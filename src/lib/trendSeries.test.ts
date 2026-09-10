import { describe, it, expect } from 'vitest';
import { deltaLeaderboard, monthEnd, monthShift, monthlyPoints, reconstructionBoundary, series } from './trendSeries';
import type { SnapshotRow } from './snapshotClient';

const row = (day: string, over: Partial<SnapshotRow> = {}): SnapshotRow => ({
  building_id: 'b1', day, compliance_pct: null, critical_pct: null, inspection_pass_pct: null, compliance_period: null, ohs_open_nc: null,
  ppm_done_pct: null, task_completion_30d_pct: null, tasks_overdue: null, tasks_due_7d: null, issues_open: null, issues_open_by_priority: null,
  issues_breached: null, issues_resolved_30d: null, docs_expiring_30: null, docs_expiring_60: null, docs_expiring_90: null, docs_expired: null,
  assets_overdue: null, report_state: null, reconstructed: false, computed_at: '2026-09-10T03:00:00Z', ...over,
});

describe('trendSeries', () => {
  it('series reads numerics that PostgREST may return as strings', () => {
    expect(series([row('2026-09-01', { compliance_pct: '87.5' }), row('2026-09-02')], 'compliance_pct')).toEqual([87.5, null]);
  });
  it('monthShift and monthEnd', () => {
    expect(monthShift('2026-09-01', 0)).toBe('2026-09');
    expect(monthShift('2026-09-01', 11)).toBe('2025-10');
    expect(monthEnd('2026-02-01')).toBe('2026-02-28');
  });
  it('monthShift crosses the year boundary and monthEnd knows December and leap February', () => {
    expect(monthShift('2026-01-01', 1)).toBe('2025-12');
    expect(monthShift('2026-01-15', 13)).toBe('2024-12');
    expect(monthEnd('2026-12-01')).toBe('2026-12-31');
    expect(monthEnd('2028-02-01')).toBe('2028-02-29');
    expect(monthEnd('2026-09-10')).toBe('2026-09-30');
  });
  it('monthlyPoints takes the last row per month and fills missing months with nulls', () => {
    const pts = monthlyPoints([
      row('2026-08-03', { compliance_pct: 70 }), row('2026-08-30', { compliance_pct: 75, issues_open: 2 }), row('2026-09-10', { compliance_pct: 80 }),
    ], '2026-09-01', 3);
    expect(pts.map((p) => p.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(pts[0]).toMatchObject({ compliancePct: null, issuesOpen: null });
    expect(pts[1]).toMatchObject({ compliancePct: 75, issuesOpen: 2 });
    expect(pts[2].compliancePct).toBe(80);
  });
  it('deltaLeaderboard sorts by change and skips buildings with fewer than two values', () => {
    const board = deltaLeaderboard({
      up: [row('2026-08-01', { compliance_pct: 60 }), row('2026-09-01', { compliance_pct: 72.4 })],
      down: [row('2026-08-01', { compliance_pct: 90 }), row('2026-09-01', { compliance_pct: 85 })],
      one: [row('2026-09-01', { compliance_pct: 50 })],
    }, 'compliance_pct');
    expect(board.map((b) => b.buildingId)).toEqual(['up', 'down']);
    expect(board[0].delta).toBe(12.4);
  });
  it('deltaLeaderboard skips null values at either end and takes rows in the order given', () => {
    const board = deltaLeaderboard({
      b: [row('2026-08-01'), row('2026-08-02', { compliance_pct: '40' }), row('2026-09-01', { compliance_pct: 55 }), row('2026-09-02')],
    }, 'compliance_pct');
    expect(board).toEqual([{ buildingId: 'b', first: 40, last: 55, delta: 15 }]);
  });
  it('reconstructionBoundary', () => {
    expect(reconstructionBoundary([{ reconstructed: true }, { reconstructed: true }, { reconstructed: false }])).toBe(2);
    expect(reconstructionBoundary([{ reconstructed: true }])).toBe(-1);
  });
});
