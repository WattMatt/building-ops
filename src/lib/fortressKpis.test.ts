import { describe, it, expect } from 'vitest';
import { classify, ratioPct, waterDeltaPct, THRESHOLDS } from './fortressKpis';

describe('ratioPct (KPI denominators)', () => {
  it('matches the verified AbaQulusi numbers', () => {
    expect(ratioPct(285585, 124528)).toBe(229.3); // K4 expense recovery (= staging)
    expect(ratioPct(32, 42)).toBe(76.2);           // K12 masterfile completeness (= staging)
    expect(ratioPct(3, 4)).toBe(75);               // inspection-pass style
  });
  it('returns null for a missing/zero denominator (honest empty-state, never NaN/∞)', () => {
    expect(ratioPct(5, 0)).toBeNull();
    expect(ratioPct(5, null)).toBeNull();
    expect(ratioPct(null, 10)).toBeNull();
    expect(ratioPct(undefined, undefined)).toBeNull();
  });
  it('respects the decimal-place argument', () => {
    expect(ratioPct(1, 3, 2)).toBe(33.33);
    expect(ratioPct(1, 3, 0)).toBe(33);
  });
});

describe('waterDeltaPct (K8)', () => {
  it('computes |site − bulk| / bulk %', () => {
    expect(waterDeltaPct(302.76, 1894.25)).toBe(525.7); // AbaQulusi bulk-check vs site-daily
    expect(waterDeltaPct(100, 105)).toBe(5);
  });
  it('null when bulk is zero or missing', () => {
    expect(waterDeltaPct(0, 100)).toBeNull();
    expect(waterDeltaPct(null, 100)).toBeNull();
  });
});

describe('classify (KPI threshold bands)', () => {
  it('higher-is-better: compliance', () => {
    expect(classify(100, THRESHOLDS.compliance)).toBe('good');   // ≥90
    expect(classify(80, THRESHOLDS.compliance)).toBe('warn');    // 75–89
    expect(classify(60, THRESHOLDS.compliance)).toBe('bad');     // <75
  });

  it('inverted (lower-is-better): open non-compliances', () => {
    expect(classify(0, THRESHOLDS.openNonCompliance)).toBe('good');
    expect(classify(2, THRESHOLDS.openNonCompliance)).toBe('warn');
    expect(classify(9, THRESHOLDS.openNonCompliance)).toBe('bad');
  });

  it('inverted: water bulk Δ (good when small)', () => {
    expect(classify(3, THRESHOLDS.waterDelta)).toBe('good');     // ≤5
    expect(classify(8, THRESHOLDS.waterDelta)).toBe('warn');     // ≤10
    expect(classify(20, THRESHOLDS.waterDelta)).toBe('bad');
  });

  it('null / no-threshold → info (empty-state)', () => {
    expect(classify(null, THRESHOLDS.compliance)).toBe('info');
    expect(classify(undefined)).toBe('info');
    expect(classify(50)).toBe('info'); // no threshold passed
  });

  it('critical equipment band is stricter than general compliance', () => {
    // 90% is good for general compliance but only warn for life-safety critical
    expect(classify(90, THRESHOLDS.compliance)).toBe('good');
    expect(classify(90, THRESHOLDS.critical)).toBe('warn');
  });

  it('inverted: equipment overdue count (O6 — good when zero)', () => {
    expect(classify(0, THRESHOLDS.equipmentOverdue)).toBe('good');  // ≤0
    expect(classify(2, THRESHOLDS.equipmentOverdue)).toBe('warn');  // ≤2
    expect(classify(5, THRESHOLDS.equipmentOverdue)).toBe('bad');
  });
});

// O8 "Compliance Trend Δ" = latest minus previous non-null point of the trend array.
// The hook computes this inline; this mirrors that pure expression to lock the sign logic.
function trendDelta(trend: (number | null)[]): number | null {
  const pts = trend.filter((v): v is number => v !== null);
  return pts.length >= 2 ? Math.round((pts[pts.length - 1] - pts[pts.length - 2]) * 10) / 10 : null;
}
function trendStatus(delta: number | null) {
  return delta === null ? 'info' : delta >= 0 ? 'good' : 'bad';
}

describe('O8 compliance trend delta (sign logic)', () => {
  it('positive delta → good', () => {
    const d = trendDelta([80, 90]);
    expect(d).toBe(10);
    expect(trendStatus(d)).toBe('good');
  });
  it('negative delta → bad', () => {
    const d = trendDelta([90, 82.5]);
    expect(d).toBe(-7.5);
    expect(trendStatus(d)).toBe('bad');
  });
  it('flat delta (0) → good', () => {
    const d = trendDelta([88, 88]);
    expect(d).toBe(0);
    expect(trendStatus(d)).toBe('good');
  });
  it('ignores null points, uses last two real values', () => {
    expect(trendDelta([70, null, 75])).toBe(5);
  });
  it('fewer than 2 points → null → info', () => {
    expect(trendDelta([100])).toBeNull();
    expect(trendDelta([null, null])).toBeNull();
    expect(trendStatus(trendDelta([100]))).toBe('info');
  });
});
