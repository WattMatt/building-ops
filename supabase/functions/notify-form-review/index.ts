import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { escapeText } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createNotifications } from "../_shared/notify.ts";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const SUBJECT_NAME_MAX = 120;

/**
 * `submissionId` is the only field read from the body. The recipient, form
 * name, building, reviewer, outcome and reviewer notes are all read back from
 * the database — a caller cannot choose who gets mailed or what it says.
 */
interface ReviewNotificationRequest {
  submissionId?: string;
}

function formatTime(value: string | null): string {
  const d = value ? new Date(value) : new Date();
  const safe = isNaN(d.getTime()) ? new Date() : d;
  return safe.toLocaleString("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg",
  });
}

serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

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

    // Service-role client: bypasses RLS, so it is only reached after the caller
    // has been identified and authorized below.
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: callerRoles, error: callerRolesErr } = await supabase
      .from("user_roles").select("role").eq("user_id", caller.id);
    if (callerRolesErr) {
      console.error("Error fetching caller roles:", callerRolesErr);
      return json({ error: "Forbidden" }, 403);
    }
    const roles = (callerRoles ?? []).map((r: { role: string }) => r.role);
    if (!roles.includes("admin") && !roles.includes("manager")) {
      return json({ error: "Forbidden: admin or manager role required" }, 403);
    }

    const body: ReviewNotificationRequest = await req.json().catch(() => ({}));
    const submissionId = typeof body.submissionId === "string" && UUID_RE.test(body.submissionId)
      ? body.submissionId
      : null;
    if (!submissionId) return json({ error: "Valid submissionId is required" }, 400);

    const { data: submission, error: submissionError } = await supabase
      .from("form_submissions")
      .select("id, form_name, building_id, submitted_by, status, review_notes, reviewed_at, reviewed_by")
      .eq("id", submissionId)
      .maybeSingle();

    if (submissionError) {
      console.error("Error fetching submission:", submissionError);
      return json({ error: "Unable to send notification" }, 500);
    }
    if (!submission) return json({ error: "Submission not found" }, 404);

    const status = submission.status as string;
    console.log(`Processing review notification for submission: ${submission.id}, status: ${status}`);

    // Only send notifications for approve/reject, not for "reviewed"
    if (status !== "approved" && status !== "rejected") {
      console.log(`Status is '${status}', no notification needed`);
      return json({ success: true, inserted: 0, emailed: 0, pushed: 0, skipped: 0, failed: 0, message: "No notification for this status" });
    }

    if (!submission.submitted_by) {
      console.log("Submission has no submitter");
      return json({ success: true, inserted: 0, emailed: 0, pushed: 0, skipped: 0, failed: 0, message: "No submitter to notify" });
    }

    // Never fall back to the reviewer's email address — this body goes to the
    // submitter, who has no business seeing it.
    let reviewerName = "A reviewer";
    const reviewerId = submission.reviewed_by || caller.id;
    const { data: reviewer } = await supabase
      .from("profiles").select("full_name").eq("id", reviewerId).maybeSingle();
    reviewerName = reviewer?.full_name || reviewerName;

    let buildingName: string | null = null;
    if (submission.building_id) {
      const { data: building } = await supabase
        .from("buildings").select("name").eq("id", submission.building_id).maybeSingle();
      buildingName = building?.name ? String(building.name) : null;
    }

    const formName = submission.form_name || "Form";
    const subjectFormName = formName.length > SUBJECT_NAME_MAX
      ? `${formName.slice(0, SUBJECT_NAME_MAX - 1)}…`
      : formName;
    const reviewNotes = submission.review_notes ? String(submission.review_notes) : null;

    // Format the review time
    const formattedTime = formatTime(submission.reviewed_at);

    const isApproved = status === "approved";
    const statusLabel = isApproved ? "Approved" : "Rejected";
    const statusColor = isApproved ? "#16a34a" : "#dc2626";

    // One sender for both the inbox row and the email: the reviewer notes ride as the
    // body (so the inbox row carries them) and the details table as detailHtml.
    const result = await createNotifications(supabase, {
      recipients: [submission.submitted_by as string],
      // The actor is whoever the row says reviewed it — the same person reviewerName was
      // read for. Using caller.id would mislabel a review the caller only re-notified for.
      actorId: reviewerId,
      actorName: reviewerName,
      kind: "form_reviewed",
      entityType: "form_submission",
      entityId: submission.id as string,
      buildingId: (submission.building_id as string | null) ?? null,
      title: `Form ${status}: ${formName}`,
      body: reviewNotes,
      // Named in the email so the notes read as the reviewer's words, not more boilerplate.
      bodyLabel: reviewNotes ? "Reviewer notes" : undefined,
      url: "/forms",
      subject: `Form ${statusLabel}: ${subjectFormName}`,
      detailHtml: `
          <p style="margin:0 0 16px;">
            Your form submission has been <strong style="color: ${statusColor};">${escapeText(status)}</strong>.
          </p>
          <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 100px;">Form:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${escapeText(formName)}</td>
              </tr>
              ${buildingName ? `
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Building:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${escapeText(buildingName)}</td>
              </tr>
              ` : ""}
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Reviewed by:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${escapeText(reviewerName)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Date:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${escapeText(formattedTime)}</td>
              </tr>
            </table>
          </div>`,
      ctaText: "View form",
    });

    console.log("Review notification processed:", result);

    return json({ success: true, ...result });

  } catch (error) {
    console.error("Error in notify-form-review:", error);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
