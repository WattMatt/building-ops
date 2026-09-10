/**
 * Pure rules for in-app notifications: which profile flag governs each kind, whether an
 * email should go out, and the inbox rows to insert. No I/O, so it is unit-tested from the
 * web app's vitest suite (src/lib/notifyRules.test.ts) and bundled into the edge functions.
 */
export const NOTIFICATION_KINDS = [
  'task_assigned', 'issue_assigned', 'issue_comment', 'issue_mention',
  'report_submitted', 'report_returned', 'report_approved',
  'form_submitted', 'form_reviewed', 'signoff_requested', 'signoff_complete', 'signoff_overdue',
  'document_expiring', 'asset_service_due',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const ENTITY_TYPES = ['task', 'issue', 'report', 'form_submission', 'signoff_request', 'document', 'asset'] as const;
export type NotificationEntityType = (typeof ENTITY_TYPES)[number];

export type PrefFlag = 'issue_updates' | 'task_reminders' | 'overdue_alerts';
export interface NotificationPrefs {
  email_notifications: boolean | null;
  issue_updates: boolean | null;
  task_reminders: boolean | null;
  overdue_alerts: boolean | null;
  daily_digest: boolean | null;
}

/** Column limits for the inbox row; the email is rendered from the same clamped values. */
export const TITLE_MAX = 200;
export const BODY_MAX = 500;

/**
 * Truncate to `max` Unicode code points. `String.slice` counts UTF-16 units and would cut an
 * emoji in half at the boundary, leaving a lone surrogate in the inbox and the email.
 */
export function clamp(s: string, max: number): string {
  return Array.from(s).slice(0, max).join('');
}

/**
 * Organization name is operator-supplied; keep it safe for the From display name.
 * Pure, so it lives here and is re-exported from notify.ts for the edge functions.
 */
export function senderName(name: string): string {
  return name.replace(/[^A-Za-z0-9 &.-]/g, "").trim().slice(0, 64) || "Building Ops";
}

/**
 * Kinds that reach the inbox but never send a per-item email (the digest covers them).
 * This cannot be derived from the governing flag: `signoff_overdue` shares `overdue_alerts`
 * with these two, yet it does email per item.
 */
const DIGEST_ONLY: ReadonlySet<NotificationKind> = new Set(['document_expiring', 'asset_service_due']);

export function governingFlag(kind: NotificationKind): PrefFlag {
  switch (kind) {
    case 'task_assigned':
    case 'signoff_requested':
    case 'signoff_complete':
      return 'task_reminders';
    case 'signoff_overdue':
    case 'document_expiring':
    case 'asset_service_due':
      return 'overdue_alerts';
    case 'issue_assigned':
    case 'issue_comment':
    case 'issue_mention':
    case 'report_submitted':
    case 'report_returned':
    case 'report_approved':
    case 'form_submitted':
    case 'form_reviewed':
      return 'issue_updates';
    default: {
      // Every kind is listed above; adding one to NOTIFICATION_KINDS breaks the build here
      // rather than silently defaulting a new kind onto the wrong preference.
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** Null flags mean opted in, matching notify-expiring-alerts. */
export function shouldEmail(kind: NotificationKind, prefs: NotificationPrefs): boolean {
  if (DIGEST_ONLY.has(kind)) return false;
  if (prefs.email_notifications === false) return false;
  return prefs[governingFlag(kind)] !== false;
}

export interface InboxInput {
  recipients: string[];
  actorId: string | null;
  actorName: string | null;
  kind: NotificationKind;
  entityType: NotificationEntityType;
  entityId: string | null;
  buildingId: string | null;
  title: string;
  body: string | null;
  url: string;
}

export interface InboxRow {
  recipient_id: string;
  actor_id: string | null;
  actor_name: string | null;
  kind: NotificationKind;
  entity_type: NotificationEntityType;
  entity_id: string | null;
  building_id: string | null;
  title: string;
  body: string | null;
  url: string;
}

/**
 * One row per distinct recipient, never the actor. Returns [] for a notification that has no
 * title or whose url is not an in-app path.
 *
 * The `notify` edge function already rejects both cases before it calls this; the check is
 * repeated here as defence in depth, because senders retrofitted onto this module call
 * buildInboxRows directly and an off-site `url` would become the email's CTA link.
 */
export function buildInboxRows(input: InboxInput): InboxRow[] {
  if (!input.title.trim()) return [];
  if (!input.url.startsWith('/') || input.url.startsWith('//')) return [];

  const seen = new Set<string>();
  const rows: InboxRow[] = [];
  for (const id of input.recipients) {
    if (!id || id === input.actorId || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      recipient_id: id, actor_id: input.actorId, actor_name: input.actorName,
      kind: input.kind, entity_type: input.entityType, entity_id: input.entityId,
      building_id: input.buildingId, title: clamp(input.title, TITLE_MAX),
      body: input.body ? clamp(input.body, BODY_MAX) : null, url: input.url,
    });
  }
  return rows;
}
