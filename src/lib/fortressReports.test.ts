import { describe, it, expect } from 'vitest';
import {
  computeBuildingPct,
  formatZAR,
  formatPct,
  periodFromMonthInput,
  monthInputFromPeriod,
  formatPeriodLabel,
  type ScoredItem,
} from './fortressReports';

const item = (id: string, group: string, weight: number, scored = true): ScoredItem => ({
  id, group_code: group, group_weight: weight, is_scored: scored,
});

describe('computeBuildingPct (group-weighted, N/A = pass)', () => {
  it('matches the SQL math gate: core(yes,no)+specialised(na)+forum(yes) = 57.5%', () => {
    // 0.85*0.5 + 0.10*1 + 0.05*1 = 0.575
    const items = [
      item('a', 'core', 85), item('b', 'core', 85),
      item('c', 'specialised', 10), item('d', 'forum', 5),
    ];
    const pct = computeBuildingPct(items, { a: 'yes', b: 'no', c: 'na', d: 'yes' });
    expect(pct).toBe(57.5);
  });

  it('all scored items pass (yes/na) → 100% (AbaQulusi case)', () => {
    const items = [item('a', 'core', 85), item('b', 'specialised', 10), item('c', 'forum', 5)];
    expect(computeBuildingPct(items, { a: 'yes', b: 'na', c: 'yes' })).toBe(100);
  });

  it('excludes unscored items from the ratio', () => {
    const items = [item('a', 'core', 85), item('info', 'core', 85, false)];
    // only 'a' counts; 'info' (an information row) is ignored even if answered
    expect(computeBuildingPct(items, { a: 'yes', info: 'no' })).toBe(100);
  });

  it('returns null when nothing scored has been answered', () => {
    expect(computeBuildingPct([item('a', 'core', 85)], {})).toBeNull();
  });

  it('N/A is a pass, not an exclusion from the denominator', () => {
    // one yes, one na, one no in the same group → 2/3 compliant ≈ 66.7%
    const items = [item('a', 'core', 85), item('b', 'core', 85), item('c', 'core', 85)];
    expect(computeBuildingPct(items, { a: 'yes', b: 'na', c: 'no' })).toBeCloseTo(66.7, 1);
  });
});

describe('formatZAR', () => {
  it('formats ZAR with the rand symbol', () => {
    expect(formatZAR(1234.5)).toMatch(/R/);
    expect(formatZAR(1234.5)).toMatch(/1[\s ,]?234/);
  });
  it('renders an em dash for null/NaN', () => {
    expect(formatZAR(null)).toBe('—');
    expect(formatZAR(undefined)).toBe('—');
  });
});

describe('formatPct', () => {
  it('formats to one decimal by default', () => {
    expect(formatPct(57.5)).toBe('57.5%');
    expect(formatPct(null)).toBe('—');
  });
});

describe('period helpers', () => {
  it('round-trips month input ↔ first-of-month period', () => {
    expect(periodFromMonthInput('2025-10')).toBe('2025-10-01');
    expect(monthInputFromPeriod('2025-10-01')).toBe('2025-10');
  });
  it('formats a period as a human label', () => {
    expect(formatPeriodLabel('2025-10-01')).toBe('October 2025');
    expect(formatPeriodLabel(null)).toBe('—');
  });
});
