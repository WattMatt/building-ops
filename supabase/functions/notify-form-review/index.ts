import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { escapeText, loadBranding, renderEmail } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_URL = (Deno.env.get("APP_URL") ?? "https://buildingops.app").replace(/\/+$/, "");

async function sendEmail(from: string, to: string[], subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Resend API error: ${error}`);
  }

  return res.json();
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

const SUBJECT_NAME_MAX = 120;

/** Organization name is operator-supplied; keep it to characters that are safe
 *  in the display-name part of an email `From` header. */
function senderName(name: string): string {
  return name.replace(/[^A-Za-z0-9 &.-]/g, "").trim().slice(0, 64) || "Building Ops";
}

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

    const status = submission.status;
    console.log(`Processing review notification for submission: ${submission.id}, status: ${status}`);

    // Only send notifications for approve/reject, not for "reviewed"
    if (status !== "approved" && status !== "rejected") {
      console.log(`Status is '${status}', no notification needed`);
      return json({ success: true, notified: 0, message: "No notification for this status" });
    }

    if (!submission.submitted_by) {
      console.log("Submission has no submitter");
      return json({ success: true, notified: 0, message: "No submitter to notify" });
    }

    // Get the submitter's email from profiles
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", submission.submitted_by)
      .maybeSingle();

    if (profileError) {
      console.error("Error fetching submitter profile:", profileError);
      return json({ error: "Unable to send notification" }, 500);
    }
    if (!profile) {
      console.log("Submitter profile not found");
      return json({ success: false, notified: 0, message: "Submitter profile not found" });
    }

    if (!profile.email) {
      console.log("Submitter has no email address");
      return json({ success: true, notified: 0, message: "Submitter has no email" });
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

    const isApproved = status === 'approved';
    const statusLabel = isApproved ? 'Approved' : 'Rejected';
    const statusColor = isApproved ? '#16a34a' : '#dc2626';

    const branding = await loadBranding(supabase);

    // Send email notification
    const emailResponse = await sendEmail(
      `${senderName(branding.appName)} <notifications@buildingops.app>`,
      [profile.email],
      `Form ${statusLabel}: ${subjectFormName}`,
      renderEmail({
        branding,
        heading: `Form ${statusLabel}`,
        greeting: `Hi ${profile.full_name || 'there'},`,
        bodyHtml: `
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
              ` : ''}
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Reviewed by:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${escapeText(reviewerName)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Date:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${escapeText(formattedTime)}</td>
              </tr>
            </table>
          </div>
          ${reviewNotes ? `
          <div style="background-color: ${isApproved ? '#f0fdf4' : '#fef2f2'}; border-left: 4px solid ${statusColor}; padding: 16px; border-radius: 4px; margin-bottom: 16px;">
            <p style="color: #374151; font-size: 14px; font-weight: 600; margin: 0 0 8px;">Reviewer Notes:</p>
            <p style="color: #4b5563; font-size: 14px; margin: 0; white-space: pre-wrap;">${escapeText(reviewNotes)}</p>
          </div>
          ` : ''}`,
        ctaText: "View full details",
        ctaUrl: `${APP_URL}/forms`,
      })
    );

    console.log("Review notification email sent successfully:", emailResponse);

    return json({
      success: true,
      notified: 1,
      message: "Review notification sent",
    });

  } catch (error) {
    console.error("Error in notify-form-review:", error);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
