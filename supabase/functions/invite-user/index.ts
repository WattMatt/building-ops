import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SET_PASSWORD_URL = "https://buildingops.app/set-password";
const VALID_ROLES = ["admin", "manager", "user", "reviewer"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// CSPRNG password with mixed character classes (>= min length 8; we use 16).
function generatePassword(len = 16): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*-_=+";
  const all = upper + lower + digits + symbols;
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  // guarantee one of each class, then fill the rest
  const pick = (set: string, n: number) => set[n % set.length];
  const chars = [
    pick(upper, bytes[0]),
    pick(lower, bytes[1]),
    pick(digits, bytes[2]),
    pick(symbols, bytes[3]),
  ];
  for (let i = 4; i < len; i++) chars.push(pick(all, bytes[i]));
  // Fisher-Yates shuffle using fresh randomness
  const shuf = new Uint32Array(chars.length);
  crypto.getRandomValues(shuf);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuf[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Identify the caller from their JWT
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

    // Parse + validate input
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = body.fullName ? String(body.fullName).trim() : null;
    const role = String(body.role ?? "user");
    const buildingIds: string[] = Array.isArray(body.buildingIds) ? body.buildingIds : [];
    const mode = body.mode === "temp_password" ? "temp_password" : "invite";

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Valid email is required" }, 400);
    if (!VALID_ROLES.includes(role)) return json({ error: "Invalid role" }, 400);
    const uuidRe = /^[0-9a-f-]{36}$/i;
    if (buildingIds.some((b) => !uuidRe.test(b))) return json({ error: "Invalid building id" }, 400);

    // Idempotency: a profile with this email means the user already exists
    const { data: existing } = await adminClient
      .from("profiles").select("id").eq("email", email).maybeSingle();
    if (existing) return json({ error: "A user with that email already exists" }, 409);

    // Create the auth user
    let newUserId: string;
    let tempPassword: string | null = null;

    if (mode === "invite") {
      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
        data: fullName ? { full_name: fullName } : undefined,
        redirectTo: SET_PASSWORD_URL,
      });
      if (error || !data?.user) return json({ error: `Invite failed: ${error?.message ?? "unknown"}` }, 500);
      newUserId = data.user.id;
    } else {
      tempPassword = generatePassword(16);
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : undefined,
      });
      if (error || !data?.user) return json({ error: `Create failed: ${error?.message ?? "unknown"}` }, 500);
      newUserId = data.user.id;
    }

    // Privileged upgrades (service role — bypasses RLS by design)
    await adminClient.from("user_roles").upsert({ user_id: newUserId, role }, { onConflict: "user_id" });

    if (buildingIds.length > 0) {
      await adminClient.from("user_buildings").delete().eq("user_id", newUserId);
      await adminClient.from("user_buildings").insert(
        buildingIds.map((building_id) => ({ user_id: newUserId, building_id }))
      );
    }

    const profilePatch: Record<string, unknown> = { must_set_password: true };
    if (fullName) profilePatch.full_name = fullName;
    await adminClient.from("profiles").update(profilePatch).eq("id", newUserId);

    // Audit trail
    await adminClient.from("audit_logs").insert({
      action: mode === "invite" ? "invite_user" : "create_user_temp_password",
      entity_type: "user",
      entity_id: newUserId,
      user_id: caller.id,
    });

    if (mode === "temp_password") {
      return json({ userId: newUserId, status: "temp_password", tempPassword });
    }
    return json({ userId: newUserId, status: "invited" });
  } catch (e) {
    console.error("invite-user error:", e);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
