/**
 * KPI metadata + threshold→status mapping for the Fortress dashboards.
 * Thresholds drive the colour band on each KPI card (02_KPI_DASHBOARD_SPEC.md §1,
 * 10_OHS_COMPLIANCE_TAB.md §4). Pure data — no React.
 */
export type KpiStatus = 'good' | 'warn' | 'bad' | 'info';

/** `num / den * 100`, rounded to `dp` decimals. null when den is missing or zero
 *  (so a KPI with no denominator shows an honest empty-state, never NaN/∞). */
export function ratioPct(num: number | null | undefined, den: number | null | undefined, dp = 1): number | null {
  if (num === null || num === undefined || den === null || den === undefined || den === 0) return null;
  const f = Math.pow(10, dp);
  return Math.round((num / den) * 100 * f) / f;
}

/** |site − bulk| / bulk * 100 — the K8 water bulk-vs-check delta. */
export function waterDeltaPct(bulk: number | null | undefined, site: number | null | undefined): number | null {
  if (bulk === null || bulk === undefined || site === null || site === undefined || bulk === 0) return null;
  return Math.round((Math.abs(site - bulk) / bulk) * 1000) / 10;
}

export interface KpiThreshold {
  /** higher is better unless `invert` */
  good: number;
  warn: number;
  invert?: boolean;
}

/** Classify a value against good/warn cut-offs. null → info (no data / empty-state). */
export function classify(value: number | null | undefined, t?: KpiThreshold): KpiStatus {
  if (value === null || value === undefined || Number.isNaN(value)) return 'info';
  if (!t) return 'info';
  if (t.invert) {
    if (value <= t.good) return 'good';
    if (value <= t.warn) return 'warn';
    return 'bad';
  }
  if (value >= t.good) return 'good';
  if (value >= t.warn) return 'warn';
  return 'bad';
}

/** Tailwind classes per status (works with the app's semantic tokens). */
export const STATUS_CLASS: Record<KpiStatus, { ring: string; text: string; badge: string }> = {
  good: { ring: 'ring-emerald-500/30', text: 'text-emerald-600', badge: 'bg-emerald-500/10 text-emerald-700' },
  warn: { ring: 'ring-amber-500/30', text: 'text-amber-600', badge: 'bg-amber-500/10 text-amber-700' },
  bad: { ring: 'ring-destructive/30', text: 'text-destructive', badge: 'bg-destructive/10 text-destructive' },
  info: { ring: 'ring-border', text: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground' },
};

export const THRESHOLDS = {
  compliance: { good: 90, warn: 75 } as KpiThreshold,            // K1 / O1
  taskCompletion: { good: 90, warn: 75 } as KpiThreshold,        // building task-completion %
  critical: { good: 95, warn: 85 } as KpiThreshold,              // O2
  inspectionPass: { good: 95, warn: 85 } as KpiThreshold,        // K2
  openActions: { good: 0, warn: 5, invert: true } as KpiThreshold, // K3 (lower better)
  openNonCompliance: { good: 0, warn: 3, invert: true } as KpiThreshold, // O3
  recovery: { good: 100, warn: 90 } as KpiThreshold,             // K4
  yield: { good: 90, warn: 75 } as KpiThreshold,                 // K9/K10
  waterDelta: { good: 5, warn: 10, invert: true } as KpiThreshold, // K8 (lower better)
  ppm: { good: 95, warn: 85 } as KpiThreshold,                   // K11
  masterfile: { good: 100, warn: 90 } as KpiThreshold,           // K12
  tenantCompliance: { good: 95, warn: 85 } as KpiThreshold,      // K13
  vacancy: { good: 0, warn: 5, invert: true } as KpiThreshold,   // K15
  equipmentOverdue: { good: 0, warn: 2, invert: true } as KpiThreshold, // O6 (count of overdue services — lower better)
} as const;
