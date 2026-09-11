// Client-invoked notifications (task/issue/report events). The caller must be a member of
// the building; recipients are filtered to members of that building (building_members RPC,
// evaluated as the caller). Org-wide kinds resolve their recipients here, never from the body.
//
// Body validation lives in _shared/notifyRules.ts (pure, and therefore unit-tested from the
// web app's vitest suite) — this file only does the I/O the rules cannot do.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { actorDisplayName, adminAndManagerIds, createNotifications } from "../_shared/notify.ts";
import { ORG_WIDE_KINDS, parseNotifyBody } from "../_shared/notifyRules.ts";

serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);
  const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller }, error: callerErr } = await userClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Invalid or expired token" }, 401);

    const body = await req.json().catch(() => null);
    const parsed = parseNotifyBody(body);
    if (!parsed.ok) return json({ error: parsed.reason }, 400);
    const { kind, entityType, entityId, buildingId, title, url, recipients: requested } = parsed.value;

    // Membership check AS THE CALLER: building_members returns rows only for members. An RPC
    // error is our fault, not the caller's — a 403 here would read as "you lack access".
    const { data: members, error: memErr } = await userClient.rpc("building_members", { b: buildingId });
    if (memErr) { console.error("building_members failed", memErr); return json({ error: "An unexpected error occurred" }, 500); }
    const memberIds = new Set((members ?? []).map((m: { id: string }) => m.id));
    if (!memberIds.has(caller.id)) return json({ error: "Forbidden" }, 403);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const recipients = ORG_WIDE_KINDS.has(kind)
      ? await adminAndManagerIds(admin)
      : requested.filter((id) => memberIds.has(id));

    const result = await createNotifications(admin, {
      recipients, actorId: caller.id, actorName: await actorDisplayName(admin, caller.id),
      kind, entityType, entityId, buildingId, title, body: parsed.value.body, url,
    });
    return json({ success: true, ...result });
  } catch (e) {
    console.error("notify failed", e);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
