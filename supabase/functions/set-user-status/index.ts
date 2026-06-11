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

// Effectively-permanent ban = reversible deactivation (preserves the user's data + audit trail).
const DEACTIVATE_DURATION = "876000h"; // ~100 years

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

    const { data: callerRole } = await adminClient
      .from("user_roles").select("role").eq("user_id", caller.id).maybeSingle();
    if (!callerRole || callerRole.role !== "admin") {
      return json({ error: "Forbidden: admin role required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const userId = String(body.userId ?? "");
    const action = body.action === "reactivate" ? "reactivate" : "deactivate";
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "Valid userId is required" }, 400);

    // Guardrails: an admin cannot deactivate themselves, and the last admin cannot be deactivated.
    if (action === "deactivate") {
      if (userId === caller.id) return json({ error: "You cannot deactivate your own account" }, 400);
      const { data: target } = await adminClient.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
      if (target?.role === "admin") {
        const { count } = await adminClient
          .from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "admin");
        if ((count ?? 0) <= 1) return json({ error: "Cannot deactivate the last remaining admin" }, 400);
      }
    }

    const ban_duration = action === "deactivate" ? DEACTIVATE_DURATION : "none";
    const { error } = await adminClient.auth.admin.updateUserById(userId, { ban_duration });
    if (error) return json({ error: `Status update failed: ${error.message}` }, 500);

    // Durable status flag (client-readable; auth.users.banned_until is not) + revoke building access on deactivate.
    if (action === "deactivate") {
      await adminClient.from("profiles").update({ deactivated: true }).eq("id", userId);
      await adminClient.from("user_buildings").delete().eq("user_id", userId);
    } else {
      await adminClient.from("profiles").update({ deactivated: false }).eq("id", userId);
    }

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
