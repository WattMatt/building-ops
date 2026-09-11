import { describe, it, expect } from 'vitest';
import { dueSoonThresholdMs, formatDuration, formatSlaInstant, slaState } from './slaState';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date('2026-09-10T10:00:00Z');
const base = { created_at: '2026-09-10T00:00:00Z', status: 'open' };

describe('formatDuration', () => {
  it('picks minutes, hours or days', () => {
    expect(formatDuration(30 * MIN)).toBe('30m');
    expect(formatDuration(3 * HOUR)).toBe('3h');
    expect(formatDuration(47 * HOUR)).toBe('47h');
    expect(formatDuration(3 * DAY)).toBe('3d');
    expect(formatDuration(-2 * DAY)).toBe('2d');
  });
  it('never reads 0m', () => {
    expect(formatDuration(0)).toBe('1m');
    expect(formatDuration(20_000, 'floor')).toBe('1m');
  });
  it('rounds in the unit first, then promotes: 60 minutes is an hour', () => {
    expect(formatDuration(59 * MIN + 30_000)).toBe('1h');
    expect(formatDuration(59 * MIN + 29_000)).toBe('59m');
    expect(formatDuration(59 * MIN + 30_000, 'floor')).toBe('59m');
    expect(formatDuration(60 * MIN, 'floor')).toBe('1h');
  });
  it('rounds in the unit first, then promotes: 48 hours is two days', () => {
    expect(formatDuration(47 * HOUR + 50 * MIN)).toBe('2d');
    expect(formatDuration(47 * HOUR + 20 * MIN)).toBe('47h');
    expect(formatDuration(47 * HOUR + 50 * MIN, 'floor')).toBe('47h');
    expect(formatDuration(48 * HOUR, 'floor')).toBe('2d');
    expect(formatDuration(2.6 * DAY, 'floor')).toBe('2d');
    expect(formatDuration(2.6 * DAY)).toBe('3d');
  });
});

describe('formatSlaInstant', () => {
  it('renders the instant in SAST with a medium date and short time', () => {
    // 00:00 UTC is 02:00 in Johannesburg (UTC+2, no DST).
    expect(formatSlaInstant(new Date('2026-09-13T00:00:00Z'))).toMatch(/^13 Sep\w* 2026, 02:00$/);
  });
});

describe('dueSoonThresholdMs', () => {
  it('is the larger of 4h and 20% of the target, capped at half the target', () => {
    expect(dueSoonThresholdMs(4 * HOUR)).toBe(2 * HOUR);
    expect(dueSoonThresholdMs(12 * HOUR)).toBe(4 * HOUR);
    expect(dueSoonThresholdMs(72 * HOUR)).toBe(14.4 * HOUR);
  });
});

describe('slaState', () => {
  it('has no SLA without a positive target', () => {
    expect(slaState(base, NOW).kind).toBe('none');
    expect(slaState({ ...base, sla_target_hours: 0 }, NOW).label).toBe('No SLA');
    expect(slaState({ ...base, sla_target_hours: 'abc' }, NOW).kind).toBe('none');
  });
  it('has no SLA without a parseable created_at', () => {
    expect(slaState({ ...base, created_at: '', sla_target_hours: 4 }, NOW)).toMatchObject({ kind: 'none', due: null, remainingMs: null });
  });
  it('is ok with plenty of time and due_soon inside the last 20% (min 4h)', () => {
    expect(slaState({ ...base, sla_target_hours: 72 }, NOW)).toMatchObject({ kind: 'ok', label: 'Due in 2d' });
    expect(slaState({ ...base, sla_target_hours: 12 }, NOW)).toMatchObject({ kind: 'due_soon', label: 'Due in 2h' });
    expect(slaState({ ...base, sla_target_hours: 168 }, new Date('2026-09-16T08:00:00Z'))).toMatchObject({ kind: 'due_soon' });
  });
  it('does not flag a short clock as due soon from the moment it starts', () => {
    const created = new Date('2026-09-10T00:00:00Z');
    expect(slaState({ ...base, sla_target_hours: 4 }, created)).toMatchObject({ kind: 'ok', label: 'Due in 4h' });
    expect(slaState({ ...base, sla_target_hours: 4 }, new Date(created.getTime() + 3 * HOUR))).toMatchObject({ kind: 'due_soon', label: 'Due in 1h' });
  });
  it('floors the time left so "Due in" never over-promises', () => {
    expect(slaState({ ...base, sla_target_hours: 24 }, new Date('2026-09-10T00:00:30Z')).label).toBe('Due in 23h');
  });
  it('accepts a numeric string target (PostgREST numeric)', () => {
    expect(slaState({ ...base, sla_target_hours: '24' }, NOW).due?.toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });
  it('is breached once past due or once the sweep stamped it', () => {
    expect(slaState({ ...base, sla_target_hours: 4 }, NOW)).toMatchObject({ kind: 'breached', breached: true, label: 'Breached 6h ago', remainingMs: -6 * HOUR });
    expect(slaState({ ...base, sla_target_hours: 72, sla_breached_at: '2026-09-10T09:00:00Z' }, NOW).kind).toBe('breached');
  });
  it('is breached at the deadline itself, not a millisecond later', () => {
    const atDue = new Date('2026-09-10T04:00:00Z');
    expect(slaState({ ...base, sla_target_hours: 4 }, atDue)).toMatchObject({ kind: 'breached', remainingMs: 0, label: 'Breached 1m ago' });
    expect(slaState({ ...base, sla_target_hours: 4 }, new Date(atDue.getTime() - 1)).kind).toBe('due_soon');
  });
  it('resolved issues read met or missed', () => {
    expect(slaState({ ...base, status: 'resolved', sla_target_hours: 24, resolved_at: '2026-09-10T05:00:00Z' }, NOW)).toMatchObject({ kind: 'met', label: 'Met' });
    expect(slaState({ ...base, status: 'resolved', sla_target_hours: 4, resolved_at: '2026-09-10T08:00:00Z' }, NOW)).toMatchObject({ kind: 'missed', label: 'Missed by 4h' });
  });
  it('says "Missed by" only when the resolution instant is known', () => {
    expect(slaState({ ...base, status: 'resolved', sla_target_hours: 4, sla_breached_at: '2026-09-10T04:30:00Z', resolved_at: null }, NOW))
      .toMatchObject({ kind: 'missed', label: 'Missed' });
  });
  it('keeps remainingMs as the signed distance to due for met and missed', () => {
    expect(slaState({ ...base, status: 'resolved', sla_target_hours: 24, resolved_at: '2026-09-10T05:00:00Z' }, NOW).remainingMs).toBe(14 * HOUR);
    expect(slaState({ ...base, status: 'resolved', sla_target_hours: 4, resolved_at: '2026-09-10T08:00:00Z' }, NOW).remainingMs).toBe(-6 * HOUR);
  });
});
