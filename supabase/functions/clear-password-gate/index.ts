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

// clear-password-gate — clears profiles.must_set_password for the CALLING user
// only (C5 gate hardening). A BEFORE UPDATE trigger on profiles
// (2026-08-05_06_phase2_onboarding_standard.sql) rejects client-side writes to
// must_set_password/deactivated, so this service-role path is the only way the
// flag can be cleared — and only right after a credential update.
//
// The "password was just set" check: auth.updateUser({ password }) bumps
// auth.users.updated_at, and the client calls this function immediately after
// a successful password update, so the caller's auth record must have been
// touched within the last few minutes. A caller who merely holds a session
// (no recent credential change) is rejected.
const RECENT_UPDATE_WINDOW_MS = 10 * 60 * 1000;

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

    // Confirm a credential update just happened for THIS user.
    const { data: authUser, error: lookupErr } = await adminClient.auth.admin.getUserById(caller.id);
    if (lookupErr || !authUser?.user) return json({ error: "User lookup failed" }, 500);
    const updatedAt = authUser.user.updated_at ? Date.parse(authUser.user.updated_at) : NaN;
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > RECENT_UPDATE_WINDOW_MS) {
      return json({ error: "No recent password change — the gate stays set" }, 403);
    }

    // Recency alone is not proof: admin.createUser stamps updated_at at creation,
    // so a temp-password invitee who signs in within the window would satisfy it
    // and clear the gate WITHOUT ever rotating the emailed credential — exactly
    // what this gate exists to prevent. Require the credential change to be
    // NEWER than the sign-in that produced this session; a password set after
    // sign-in bumps updated_at past last_sign_in_at, whereas an untouched invite
    // still carries its creation timestamp.
    const lastSignInAt = authUser.user.last_sign_in_at
      ? Date.parse(authUser.user.last_sign_in_at)
      : NaN;
    if (!Number.isFinite(lastSignInAt) || updatedAt <= lastSignInAt) {
      return json({ error: "No password change since sign-in — the gate stays set" }, 403);
    }

    const { error: updateErr } = await adminClient
      .from("profiles")
      .update({ must_set_password: false })
      .eq("id", caller.id);
    if (updateErr) {
      console.error("clear-password-gate update failed:", updateErr);
      return json({ error: "Failed to clear the gate" }, 500);
    }

    // Verified write (C5): read back and fail loud rather than reporting a
    // success the database does not reflect.
    const { data: check, error: checkErr } = await adminClient
      .from("profiles")
      .select("must_set_password")
      .eq("id", caller.id)
      .maybeSingle();
    if (checkErr || !check || check.must_set_password !== false) {
      return json({ error: "Gate clear could not be verified" }, 500);
    }

    return json({ userId: caller.id, mustSetPassword: false });
  } catch (e) {
    console.error("clear-password-gate error:", e);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
