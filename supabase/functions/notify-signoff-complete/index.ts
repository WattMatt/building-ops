import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { loadBranding, renderEmail } from "../_shared/email.ts";

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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CompleteNotification {
  submissionId: string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { submissionId }: CompleteNotification = await req.json();
    if (!submissionId) throw new Error("Missing submissionId");

    const { data: submission } = await supabase
      .from("form_submissions")
      .select("form_name, building_id, submitted_by")
      .eq("id", submissionId)
      .single();
    if (!submission) throw new Error("Submission not found");

    let buildingName = "";
    if (submission.building_id) {
      const { data: b } = await supabase.from("buildings").select("name").eq("id", submission.building_id).single();
      buildingName = b?.name ?? "";
    }

    // Recipients: the submitter + every distinct requester (assigned_by) on the sign-off.
    const recipientIds = new Set<string>();
    if (submission.submitted_by) recipientIds.add(submission.submitted_by);
    const { data: requests } = await supabase
      .from("form_signoff_requests")
      .select("assigned_by")
      .eq("submission_id", submissionId);
    (requests || []).forEach((r) => r.assigned_by && recipientIds.add(r.assigned_by));

    if (recipientIds.size === 0) {
      return new Response(JSON.stringify({ success: true, notified: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("email, full_name")
      .in("id", Array.from(recipientIds));
    const emails = (profiles || []).map((p) => p.email).filter(Boolean) as string[];
    if (emails.length === 0) {
      return new Response(JSON.stringify({ success: true, notified: 0, message: "No recipient emails" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const formName = submission.form_name ?? "a form";

    const branding = await loadBranding(supabase);

    await sendEmail(
      `${branding.appName} <notifications@buildingops.app>`,
      emails,
      `Sign-off complete: ${formName}`,
      renderEmail({
        branding,
        heading: "Sign-off complete",
        bodyHtml: `<p style="margin:0 0 16px;">All required signatures have been collected for <strong>${formName}</strong>${buildingName ? ` (${buildingName})` : ""}.</p>`,
        ctaText: "View submission",
        ctaUrl: `${APP_URL}/forms`,
      }),
    );

    return new Response(JSON.stringify({ success: true, notified: emails.length }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    console.error("notify-signoff-complete error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
