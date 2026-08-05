import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type AdminClient = ReturnType<typeof createClient>;

// Effectively-permanent ban = reversible deactivation (preserves the user's data + audit trail).
const DEACTIVATE_DURATION = "876000h"; // ~100 years

/**
 * user_roles can hold several rows per user (it carries building_id), so the
 * role is read as a set, never as a single row. Returns null when the lookup
 * failed — callers must treat that as "deny".
 */
async function hasAdminRole(adminClient: AdminClient, userId: string): Promise<boolean | null> {
  const { data, error } = await adminClient
    .from("user_roles").select("role").eq("user_id", userId);
  if (error) {
    console.error(`set-user-status: role lookup failed (${userId}):`, error.message);
    return null;
  }
  return (data ?? []).some((r) => r.role === "admin");
}

/**
 * Admins who can still sign in, excluding `excludeUserId`. A deactivated admin
 * keeps their role rows, so counting rows alone would let the org drop to zero
 * usable administrators. Returns null when the state cannot be established.
 */
async function countOtherActiveAdmins(
  adminClient: AdminClient,
  excludeUserId: string,
): Promise<number | null> {
  const { data: adminRows, error: rolesErr } = await adminClient
    .from("user_roles").select("user_id").eq("role", "admin");
  if (rolesErr) {
    console.error("set-user-status: admin role list failed:", rolesErr.message);
    return null;
  }

  const ids = [...new Set((adminRows ?? []).map((r) => String(r.user_id)))]
    .filter((id) => id !== excludeUserId);
  if (ids.length === 0) return 0;

  const { data: active, error: profileErr } = await adminClient
    .from("profiles").select("id").in("id", ids).not("deactivated", "is", true);
  if (profileErr) {
    console.error("set-user-status: active admin lookup failed:", profileErr.message);
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
    const action = body.action === "reactivate" ? "reactivate" : "deactivate";
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "Valid userId is required" }, 400);

    // Guardrails: an admin cannot deactivate themselves, and the last admin cannot be deactivated.
    if (action === "deactivate") {
      if (userId === caller.id) return json({ error: "You cannot deactivate your own account" }, 400);
      const targetIsAdmin = await hasAdminRole(adminClient, userId);
      if (targetIsAdmin === null) {
        return json({ error: "Unable to verify the target account" }, 403);
      }
      if (targetIsAdmin) {
        const others = await countOtherActiveAdmins(adminClient, userId);
        if (others === null) {
          return json({ error: "Unable to verify the target account" }, 403);
        }
        if (others < 1) return json({ error: "Cannot deactivate the last remaining admin" }, 400);
      }
    }

    const ban_duration = action === "deactivate" ? DEACTIVATE_DURATION : "none";
    const { error } = await adminClient.auth.admin.updateUserById(userId, { ban_duration });
    if (error) {
      console.error("set-user-status updateUserById failed:", error);
      return json({ error: "Status update failed" }, 500);
    }

    // ban_duration only blocks new sign-ins; an access token already issued
    // stays valid for the rest of its lifetime. Revoke server-side instead --
    // GoTrue's admin signOut takes a JWT, not a user id, so it cannot be used
    // here. Treated as fatal: reporting a deactivation whose sessions are still
    // live is worse than reporting a failure.
    if (action === "deactivate") {
      const { error: revokeErr } = await adminClient.rpc("revoke_user_sessions", {
        p_user_id: userId,
      });
      if (revokeErr) {
        console.error("set-user-status session revoke failed:", revokeErr);
        return json({ error: "Account was banned but active sessions could not be revoked" }, 500);
      }
    }

    // Durable status flag (client-readable; auth.users.banned_until is not).
    // Building assignments are deliberately left intact: the ban + this flag already
    // block all access, and deleting them would make reactivation non-reversible.
    const { error: profileErr } = await adminClient
      .from("profiles").update({ deactivated: action === "deactivate" }).eq("id", userId);
    if (profileErr) console.error("set-user-status profile flag update failed:", profileErr);

    await adminClient.from("audit_logs").insert({
      action: action === "deactivate" ? "deactivate_user" : "reactivate_user",
      entity_type: "user",
      entity_id: userId,
      user_id: caller.id,
    });

    return json({ userId, status: action === "deactivate" ? "deactivated" : "active" });
  } catch (e) {
    console.error("set-user-status error:", e);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
