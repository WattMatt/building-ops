import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { escapeText, loadBranding } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { adminAndManagerIds, createNotifications } from "../_shared/notify.ts";

const SIGNOFF_SECRET = Deno.env.get("SIGNOFF_REMINDERS_SECRET");

/**
 * The shared CORS policy (allow-listed origins, never `*`) plus the one header this
 * cron-triggered function accepts on top of the standard set.
 */
function reminderCors(req: Request): Record<string, string> {
  const base = corsHeaders(req);
  return {
    ...base,
    "Access-Control-Allow-Headers": `${base["Access-Control-Allow-Headers"]}, x-signoff-secret`,
  };
}

const dueLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeZone: "Africa/Johannesburg" });

serve(async (req: Request): Promise<Response> => {
  const cors = reminderCors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // Shared-secret guard — this function is cron-triggered, not user-facing.
  if (!SIGNOFF_SECRET || req.headers.get("x-signoff-secret") !== SIGNOFF_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // Loaded once and handed to every send, so a run does not re-read branding per row.
    const branding = await loadBranding(supabase);
    const now = new Date();
    const nowIso = now.toISOString();
    const in48h = new Date(now.getTime() + 48 * 3600 * 1000).toISOString();
    const reminderCutoff = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

    const { data: pending } = await supabase
      .from("form_signoff_requests")
      .select("id, submission_id, assigned_to, due_at, reminded_at")
      .eq("active", true)
      .eq("status", "pending")
      .not("due_at", "is", null);

    // Admin/manager escalation list (fetched once, lazily).
    let escalationIds: string[] | null = null;
    const getEscalationIds = async () => {
      if (escalationIds) return escalationIds;
      escalationIds = await adminAndManagerIds(supabase);
      return escalationIds;
    };

    const formInfo = async (submissionId: string) => {
      const { data } = await supabase
        .from("form_submissions").select("form_name, building_id").eq("id", submissionId).single();
      return {
        name: (data?.form_name as string | null) ?? "a form",
        buildingId: (data?.building_id as string | null) ?? null,
      };
    };

    let reminded = 0, escalated = 0, expired = 0;

    for (const r of pending || []) {
      const due = new Date(r.due_at as string);
      if (due < now) {
        await supabase
          .from("form_signoff_requests")
          .update({ status: "expired", active: false, updated_at: nowIso })
          .eq("id", r.id);
        // expiry vetoes the submission (mirrors decline): reject + halt remaining
        // steps so the chain can't stall and the re-request button reappears.
        await supabase
          .from("form_submissions")
          .update({ signoff_status: "rejected", updated_at: nowIso })
          .eq("id", r.submission_id);
        await supabase
          .from("form_signoff_requests")
          .update({ active: false, updated_at: nowIso })
          .eq("submission_id", r.submission_id)
          .neq("id", r.id)
          .eq("status", "pending");
        expired++;
        const form = await formInfo(r.submission_id);
        await createNotifications(supabase, {
          recipients: await getEscalationIds(),
          actorId: null,
          actorName: null,
          kind: "signoff_overdue",
          entityType: "signoff_request",
          entityId: r.id as string,
          buildingId: form.buildingId,
          title: `Sign-off overdue: ${form.name}`,
          body: "The request passed its due date and was marked expired. Reassign it if it is still required.",
          url: "/my-signoffs",
          subject: `Sign-off overdue: ${form.name}`,
          detailHtml: `<p style="margin:0 0 16px;">A sign-off request for <strong>${escapeText(form.name)}</strong> has passed its due date and has been marked expired. Please reassign it if it is still required.</p>`,
          ctaText: "Open sign-offs",
        }, branding);
        escalated++;
      } else if ((due.toISOString() <= in48h) && (!r.reminded_at || (r.reminded_at as string) < reminderCutoff)) {
        if (!r.assigned_to) continue;
        const form = await formInfo(r.submission_id);
        await createNotifications(supabase, {
          recipients: [r.assigned_to as string],
          actorId: null,
          actorName: null,
          kind: "signoff_requested",
          entityType: "signoff_request",
          entityId: r.id as string,
          buildingId: form.buildingId,
          title: `Reminder: sign-off due ${dueLabel(r.due_at as string)}`,
          body: `${form.name} is awaiting your signature.`,
          url: "/my-signoffs",
          subject: `Sign-off reminder: ${form.name}`,
          detailHtml: `<p style="margin:0 0 16px;">This is a reminder that <strong>${escapeText(form.name)}</strong> is awaiting your signature and is due on <strong>${escapeText(dueLabel(r.due_at as string))}</strong>.</p>`,
          ctaText: "Open sign-offs",
        }, branding);
        await supabase.from("form_signoff_requests").update({ reminded_at: nowIso }).eq("id", r.id);
        reminded++;
      }
    }

    return new Response(JSON.stringify({ reminded, escalated, expired }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...cors },
    });
  } catch (error) {
    console.error("signoff-reminders error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }
});
