// report-share — public share links for issued report PDFs (spec §5.8).
// GET ?t=   → metadata; POST {t, passcode?} → 10-minute signed URL; POST {action:'create'} (JWT) → new link.
// No user JWT on the public paths (verify_jwt = false): the token IS the credential. Rows are read with
// the service role. Every public failure that could reveal whether a token exists answers the same 404;
// the only other public status is 429 while a passcode lockout is running. The function never generates
// a PDF (spec §3): it serves exactly the artifact the share row pins. Logs carry counts and reasons only —
// never a token, a passcode, a hash or an email.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { callerId, canAccessBuilding, isAdminOrManager, type Admin } from "../_shared/reportAccess.ts";
import { EXPIRY_DAYS_ALLOWED, PASSCODE_MAX, PASSCODE_MIN, TOKEN_RE, passcodeHash } from "../_shared/distribution.ts";

const SHARE_SALT = Deno.env.get("SHARE_SALT") ?? "";
const SIGNED_URL_TTL = 600;
const MAX_FAILURES = 10;
const LOCK_MINUTES = 15;
const BUCKET = "generated-reports";

type ShareRow = {
  id: string;
  report_id: string;
  artifact_id: string;
  expires_at: string;
  revoked_at: string | null;
  passcode_hash: string | null;
  failed_attempts: number;
  locked_until: string | null;
  view_count: number;
};

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors },
  });
/** Malformed, unknown, revoked, expired and orphaned tokens all look identical from outside. */
const notFound = (cors: Record<string, string>) =>
  new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...cors },
  });

