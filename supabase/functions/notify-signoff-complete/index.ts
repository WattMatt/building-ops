import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { escapeText } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { actorDisplayName, createNotifications } from "../_shared/notify.ts";

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
      return json({ success: true, inserted: 0, emailed: 0, skipped: 0, failed: 0 });
    }

    const formName = submission.form_name ?? "a form";

    const result = await createNotifications(supabase, {
      recipients: Array.from(recipientIds),
      actorId: caller.id,
      actorName: await actorDisplayName(supabase, caller.id),
      kind: "signoff_complete",
      entityType: "form_submission",
      entityId: submissionId,
      buildingId: (submission.building_id as string | null) ?? null,
      title: `Sign-off complete: ${formName}`,
      body: null,
      url: "/forms",
      subject: `Sign-off complete: ${formName}`,
      detailHtml: `<p style="margin:0 0 16px;">All required signatures have been collected for <strong>${escapeText(formName)}</strong>${buildingName ? ` (${escapeText(buildingName)})` : ""}.</p>`,
      ctaText: "View submission",
    });

    return json({ success: true, ...result });
  } catch (error) {
    console.error("notify-signoff-complete error:", error);
    // The detail stays in the log: an internal message must not reach the caller.
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
