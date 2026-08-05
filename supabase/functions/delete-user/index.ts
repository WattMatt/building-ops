import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type AdminClient = ReturnType<typeof createClient>;

/**
 * Best-effort removal of the target's personal storage objects — the avatar
 * only. Evidence photos under tenant-documents/photos/<uid> belong to the
 * issues, task completions and form submissions that outlive the account, so
 * they are never touched here.
 */
async function purgeUserStorage(adminClient: AdminClient, userId: string) {
  const targets = [
    { bucket: "avatars", prefix: userId },
  ];

  for (const { bucket, prefix } of targets) {
    try {
      const { data: objects, error: listErr } = await adminClient.storage
        .from(bucket).list(prefix, { limit: 1000 });
      if (listErr) {
        console.error(`delete-user: storage list failed (${bucket}/${prefix}):`, listErr.message);
        continue;
      }
      // Entries with a null id are sub-folders, not objects.
      const paths = (objects ?? []).filter((o) => o.id !== null).map((o) => `${prefix}/${o.name}`);
      if (paths.length === 0) continue;

      const { error: rmErr } = await adminClient.storage.from(bucket).remove(paths);
      if (rmErr) {
        console.error(`delete-user: storage remove failed (${bucket}/${prefix}):`, rmErr.message);
      }
    } catch (e) {
      console.error(`delete-user: storage purge failed (${bucket}/${prefix}):`, e);
    }
  }
}

/**
 * user_roles can hold several rows per user (it carries building_id), so the
 * role is read as a set, never as a single row. Returns null when the lookup
 * failed — callers must treat that as "deny".
 */
async function hasAdminRole(adminClient: AdminClient, userId: string): Promise<boolean | null> {
  const { data, error } = await adminClient
    .from("user_roles").select("role").eq("user_id", userId);
  if (error) {
    console.error(`delete-user: role lookup failed (${userId}):`, error.message);
    return null;
  }
  return (data ?? []).some((r) => r.role === "admin");
}

/**
 * Admins who can still sign in, excluding `excludeUserId`. A deactivated admin
 * is banned in auth, so counting their role rows would let the org drop to zero
 * usable administrators. Returns null when the state cannot be established.
 */
async function countOtherActiveAdmins(
  adminClient: AdminClient,
  excludeUserId: string,
): Promise<number | null> {
  const { data: adminRows, error: rolesErr } = await adminClient
    .from("user_roles").select("user_id").eq("role", "admin");
  if (rolesErr) {
    console.error("delete-user: admin role list failed:", rolesErr.message);
    return null;
  }

  const ids = [...new Set((adminRows ?? []).map((r) => String(r.user_id)))]
    .filter((id) => id !== excludeUserId);
  if (ids.length === 0) return 0;

  const { data: active, error: profileErr } = await adminClient
    .from("profiles").select("id").in("id", ids).not("deactivated", "is", true);
  if (profileErr) {
    console.error("delete-user: active admin lookup failed:", profileErr.message);
    return null;
  }
  return new Set((active ?? []).map((p) => String(p.id))).size;
}

/**
 * Admin hard-delete of ANOTHER user (distinct from delete-account, which is a
 * caller self-delete). Permanent and irreversible — the UI gates it behind a
 * typed-email confirmation. Guards mirror set-user-status: an admin cannot
 * delete themselves, and the last active admin cannot be deleted.
 */
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

    // Authorize: caller must be an admin
    const callerIsAdmin = await hasAdminRole(adminClient, caller.id);
    if (callerIsAdmin !== true) {
      return json({ error: "Forbidden: admin role required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const userId = String(body.userId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "Valid userId is required" }, 400);

    // Guardrails
    if (userId === caller.id) {
      return json({ error: "You cannot delete your own account" }, 400);
    }
    const targetIsAdmin = await hasAdminRole(adminClient, userId);
    if (targetIsAdmin === null) {
      return json({ error: "Unable to verify the target account" }, 403);
    }
    if (targetIsAdmin) {
      const others = await countOtherActiveAdmins(adminClient, userId);
      if (others === null) {
        return json({ error: "Unable to verify the target account" }, 403);
      }
      if (others < 1) return json({ error: "Cannot delete the last remaining admin" }, 400);
    }

    // Auth row first: while it exists the user can still sign in, so a failure
    // part-way through must never leave them without a profile or role.
    const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
    const alreadyGone = !!delErr &&
      ((delErr as { status?: number }).status === 404 || /not.*found/i.test(delErr.message));
    if (delErr && !alreadyGone) {
      console.error("delete-user: auth delete failed:", delErr.message);
      return json({ error: "Failed to delete user" }, 500);
    }

    // Only now that the account is gone for good: irreversible object removal
    // must never run ahead of an operation that can still abort.
    await purgeUserStorage(adminClient, userId);

    // Sweep anything the auth.users cascade did not reach. The account is
    // already unusable at this point, so failures are logged, not fatal.
    const residual: Array<[string, string]> = [
      ["user_buildings", "user_id"],
      ["user_roles", "user_id"],
      ["profiles", "id"],
    ];
    for (const [table, column] of residual) {
      const { error } = await adminClient.from(table).delete().eq(column, userId);
      if (error) {
        console.error(`delete-user: residual cleanup failed on ${table}:`, error.message);
      }
    }

    // Audit (caller persists, so user_id FK is safe; entity_id records the target).
    const { error: auditErr } = await adminClient.from("audit_logs").insert({
      action: "delete_user",
      entity_type: "user",
      entity_id: userId,
      user_id: caller.id,
    });
    if (auditErr) console.error("delete-user: audit insert failed:", auditErr.message);

    return json({ status: "deleted", userId });
  } catch (e) {
    console.error("delete-user error:", e);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
