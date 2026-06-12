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

    // ── action: "status" — real auth state for the admin user list ──
    // The "Invited (pending)" badge used to key off the must_set_password
    // proxy alone; this exposes the truth (confirmed? ever signed in?).
    if (body.action === "status") {
      const { data: listData, error: listError } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (listError) return json({ error: `List failed: ${listError.message}` }, 500);
      return json({
        status: "ok",
        users: (listData?.users ?? []).map((u) => ({
          id: u.id,
          email_confirmed: Boolean(u.email_confirmed_at),
          last_sign_in_at: u.last_sign_in_at ?? null,
        })),
      });
    }

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Valid email is required" }, 400);

    // ── action: "resend" — recovery path for an EXISTING pending user ──
    // Generates a fresh sign-in link and either emails it (Resend API,
    // branded) or returns it for the admin to copy. The copy path makes
    // onboarding independent of email delivery entirely.
    if (body.action === "resend") {
      const { data: profile } = await adminClient
        .from("profiles").select("id, deactivated, full_name").eq("email", email).maybeSingle();
      if (!profile) return json({ error: "No user with that email" }, 404);
      if (profile.deactivated) return json({ error: "User is deactivated — reactivate them first" }, 409);

      // The admin created this account and is vouching for the address:
      // confirm it so a recovery-grade link is always issuable, whatever
      // state the original invite died in.
      await adminClient.auth.admin.updateUserById(profile.id, { email_confirm: true });

      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: SET_PASSWORD_URL },
      });
      const actionLink = linkData?.properties?.action_link;
      if (linkError || !actionLink) {
        return json({ error: `Link generation failed: ${linkError?.message ?? "unknown"}` }, 500);
      }

      const delivery = body.delivery === "link" ? "link" : "email";
      if (delivery === "email") {
        const resendKey = Deno.env.get("RESEND_API_KEY");
        if (!resendKey) return json({ error: "RESEND_API_KEY not configured" }, 500);
        const greeting = profile.full_name ? `Hi ${profile.full_name},` : "Hi,";
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Building Ops <notifications@buildingops.app>",
            to: [email],
            subject: "Your Building Ops sign-in link",
            html: `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
<div style="background:#006d8f;padding:18px 32px;"><span style="color:#ffffff;font-size:18px;font-weight:700;">Building Ops</span></div>
<div style="padding:28px 32px;color:#111827;font-size:14px;line-height:1.6;">
<p style="margin:0 0 12px;">${greeting}</p>
<p style="margin:0 0 20px;">Here is a fresh link to finish setting up your Building Ops account. Click it, choose a password, and you're in.</p>
<p style="margin:0 0 24px;"><a href="${actionLink}" style="background:#006d8f;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block;">Set your password</a></p>
<p style="margin:0;color:#6b7280;font-size:12px;">This link is valid for 24 hours. If it expires, ask your administrator to send a new one.</p>
</div></div>`,
          }),
        });
        if (!emailRes.ok) {
          const detail = await emailRes.text().catch(() => "");
          return json({ error: `Email send failed: ${detail.slice(0, 200)}` }, 502);
        }
      }

      await adminClient.from("audit_logs").insert({
        action: delivery === "email" ? "resend_invite_email" : "copy_invite_link",
        entity_type: "user",
        entity_id: profile.id,
        user_id: caller.id,
      });

      return json(delivery === "email" ? { status: "resent" } : { status: "link", actionLink });
    }

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

    // Set the first-login gate. Use upsert (not a bare update) and VERIFY the
    // write: a plain update that matched zero rows — e.g. racing the
    // handle_new_user trigger that creates the profile — used to leave
    // must_set_password at its default (false), stranding the user as a
    // never-onboarded account the admin UI mislabelled "Active". Fail loudly
    // rather than hand back a half-provisioned invite.
    const profilePatch: Record<string, unknown> = { id: newUserId, must_set_password: true };
    if (fullName) profilePatch.full_name = fullName;
    const { data: patched, error: patchErr } = await adminClient
      .from("profiles").upsert(profilePatch, { onConflict: "id" }).select("id, must_set_password");
    if (patchErr || !patched?.[0]?.must_set_password) {
      return json({ error: `Failed to set first-login gate: ${patchErr?.message ?? "no row written"}` }, 500);
    }

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
