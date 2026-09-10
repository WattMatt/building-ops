/**
 * Pure rules for in-app notifications: which profile flag governs each kind, whether an
 * email should go out, and the inbox rows to insert. No I/O, so it is unit-tested from the
 * web app's vitest suite (src/lib/notifyRules.test.ts) and bundled into the edge functions.
 */
export const NOTIFICATION_KINDS = [
  'task_assigned', 'issue_assigned', 'issue_comment', 'issue_mention',
  'report_submitted', 'report_returned', 'report_approved',
  'form_submitted', 'form_reviewed', 'signoff_requested', 'signoff_complete', 'signoff_overdue',
  'document_expiring', 'asset_service_due', 'task_due_today',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const ENTITY_TYPES = ['task', 'issue', 'report', 'form_submission', 'signoff_request', 'document', 'asset'] as const;
export type NotificationEntityType = (typeof ENTITY_TYPES)[number];

/**
 * The only kinds the web client may send through the `notify` edge function. The rest are
 * produced server-side by their own functions (form review/submission, sign-off reminders,
 * expiring-document alerts), which reach the inbox without going through `notify` at all —
 * so a browser has no business asking for them.
 */
export const CLIENT_KINDS: ReadonlySet<NotificationKind> = new Set([
  'task_assigned', 'issue_assigned', 'issue_comment', 'issue_mention',
  'report_submitted', 'report_returned', 'report_approved',
]);

/**
 * Client kinds whose recipients are resolved server-side (every admin and manager) instead of
 * being taken from the request body. Only `report_submitted` qualifies: `form_submitted` and
 * `signoff_overdue` are org-wide too, but their own edge functions fan them out, and the
 * client cannot send them at all (they are not in CLIENT_KINDS).
 */
export const ORG_WIDE_KINDS: ReadonlySet<NotificationKind> = new Set(['report_submitted']);

/**
 * The kinds worth interrupting someone's day for. Everything else stays in the inbox (and the
 * email/digest) so push never becomes noise: a comment on an issue can wait, a task landing on
 * your list right now cannot. `task_due_today` exists only for push and the inbox — the daily
 * digest raises it and it never emails per item.
 */
export const PUSH_KINDS: ReadonlySet<NotificationKind> = new Set([
  'task_assigned', 'issue_mention', 'signoff_requested', 'task_due_today',
]);

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
export const URL_MAX = 300;
export const MAX_RECIPIENTS = 50;

/**
 * Every in-app destination a notification is allowed to deep-link to. An allowlist rather than
 * a "starts with /" check, because the url becomes the CTA href in the outgoing email: a bare
 * `/` test would happily accept `/logout`, `/settings` or any other path a caller invented.
 */
export const ALLOWED_URL_PREFIXES = [
  '/issues', '/buildings/', '/reports/fortress/', '/my-signoffs', '/forms', '/inbox', '/my-day',
] as const;

/**
 * A url is usable only if it is one of the known in-app paths, is not protocol-relative
 * (`//evil.example` is a fully qualified off-site link once the browser resolves it), contains
 * no backslash (which several clients normalise to `/`, so `/issues\evil` can escape the
 * prefix it appears to match) and fits the column.
 *
 * A bare prefix (one that does not already end in `/`, e.g. `/issues` or `/forms`) is a route
 * boundary, not a free-text prefix: `startsWith` alone would also accept a sibling route it
 * merely shares characters with, like `/issuesanything` or `/formsx`. So for those prefixes the
 * character right after the match must be absent, `/`, or `?` — the only ways a real path can
 * continue. Prefixes that already end in `/` (e.g. `/buildings/`) already carry that boundary.
 */
export function isAllowedUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > URL_MAX) return false;
  if (url.startsWith('//') || url.includes('\\')) return false;
  return ALLOWED_URL_PREFIXES.some((prefix) => {
    if (!url.startsWith(prefix)) return false;
    if (prefix.endsWith('/')) return true;
    const next = url.charAt(prefix.length);
    return next === '' || next === '/' || next === '?';
  });
}

