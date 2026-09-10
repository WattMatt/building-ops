import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type AdminClient = ReturnType<typeof createClient>;

const VALID_ROLES = ["admin", "manager", "user"];

/**
 * Server-side role change. Previously the admin UI wrote user_roles directly from
 * the browser, so the single most privileged operation had NONE of the guardrails
 * that deactivate/delete enforce: an admin could demote themselves — or the only
 * other admin — to a non-admin role in one click and, with self-signup disabled,
 * leave the org with no way back in. This function is the chokepoint: caller must be
 * an admin, the last active admin cannot be demoted, and you cannot strip your own
 * admin role. Mirrors set-user-status.
 */

/**
 * user_roles can hold several rows per user (it carries building_id), so the role
 * is read as a set, never as a single row. Returns null when the lookup failed —
 * callers must treat that as "deny".
 */
async function hasAdminRole(adminClient: AdminClient, userId: string): Promise<boolean | null> {
  const { data, error } = await adminClient
    .from("user_roles").select("role").eq("user_id", userId);
  if (error) {
    console.error(`set-user-role: role lookup failed (${userId}):`, error.message);
    return null;
  }
  return (data ?? []).some((r) => r.role === "admin");
}

/**
 * Admins who can still sign in, excluding `excludeUserId`. A deactivated admin keeps
 * their role rows, so counting rows alone would let the org drop to zero usable
 * administrators. Returns null when the state cannot be established.
 */
async function countOtherActiveAdmins(
  adminClient: AdminClient,
  excludeUserId: string,
): Promise<number | null> {
  const { data: adminRows, error: rolesErr } = await adminClient
    .from("user_roles").select("user_id").eq("role", "admin");
  if (rolesErr) {
    console.error("set-user-role: admin role list failed:", rolesErr.message);
    return null;
  }
  const ids = [...new Set((adminRows ?? []).map((r) => String(r.user_id)))]
    .filter((id) => id !== excludeUserId);
  if (ids.length === 0) return 0;

  const { data: active, error: profileErr } = await adminClient
    .from("profiles").select("id").in("id", ids).not("deactivated", "is", true);
  if (profileErr) {
    console.error("set-user-role: active admin lookup failed:", profileErr.message);
    return null;
  }
  return new Set((active ?? []).map((p) => String(p.id))).size;
}

serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerErr } = await userClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Invalid or expired token" }, 401);

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const callerIsAdmin = await hasAdminRole(adminClient, caller.id);
    if (callerIsAdmin !== true) {
      return json({ error: "Forbidden: admin role required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const userId = String(body.userId ?? "");
    const role = String(body.role ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "Valid userId is required" }, 400);
    if (!VALID_ROLES.includes(role)) return json({ error: "Invalid role" }, 400);

    // Guardrails: demoting an admin to a non-admin role must never remove the org's
    // last way in. This is application logic RLS cannot express — RLS only knows the
    // caller is an admin, not that this write empties the admin set.
    if (role !== "admin") {
      const targetIsAdmin = await hasAdminRole(adminClient, userId);
      if (targetIsAdmin === null) return json({ error: "Unable to verify the target account" }, 403);
      if (targetIsAdmin) {
        if (userId === caller.id) {
          return json({ error: "You cannot remove your own admin role" }, 400);
        }
        const others = await countOtherActiveAdmins(adminClient, userId);
        if (others === null) return json({ error: "Unable to verify the target account" }, 403);
        if (others < 1) return json({ error: "Cannot demote the last remaining admin" }, 400);
      }
    }

    // Upsert on user_id (prod PK) and VERIFY the write: a bare update matching zero
    // rows (e.g. a user with no role row) previously reported success while changing
    // nothing. Fail loudly instead.
    const { data: written, error: writeErr } = await adminClient
      .from("user_roles")
      .upsert({ user_id: userId, role }, { onConflict: "user_id" })
      .select("user_id, role");
    if (writeErr || !written?.[0]) {
      console.error("set-user-role write failed:", writeErr);
      return json({ error: `Role update failed: ${writeErr?.message ?? "no row written"}` }, 500);
    }

    await adminClient.from("audit_logs").insert({
      action: "user_role_change",
      entity_type: "user",
      entity_id: userId,
      user_id: caller.id,
    });

    return json({ userId, role });
  } catch (e) {
    console.error("set-user-role error:", e);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
