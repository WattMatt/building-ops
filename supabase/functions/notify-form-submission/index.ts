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

// This notification is only meaningful for a submission that was just created;
// anything older is a replay and is dropped without mailing anyone.
const FRESH_SUBMISSION_MS = 5 * 60 * 1000;

/** Organization name is operator-supplied; keep it to characters that are safe
 *  in the display-name part of an email `From` header. */
function senderName(name: string): string {
  return name.replace(/[^A-Za-z0-9 &.-]/g, "").trim().slice(0, 64) || "Building Ops";
}

/**
 * Every value rendered into the email is read from the database with the
 * service-role client. Body fields are only ever used to *locate* the row
 * (`submissionId`, `buildingId`); they are never rendered.
 */
interface NotificationRequest {
  submissionId?: string;
  buildingId?: string;
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
    const isPrivileged = roles.includes("admin") || roles.includes("manager");

    const body: NotificationRequest = await req.json().catch(() => ({}));
    const submissionId = typeof body.submissionId === "string" && UUID_RE.test(body.submissionId)
      ? body.submissionId
      : null;
    const buildingIdHint = typeof body.buildingId === "string" && UUID_RE.test(body.buildingId)
      ? body.buildingId
      : null;

    const columns = "id, form_name, building_id, submitted_by, created_at";
    let submission: {
      id: string;
      form_name: string | null;
      building_id: string | null;
      submitted_by: string | null;
      created_at: string | null;
    } | null = null;

    if (submissionId) {
      const { data, error } = await supabase
        .from("form_submissions").select(columns).eq("id", submissionId).maybeSingle();
      if (error) {
        console.error("Error fetching submission:", error);
        return json({ error: "Unable to send notification" }, 500);
      }
      submission = data;
    } else {
      // Legacy callers post only descriptive fields; resolve the row they just
      // inserted instead of trusting those strings.
      let q = supabase
        .from("form_submissions").select(columns).eq("submitted_by", caller.id);
      if (buildingIdHint) q = q.eq("building_id", buildingIdHint);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) {
        console.error("Error resolving caller submission:", error);
        return json({ error: "Unable to send notification" }, 500);
      }
      submission = data;
    }

    // A row the caller may not see is reported exactly like a missing one, so
    // the response cannot be used to probe which submission ids exist.
    if (!submission || (!isPrivileged && submission.submitted_by !== caller.id)) {
      return json({ error: "Submission not found" }, 404);
    }

    const createdAtMs = submission.created_at ? Date.parse(submission.created_at) : NaN;
    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > FRESH_SUBMISSION_MS) {
      console.log(`Submission ${submission.id} is not freshly created; skipping notification`);
      return json({ success: true, notified: 0, message: "Submission is not recent" });
    }

    const formName = submission.form_name || "Form";
    console.log(`Processing notification for submission: ${submission.id}`);

    let buildingName: string | null = null;
    if (submission.building_id) {
      const { data: building } = await supabase
        .from("buildings").select("name").eq("id", submission.building_id).maybeSingle();
      buildingName = building?.name ? String(building.name) : null;
    }

    let submittedBy = "Unknown User";
    if (submission.submitted_by) {
      const { data: submitter } = await supabase
        .from("profiles").select("full_name, email").eq("id", submission.submitted_by).maybeSingle();
      submittedBy = submitter?.full_name || submitter?.email || submittedBy;
    }

    // Get all admins and managers (they have access to all buildings)
    const { data: adminManagerRoles, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "manager"]);

    if (rolesError) {
      console.error("Error fetching admin/manager roles:", rolesError);
      return json({ error: "Unable to send notification" }, 500);
    }

    const managerUserIds = adminManagerRoles?.map(r => r.user_id) || [];
    console.log(`Found ${managerUserIds.length} admins/managers`);

    if (managerUserIds.length === 0) {
      console.log("No admins or managers found to notify");
      return json({ success: true, notified: 0, message: "No managers to notify" });
    }

    // Get email addresses for these users from profiles
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("id", managerUserIds);

    if (profilesError) {
      console.error("Error fetching profiles:", profilesError);
      return json({ error: "Unable to send notification" }, 500);
    }

    if (!profiles || profiles.length === 0) {
      console.log("No profiles found for managers");
      return json({ success: true, notified: 0, message: "No manager profiles found" });
    }

    const recipientEmails = profiles.map(p => p.email).filter(Boolean);
    console.log(`Sending notifications to ${recipientEmails.length} recipients`);

    if (recipientEmails.length === 0) {
      return json({ success: true, notified: 0, message: "No valid email addresses" });
    }

    // Format the submission time
    const formattedTime = formatTime(submission.created_at);

    const branding = await loadBranding(supabase);

    // Send email notification
    const emailResponse = await sendEmail(
      `${senderName(branding.appName)} <notifications@buildingops.app>`,
      recipientEmails,
      `New Form Submission: ${formName}`,
      renderEmail({
        branding,
        heading: "New Form Submission",
        bodyHtml: `
          <p style="margin:0 0 16px;">
            A new form has been submitted and requires your review.
          </p>
          <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Form:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${escapeText(formName)}</td>
              </tr>
              ${buildingName ? `
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Building:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${escapeText(buildingName)}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Submitted by:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${escapeText(submittedBy)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Submitted at:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${escapeText(formattedTime)}</td>
              </tr>
            </table>
          </div>`,
        ctaText: "Review submission",
        ctaUrl: `${APP_URL}/forms`,
      })
    );

    console.log("Email sent successfully:", emailResponse);

    return json({
      success: true,
      notified: recipientEmails.length,
      message: `Notification sent to ${recipientEmails.length} manager(s)`,
    });

  } catch (error) {
    console.error("Error in notify-form-submission:", error);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
