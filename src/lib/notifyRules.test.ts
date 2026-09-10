import { describe, it, expect } from 'vitest';
import {
  shouldEmail,
  governingFlag,
  senderName,
  clamp,
  TITLE_MAX,
  BODY_MAX,
  NOTIFICATION_KINDS,
  buildInboxRows,
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
