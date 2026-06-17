import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SIGNOFF_SECRET = Deno.env.get("SIGNOFF_REMINDERS_SECRET");
const APP_URL = (Deno.env.get("APP_URL") ?? "https://building-ops-clone.vercel.app").replace(/\/+$/, "");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-signoff-secret",
};

async function sendEmail(to: string[], subject: string, html: string) {
  if (to.length === 0) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: "Building Ops <notifications@buildingops.app>", to, subject, html }),
  });
  if (!res.ok) console.error("Resend error:", await res.text());
}

const shell = (heading: string, color: string, body: string) => `
  <!DOCTYPE html><html><head><meta charset="utf-8"></head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;margin:0;padding:20px;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="background:${color};padding:24px;text-align:center;"><h1 style="color:#fff;margin:0;font-size:22px;">${heading}</h1></div>
      <div style="padding:32px;color:#374151;font-size:15px;">${body}<p style="margin-top:24px;"><a href="${APP_URL}/my-signoffs" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Open sign-offs</a></p></div>
    </div>
  </body></html>`;

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Shared-secret guard — this function is cron-triggered, not user-facing.
  if (!SIGNOFF_SECRET || req.headers.get("x-signoff-secret") !== SIGNOFF_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
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
    let escalationEmails: string[] | null = null;
    const getEscalationEmails = async () => {
      if (escalationEmails) return escalationEmails;
      const { data: roles } = await supabase.from("user_roles").select("user_id").in("role", ["admin", "manager"]);
      const ids = (roles || []).map((r) => r.user_id);
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("email").in("id", ids)
        : { data: [] as { email: string | null }[] };
      escalationEmails = (profs || []).map((p) => p.email).filter(Boolean) as string[];
      return escalationEmails;
    };

    const formName = async (submissionId: string) => {
      const { data } = await supabase.from("form_submissions").select("form_name").eq("id", submissionId).single();
      return data?.form_name ?? "a form";
    };
    const signerEmail = async (id: string) => {
      const { data } = await supabase.from("profiles").select("email, full_name").eq("id", id).single();
      return data;
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
        const fn = await formName(r.submission_id);
        await sendEmail(
          await getEscalationEmails(),
          `Sign-off overdue: ${fn}`,
          shell("Sign-off overdue", "#ef4444", `<p>A sign-off request for <strong>${fn}</strong> has passed its due date and has been marked expired. Please reassign it if it is still required.</p>`),
        );
        escalated++;
      } else if ((due.toISOString() <= in48h) && (!r.reminded_at || (r.reminded_at as string) < reminderCutoff)) {
        const signer = await signerEmail(r.assigned_to);
        if (signer?.email) {
          const fn = await formName(r.submission_id);
          await sendEmail(
            [signer.email],
            `Sign-off reminder: ${fn}`,
            shell("Sign-off reminder", "#2563eb", `<p>Hi ${signer.full_name || "there"}, this is a reminder that <strong>${fn}</strong> is awaiting your signature and is due soon.</p>`),
          );
          await supabase.from("form_signoff_requests").update({ reminded_at: nowIso }).eq("id", r.id);
          reminded++;
        }
      }
    }

    return new Response(JSON.stringify({ reminded, escalated, expired }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    console.error("signoff-reminders error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
