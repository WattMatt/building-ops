// Web Push over our own VAPID keys. Never throws into the caller's flow: the inbox row is the
// record, a push is a hint. A 404/410 from the push service means the subscription is gone —
// we stamp failed_at so the sender skips it and the digest prunes it after 30 days.
import webpush from "npm:web-push@3.6.7";
import type { PushPayload } from "./notifyRules.ts";

const PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
const PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
const SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:notifications@buildingops.app";
export const pushConfigured = !!(PUBLIC && PRIVATE);
if (pushConfigured) webpush.setVapidDetails(SUBJECT, PUBLIC!, PRIVATE!);

// deno-lint-ignore no-explicit-any
type Admin = { from: (t: string) => any };
interface SubRow { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }

export interface PushResult { sent: number; gone: number; failed: number; skipped: number }

/** Sends `payload` to every live subscription of `recipientIds`. */
export async function sendPush(admin: Admin, recipientIds: string[], payload: PushPayload): Promise<PushResult> {
  const r: PushResult = { sent: 0, gone: 0, failed: 0, skipped: 0 };
  if (!pushConfigured || !recipientIds.length) { r.skipped = recipientIds.length; return r; }
  const { data, error } = await admin.from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth").in("user_id", recipientIds).is("failed_at", null);
  if (error) { console.error("push: subscriptions read failed", error); r.failed = recipientIds.length; return r; }
  const body = JSON.stringify(payload);
  await Promise.all(((data ?? []) as SubRow[]).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 60 * 60, urgency: "high" });
      r.sent++;
      await admin.from("push_subscriptions").update({ last_seen_at: new Date().toISOString() }).eq("id", s.id);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        r.gone++;
        await admin.from("push_subscriptions").update({ failed_at: new Date().toISOString() }).eq("id", s.id);
      } else { r.failed++; console.error("push: send failed", s.id, status, (e as Error).message); }
    }
  }));
  return r;
}
