// One sender for every notification: inserts inbox rows (service role) and emails each
// recipient whose preferences allow it. Every user-facing edge function routes through
// this so the inbox and the email can never disagree about what was sent.
import { escapeText, loadBranding, renderEmail, type Branding } from "./email.ts";
import { buildInboxRows, shouldEmail, type InboxInput, type NotificationPrefs } from "./notifyRules.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
export const APP_URL = (Deno.env.get("APP_URL") ?? "https://buildingops.app").replace(/\/+$/, "");

/** Organization name is operator-supplied; keep it safe for the From display name. */
export function senderName(name: string): string {
  return name.replace(/[^A-Za-z0-9 &.-]/g, "").trim().slice(0, 64) || "Building Ops";
}

export async function sendEmail(from: string, to: string[], subject: string, html: string): Promise<void> {
  if (!to.length) return;
  if (!RESEND_API_KEY) { console.warn("RESEND_API_KEY not set; email skipped"); return; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend API error: ${await res.text()}`);
}

// deno-lint-ignore no-explicit-any
type Admin = { from: (t: string) => any };

export interface CreateNotificationsInput extends InboxInput {
  /** Email subject; defaults to the title. */
  subject?: string;
  /** Extra HTML under the body line (already escaped by the caller). */
  detailHtml?: string;
  ctaText?: string;
}

export interface CreateNotificationsResult { inserted: number; emailed: number; skipped: number }

/**
 * Insert inbox rows for every recipient (minus the actor), then email those whose profile
 * flags allow it. Email failures are logged, never thrown: the inbox row is the record.
 */
export async function createNotifications(admin: Admin, input: CreateNotificationsInput, branding?: Branding): Promise<CreateNotificationsResult> {
  const rows = buildInboxRows(input);
  if (!rows.length) return { inserted: 0, emailed: 0, skipped: 0 };

  const { error: insErr } = await admin.from("notifications").insert(rows);
  if (insErr) throw new Error(`Could not write inbox rows: ${insErr.message}`);

  const ids = rows.map((r) => r.recipient_id);
  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("id, email, full_name, email_notifications, issue_updates, task_reminders, overdue_alerts, daily_digest, deactivated")
    .in("id", ids);
  if (profErr) { console.error("notify: profiles read failed", profErr); return { inserted: rows.length, emailed: 0, skipped: rows.length }; }

  const b = branding ?? await loadBranding(admin);
  const from = `${senderName(b.appName)} <notifications@buildingops.app>`;
  let emailed = 0, skipped = 0;
  for (const p of profiles ?? []) {
    const prefs: NotificationPrefs = p;
    if (!p.email || p.deactivated || !shouldEmail(input.kind, prefs)) { skipped++; continue; }
    const html = renderEmail({
      branding: b,
      preheader: input.body ?? undefined,
      heading: input.title,
      greeting: p.full_name ? `Hi ${escapeText(p.full_name)},` : undefined,
      bodyHtml: `${input.body ? `<p style="margin:0 0 12px;">${escapeText(input.body)}</p>` : ""}${input.detailHtml ?? ""}`,
      ctaText: input.ctaText ?? "Open in Building Ops",
      ctaUrl: `${APP_URL}${input.url}`,
      footnote: "You can change which emails you receive under My Profile → Notifications.",
    });
    try { await sendEmail(from, [p.email], input.subject ?? input.title, html); emailed++; }
    catch (e) { console.error("notify: email failed", p.id, e); skipped++; }
  }
  return { inserted: rows.length, emailed, skipped };
}

/** All active admins and managers — the server-side recipient list for org-wide kinds. */
export async function adminAndManagerIds(admin: Admin): Promise<string[]> {
  const { data } = await admin.from("user_roles").select("user_id").in("role", ["admin", "manager"]);
  return Array.from(new Set((data ?? []).map((r: { user_id: string }) => r.user_id)));
}

/** Display name for the actor, denormalised onto the inbox row. */
export async function actorDisplayName(admin: Admin, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  return (data?.full_name as string | null)?.trim() || (data?.email as string | null) || null;
}
