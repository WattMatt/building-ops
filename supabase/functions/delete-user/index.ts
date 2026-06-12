import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Admin hard-delete of ANOTHER user (distinct from delete-account, which is a
 * caller self-delete). Permanent and irreversible — the UI gates it behind a
 * typed-email confirmation. Guards mirror set-user-status: an admin cannot
 * delete themselves, and the last remaining admin cannot be deleted.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
    const { data: callerRole } = await adminClient
      .from("user_roles").select("role").eq("user_id", caller.id).maybeSingle();
    if (!callerRole || callerRole.role !== "admin") {
      return json({ error: "Forbidden: admin role required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const userId = String(body.userId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "Valid userId is required" }, 400);

    // Guardrails
    if (userId === caller.id) {
      return json({ error: "You cannot delete your own account" }, 400);
    }
    const { data: target } = await adminClient
      .from("user_roles").select("role").eq("user_id", userId).maybeSingle();
    if (target?.role === "admin") {
      const { count } = await adminClient
        .from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "admin");
      if ((count ?? 0) <= 1) return json({ error: "Cannot delete the last remaining admin" }, 400);
    }

    // Capture the email for the audit trail before the row is gone.
    const { data: prof } = await adminClient
      .from("profiles").select("email").eq("id", userId).maybeSingle();

    // Explicit child cleanup (FKs mostly cascade from auth.users, but be sure).
    await adminClient.from("user_buildings").delete().eq("user_id", userId);
    await adminClient.from("user_roles").delete().eq("user_id", userId);
    await adminClient.from("profiles").delete().eq("id", userId);

    const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
    if (delErr) return json({ error: `Delete failed: ${delErr.message}` }, 500);

    // Audit (caller persists, so user_id FK is safe; entity_id records the target).
    await adminClient.from("audit_logs").insert({
      action: "delete_user",
      entity_type: "user",
      entity_id: userId,
      user_id: caller.id,
      // deleted user's email captured in the new_value-style note if the column exists
    });

    return json({ status: "deleted", email: prof?.email ?? null });
  } catch (e) {
    console.error("delete-user error:", e);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
