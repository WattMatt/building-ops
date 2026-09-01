import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { loadBranding, renderEmail } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_URL = (Deno.env.get("APP_URL") ?? "https://building-ops-clone.vercel.app").replace(/\/+$/, "");

async function sendEmail(from: string, to: string[], subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend API error: ${await res.text()}`);
  return res.json();
}

interface SignoffRequestNotification {
  requestId: string;
  reminder?: boolean;
}

serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    // Authorize the caller: this function had NO internal auth — any holder of a project
    // JWT could spam sign-off request emails for any requestId. Identify the caller, then
    // require they be the request's requester (assigned_by) or an admin/manager.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerErr } = await userClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Invalid or expired token" }, 401);

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { requestId }: SignoffRequestNotification = await req.json();
    if (!requestId) return json({ error: "Missing requestId" }, 400);

    const { data: request, error: reqErr } = await supabase
      .from("form_signoff_requests")
      .select("id, submission_id, assigned_to, assigned_by, due_at, instructions")
      .eq("id", requestId)
      .single();
    if (reqErr || !request) return json({ error: "Sign-off request not found" }, 404);

    const { data: callerRoles } = await supabase
      .from("user_roles").select("role").eq("user_id", caller.id);
    const isManager = (callerRoles ?? []).some((r) => r.role === "admin" || r.role === "manager");
    if (!isManager && request.assigned_by !== caller.id) {
      return json({ error: "Forbidden: you did not raise this sign-off request" }, 403);
    }

    const { data: submission } = await supabase
      .from("form_submissions")
      .select("form_name, building_id")
      .eq("id", request.submission_id)
      .single();

    let buildingName = "";
    if (submission?.building_id) {
      const { data: b } = await supabase.from("buildings").select("name").eq("id", submission.building_id).single();
      buildingName = b?.name ?? "";
    }

    const { data: signer } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", request.assigned_to)
      .single();
    if (!signer?.email) {
      return json({ success: true, notified: 0, message: "Signer has no email" });
    }

    let requesterName = "A manager";
    if (request.assigned_by) {
      const { data: by } = await supabase.from("profiles").select("full_name, email").eq("id", request.assigned_by).single();
      requesterName = by?.full_name ?? by?.email ?? requesterName;
    }

    const formName = submission?.form_name ?? "a form";
    const due = request.due_at
      ? new Date(request.due_at).toLocaleString("en-ZA", { dateStyle: "medium", timeZone: "Africa/Johannesburg" })
      : null;
    const heading = "Sign-off requested";

    const branding = await loadBranding(supabase);

    await sendEmail(
      `${branding.appName} <notifications@buildingops.app>`,
      [signer.email],
      `${heading}: ${formName}`,
      renderEmail({
        branding,
        heading,
        greeting: `Hi ${signer.full_name || "there"},`,
        bodyHtml: `
          <p style="margin:0 0 16px;">${requesterName} has asked you to sign off on <strong>${formName}</strong>${buildingName ? ` for ${buildingName}` : ""}.</p>
          ${due ? `<p style="margin:0 0 16px;">Please sign by <strong>${due}</strong>.</p>` : ""}
          ${request.instructions ? `<div style="background:#f9fafb;border-left:4px solid ${branding.color};padding:16px;border-radius:4px;margin:0 0 16px;color:#374151;">${request.instructions}</div>` : ""}`,
        ctaText: "Review & sign",
        ctaUrl: `${APP_URL}/my-signoffs`,
      }),
    );

    return json({ success: true, notified: 1 });
  } catch (error) {
    console.error("notify-signoff-request error:", error);
    return json({ error: (error as Error).message }, 500);
  }
});
