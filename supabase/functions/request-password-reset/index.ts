import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadBranding, renderEmail } from "../_shared/email.ts";

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
        const branding = await loadBranding(admin);
        const isSetup = dest === "/set-password";
        const greeting = profile.full_name ? `Hi ${profile.full_name},` : "Hi,";
        const heading = isSetup ? "Finish setting up your account" : "Reset your password";
        const blurb = isSetup
          ? `Here's a fresh link to finish setting up your ${branding.appName} account. Click below to choose a password and you're in.`
          : `We received a request to reset your ${branding.appName} password. Click below to choose a new one. If you didn't ask for this, you can safely ignore this email.`;
        const html = renderEmail({
          branding,
          preheader: heading,
          heading,
          greeting,
          bodyHtml: `<p style="margin:0;">${blurb}</p>`,
          ctaText: isSetup ? "Set your password" : "Reset password",
          ctaUrl: actionLink,
          footnote: "This link is valid for a short time and can only be used once.",
        });
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: `${branding.appName} <notifications@buildingops.app>`,
            to: [email],
            subject: isSetup ? `Your ${branding.appName} setup link` : `Reset your ${branding.appName} password`,
            html,
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