/** Ids are uuids everywhere in this schema; accept nothing looser. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NotifyBody {
  kind: NotificationKind;
  entityType: NotificationEntityType;
  entityId: string | null;
  buildingId: string;
  title: string;
  body: string | null;
  url: string;
  recipients: string[];
}

export type ParsedNotifyBody =
  | { ok: true; value: NotifyBody }
  | { ok: false; reason: string };

/**
 * Validate an untrusted `notify` request body. Lives here, not in the edge function, so the
 * whole allowlist is covered by the web app's vitest suite (Deno is not part of the test run).
 *
 * Recipients are only shape-checked here; the edge function still has to intersect them with
 * the caller's building membership, which needs a database round-trip.
 */
export function parseNotifyBody(raw: unknown): ParsedNotifyBody {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'Body must be a JSON object' };
  const input = raw as Record<string, unknown>;

  const kind = NOTIFICATION_KINDS.find((k) => k === input.kind);
  if (!kind || !CLIENT_KINDS.has(kind)) return { ok: false, reason: 'Unsupported notification kind' };

  const entityType = ENTITY_TYPES.find((t) => t === input.entityType);
  if (!entityType) return { ok: false, reason: 'Unknown entity type' };

  if (typeof input.buildingId !== 'string' || !UUID_RE.test(input.buildingId)) {
    return { ok: false, reason: 'buildingId must be a uuid' };
  }
  const buildingId = input.buildingId;

  // Optional, but a value that is present has to be a real id rather than being silently dropped.
  let entityId: string | null = null;
  if (input.entityId !== undefined && input.entityId !== null && input.entityId !== '') {
    if (typeof input.entityId !== 'string' || !UUID_RE.test(input.entityId)) {
      return { ok: false, reason: 'entityId must be a uuid' };
    }
    entityId = input.entityId;
  }

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) return { ok: false, reason: 'title is required' };

  const body = typeof input.body === 'string' ? input.body.trim() : '';

  const url = typeof input.url === 'string' ? input.url : '';
  if (!isAllowedUrl(url)) return { ok: false, reason: 'url is not a known in-app path' };

  const seen = new Set<string>();
  const recipients: string[] = [];
  if (Array.isArray(input.recipients)) {
    for (const id of input.recipients) {
      if (typeof id !== 'string' || !UUID_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      recipients.push(id);
      if (recipients.length === MAX_RECIPIENTS) break;
    }
  }

  return {
    ok: true,
    value: {
      kind, entityType, entityId, buildingId,
      title: clamp(title, TITLE_MAX),
      body: body ? clamp(body, BODY_MAX) : null,
      url, recipients,
    },
  };
}

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
const DIGEST_ONLY: ReadonlySet<NotificationKind> = new Set(['document_expiring', 'asset_service_due', 'task_due_today']);

export function governingFlag(kind: NotificationKind): PrefFlag {
  switch (kind) {
    case 'task_assigned':
    case 'signoff_requested':
    case 'signoff_complete':
    case 'task_due_today':
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

/**
 * Push is governed by the kind's preference flag alone. `email_notifications` is the email
 * master switch, so turning email off must not also silence the phone — the two channels are
 * separate opt-ins. Null flags mean opted in, as for email.
 */
export function shouldPush(kind: NotificationKind, prefs: NotificationPrefs): boolean {
  return PUSH_KINDS.has(kind) && prefs[governingFlag(kind)] !== false;
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
 * title or whose url is not one of the known in-app paths.
 *
 * The `notify` edge function already rejects both cases before it calls this; the check is
 * repeated here as defence in depth, because senders retrofitted onto this module call
 * buildInboxRows directly and an off-site `url` would become the email's CTA link.
 */
export function buildInboxRows(input: InboxInput): InboxRow[] {
  if (!input.title.trim()) return [];
  if (!isAllowedUrl(input.url)) return [];

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

/** What the service worker shows. `tag` collapses repeat pushes for the same entity into one card. */
export interface PushPayload {
  title: string;
  body: string | null;
  url: string;
  tag: string;
}

export function pushPayloadFor(row: Pick<InboxRow, 'kind' | 'title' | 'body' | 'url' | 'entity_id'>): PushPayload {
  return {
    title: row.title,
    body: row.body,
    url: row.url,
    tag: row.entity_id ? `${row.kind}:${row.entity_id}` : row.kind,
  };
}
