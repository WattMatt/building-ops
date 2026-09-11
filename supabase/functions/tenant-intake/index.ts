// tenant-intake — the public "report a problem" endpoint behind a per-building QR token (spec §5.10,
// R4c Task 2). The tenant has no account: the token IS the credential (`verify_jwt = false`). It is
// resolved with the service role; a malformed, unknown or disabled token — or the org's
// features.tenant_intake flag being off — answers the same 404.
//
// The token arrives in `?t=` on BOTH verbs, so it is resolved — and the buckets charged — before a
// request body is ever read. Three hashed rate buckets, each with a different job (R4c review):
//
//   attempts   per address, high cap, charged on every request of either verb before anything is
//              resolved or parsed. This is the bucket that absorbs abuse.
//   address    per address AND token, the everyday throttle. Keyed on both so a shopping centre
//              behind one connection cannot exhaust another building's allowance.
//   token      the building's own 20/hour, SPENT only by a submission that is actually stored. The
//              token is printed on a poster by design, so junk posts must never silence a building.
//
// POST drops honeypot hits without storing anything, uploads at most three photos under
// intake/<building>/ (a prefix no session can write, and swept again if the insert fails), inserts
// the issue with a reference the tenant keeps, and notifies the admins/managers plus the building's
// assignee. Nothing here logs a token, an address, a reference or a reporter field — counts and
// statuses only.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { escapeText } from "../_shared/email.ts";
import { adminAndManagerIds, createNotifications } from "../_shared/notify.ts";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const BUCKET = "tenant-documents";
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
/** Stored submissions per token per hour. Spent on success only. */
const TOKEN_LIMIT_PER_HOUR = 20;
/** Submissions attempted from one address for ONE token per hour. */
const ADDRESS_LIMIT_PER_HOUR = 5;
/** Any request from one address per hour, whatever it carries. Deliberately generous. */
const ATTEMPT_LIMIT_PER_HOUR = 120;
const SHOP_CAP = 500;
const REFERENCE_ATTEMPTS = 5;
const PHOTO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REFERENCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const LIMITS = { title: 120, description: 2000, name: 80, shop_number: 20, phone: 30, email: 120 } as const;

/** What a tenant can pick; stored on issues.category. Mirrored nowhere — the page reads it from GET. */
const INTAKE_CATEGORIES = [
  "Electrical", "Plumbing", "Air-conditioning / HVAC", "Lighting", "Doors, locks & shopfront",
  "Roof & leaks", "Cleaning & waste", "Pests", "Security", "Parking", "Other",
] as const;

type Json = Record<string, unknown>;
function json(status: number, body: Json, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
/** Malformed, unknown, disabled, and flag-off all look identical from outside. */
const notFound = (cors: Record<string, string>) => json(404, { error: "not_found" }, cors);
const rateLimited = (cors: Record<string, string>) =>
  json(429, { error: "rate_limited" }, { ...cors, "Retry-After": "3600" });

/** `FO-` + 6 base32 characters (RFC 4648 alphabet, `byte & 31`). */
function mintReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = "";
  for (const b of bytes) s += REFERENCE_ALPHABET[b & 31];
  return `FO-${s}`;
}

/**
 * The connecting address, as trustworthy as this runtime can make it.
 *
 * A caller can send its own `x-forwarded-for`. A gateway that APPENDS the peer address rather than
 * replacing the header therefore leaves an attacker-chosen value in FRONT — so the first hop is
 * attacker-controlled and worthless as a rate-limit key (a fresh value per request would mint a
 * fresh bucket every time). The LAST hop is the one the closest proxy wrote, so that is what we
 * take. Better still is a header the platform itself sets from the TCP peer and a client cannot
 * forge — `cf-connecting-ip` on the Cloudflare edge that fronts Supabase functions, `fly-client-ip`
 * on Fly, `x-real-ip` on a local `functions serve` — so those win when present.
 *
 * The value is only ever hashed with INTAKE_IP_SALT. It is never logged and never stored.
 */