/** The share row for a token that is well-formed, known, not revoked and not expired; otherwise null. */
async function loadLiveShare(admin: Admin, token: string): Promise<ShareRow | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data, error } = await admin
    .from("report_shares")
    .select("id, report_id, artifact_id, expires_at, revoked_at, passcode_hash, failed_attempts, locked_until, view_count")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  const row = data as ShareRow | null;
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return json(cors, { error: "method" }, 405);
  if (!SHARE_SALT) {
    console.error("report-share: SHARE_SALT not set");
    return json(cors, { error: "unavailable" }, 503);
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // ── Public metadata ──
    if (req.method === "GET") {
      const token = new URL(req.url).searchParams.get("t") ?? "";
      const share = await loadLiveShare(admin, token);
      if (!share) {
        console.log("report-share: get", { ok: false });
        return notFound(cors);
      }
      const [{ data: report }, { data: artifact }] = await Promise.all([
        admin.from("reports").select("title, report_type, report_period, status, building_id").eq("id", share.report_id).maybeSingle(),
        admin.from("report_artifacts").select("file_name, report_status, created_at").eq("id", share.artifact_id).maybeSingle(),
      ]);
      if (!report || !artifact) {
        console.log("report-share: get", { ok: false, reason: "orphan" });
        return notFound(cors);
      }
      const { data: building } = await admin.from("buildings").select("name").eq("id", report.building_id).maybeSingle();
      console.log("report-share: get", { ok: true, needsPasscode: !!share.passcode_hash });
      return json(cors, {
        building: building?.name ?? "Building",
        title: report.title,
        type: report.report_type,
        period: report.report_period,
        reportStatus: artifact.report_status ?? report.status,
        issuedAt: artifact.created_at,
        expiresAt: share.expires_at,
        needsPasscode: !!share.passcode_hash,
      });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(cors, { error: "bad body" }, 400);

    // ── Authenticated create (the only path that can set a passcode: the hash needs SHARE_SALT) ──
    if (body.action === "create") {
      const uid = await callerId(req);
      if (!uid) return json(cors, { error: "unauthorized" }, 401);
      if (!(await isAdminOrManager(admin, uid))) return json(cors, { error: "forbidden" }, 403);
      const { reportId, artifactId, token, expiresInDays, passcode } = body;
      if (typeof reportId !== "string" || typeof artifactId !== "string" || typeof token !== "string" || !TOKEN_RE.test(token)) {
        return json(cors, { error: "bad body" }, 400);
      }
      if (!(EXPIRY_DAYS_ALLOWED as readonly number[]).includes(expiresInDays as number)) return json(cors, { error: "bad expiry" }, 400);
      if (passcode !== undefined && (typeof passcode !== "string" || passcode.length < PASSCODE_MIN || passcode.length > PASSCODE_MAX)) {
        return json(cors, { error: "bad passcode" }, 400);
      }
      const { data: report } = await admin.from("reports").select("id, building_id").eq("id", reportId).maybeSingle();
      if (!report) return json(cors, { error: "bad report" }, 400);
      if (!(await canAccessBuilding(admin, uid, report.building_id))) return json(cors, { error: "forbidden" }, 403);
      const { data: artifact } = await admin.from("report_artifacts").select("id, source_id").eq("id", artifactId).maybeSingle();
      if (!artifact || artifact.source_id !== reportId) return json(cors, { error: "bad artifact" }, 400);
      const expiresAt = new Date(Date.now() + (expiresInDays as number) * 86_400_000).toISOString();
      const hash = typeof passcode === "string" ? await passcodeHash(passcode, token, SHARE_SALT) : null;
      const { data: row, error } = await admin
        .from("report_shares")
        .insert({ report_id: reportId, artifact_id: artifactId, token, created_by: uid, expires_at: expiresAt, passcode_hash: hash })
        .select("id, token, expires_at")
        .single();
      if (error || !row) {
        console.log("report-share: create", { ok: false, code: error?.code ?? "no row" });
        return json(cors, { error: error?.code === "23505" ? "token taken" : "insert failed" }, 400);
      }
      console.log("report-share: create", { ok: true, passcode: !!hash, days: expiresInDays });
      return json(cors, { id: row.id, token: row.token, expiresAt: row.expires_at });
    }

    // ── Public open ──
    const token = typeof body.t === "string" ? body.t : "";
    const share = await loadLiveShare(admin, token);
    if (!share) {
      console.log("report-share: open", { ok: false });
      return notFound(cors);
    }
    if (share.locked_until && new Date(share.locked_until).getTime() > Date.now()) {
      const retryAfterSeconds = Math.ceil((new Date(share.locked_until).getTime() - Date.now()) / 1000);
      console.log("report-share: open", { ok: false, reason: "locked" });
      return json({ ...cors, "Retry-After": String(retryAfterSeconds) }, { error: "locked", retryAfterSeconds }, 429);
    }
    if (share.passcode_hash) {
      const passcode = typeof body.passcode === "string" ? body.passcode : "";
      const ok = passcode.length >= PASSCODE_MIN && passcode.length <= PASSCODE_MAX &&
        (await passcodeHash(passcode, token, SHARE_SALT)) === share.passcode_hash;
      if (!ok) {
        // The 10th consecutive failure locks the link for 15 minutes and resets the counter.
        const failures = share.failed_attempts + 1;
        const patch = failures >= MAX_FAILURES
          ? { failed_attempts: 0, locked_until: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() }
          : { failed_attempts: failures };
        await admin.from("report_shares").update(patch).eq("id", share.id);
        console.log("report-share: open", { ok: false, reason: "passcode", locked: failures >= MAX_FAILURES });
        return notFound(cors);
      }
    }
    const { data: artifact } = await admin.from("report_artifacts").select("file_path, file_name").eq("id", share.artifact_id).maybeSingle();
    if (!artifact) {
      console.log("report-share: open", { ok: false, reason: "orphan" });
      return notFound(cors);
    }
    const { data: signed, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(artifact.file_path, SIGNED_URL_TTL);
    if (signErr || !signed?.signedUrl) {
      console.error("report-share: sign failed", signErr?.message);
      return notFound(cors);
    }
    await admin
      .from("report_shares")
      .update({ view_count: share.view_count + 1, last_viewed_at: new Date().toISOString(), failed_attempts: 0, locked_until: null })
      .eq("id", share.id);
    console.log("report-share: open", { ok: true });
    return json(cors, { url: signed.signedUrl, fileName: artifact.file_name, expiresInSeconds: SIGNED_URL_TTL });
  } catch (error) {
    // The message may name a table or column, never the token (it is not interpolated anywhere).
    console.error("report-share error:", error instanceof Error ? error.message : error);
    return json(cors, { error: "unavailable" }, 500);
  }
});
