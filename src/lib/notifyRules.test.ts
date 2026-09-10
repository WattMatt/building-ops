import { describe, it, expect } from 'vitest';
import {
  shouldEmail,
  governingFlag,
  senderName,
  clamp,
  TITLE_MAX,
  BODY_MAX,
  URL_MAX,
  NOTIFICATION_KINDS,
  buildInboxRows,
  isAllowedUrl,
  parseNotifyBody,
  CLIENT_KINDS,
  ORG_WIDE_KINDS,
  MAX_RECIPIENTS,
  PUSH_KINDS,
  shouldPush,
  pushPayloadFor,
  type InboxInput,
  type NotificationKind,
  type PrefFlag,
} from '../../supabase/functions/_shared/notifyRules';

const input = (over: Partial<InboxInput> = {}): InboxInput => ({
  recipients: ['a'], actorId: 'me', actorName: 'Me', kind: 'issue_comment', entityType: 'issue',
  entityId: 'i1', buildingId: 'b1', title: 't', body: null, url: '/issues?open=i1', ...over,
});

// A lone (unpaired) surrogate — what String.slice leaves behind when it cuts an emoji in half.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('governingFlag', () => {
  // The table from the R1b plan: every kind, and the profile flag that governs its email.
  const TABLE: Record<NotificationKind, PrefFlag> = {
    task_assigned: 'task_reminders',
    issue_assigned: 'issue_updates',
    issue_comment: 'issue_updates',
    issue_mention: 'issue_updates',
    report_submitted: 'issue_updates',
    report_returned: 'issue_updates',
    report_approved: 'issue_updates',
    form_submitted: 'issue_updates',
    form_reviewed: 'issue_updates',
    signoff_requested: 'task_reminders',
    signoff_complete: 'task_reminders',
    signoff_overdue: 'overdue_alerts',
    document_expiring: 'overdue_alerts',
    asset_service_due: 'overdue_alerts',
    task_due_today: 'task_reminders',
  };

  it('maps every kind to the flag the design says governs it', () => {
    for (const kind of NOTIFICATION_KINDS) expect([kind, governingFlag(kind)]).toEqual([kind, TABLE[kind]]);
  });

  it('covers every kind with no extras', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });
});

describe('shouldEmail', () => {
  const base = { email_notifications: null, issue_updates: null, task_reminders: null, overdue_alerts: null, daily_digest: null };
  it('null flags mean opted in', () => {
    expect(shouldEmail('issue_comment', base)).toBe(true);
  });
  it('email_notifications=false silences everything', () => {
    expect(shouldEmail('issue_comment', { ...base, email_notifications: false })).toBe(false);
  });
  it('the governing flag alone can silence a kind', () => {
    expect(shouldEmail('task_assigned', { ...base, task_reminders: false })).toBe(false);
    expect(shouldEmail('issue_assigned', { ...base, task_reminders: false })).toBe(true);
  });
  it('digest-only kinds never email per item', () => {
    expect(shouldEmail('document_expiring', base)).toBe(false);
    expect(shouldEmail('asset_service_due', base)).toBe(false);
  });
  it('signoff_overdue shares overdue_alerts with the digest-only kinds but still emails', () => {
    expect(shouldEmail('signoff_overdue', base)).toBe(true);
    expect(shouldEmail('signoff_overdue', { ...base, overdue_alerts: false })).toBe(false);
  });
});

