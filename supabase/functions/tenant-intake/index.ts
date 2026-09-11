// tenant-intake — the public "report a problem" endpoint behind a per-building QR token (spec §5.10,
// R4c Task 2). The tenant has no account: the token IS the credential (`verify_jwt = false`). It is
// resolved with the service role; a malformed, unknown or disabled token — or the org's
// features.tenant_intake flag being off — answers the same 404. POST is rate-limited per token and
// per hashed IP, drops honeypot hits without storing anything, uploads at most three photos under
// intake/<building>/ (a prefix no session can write), inserts the issue with a reference the tenant
// keeps, and notifies the admins/managers plus the building's assignee. Nothing here logs a token,
// an IP, a reference or a reporter field — counts and statuses only.

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
const TOKEN_LIMIT_PER_HOUR = 20;
const IP_LIMIT_PER_HOUR = 5;
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

/** `FO-` + 6 base32 characters (RFC 4648 alphabet, `byte & 31`). */
function mintReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = "";
  for (const b of bytes) s += REFERENCE_ALPHABET[b & 31];
  return `FO-${s}`;
}

/** 32 hex chars of sha256(salt ':' ip). The raw address never leaves this function. */
async function ipBucket(req: Request, salt: string): Promise<string> {
  // Supabase's gateway sets x-forwarded-for; x-real-ip is the fallback for a local `functions serve`.
  // A request with neither shares one "unknown" bucket — logged once so it is never a silent 5/hour cap.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip")?.trim() || "";
  if (!ip) console.warn("tenant-intake: no client address header; using the shared bucket");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip || "unknown"}`));
  return "ip:" + Array.from(new Uint8Array(digest)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const clean = (v: FormDataEntryValue | null, max: number): string =>
  (typeof v === "string" ? v : "").replace(/\s+/g, " ").trim().slice(0, max);

type TokenRow = { id: string; building_id: string; is_active: boolean; created_by: string | null };
type Resolved = { token: TokenRow; buildingName: string };

// The untyped service-role client, exactly as _shared/reportAccess.ts names it: the intake tables
// are not in the generated Database types, and this function never runs through them anyway.
type Admin = ReturnType<typeof createClient>;

/** Token row + flag + building name, or null for every reason the caller must not learn. */
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
  const { data: org, error: orgErr } = await admin.from("organizations").select("settings").limit(1).maybeSingle();
  if (orgErr) throw orgErr;
  const flag = (org as { settings?: { features?: { tenant_intake?: unknown } } } | null)?.settings?.features?.tenant_intake;
  if (flag !== true) return null;
  const { data: b, error: bErr } = await admin.from("buildings").select("name").eq("id", t.building_id).maybeSingle();
  if (bErr) throw bErr;
  if (!b) return null;
  return { token: t, buildingName: (b as { name: string | null }).name ?? "Building" };
}

async function handleGet(admin: Admin, resolved: Resolved, cors: Record<string, string>): Promise<Response> {
  const [{ data: shops, error: shopErr }, { data: org, error: orgErr }] = await Promise.all([
    admin
      .from("building_tenants")
      .select("shop_number, shop_name")
      .eq("building_id", resolved.token.building_id)
      .or("is_active.is.null,is_active.eq.true")
      .not("shop_number", "is", null)
      .order("shop_number")
      .limit(SHOP_CAP),
    admin.from("organizations").select("name, logo_url, primary_color").limit(1).maybeSingle(),
  ]);
  if (shopErr) throw shopErr;
  if (orgErr) throw orgErr;
  const o = (org ?? {}) as { name?: string | null; logo_url?: string | null; primary_color?: string | null };
  const color = typeof o.primary_color === "string" && /^#?[0-9a-f]{6}$/i.test(o.primary_color)
    ? (o.primary_color.startsWith("#") ? o.primary_color : `#${o.primary_color}`)
    : "#2563eb";
  console.log("tenant-intake: served", { method: "GET", shops: shops?.length ?? 0 });
  return json(200, {
    building: { name: resolved.buildingName },
    org: { name: o.name?.trim() || "Building Ops", logoUrl: o.logo_url ?? null, primaryColor: color },
    shops: ((shops ?? []) as { shop_number: string; shop_name: string | null }[]).map((s) => ({
      shopNumber: s.shop_number,
      shopName: s.shop_name ?? "",
    })),
    categories: INTAKE_CATEGORIES,
  }, cors);
}

async function handlePost(req: Request, admin: Admin, cors: Record<string, string>): Promise<Response> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("multipart/form-data")) {
    return json(400, { error: "invalid", fields: ["body"] }, cors);
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json(413, { error: "too_large" }, cors);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "invalid", fields: ["body"] }, cors);
  }

  const resolved = await resolve(admin, clean(form.get("t"), 64));
  if (!resolved) return notFound(cors);
  const { token, buildingName } = resolved;

  const salt = Deno.env.get("INTAKE_IP_SALT");
  if (!salt) {
    console.error("tenant-intake: INTAKE_IP_SALT is not set; refusing to accept submissions");
    return json(500, { error: "unavailable" }, cors);
  }

  // Both buckets are counted before either verdict is read: a burst that trips one limit still
  // burns the other, so alternating tokens from one address does not double the allowance.
  const [tokOk, ipOk] = await Promise.all([
    admin.rpc("intake_rate_hit", { p_bucket: `t:${token.id}`, p_limit: TOKEN_LIMIT_PER_HOUR }),
    admin.rpc("intake_rate_hit", { p_bucket: await ipBucket(req, salt), p_limit: IP_LIMIT_PER_HOUR }),
  ]);
  if (tokOk.error) throw tokOk.error;
  if (ipOk.error) throw ipOk.error;
  if (tokOk.data !== true || ipOk.data !== true) {
    console.log("tenant-intake: rate limited", { token: tokOk.data !== true, ip: ipOk.data !== true });
    return json(429, { error: "rate_limited" }, { ...cors, "Retry-After": "3600" });
  }

  // Honeypot: a filled hidden field is a bot. Answer like a success (a fresh, unstored reference)
  // so the sender learns nothing, and store nothing.
  if (clean(form.get("website"), 10)) {
    console.log("tenant-intake: served", { method: "POST", honeypot: 1 });
    return json(201, { reference: mintReference() }, cors);
  }

  const title = clean(form.get("title"), LIMITS.title);
  const description = clean(form.get("description"), LIMITS.description);
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
  // URL, the same shape src/lib/photos.ts writes, so SignedImage re-signs it on read.
  const photoUrls: string[] = [];
  for (const f of files) {
    const path = `intake/${token.building_id}/${crypto.randomUUID()}.${PHOTO_EXT[f.type]}`;
    const { error } = await admin.storage.from(BUCKET).upload(path, await f.arrayBuffer(), { contentType: f.type, upsert: false });
    if (error) {
      console.error("tenant-intake: upload failed:", error.message ?? error);
      return json(500, { error: "upload_failed" }, cors);
    }
    photoUrls.push(admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
  }

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
}

serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET" && req.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, { ...cors, Allow: "GET, POST, OPTIONS" });
  }
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (req.method === "GET") {
      const resolved = await resolve(admin, new URL(req.url).searchParams.get("t") ?? "");
      if (!resolved) return notFound(cors);
      return await handleGet(admin, resolved, cors);
    }
    return await handlePost(req, admin, cors);
  } catch (error) {
    // The message may name a table or column, never the token or the tenant (neither is interpolated).
    console.error("tenant-intake error:", error instanceof Error ? error.message : error);
    return json(500, { error: "unavailable" }, cors);
  }
});