function clientAddress(req: Request): string {
  const direct = req.headers.get("cf-connecting-ip")
    ?? req.headers.get("fly-client-ip")
    ?? req.headers.get("x-real-ip");
  if (direct?.trim()) return direct.trim();
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops.length ? hops[hops.length - 1] : "";
}

/** 32 hex chars of sha256(salt ':' address [':' scope]). The raw address never leaves this function. */
async function addressBucket(salt: string, address: string, scope?: string): Promise<string> {
  const parts = [salt, address || "unknown", ...(scope ? [scope] : [])];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join(":")));
  return "ip:" + Array.from(new Uint8Array(digest)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Single-line fields: every run of whitespace becomes one space. */
const clean = (v: FormDataEntryValue | null, max: number): string =>
  (typeof v === "string" ? v : "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The description is the one field a tenant writes more than a phrase into, and collapsing all
 * whitespace turned a multi-paragraph report into a single line. Horizontal whitespace still
 * collapses to one space; line breaks survive, normalised to `\n` and capped at one blank line.
 */
const cleanMultiline = (v: FormDataEntryValue | null, max: number): string =>
  (typeof v === "string" ? v : "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);

type TokenRow = { id: string; building_id: string; is_active: boolean; created_by: string | null };
type OrgSettings = { features?: { tenant_intake?: unknown }; intake?: { show_shop_names?: unknown } };
type OrgRow = { name?: string | null; logo_url?: string | null; primary_color?: string | null; settings?: OrgSettings | null };
type Resolved = { token: TokenRow; buildingName: string; org: OrgRow };

// The untyped service-role client, exactly as _shared/reportAccess.ts names it: the intake tables
// are not in the generated Database types, and this function never runs through them anyway.
type Admin = ReturnType<typeof createClient>;

/** Token row + flag + building name + the org row the GET renders, or null for every reason the caller must not learn. */
async function resolve(admin: Admin, token: string): Promise<Resolved | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data: row, error } = await admin
    .from("intake_tokens")
    .select("id, building_id, is_active, created_by")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  const t = row as TokenRow | null;
  if (!t || !t.is_active) return null;
  // Ship dark until the owner switches the flag on (organizations.settings is R4a's column).
  const { data: orgRow, error: orgErr } = await admin
    .from("organizations")
    .select("name, logo_url, primary_color, settings")
    .limit(1)
    .maybeSingle();
  if (orgErr) throw orgErr;
  const org = (orgRow ?? {}) as OrgRow;
  if (org.settings?.features?.tenant_intake !== true) return null;
  const { data: b, error: bErr } = await admin.from("buildings").select("name").eq("id", t.building_id).maybeSingle();
  if (bErr) throw bErr;
  if (!b) return null;
  return { token: t, buildingName: (b as { name: string | null }).name ?? "Building", org };
}

/** Best-effort sweep of this request's uploads. Nothing else ever visits the intake prefix. */
async function discardUploads(admin: Admin, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await admin.storage.from(BUCKET).remove(paths);
  if (error) console.error("tenant-intake: could not remove orphaned uploads:", error.message ?? error);
  else console.log("tenant-intake: swept orphaned uploads", { photos: paths.length });
}

async function handleGet(admin: Admin, resolved: Resolved, cors: Record<string, string>): Promise<Response> {
  // Shop NAMES are the building's tenant roster, and this endpoint is unauthenticated: anyone who
  // photographs the poster can read it. A shop NUMBER is all the form needs to identify a unit, so
  // names ship only when the owner has opted in with organizations.settings.intake.show_shop_names
  // — and when they have not, the column is not even selected.
  const showNames = resolved.org.settings?.intake?.show_shop_names === true;
  const { data: shops, error: shopErr } = await admin
    .from("building_tenants")
    .select(showNames ? "shop_number, shop_name" : "shop_number")
    .eq("building_id", resolved.token.building_id)
    .or("is_active.is.null,is_active.eq.true")
    .not("shop_number", "is", null)
    .order("shop_number")
    .limit(SHOP_CAP);
  if (shopErr) throw shopErr;
  const o = resolved.org;
  const color = typeof o.primary_color === "string" && /^#?[0-9a-f]{6}$/i.test(o.primary_color)
    ? (o.primary_color.startsWith("#") ? o.primary_color : `#${o.primary_color}`)
    : "#2563eb";
  console.log("tenant-intake: served", { method: "GET", shops: shops?.length ?? 0, names: showNames ? 1 : 0 });
  return json(200, {
    building: { name: resolved.buildingName },
    org: { name: o.name?.trim() || "Building Ops", logoUrl: o.logo_url ?? null, primaryColor: color },
    shops: ((shops ?? []) as { shop_number: string; shop_name?: string | null }[]).map((s) => ({
      shopNumber: s.shop_number,
      shopName: showNames ? (s.shop_name ?? "") : "",
    })),
    categories: INTAKE_CATEGORIES,
  }, cors);
}

async function handlePost(
  req: Request,
  admin: Admin,
  resolved: Resolved,
  salt: string,
  address: string,
  cors: Record<string, string>,
): Promise<Response> {
  const { token, buildingName } = resolved;

  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("multipart/form-data")) {
    return json(400, { error: "invalid", fields: ["body"] }, cors);
  }
  // A chunked POST declares no length, and `Number(null ?? "0")` used to make that a 0 that sailed
  // through the cap below — the whole body was then parsed anyway. Every client of ours sends a
  // FormData body, whose length fetch computes, so a POST without a declared length is refused
  // rather than read.
  const declaredHeader = req.headers.get("content-length");
  const declared = Number(declaredHeader);
  if (declaredHeader === null || declaredHeader.trim() === "" || !Number.isFinite(declared) || declared < 0) {
    return json(411, { error: "length_required" }, cors);
  }
  if (declared > MAX_BODY_BYTES) return json(413, { error: "too_large" }, cors);

  // This address, for THIS token. Keyed on both: a centre behind one connection used to get five
  // reports an hour across every building it could see.
  const { data: addressOk, error: addressErr } = await admin.rpc("intake_rate_hit", {
    p_bucket: await addressBucket(salt, address, token.id),
    p_limit: ADDRESS_LIMIT_PER_HOUR,
  });
  if (addressErr) throw addressErr;
  if (addressOk !== true) {
    console.log("tenant-intake: rate limited", { scope: "address" });
    return rateLimited(cors);
  }

  // The token's allowance is READ here and SPENT only once a submission is stored (below). Twenty
  // junk posts against a token that is printed at the door must not silence the building.
  const tokenBucket = `t:${token.id}`;
  const { data: tokenOk, error: tokenErr } = await admin.rpc("intake_rate_check", {
    p_bucket: tokenBucket,
    p_limit: TOKEN_LIMIT_PER_HOUR,
  });
  if (tokenErr) throw tokenErr;
  if (tokenOk !== true) {
    console.log("tenant-intake: rate limited", { scope: "token" });
    return rateLimited(cors);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "invalid", fields: ["body"] }, cors);
  }

  // Honeypot: a filled hidden field is a bot. Answer like a success (a fresh, unstored reference)
  // so the sender learns nothing, and store nothing.
  if (clean(form.get("website"), 10)) {
    console.log("tenant-intake: served", { method: "POST", honeypot: 1 });
    return json(201, { reference: mintReference() }, cors);
  }

  const title = clean(form.get("title"), LIMITS.title);
  const description = cleanMultiline(form.get("description"), LIMITS.description);
  const name = clean(form.get("name"), LIMITS.name);
  const shopNumber = clean(form.get("shop_number"), LIMITS.shop_number);
  const phone = clean(form.get("phone"), LIMITS.phone);
  const email = clean(form.get("email"), LIMITS.email).toLowerCase();
  const categoryRaw = clean(form.get("category"), 64);
  const category = (INTAKE_CATEGORIES as readonly string[]).includes(categoryRaw) ? categoryRaw : null;
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);

  const invalid: string[] = [];
  if (!title) invalid.push("title");
  if (!description) invalid.push("description");
  if (!name) invalid.push("name");
  if (email && !EMAIL_RE.test(email)) invalid.push("email");
  if (files.length > MAX_PHOTOS || files.some((f) => !PHOTO_EXT[f.type] || f.size > MAX_PHOTO_BYTES)) invalid.push("photos");

  // A shop number is optional, but one that is given must be a real shop in this building; the
  // tenant row's name and unit go onto the issue so the team knows where to go.
  let shop: string | null = null;
  let unit: string | null = null;
  if (shopNumber) {
    const { data: tenant, error } = await admin
      .from("building_tenants")
      .select("shop_name, unit_number")
      .eq("building_id", token.building_id)
      .eq("shop_number", shopNumber)
      .or("is_active.is.null,is_active.eq.true")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!tenant) invalid.push("shop_number");
    else {
      shop = (tenant as { shop_name: string | null }).shop_name ?? null;
      unit = (tenant as { unit_number: string | null }).unit_number ?? null;
    }
  }
  if (invalid.length) return json(400, { error: "invalid", fields: invalid }, cors);

  // Photos: service-role upload under the intake prefix. The stored value is the public-style
  // URL, the same shape src/lib/photos.ts writes, so SignedImage re-signs it on read. Every path is
  // remembered: the uploads happen before the insert, so any failure after this point has to sweep
  // them — nothing else ever walks the intake prefix.
  const uploaded: string[] = [];
  const photoUrls: string[] = [];
  for (const f of files) {
    const path = `intake/${token.building_id}/${crypto.randomUUID()}.${PHOTO_EXT[f.type]}`;
    const { error } = await admin.storage.from(BUCKET).upload(path, await f.arrayBuffer(), { contentType: f.type, upsert: false });
    if (error) {
      console.error("tenant-intake: upload failed:", error.message ?? error);
      await discardUploads(admin, uploaded);
      return json(500, { error: "upload_failed" }, cors);
    }
    uploaded.push(path);
    photoUrls.push(admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
  }

  try {
    // Who acts on it: the building's 'issue' rule, else its 'user' rule, else nobody.
    const { data: rules, error: rulesErr } = await admin
      .from("building_role_assignments")
      .select("role, user_id")
      .eq("building_id", token.building_id)
      .in("role", ["issue", "user"]);
    if (rulesErr) throw rulesErr;
    const ruleFor = (role: string) => ((rules ?? []) as { role: string; user_id: string }[]).find((r) => r.role === role)?.user_id ?? null;
    const assignee = ruleFor("issue") ?? ruleFor("user");

    // reported_by is not null on issues: the token creator, or the first admin if that account is gone.
    const admins = await adminAndManagerIds(admin);
    let reportedBy = token.created_by;
    if (!reportedBy) {
      const { data } = await admin.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
      reportedBy = (data as { user_id: string } | null)?.user_id ?? admins[0] ?? null;
    }
    if (!reportedBy) {
      console.error("tenant-intake: no account to report under");
      await discardUploads(admin, uploaded);
      return json(500, { error: "unavailable" }, cors);
    }

    const reporter = { name, shop_number: shopNumber || null, shop, unit, phone: phone || null, email: email || null };
    const issueId = crypto.randomUUID();
    let reference = "";
    for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt++) {
      reference = mintReference();
      const { error } = await admin.from("issues").insert({
        id: issueId,
        building_id: token.building_id,
        title,
        description,
        category,
        priority: "medium",
        status: "open",
        reported_by: reportedBy,
        assigned_to: assignee,
        source: "tenant_intake",
        reporter,
        reference,
        photo_urls: photoUrls.length ? photoUrls : null,
      });
      if (!error) break;
      // 23505 on the reference's partial unique index → mint another; anything else is fatal.
      if (error.code !== "23505" || attempt === REFERENCE_ATTEMPTS - 1) throw error;
      reference = "";
    }

    // Counters ride after the response (the same waitUntil pattern as ics-feed's last_used_at).
    // The token's own hourly allowance is spent right here, next to the touch, because only a
    // submission that is actually stored may cost the building one of its twenty.
    const { error: spendErr } = await admin.rpc("intake_rate_hit", { p_bucket: tokenBucket, p_limit: TOKEN_LIMIT_PER_HOUR });
    if (spendErr) console.warn("tenant-intake: intake_rate_hit (token) failed:", spendErr.message ?? spendErr);
    const touch = admin.rpc("intake_touch", { p_token: token.id }).then(({ error }: { error: { message?: string } | null }) => {
      if (error) console.warn("tenant-intake: intake_touch failed:", error.message ?? error);
    });
    const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    runtime?.waitUntil?.(touch);

    // The issue is stored by now, so a notification failure is logged, never surfaced to the tenant.
    let notified: Record<string, number> = {};
    try {
      const recipients = Array.from(new Set([...admins, ...(assignee ? [assignee] : [])]));
      const shopLabel = shop ? `${shop} (${shopNumber})` : shopNumber ? `Shop ${shopNumber}` : "No shop given";
      const result = await createNotifications(admin, {
        recipients,
        actorId: null,
        actorName: "Tenant intake",
        kind: "issue_reported",
        entityType: "issue",
        entityId: issueId,
        buildingId: token.building_id,
        title: `Tenant reported: ${title}`,
        body: `${buildingName} · ${shopLabel} · ${name}`,
        url: `/issues?open=${issueId}`,
        subject: `Tenant report in ${buildingName}: ${title}`,
        detailHtml: `<p style="margin:0 0 12px;">A tenant reported a problem in <strong>${escapeText(buildingName)}</strong> through the intake form (reference ${escapeText(reference)}).${assignee ? "" : " Nobody is assigned yet."}</p>`,
        bodyLabel: "Where and who",
        ctaText: "Open the issue",
        pushTo: assignee ? [assignee] : admins,
      });
      notified = { inserted: result.inserted, pushed: result.pushed, emailed: result.emailed, failed: result.failed };
    } catch (e) {
      console.error("tenant-intake: notify failed:", e instanceof Error ? e.message : e);
    }

    console.log("tenant-intake: served", { method: "POST", photos: photoUrls.length, assigned: assignee ? 1 : 0, notified });
    return json(201, { reference }, cors);
  } catch (e) {
    // The photos are in the bucket already and the issue that would have referenced them does not
    // exist, so they would sit under the intake prefix forever. Sweep before the error goes up.
    await discardUploads(admin, uploaded);
    throw e;
  }
}

serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET" && req.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, { ...cors, Allow: "GET, POST, OPTIONS" });
  }
  try {
    // Both verbs charge a bucket, so the salt is required to serve at all — the GET hands out a
    // building's shop list and used to be pollable for free.
    const salt = Deno.env.get("INTAKE_IP_SALT");
    if (!salt) {
      console.error("tenant-intake: INTAKE_IP_SALT is not set; refusing to serve");
      return json(500, { error: "unavailable" }, cors);
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const address = clientAddress(req);
    // A request with no address header at all shares one bucket — logged once so it is never a
    // silent cap. The address itself is never logged.
    if (!address) console.warn("tenant-intake: no connecting-address header; using the shared bucket");

    // Charged first, on every request of either verb, before a token is resolved or a body read.
    const { data: attemptOk, error: attemptErr } = await admin.rpc("intake_rate_hit", {
      p_bucket: await addressBucket(salt, address),
      p_limit: ATTEMPT_LIMIT_PER_HOUR,
    });
    if (attemptErr) throw attemptErr;
    if (attemptOk !== true) {
      console.log("tenant-intake: rate limited", { scope: "attempts", method: req.method });
      return rateLimited(cors);
    }

    // `?t=` on both verbs: on POST it is what lets the token be resolved and the buckets charged
    // before `req.formData()` is called on a stranger's body.
    const resolved = await resolve(admin, new URL(req.url).searchParams.get("t") ?? "");
    if (!resolved) return notFound(cors);
    if (req.method === "GET") return await handleGet(admin, resolved, cors);
    return await handlePost(req, admin, resolved, salt, address, cors);
  } catch (error) {
    // The message may name a table or column, never the token or the tenant (neither is interpolated).
    console.error("tenant-intake error:", error instanceof Error ? error.message : error);
    return json(500, { error: "unavailable" }, cors);
  }
});
