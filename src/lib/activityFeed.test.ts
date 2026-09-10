import { describe, it, expect } from 'vitest';
import { describeActivity, groupByDay, type FeedRow } from './activityFeed';

const row = (overrides: Partial<FeedRow> = {}): FeedRow => ({
  id: 'a1',
  issue_id: 'i1',
  activity_type: 'created',
  old_value: null,
  new_value: null,
  comment: null,
  author_name: 'Thabo Mokoena',
  created_at: '2026-09-10T10:00:00Z',
  issue_title: 'Leaking pipe',
  building_name: 'Sandton Tower',
  ...overrides,
});

describe('describeActivity', () => {
  it('created → "created this issue"', () => {
    expect(describeActivity(row({ activity_type: 'created' }))).toBe('created this issue');
  });

  it('status_change → "changed status <Old> → <New>" using the status labels', () => {
    expect(
      describeActivity(row({ activity_type: 'status_change', old_value: 'open', new_value: 'in_progress' }))
    ).toBe('changed status Open → In Progress');
  });

  it('status_change falls back to the raw value when it is not a known status', () => {
    expect(
      describeActivity(row({ activity_type: 'status_change', old_value: 'open', new_value: 'mystery' }))
    ).toBe('changed status Open → mystery');
  });

  it('assignment with a new value → "assigned this issue"', () => {
    expect(describeActivity(row({ activity_type: 'assignment', new_value: 'user-123' }))).toBe(
      'assigned this issue'
    );
  });

  it('assignment with no new value → "removed the assignee"', () => {
    expect(describeActivity(row({ activity_type: 'assignment', new_value: null }))).toBe(
      'removed the assignee'
    );
  });

  it('contractor_assignment → "assigned contractor <name>"', () => {
    expect(
      describeActivity(row({ activity_type: 'contractor_assignment', new_value: 'ACME Plumbing' }))
    ).toBe('assigned contractor ACME Plumbing');
  });

  it('contractor_assignment with no new value → "assigned contractor"', () => {
    expect(
      describeActivity(row({ activity_type: 'contractor_assignment', new_value: null }))
    ).toBe('assigned contractor');
  });

  it('comment → "commented: <text>" when 80 chars or fewer', () => {
    expect(describeActivity(row({ activity_type: 'comment', comment: 'Fixed the valve.' }))).toBe(
      'commented: Fixed the valve.'
    );
  });

  it('comment with null text → "commented" with no trailing colon', () => {
    expect(describeActivity(row({ activity_type: 'comment', comment: null }))).toBe('commented');
  });

  it('comment with empty text → "commented" with no trailing colon', () => {
    expect(describeActivity(row({ activity_type: 'comment', comment: '' }))).toBe('commented');
  });

  it('comment → truncates to the first 80 chars with an ellipsis when longer', () => {
    const long = 'x'.repeat(120);
    const result = describeActivity(row({ activity_type: 'comment', comment: long }));
    expect(result).toBe(`commented: ${'x'.repeat(80)}…`);
  });

  it('comment exactly 80 chars is not truncated', () => {
    const exact = 'y'.repeat(80);
    expect(describeActivity(row({ activity_type: 'comment', comment: exact }))).toBe(
      `commented: ${exact}`
    );
  });

  it('unknown type → the raw type string', () => {
    expect(describeActivity(row({ activity_type: 'weird_thing' }))).toBe('weird_thing');
  });
});

describe('groupByDay', () => {
  it('groups today under "Today", yesterday under "Yesterday", and older days by formatted label', () => {
    const today = row({ id: 'today', created_at: '2026-09-10T10:00:00Z' }); // 12:00 SAST
    const yesterday = row({ id: 'yesterday', created_at: '2026-09-09T10:00:00Z' }); // 12:00 SAST
    const older = row({ id: 'older', created_at: '2026-09-05T10:00:00Z' }); // Sat, 12:00 SAST

    const groups = groupByDay([today, yesterday, older], '2026-09-10');

    expect(groups.map((g) => g.day)).toEqual(['Today', 'Yesterday', 'Sat 5 Sep']);
    expect(groups[0].items.map((r) => r.id)).toEqual(['today']);
    expect(groups[1].items.map((r) => r.id)).toEqual(['yesterday']);
    expect(groups[2].items.map((r) => r.id)).toEqual(['older']);
  });

  it('computes the local day using Africa/Johannesburg, not UTC', () => {
    // 22:30 UTC on Sep 9 is 00:30 SAST on Sep 10 — should land in "Today", not "Yesterday".
    const lateUtc = row({ id: 'late-utc', created_at: '2026-09-09T22:30:00Z' });
    const groups = groupByDay([lateUtc], '2026-09-10');
    expect(groups.map((g) => g.day)).toEqual(['Today']);
  });

  it('preserves newest-first order within a day', () => {
    const newer = row({ id: 'newer', created_at: '2026-09-10T15:00:00Z' });
    const older = row({ id: 'older-same-day', created_at: '2026-09-10T08:00:00Z' });
    const groups = groupByDay([newer, older], '2026-09-10');
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((r) => r.id)).toEqual(['newer', 'older-same-day']);
  });

  it('orders day groups newest first even when input rows are interleaved', () => {
    const today = row({ id: 'today', created_at: '2026-09-10T10:00:00Z' });
    const older = row({ id: 'older', created_at: '2026-09-05T10:00:00Z' });
    const yesterday = row({ id: 'yesterday', created_at: '2026-09-09T10:00:00Z' });
    const groups = groupByDay([today, older, yesterday], '2026-09-10');
    expect(groups.map((g) => g.day)).toEqual(['Today', 'Yesterday', 'Sat 5 Sep']);
  });

  it('returns an empty array for no rows', () => {
    expect(groupByDay([], '2026-09-10')).toEqual([]);
  });
});
