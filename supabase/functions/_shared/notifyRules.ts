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

/** Kinds that reach the inbox but never send a per-item email (the digest covers them). */
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
    default:
      return 'issue_updates';
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

/** One row per distinct recipient, never the actor. */
export function buildInboxRows(input: InboxInput): InboxRow[] {
  const seen = new Set<string>();
  const rows: InboxRow[] = [];
  for (const id of input.recipients) {
    if (!id || id === input.actorId || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      recipient_id: id, actor_id: input.actorId, actor_name: input.actorName,
      kind: input.kind, entity_type: input.entityType, entity_id: input.entityId,
      building_id: input.buildingId, title: input.title.slice(0, 200), body: input.body ? input.body.slice(0, 500) : null, url: input.url,
    });
  }
  return rows;
}