describe('buildInboxRows', () => {
  it('drops the actor and de-duplicates recipients', () => {
    const rows = buildInboxRows(input({ recipients: ['a', 'b', 'a', 'me'] }));
    expect(rows.map((r) => r.recipient_id)).toEqual(['a', 'b']);
    expect(rows[0]).toMatchObject({ actor_id: 'me', actor_name: 'Me', kind: 'issue_comment', entity_type: 'issue', entity_id: 'i1', building_id: 'b1', title: 't', url: '/issues?open=i1' });
  });

  it('a null actorId drops nobody', () => {
    const rows = buildInboxRows(input({ recipients: ['a', 'b', 'c'], actorId: null }));
    expect(rows.map((r) => r.recipient_id)).toEqual(['a', 'b', 'c']);
    expect(rows.every((r) => r.actor_id === null)).toBe(true);
  });

  it('truncates the title to 200 code points and the body to 500', () => {
    const rows = buildInboxRows(input({ title: 'a'.repeat(201), body: 'b'.repeat(501) }));
    expect(Array.from(rows[0].title)).toHaveLength(TITLE_MAX);
    expect(Array.from(rows[0].body!)).toHaveLength(BODY_MAX);
  });

  it('leaves a title shorter than the limit alone', () => {
    const rows = buildInboxRows(input({ title: 'a'.repeat(200), body: 'b'.repeat(500) }));
    expect(rows[0].title).toHaveLength(200);
    expect(rows[0].body).toHaveLength(500);
  });

  it('never splits an emoji that straddles the truncation boundary', () => {
    // The 200th code point is the emoji, so a UTF-16 slice(0, 200) would cut it in half.
    const title = `${'a'.repeat(199)}\u{1F600}${'z'.repeat(20)}`;
    const rows = buildInboxRows(input({ title }));
    expect(Array.from(rows[0].title)).toHaveLength(TITLE_MAX);
    expect(rows[0].title.endsWith('\u{1F600}')).toBe(true);
    expect(LONE_SURROGATE.test(rows[0].title)).toBe(false);
    // 199 plain chars + a surrogate pair: proof we counted code points, not UTF-16 units.
    expect(rows[0].title.length).toBe(201);
    expect(title.slice(0, TITLE_MAX)).toMatch(LONE_SURROGATE);
  });

  it('turns an empty body into null', () => {
    expect(buildInboxRows(input({ body: '' }))[0].body).toBeNull();
  });

  it('refuses a notification with no real title', () => {
    expect(buildInboxRows(input({ title: '' }))).toEqual([]);
    expect(buildInboxRows(input({ title: '   \n\t ' }))).toEqual([]);
  });

  it('refuses a url that is not an in-app path', () => {
    expect(buildInboxRows(input({ url: '//evil' }))).toEqual([]);
    expect(buildInboxRows(input({ url: 'https://x' }))).toEqual([]);
    expect(buildInboxRows(input({ url: '' }))).toEqual([]);
    expect(buildInboxRows(input({ url: '/issues' }))).toHaveLength(1);
  });
});

describe('isAllowedUrl', () => {
  const TABLE: [string, boolean][] = [
    ['/issues', true],
    ['/issues?open=abc', true],
    ['/buildings/123?tab=checklists', true],
    ['/reports/fortress/abc', true],
    ['/my-signoffs', true],
    ['/forms', true],
    ['/inbox', true],
    ['/my-day', true],
    ['/my-day?d=2026-09-10', true],
    ['/my-dayx', false],
    ['/calendar', true],
    ['/calendar?date=2026-09-10&view=week', true],
    ['/calendarx', false],
    // Not on the allowlist, however in-app it looks.
    ['/settings', false],
    ['/', false],
    ['', false],
    // A bare prefix (no trailing slash) is a route boundary, not a free-text prefix: a sibling
    // route that merely shares characters must not sneak past `startsWith`.
    ['/issuesanything', false],
    ['/issues?open=x', true],
    ['/issues/', true],
    ['/inboxx', false],
    ['/forms', true],
    ['/buildings/abc', true],
    ['/buildingsx', false],
    // Off-site, or a path that resolves off-site once a browser normalises it.
    ['//evil.example', false],
    ['https://evil.example', false],
    ['/issues\\evil.example', false],
    ['\\\\evil.example', false],
    // Longer than the column.
    [`/issues?open=${'a'.repeat(300)}`, false],
  ];

  it.each(TABLE)('%j -> %s', (url, allowed) => {
    expect(isAllowedUrl(url)).toBe(allowed);
  });

  it('accepts a url of exactly the maximum length', () => {
    // `/issues` needs a boundary char (`?`) before free text now that a bare prefix requires
    // one — `/issues` + 293 letters would be the `/issuesanything` sibling-route case.
    expect(isAllowedUrl(`/issues?${'a'.repeat(292)}`)).toBe(true);
    expect(`/issues?${'a'.repeat(292)}`).toHaveLength(URL_MAX);
  });
});

