import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { escapeText } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { adminAndManagerIds, createNotifications } from "../_shared/notify.ts";

const UUID_RE = /^[0-9a-f-]{36}$/i;

// This notification is only meaningful for a submission that was just created;
// anything older is a replay and is dropped without mailing anyone.
const FRESH_SUBMISSION_MS = 5 * 60 * 1000;

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
      return json({ success: true, inserted: 0, emailed: 0, pushed: 0, skipped: 0, failed: 0, message: "Submission is not recent" });
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

    // Admins and managers have access to every building, so they are the review queue.
    const managerUserIds = await adminAndManagerIds(supabase);
    console.log(`Found ${managerUserIds.length} admins/managers`);

    if (managerUserIds.length === 0) {
      console.log("No admins or managers found to notify");
      return json({ success: true, inserted: 0, emailed: 0, pushed: 0, skipped: 0, failed: 0, message: "No managers to notify" });
    }

    // Format the submission time
    const formattedTime = formatTime(submission.created_at);

    const result = await createNotifications(supabase, {
      recipients: managerUserIds,
      actorId: submission.submitted_by,
      actorName: submission.submitted_by ? submittedBy : null,
      kind: "form_submitted",
      entityType: "form_submission",
      entityId: submission.id,
      buildingId: submission.building_id,
      title: `New form submission: ${formName}`,
      body: null,
      url: "/forms",
      subject: `New Form Submission: ${formName}`,
      detailHtml: `
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
              ` : ""}
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
    });

    console.log("Submission notification processed:", result);

    return json({ success: true, ...result });

  } catch (error) {
    console.error("Error in notify-form-submission:", error);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
