import { describe, it, expect } from 'vitest';
import { shouldEmail, governingFlag, NOTIFICATION_KINDS, buildInboxRows } from '../../supabase/functions/_shared/notifyRules';

describe('governingFlag', () => {
  it('maps every kind to a profile flag', () => {
    for (const k of NOTIFICATION_KINDS) expect(typeof governingFlag(k)).toBe('string');
    expect(governingFlag('task_assigned')).toBe('task_reminders');
    expect(governingFlag('issue_mention')).toBe('issue_updates');
    expect(governingFlag('signoff_overdue')).toBe('overdue_alerts');
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
});

describe('buildInboxRows', () => {
  it('drops the actor and de-duplicates recipients', () => {
    const rows = buildInboxRows({ recipients: ['a', 'b', 'a', 'me'], actorId: 'me', actorName: 'Me', kind: 'issue_comment', entityType: 'issue', entityId: 'i1', buildingId: 'b1', title: 't', body: null, url: '/issues?open=i1' });
    expect(rows.map((r) => r.recipient_id)).toEqual(['a', 'b']);
    expect(rows[0]).toMatchObject({ actor_id: 'me', actor_name: 'Me', kind: 'issue_comment', entity_type: 'issue', entity_id: 'i1', building_id: 'b1', title: 't', url: '/issues?open=i1' });
  });
});
