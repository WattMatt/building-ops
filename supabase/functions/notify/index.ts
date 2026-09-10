// Client-invoked notifications (task/issue/report events). The caller must be a member of
// the building; recipients are filtered to members of that building (building_members RPC,
// evaluated as the caller). Org-wide kinds resolve their recipients here, never from the body.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { actorDisplayName, adminAndManagerIds, createNotifications } from "../_shared/notify.ts";
import { ENTITY_TYPES, NOTIFICATION_KINDS, type NotificationEntityType, type NotificationKind } from "../_shared/notifyRules.ts";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const ORG_WIDE: ReadonlySet<NotificationKind> = new Set(["report_submitted", "form_submitted", "signoff_overdue"]);
const MAX_RECIPIENTS = 50;

interface Body {
  kind?: string; entityType?: string; entityId?: string; buildingId?: string;
  recipients?: unknown; title?: string; body?: string; url?: string;
}

serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller }, error: callerErr } = await userClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Invalid or expired token" }, 401);

    const b: Body = await req.json().catch(() => ({}));
    const kind = NOTIFICATION_KINDS.find((k) => k === b.kind);
    const entityType = ENTITY_TYPES.find((t) => t === b.entityType);
    const buildingId = typeof b.buildingId === "string" && UUID_RE.test(b.buildingId) ? b.buildingId : null;
    const entityId = typeof b.entityId === "string" && UUID_RE.test(b.entityId) ? b.entityId : null;
    const title = typeof b.title === "string" ? b.title.trim().slice(0, 200) : "";
    const body = typeof b.body === "string" ? b.body.trim().slice(0, 500) : null;
    const path = typeof b.url === "string" && b.url.startsWith("/") && !b.url.startsWith("//") ? b.url.slice(0, 300) : null;
    if (!kind || !entityType || !buildingId || !title || !path) return json({ error: "Invalid notification" }, 400);

    // Membership check AS THE CALLER: building_members returns rows only for members.
    const { data: members, error: memErr } = await userClient.rpc("building_members", { b: buildingId });
    if (memErr) { console.error("building_members failed", memErr); return json({ error: "Forbidden" }, 403); }
    const memberIds = new Set((members ?? []).map((m: { id: string }) => m.id));
    if (!memberIds.has(caller.id)) return json({ error: "Forbidden" }, 403);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let recipients: string[];
    if (ORG_WIDE.has(kind)) {
      recipients = await adminAndManagerIds(admin);
    } else {
      const raw = Array.isArray(b.recipients) ? b.recipients.filter((r): r is string => typeof r === "string" && UUID_RE.test(r)) : [];
      recipients = raw.filter((id) => memberIds.has(id)).slice(0, MAX_RECIPIENTS);
    }

    const result = await createNotifications(admin, {
      recipients, actorId: caller.id, actorName: await actorDisplayName(admin, caller.id),
      kind, entityType: entityType as NotificationEntityType, entityId, buildingId, title, body, url: path,
    });
    return json({ success: true, ...result });
  } catch (e) {
    console.error("notify failed", e);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
