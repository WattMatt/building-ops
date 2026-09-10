import { describe, it, expect } from 'vitest';
import { buildCoverage, periodMatches, previousMonthPeriod, summaryLine } from './reportCoverage';

const b = (id: string, types = ['ops_monthly', 'cm_monthly']) => ({ id, name: id.toUpperCase(), report_types: types });
const r = (id: string, building_id: string, report_type: string, report_period: string, status: string) => ({ id, building_id, report_type, report_period, status });

describe('previousMonthPeriod', () => {
  it('steps back one month, across a year boundary', () => {
    expect(previousMonthPeriod('2026-09-10')).toBe('2026-08-01');
    expect(previousMonthPeriod('2026-01-15')).toBe('2025-12-01');
  });
});

describe('periodMatches', () => {
  it('matches monthly types on the month and annual on the year', () => {
    expect(periodMatches('ops_monthly', '2026-08-01', '2026-08-01')).toBe(true);
    expect(periodMatches('ops_monthly', '2026-07-01', '2026-08-01')).toBe(false);
    expect(periodMatches('annual_inspection', '2026-03-01', '2026-08-01')).toBe(true);
    expect(periodMatches('annual_inspection', '2025-12-01', '2026-08-01')).toBe(false);
  });
});

describe('buildCoverage', () => {
  it('marks missing, n/a and the most advanced report per cell, and counts per type', () => {
    const { rows, summary } = buildCoverage(
      [b('a'), b('b', ['ops_monthly', 'cm_monthly', 'annual_inspection']), b('c', ['ops_monthly'])],
      [
        r('r1', 'a', 'ops_monthly', '2026-08-01', 'approved'),
        r('r2', 'b', 'ops_monthly', '2026-08-01', 'draft'),
        r('r3', 'b', 'annual_inspection', '2026-02-01', 'submitted'),
        r('r4', 'b', 'annual_inspection', '2026-05-01', 'approved'),
        r('r5', 'c', 'ops_monthly', '2026-07-01', 'approved'),   // wrong month
      ],
      '2026-08-01',
    );
    expect(rows[0].cells.ops_monthly).toEqual({ status: 'approved', reportId: 'r1' });
    expect(rows[0].cells.cm_monthly).toEqual({ status: 'missing', reportId: null });
    expect(rows[0].cells.annual_inspection).toEqual({ status: 'na', reportId: null });
    expect(rows[1].cells.annual_inspection).toEqual({ status: 'approved', reportId: 'r4' });
    expect(rows[2].cells.ops_monthly.status).toBe('missing');
    expect(rows[2].cells.cm_monthly.status).toBe('na');
    expect(summary.ops_monthly).toMatchObject({ approved: 1, draft: 1, missing: 1 });
    expect(summary.cm_monthly).toMatchObject({ missing: 2, na: 0 });
    expect(summary.annual_inspection).toMatchObject({ approved: 1 });
  });
  it('summaryLine omits zeros and n/a', () => {
    expect(summaryLine({ missing: 12, na: 3, draft: 0, submitted: 4, reviewed: 0, approved: 31, rejected: 0 })).toBe('31 approved · 4 submitted · 12 missing');
    expect(summaryLine({ missing: 0, na: 0, draft: 0, submitted: 0, reviewed: 0, approved: 0, rejected: 0 })).toBe('nothing due');
  });
});
