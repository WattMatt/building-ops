/**
 * Pure PPM (planned preventive maintenance) helpers — no React, no network — so the
 * section grid, the K11 KPI, and the PDF builder all share one definition of "done".
 *
 * A `ppm_services` row carries a `months` jsonb keyed by "YYYY-MM":
 *   { "2025-08": { "status": "done", "date": "2025-08-12" }, "2025-09": { "status": "due" } }
 * A month with no key is blank/unset. Only the literal status 'done' counts as serviced.
 */

export type PpmCellStatus = 'due' | 'done' | 'missed' | 'na';

/** One stored month cell. `date` is optional. */
export interface PpmCell {
  status?: PpmCellStatus;
  date?: string | null;
}

/** The shape we read off a `ppm_services` row — only the bits these helpers need. */
export interface PpmServiceLike {
  months?: Record<string, PpmCell> | null;
}

/** Sorted "YYYY-MM" keys whose cell status is exactly 'done'. */
export function doneMonths(service: PpmServiceLike): string[] {
  const months = service.months ?? {};
  return Object.keys(months)
    .filter((m) => months[m]?.status === 'done')
    .sort();
}

/** True when a service has at least one 'done' month cell. */
export function hasDoneCell(service: PpmServiceLike): boolean {
  const months = service.months ?? {};
  return Object.values(months).some((c) => c?.status === 'done');
}

export interface PpmCompletion {
  /** services with ≥1 'done' cell */
  doneCount: number;
  /** total services */
  total: number;
  /** round(doneCount / total × 100), or null when there are no services */
  pct: number | null;
}

/**
 * K11 — PPM Serviced. The share of services that have been serviced at least once
 * (any 'done' cell) over the report's 12-month window. Null when there are no services
 * (honest empty-state, not a misleading 0%).
 */
export function ppmCompletion(services: PpmServiceLike[]): PpmCompletion {
  const total = services.length;
  const doneCount = services.filter(hasDoneCell).length;
  const pct = total === 0 ? null : Math.round((doneCount / total) * 100);
  return { doneCount, total, pct };
}
