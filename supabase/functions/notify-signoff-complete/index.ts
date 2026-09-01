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

interface CompleteNotification {
  submissionId: string;
}

serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    // Authorize the caller: this function had NO internal auth and did not verify the
    // sign-off was actually complete, so any project-JWT holder could email "all
    // signatures collected" for any submission — a forged compliance signal. Identify
    // the caller and require they be party to the sign-off (or an admin/manager).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerErr } = await userClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Invalid or expired token" }, 401);

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { submissionId }: CompleteNotification = await req.json();
    if (!submissionId) return json({ error: "Missing submissionId" }, 400);

    const { data: submission } = await supabase
      .from("form_submissions")
      .select("form_name, building_id, submitted_by, signoff_status")
      .eq("id", submissionId)
      .single();
    if (!submission) return json({ error: "Submission not found" }, 404);

    // All sign-off requests for this submission — used for authorization and recipients.
    const { data: requests } = await supabase
      .from("form_signoff_requests")
      .select("assigned_by, assigned_to")
      .eq("submission_id", submissionId);
    const allRequests = requests ?? [];

    // Authorize: admin/manager, or a party to this sign-off (submitter / requester / signer).
    const { data: callerRoles } = await supabase
      .from("user_roles").select("role").eq("user_id", caller.id);
    const isManager = (callerRoles ?? []).some((r) => r.role === "admin" || r.role === "manager");
    const isParty = submission.submitted_by === caller.id
      || allRequests.some((r) => r.assigned_by === caller.id || r.assigned_to === caller.id);
    if (!isManager && !isParty) {
      return json({ error: "Forbidden: you are not part of this sign-off" }, 403);
    }

    // Verify the sign-off truly is complete before announcing it. The DB trigger is the
    // system of record for completion (the client reads the same column), so trust it
    // rather than re-deriving from request rows — refuse to emit a false
    // "all signatures collected" signal for an incomplete sign-off.
    if (submission.signoff_status !== "complete") {
      return json({ error: "Sign-off is not complete", complete: false }, 409);
    }

    let buildingName = "";
    if (submission.building_id) {
      const { data: b } = await supabase.from("buildings").select("name").eq("id", submission.building_id).single();
      buildingName = b?.name ?? "";
    }

    // Recipients: the submitter + every distinct requester (assigned_by) on the sign-off.
    const recipientIds = new Set<string>();
    if (submission.submitted_by) recipientIds.add(submission.submitted_by);
    allRequests.forEach((r) => r.assigned_by && recipientIds.add(r.assigned_by));

    if (recipientIds.size === 0) {
      return json({ success: true, notified: 0 });
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("email, full_name")
      .in("id", Array.from(recipientIds));
    const emails = (profiles || []).map((p) => p.email).filter(Boolean) as string[];
    if (emails.length === 0) {
      return json({ success: true, notified: 0, message: "No recipient emails" });
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

    return json({ success: true, notified: emails.length });
  } catch (error) {
    console.error("notify-signoff-complete error:", error);
    return json({ error: (error as Error).message }, 500);
  }
});
