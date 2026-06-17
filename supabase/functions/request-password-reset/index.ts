import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Clone-correct, env-overridable. Falls back to the clone's own domain.
const APP_URL = (Deno.env.get("APP_URL") ?? "https://building-ops-clone.vercel.app").replace(/\/+$/, "");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * PUBLIC (verify_jwt=false) password-reset / fresh-setup-link endpoint.
 *
 * Mints a recovery-grade link and emails it via Resend instead of relying on
 * Supabase's built-in mailer (frequently unconfigured on a cloned project, the
 * same weakness that broke user invites). Enumeration-safe: ALWAYS returns
 * {status:"ok"} and only sends mail to a real, active account — so it never
 * reveals which addresses are registered. Abuse profile matches the built-in
 * resetPasswordForEmail it replaces (anyone could already trigger that).
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ status: "ok" });

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    // Where the link lands: the forgot-password flow → /reset (recovery form),
    // the finish-setup flow → /set-password.
    const dest = body.dest === "setup" ? "/set-password" : "/reset";

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      // Still 200/ok-shaped to avoid handing probers a distinguishable response.
      return json({ status: "ok" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: profile } = await admin
      .from("profiles")
      .select("id, deactivated, full_name")
      .eq("email", email)
      .maybeSingle();

    if (profile && !profile.deactivated) {
      // Confirm the address so a recovery link is always issuable (mirrors the
      // invite "resend" path), then mint it.
      await admin.auth.admin.updateUserById(profile.id, { email_confirm: true });

      const { data: linkData } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${APP_URL}${dest}` },
      });
      const actionLink = linkData?.properties?.action_link;
      const resendKey = Deno.env.get("RESEND_API_KEY");

      if (actionLink && resendKey) {
        const greeting = profile.full_name ? `Hi ${profile.full_name},` : "Hi,";
        const heading = dest === "/set-password" ? "Finish setting up your account" : "Reset your password";
        const blurb =
          dest === "/set-password"
            ? "Here's a fresh link to finish setting up your Building Ops account. Click it, choose a password, and you're in."
            : "We received a request to reset your Building Ops password. Click below to choose a new one. If you didn't ask for this, you can ignore this email.";
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Building Ops <notifications@buildingops.app>",
            to: [email],
            subject: dest === "/set-password" ? "Your Building Ops setup link" : "Reset your Building Ops password",
            html: `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
<div style="background:#006d8f;padding:18px 32px;"><span style="color:#ffffff;font-size:18px;font-weight:700;">Building Ops</span></div>
<div style="padding:28px 32px;color:#111827;font-size:14px;line-height:1.6;">
<p style="margin:0 0 12px;">${greeting}</p>
<p style="margin:0 0 8px;font-weight:600;">${heading}</p>
<p style="margin:0 0 20px;">${blurb}</p>
<p style="margin:0 0 24px;"><a href="${actionLink}" style="background:#006d8f;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block;">${dest === "/set-password" ? "Set your password" : "Reset password"}</a></p>
<p style="margin:0;color:#6b7280;font-size:12px;">This link is valid for a short time and can only be used once.</p>
</div></div>`,
          }),
        });
      }
    }

    return json({ status: "ok" });
  } catch (e) {
    // Never leak failure detail; never enumerate.
    console.error("request-password-reset error:", e);
    return json({ status: "ok" });
  }
});
