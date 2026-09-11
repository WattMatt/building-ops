// One sender for every notification: inserts inbox rows (service role), pushes to the
// devices of recipients whose preferences allow it, and emails each recipient whose
// preferences allow it. Every user-facing edge function routes through this so the inbox,
// the push and the email can never disagree about what was sent.
import { escapeText, loadBranding, renderEmail, type Branding } from "./email.ts";
import {
  BODY_MAX,
  TITLE_MAX,
  buildInboxRows,
  clamp,
  pushPayloadFor,
  senderName,
  shouldEmail,
  shouldPush,
  type InboxInput,
  type NotificationPrefs,
} from "./notifyRules.ts";
import { sendPush, type PushResult } from "./push.ts";

// senderName is pure, so it lives in notifyRules.ts; re-exported here for existing importers.
export { senderName };

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
export const APP_URL = (Deno.env.get("APP_URL") ?? "https://buildingops.app").replace(/\/+$/, "");

/**
 * Send one Resend message. Returns true when the provider accepted it, false when there was
 * nothing (or no API key) to send — callers count those separately from a thrown failure.
 */
export async function sendEmail(from: string, to: string[], subject: string, html: string): Promise<boolean> {
  if (!to.length) return false;
  if (!RESEND_API_KEY) { console.warn("RESEND_API_KEY not set; email skipped"); return false; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from, to, subject, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend API error: ${await res.text()}`);
  return true;
}

// deno-lint-ignore no-explicit-any
type Admin = { from: (t: string) => any };

/** The profile columns the sender needs to decide whether a recipient gets a push or an email. */
interface Recipient extends NotificationPrefs {
  id: string;
  email: string | null;
  full_name: string | null;
  deactivated: boolean | null;
}

const RECIPIENT_COLUMNS =
  "id, email, full_name, email_notifications, issue_updates, task_reminders, overdue_alerts, daily_digest, deactivated";

export interface CreateNotificationsInput extends InboxInput {
  /** Email subject; defaults to the title. */
  subject?: string;
  /** Explanatory HTML above the body line (already escaped by the caller). */
  detailHtml?: string;
  /**
   * Names what `body` is in the email — "Reviewer notes", "Instructions" — so a free-text
   * paragraph arriving under the explanation reads as quoted input rather than more prose.
   * The inbox row keeps the plain, unlabelled body.
   */
  bodyLabel?: string;
  ctaText?: string;
  /**
   * Restrict the push (not the inbox row, not the email) to these recipients. `issue_reported`
   * goes to every admin/manager plus the assignee, but only the assignee's phone should buzz.
   */
  pushTo?: string[];
}

export interface CreateNotificationsResult {
  /** Inbox rows written. */
  inserted: number;
  /** Emails Resend accepted. */
  emailed: number;
  /** Push messages the push services accepted (one per live device, so this can exceed `inserted`). */
  pushed: number;
  /** Recipients deliberately not emailed: unknown id, deactivated, no address, preference off. */
  skipped: number;
  /** Recipients whose email threw (provider error or timeout). The inbox row still stands. */
  failed: number;
}

const NO_PUSH: PushResult = { sent: 0, gone: 0, failed: 0, skipped: 0 };

/**
 * Read the recipient profiles first, drop anyone unknown or deactivated, insert inbox rows
 * for the survivors only, push to the devices of those whose profile flags allow it, then
 * email those whose profile flags allow it.
 *
 * Reading first matters twice over: an id with no profile would make the whole insert fail on
 * the recipient foreign key, and a deactivated account should not accumulate inbox rows it can
 * never read. Push and email failures are counted, never thrown: the inbox row is the record.
 */
export async function createNotifications(
  admin: Admin,
  input: CreateNotificationsInput,
  brandingOverride?: Branding,
): Promise<CreateNotificationsResult> {
  // Clamp once, with the same helper buildInboxRows uses, so the email heading and body are
  // character-for-character what the inbox row holds.
  const title = clamp(input.title, TITLE_MAX);
  const body = input.body ? clamp(input.body, BODY_MAX) : null;

  // Also validates the title and url; [] means there is nothing legitimate to send.
  const candidates = buildInboxRows(input);
  if (!candidates.length) return { inserted: 0, emailed: 0, pushed: 0, skipped: 0, failed: 0 };

  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select(RECIPIENT_COLUMNS)
    .in("id", candidates.map((r) => r.recipient_id));
  if (profErr) {
    console.error("notify: profiles read failed", profErr);
    throw new Error(`Could not read notification recipients: ${profErr.message}`);
  }

  const byId = new Map<string, Recipient>();
  for (const p of (profiles ?? []) as Recipient[]) byId.set(p.id, p);
  const rows = candidates.filter((r) => {
    const p = byId.get(r.recipient_id);
    return !!p && !p.deactivated;
  });
  // Recipients dropped here get neither a row nor an email.
  let skipped = candidates.length - rows.length;
  if (!rows.length) return { inserted: 0, emailed: 0, pushed: 0, skipped, failed: 0 };

  const { error: insErr } = await admin.from("notifications").insert(rows);
  if (insErr) throw new Error(`Could not write inbox rows: ${insErr.message}`);

  // Push before email: it is the channel that reaches a phone now. Only the kinds in PUSH_KINDS
  // qualify, governed by the same profile flag as the email but not by the email master switch.
  // sendPush itself never throws for a single device; the guard here covers the subscription
  // read and anything unexpected, because a push problem must never cost anyone the email.
  // `pushTo`, when the caller sets it, narrows the push to a subset of the same rows; the
  // preference check still applies, so it can never turn a push on for someone who opted out.
  const pushAllowed = input.pushTo ? new Set(input.pushTo) : null;
  const pushRecipients = rows
    .filter((row) =>
      (!pushAllowed || pushAllowed.has(row.recipient_id)) && shouldPush(input.kind, byId.get(row.recipient_id)!)
    )
    .map((row) => row.recipient_id);
  let push: PushResult = NO_PUSH;
  if (pushRecipients.length) {
    try {
      push = await sendPush(
        admin,
        pushRecipients,
        pushPayloadFor({ kind: input.kind, title, body, url: input.url, entity_id: input.entityId }),
      );
    } catch (e) {
      console.error("notify: push failed", e);
      push = { ...NO_PUSH, failed: pushRecipients.length };
    }
  }
  console.log("notify: push", { kind: input.kind, ...push });

  const branding = brandingOverride ?? await loadBranding(admin);
  const from = `${senderName(branding.appName)} <notifications@buildingops.app>`;
  let emailed = 0, failed = 0;
  for (const row of rows) {
    const p = byId.get(row.recipient_id)!;
    const prefs: NotificationPrefs = p;
    if (!p.email || !shouldEmail(input.kind, prefs)) { skipped++; continue; }
    const html = renderEmail({
      branding,
      preheader: body ?? undefined,
      heading: title,
      // renderEmail escapes heading, greeting and preheader itself — escaping here too would
      // render "O&#39;Brien" in the greeting. Only bodyHtml and footnote are raw.
      greeting: p.full_name ? `Hi ${p.full_name},` : undefined,
      // detailHtml explains what happened; the body is the human's own words about it, so it
      // reads second, labelled where the caller named it, and with newlines preserved.
      bodyHtml: `${input.detailHtml ?? ""}${
        body
          ? `<p style="margin:0 0 12px;white-space:pre-wrap;">${
            input.bodyLabel ? `<strong>${escapeText(input.bodyLabel)}:</strong> ` : ""
          }${escapeText(body)}</p>`
          : ""
      }`,
      ctaText: input.ctaText ?? `Open in ${branding.appName}`,
      ctaUrl: `${APP_URL}${input.url}`,
      // Raw HTML by design; APP_URL and the branding colour are server constants.
      footnote: `You can change which emails you receive on <a href="${APP_URL}/profile" style="color:${branding.color};">your profile</a>.`,
    });
    try {
      if (await sendEmail(from, [p.email], input.subject ?? title, html)) emailed++;
      else skipped++;
    } catch (e) {
      console.error("notify: email failed", row.recipient_id, e);
      failed++;
    }
  }
  return { inserted: rows.length, emailed, pushed: push.sent, skipped, failed };
}

/** All admins and managers by role; deactivated accounts are dropped by createNotifications. */
export async function adminAndManagerIds(admin: Admin): Promise<string[]> {
  const { data, error } = await admin.from("user_roles").select("user_id").in("role", ["admin", "manager"]);
  if (error) { console.error("notify: admin/manager roles read failed", error); return []; }
  return Array.from(new Set((data ?? []).map((r: { user_id: string }) => r.user_id)));
}

/** Display name for the actor, denormalised onto the inbox row. */
export async function actorDisplayName(admin: Admin, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  return (data?.full_name as string | null)?.trim() || (data?.email as string | null) || null;
}
