import { describe, it, expect } from 'vitest';
import { classify, THRESHOLDS } from './fortressKpis';

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
});
