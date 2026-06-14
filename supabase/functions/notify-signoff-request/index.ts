import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

async function sendEmail(to: string[], subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: "Building Ops <notifications@buildingops.app>", to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend API error: ${await res.text()}`);
  return res.json();
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SignoffRequestNotification {
  requestId: string;
  reminder?: boolean;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { requestId, reminder }: SignoffRequestNotification = await req.json();
    if (!requestId) throw new Error("Missing requestId");

    const { data: request, error: reqErr } = await supabase
      .from("form_signoff_requests")
      .select("id, submission_id, assigned_to, assigned_by, due_at, instructions")
      .eq("id", requestId)
      .single();
    if (reqErr || !request) throw new Error("Sign-off request not found");

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
      return new Response(JSON.stringify({ success: true, notified: 0, message: "Signer has no email" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
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
    const heading = reminder ? "Sign-off reminder" : "Sign-off requested";

    await sendEmail(
      [signer.email],
      `${heading}: ${formName}`,
      `
      <!DOCTYPE html><html><head><meta charset="utf-8"></head>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;margin:0;padding:20px;">
        <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <div style="background:#2563eb;padding:24px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:22px;">${heading}</h1>
          </div>
          <div style="padding:32px;">
            <p style="color:#374151;font-size:16px;margin:0 0 8px;">Hi ${signer.full_name || "there"},</p>
            <p style="color:#374151;font-size:16px;margin:0 0 24px;">${requesterName} has asked you to sign off on <strong>${formName}</strong>${buildingName ? ` for ${buildingName}` : ""}.</p>
            ${due ? `<p style="color:#374151;font-size:14px;margin:0 0 16px;">Please sign by <strong>${due}</strong>.</p>` : ""}
            ${request.instructions ? `<div style="background:#f9fafb;border-left:4px solid #2563eb;padding:16px;border-radius:4px;margin-bottom:24px;color:#374151;">${request.instructions}</div>` : ""}
            <a href="https://buildingops.app/my-signoffs" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Review &amp; sign</a>
          </div>
        </div>
      </body></html>`,
    );

    return new Response(JSON.stringify({ success: true, notified: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    console.error("notify-signoff-request error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
