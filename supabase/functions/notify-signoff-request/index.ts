import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { escapeText } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createNotifications } from "../_shared/notify.ts";

interface SignoffRequestNotification {
  requestId: string;
  reminder?: boolean;
}

serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    // Authorize the caller: this function had NO internal auth — any holder of a project
    // JWT could spam sign-off request emails for any requestId. Identify the caller, then
    // require they be the request's requester (assigned_by) or an admin/manager.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerErr } = await userClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Invalid or expired token" }, 401);

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { requestId }: SignoffRequestNotification = await req.json();
    if (!requestId) return json({ error: "Missing requestId" }, 400);

    const { data: request, error: reqErr } = await supabase
      .from("form_signoff_requests")
      .select("id, submission_id, assigned_to, assigned_by, due_at, instructions")
      .eq("id", requestId)
      .single();
    if (reqErr || !request) return json({ error: "Sign-off request not found" }, 404);

    const { data: callerRoles } = await supabase
      .from("user_roles").select("role").eq("user_id", caller.id);
    const isManager = (callerRoles ?? []).some((r) => r.role === "admin" || r.role === "manager");
    if (!isManager && request.assigned_by !== caller.id) {
      return json({ error: "Forbidden: you did not raise this sign-off request" }, 403);
    }

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

    let requesterName = "A manager";
    if (request.assigned_by) {
      const { data: by } = await supabase.from("profiles").select("full_name, email").eq("id", request.assigned_by).single();
      requesterName = by?.full_name ?? by?.email ?? requesterName;
    }

    const formName = submission?.form_name ?? "a form";
    const due = request.due_at
      ? new Date(request.due_at).toLocaleString("en-ZA", { dateStyle: "medium", timeZone: "Africa/Johannesburg" })
      : null;
    const heading = "Sign-off requested";
    const instructions = request.instructions ? String(request.instructions) : null;

    const result = await createNotifications(supabase, {
      recipients: [request.assigned_to as string],
      actorId: (request.assigned_by as string | null) ?? null,
      actorName: requesterName,
      kind: "signoff_requested",
      entityType: "signoff_request",
      entityId: request.id as string,
      buildingId: (submission?.building_id as string | null) ?? null,
      title: `${heading}: ${formName}`,
      // The requester's instructions are the one thing the signer needs in the inbox row.
      body: instructions,
      url: "/my-signoffs",
      subject: `${heading}: ${formName}`,
      detailHtml: `
          <p style="margin:0 0 16px;">${escapeText(requesterName)} has asked you to sign off on <strong>${escapeText(formName)}</strong>${buildingName ? ` for ${escapeText(buildingName)}` : ""}.</p>
          ${due ? `<p style="margin:0 0 16px;">Please sign by <strong>${escapeText(due)}</strong>.</p>` : ""}`,
      ctaText: "Review & sign",
    });

    return json({ success: true, ...result });
  } catch (error) {
    console.error("notify-signoff-request error:", error);
    return json({ error: (error as Error).message }, 500);
  }
});
