import { describe, it, expect } from 'vitest';
import { formatDuration, slaState } from './slaState';

const NOW = new Date('2026-09-10T10:00:00Z');
const base = { created_at: '2026-09-10T00:00:00Z', status: 'open' };

describe('formatDuration', () => {
  it('picks minutes, hours or days', () => {
    expect(formatDuration(30 * 60_000)).toBe('30m');
    expect(formatDuration(3 * 3_600_000)).toBe('3h');
    expect(formatDuration(47 * 3_600_000)).toBe('47h');
    expect(formatDuration(3 * 86_400_000)).toBe('3d');
    expect(formatDuration(-2 * 86_400_000)).toBe('2d');
  });
});

describe('slaState', () => {
  it('has no SLA without a positive target', () => {
    expect(slaState(base, NOW).kind).toBe('none');
    expect(slaState({ ...base, sla_target_hours: 0 }, NOW).label).toBe('No SLA');
    expect(slaState({ ...base, sla_target_hours: 'abc' }, NOW).kind).toBe('none');
  });
  it('is ok with plenty of time and due_soon inside the last 20% (min 4h)', () => {
    expect(slaState({ ...base, sla_target_hours: 72 }, NOW)).toMatchObject({ kind: 'ok', label: 'Due in 2d' });
    expect(slaState({ ...base, sla_target_hours: 12 }, NOW)).toMatchObject({ kind: 'due_soon', label: 'Due in 2h' });
    expect(slaState({ ...base, sla_target_hours: 168 }, new Date('2026-09-16T08:00:00Z'))).toMatchObject({ kind: 'due_soon' });
  });
  it('accepts a numeric string target (PostgREST numeric)', () => {
    expect(slaState({ ...base, sla_target_hours: '24' }, NOW).due?.toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });
  it('is breached once past due or once the sweep stamped it', () => {
    expect(slaState({ ...base, sla_target_hours: 4 }, NOW)).toMatchObject({ kind: 'breached', breached: true, label: 'Breached 6h ago' });
    expect(slaState({ ...base, sla_target_hours: 72, sla_breached_at: '2026-09-10T09:00:00Z' }, NOW).kind).toBe('breached');
  });
  it('resolved issues read met or missed', () => {
    expect(slaState({ ...base, status: 'resolved', sla_target_hours: 24, resolved_at: '2026-09-10T05:00:00Z' }, NOW)).toMatchObject({ kind: 'met', label: 'Met' });
    expect(slaState({ ...base, status: 'resolved', sla_target_hours: 4, resolved_at: '2026-09-10T08:00:00Z' }, NOW)).toMatchObject({ kind: 'missed', label: 'Missed by 4h' });
    expect(slaState({ ...base, status: 'resolved', sla_target_hours: 4, sla_breached_at: '2026-09-10T04:30:00Z', resolved_at: null }, NOW).kind).toBe('missed');
  });
});