describe('CLIENT_KINDS / ORG_WIDE_KINDS', () => {
  it('org-wide means report_submitted and nothing else', () => {
    // form_submitted and signoff_overdue are org-wide too, but their own edge functions raise
    // them — the client cannot ask `notify` for them at all.
    expect([...ORG_WIDE_KINDS]).toEqual(['report_submitted']);
    expect(ORG_WIDE_KINDS.has('form_submitted')).toBe(false);
    expect(ORG_WIDE_KINDS.has('signoff_overdue')).toBe(false);
  });

  it('every org-wide kind is a kind the client may send', () => {
    for (const kind of ORG_WIDE_KINDS) expect(CLIENT_KINDS.has(kind)).toBe(true);
  });

  it('is a subset of the known kinds', () => {
    for (const kind of CLIENT_KINDS) expect(NOTIFICATION_KINDS).toContain(kind);
  });
});

describe('parseNotifyBody', () => {
  const UUID_A = '11111111-2222-4333-8444-555555555555';
  const UUID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const valid = (over: Record<string, unknown> = {}) => ({
    kind: 'issue_comment', entityType: 'issue', entityId: UUID_A, buildingId: UUID_B,
    recipients: [UUID_A], title: 'Someone commented', body: ' hi ', url: '/issues?open=1', ...over,
  });

  const reject = (raw: unknown): string => {
    const parsed = parseNotifyBody(raw);
    expect(parsed.ok).toBe(false);
    return parsed.ok ? '' : parsed.reason;
  };

  it('accepts a valid client payload', () => {
    const parsed = parseNotifyBody(valid());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({
      kind: 'issue_comment', entityType: 'issue', entityId: UUID_A, buildingId: UUID_B,
      title: 'Someone commented', body: 'hi', url: '/issues?open=1', recipients: [UUID_A],
    });
  });

  it('treats an absent entityId, body and recipients as empty rather than invalid', () => {
    const parsed = parseNotifyBody({ kind: 'report_submitted', entityType: 'report', buildingId: UUID_B, title: 't', url: '/reports/fortress/1' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({ entityId: null, body: null, recipients: [] });
  });

  it('rejects a kind the client is not allowed to send', () => {
    expect(reject(valid({ kind: 'form_submitted', entityType: 'form_submission' }))).toMatch(/kind/i);
    expect(reject(valid({ kind: 'signoff_overdue', entityType: 'signoff_request' }))).toMatch(/kind/i);
    expect(reject(valid({ kind: 'document_expiring', entityType: 'document' }))).toMatch(/kind/i);
    expect(reject(valid({ kind: 'not_a_kind' }))).toMatch(/kind/i);
  });

  it('accepts every kind on the client allowlist', () => {
    for (const kind of CLIENT_KINDS) expect(parseNotifyBody(valid({ kind })).ok).toBe(true);
  });

  it('rejects an unknown entity type', () => {
    expect(reject(valid({ entityType: 'building' }))).toMatch(/entity type/i);
  });

  it('rejects an id that is not a uuid', () => {
    expect(reject(valid({ buildingId: 'b1' }))).toMatch(/buildingId/);
    expect(reject(valid({ buildingId: undefined }))).toMatch(/buildingId/);
    // 36 characters of hex and dashes, but not in the uuid layout: the old loose regex took it.
    expect(reject(valid({ buildingId: '1111111122224333844455555555-5555' }))).toMatch(/buildingId/);
    expect(reject(valid({ entityId: 'i1' }))).toMatch(/entityId/);
  });

  it('rejects a url that is off-site or not on the allowlist', () => {
    expect(reject(valid({ url: '//evil' }))).toMatch(/url/);
    expect(reject(valid({ url: '/settings' }))).toMatch(/url/);
    expect(reject(valid({ url: '/issues\\evil' }))).toMatch(/url/);
    expect(reject(valid({ url: undefined }))).toMatch(/url/);
  });

  it('rejects a title that is empty or only whitespace', () => {
    expect(reject(valid({ title: '' }))).toMatch(/title/);
    expect(reject(valid({ title: '   \n\t ' }))).toMatch(/title/);
    expect(reject(valid({ title: 42 }))).toMatch(/title/);
  });

  it('rejects a body that is not a JSON object', () => {
    expect(reject(null)).toMatch(/object/i);
    expect(reject('nope')).toMatch(/object/i);
    expect(reject([valid()])).toMatch(/object/i);
  });

  it('clamps the title and body to the column limits', () => {
    const parsed = parseNotifyBody(valid({ title: 'a'.repeat(300), body: 'b'.repeat(700) }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.title).toHaveLength(TITLE_MAX);
    expect(parsed.value.body).toHaveLength(BODY_MAX);
  });

  it('de-duplicates recipients, drops non-uuids, and caps the list at 50', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `${String(i).padStart(8, '0')}-2222-4333-8444-555555555555`);
    const parsed = parseNotifyBody(valid({ recipients: [...ids, ...ids, 'not-a-uuid', 7, null] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.recipients).toHaveLength(MAX_RECIPIENTS);
    expect(parsed.value.recipients).toEqual(ids.slice(0, MAX_RECIPIENTS));
  });

  it('de-duplicates before capping, so 60 copies of one id is one recipient', () => {
    const parsed = parseNotifyBody(valid({ recipients: Array.from({ length: 60 }, () => UUID_A) }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.recipients).toEqual([UUID_A]);
  });

  it('ignores a recipients value that is not an array', () => {
    const parsed = parseNotifyBody(valid({ recipients: UUID_A }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.recipients).toEqual([]);
  });
});

describe('clamp', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(clamp('\u{1F600}\u{1F600}\u{1F600}', 2)).toBe('\u{1F600}\u{1F600}');
    expect(clamp('abc', 10)).toBe('abc');
    expect(clamp('', 5)).toBe('');
  });
});

describe('senderName', () => {
  it('strips characters that would break the From display name', () => {
    expect(senderName('Watson & Mattheus (Pty) Ltd')).toBe('Watson & Mattheus Pty Ltd');
  });
  it('falls back when nothing usable is left', () => {
    expect(senderName('***')).toBe('Building Ops');
  });
});

describe('push', () => {
  it('pushes only the four urgent kinds', () => {
    expect([...PUSH_KINDS].sort()).toEqual(['issue_mention', 'signoff_requested', 'task_assigned', 'task_due_today']);
  });
  it('honours the governing flag and never pushes other kinds', () => {
    const on = { email_notifications: true, issue_updates: true, task_reminders: true, overdue_alerts: true, daily_digest: false };
    expect(shouldPush('task_assigned', on)).toBe(true);
    expect(shouldPush('task_assigned', { ...on, task_reminders: false })).toBe(false);
    expect(shouldPush('issue_mention', { ...on, issue_updates: false })).toBe(false);
    expect(shouldPush('issue_comment', on)).toBe(false);
    expect(shouldPush('task_due_today', { ...on, email_notifications: false })).toBe(true); // email master switch does not govern push
  });
  it('task_due_today is inbox + push only, never an email', () => {
    expect(governingFlag('task_due_today')).toBe('task_reminders');
    expect(shouldEmail('task_due_today', { email_notifications: true, issue_updates: true, task_reminders: true, overdue_alerts: true, daily_digest: true })).toBe(false);
  });
  it('allows /my-day deep links', () => {
    expect(isAllowedUrl('/my-day')).toBe(true);
    expect(isAllowedUrl('/my-dayx')).toBe(false);
  });
  it('allows /calendar deep links (My Day week strip, task reminders)', () => {
    expect(isAllowedUrl('/calendar')).toBe(true);
    expect(isAllowedUrl('/calendar?date=2026-09-10&view=week')).toBe(true);
    expect(isAllowedUrl('/calendarx')).toBe(false);
  });
  it('shapes a push payload from an inbox row', () => {
    const p = pushPayloadFor({ kind: 'task_assigned', title: 'T', body: 'B', url: '/my-day', entity_id: 'e1' });
    expect(p).toEqual({ title: 'T', body: 'B', url: '/my-day', tag: 'task_assigned:e1' });
    expect(pushPayloadFor({ kind: 'task_due_today', title: 'T', body: null, url: '/my-day', entity_id: null }).tag).toBe('task_due_today');
  });
});
