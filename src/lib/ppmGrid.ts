/**
 * Pure PPM grid helpers — no React, no network — shared by the Building Details PPM tab,
 * the Fortress PPM report section and the K11 KPI.
 *
 * R3c (spec §5.6, D6): the plan lives in `building_ppm_services`, execution lives in
 * `task_instances` (one row per occurrence, `source_ppm_id` set), and the month grid is
 * DERIVED from execution through the `ppm_monthly_status` view. A report may pin a cell
 * with a noted override stored in `ppm_services.overrides`. This module merges those
 * layers into the 12-month grid a screen renders.
 *
 * Precedence per cell: override > derived > legacy `months` value > blank. The legacy
 * layer exists because the one-shot migration links every existing `ppm_services` row
 * to a plan line, and those rows carry months that were captured by hand before any
 * occurrence was generated — dropping them would blank 698 historical grids.
 */
import { ppmCompletion, type PpmCell, type PpmCellStatus, type PpmCompletion } from '@/lib/ppmStatus';

export type { PpmCellStatus };

/** One row of the `ppm_monthly_status` view (R3c columns). */
export interface DerivedRow {
  ppm_service_id: string;
  service_name?: string | null;
  /** "YYYY-MM" */
  period_month: string;
  /** 'done' | 'missed' | 'due' as the view emits it; anything else is ignored. */
  status: string | null;
  done_on?: string | null;
}

/** One entry of `ppm_services.overrides`, keyed by "YYYY-MM". */
export interface PpmOverride {
  status: PpmCellStatus;
  note: string;
  by?: string | null;
  at?: string | null;
}

export type MergedSource = 'override' | 'derived' | 'legacy' | 'none';

/** How many occurrences execution holds for one month, by status. Present only when > 1. */
export interface PpmOccurrences {
  done: number;
  missed: number;
  due: number;
  total: number;
}

export interface MergedCell {
  status: PpmCellStatus | null;
  source: MergedSource;
  /** Override note, when `source` is 'override'. */
  note?: string;
  /** Completion date from execution, when derived. */
  doneOn?: string | null;
  /** What execution says, kept alongside an override so the UI can offer "keep derived". */
  derivedStatus: PpmCellStatus | null;
  /** Per-status counts when the month held more than one occurrence (the title shows them). */
  occurrences?: PpmOccurrences;
}

/** Status classes shared by every PPM grid (tab and report section). */
export const PPM_STATUS_STYLE: Record<PpmCellStatus, { cls: string; label: string }> = {
  done: { cls: 'bg-emerald-500 text-white', label: 'Done' },
  due: { cls: 'bg-amber-400 text-amber-950', label: 'Due' },
  missed: { cls: 'bg-destructive text-destructive-foreground', label: 'Missed' },
  na: { cls: 'bg-muted text-muted-foreground', label: 'N/A' },
};
export const PPM_STATUS_SHORT: Record<PpmCellStatus, string> = { done: '✓', due: '•', missed: '✕', na: '—' };
export const PPM_STATUSES: readonly PpmCellStatus[] = ['due', 'done', 'missed', 'na'];

/**
 * Every status a cell may carry. Overrides and legacy `months` come straight out of jsonb,
 * so anything not in this set is treated as absent rather than handed to a style lookup.
 */
const VALID = new Set<string>(PPM_STATUSES);
const DERIVED_STATUSES = new Set<string>(['done', 'missed', 'due']);

/** The status if it is one the grid knows, else null. */
export function asPpmStatus(v: unknown): PpmCellStatus | null {
  return typeof v === 'string' && VALID.has(v) ? (v as PpmCellStatus) : null;
}

/** Month/year column header parts for a "YYYY-MM" key, as every PPM grid prints them. */
export function colHeader(monthKey: string): { mon: string; yr: string } {
  const d = new Date(`${monthKey}-01T00:00:00`);
  return { mon: d.toLocaleDateString('en-ZA', { month: 'short' }), yr: `'${String(d.getFullYear()).slice(2)}` };
}

/**
 * "YYYY-MM" keys for a 12-month window anchored on the SA fiscal year (July). `anchor` is a
 * YYYY-MM-DD (a report's `report_period`) or a Date; defaults to today, as does an anchor
 * that does not parse (a malformed `report_period` must not yield twelve "NaN-NaN" keys).
 */
export function fiscalWindow(anchor?: string | Date | null): string[] {
  let base = anchor instanceof Date ? anchor : anchor ? new Date(`${anchor.slice(0, 10)}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) base = new Date();
  const y = base.getFullYear();
  const m = base.getMonth(); // 0-based
  const startYear = m >= 6 ? y : y - 1; // July = month index 6
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(startYear, 6 + i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

/** Group view rows by plan line so callers can hand `mergePpmGrid` one line's rows. */
export function derivedByService(rows: readonly DerivedRow[]): Map<string, DerivedRow[]> {
  const out = new Map<string, DerivedRow[]>();
  for (const r of rows) {
    const list = out.get(r.ppm_service_id);
    if (list) list.push(r);
    else out.set(r.ppm_service_id, [r]);
  }
  return out;
}

interface DerivedMonth { status: PpmCellStatus; doneOn: string | null; occurrences?: PpmOccurrences }

/**
 * One status per month from its occurrences. This is a compliance grid, so a month with one
 * completed and one missed occurrence reads MISSED: missed > done > due. `doneOn` is the
 * first completion date and is only kept when the month reads done. Counts ride along when
 * the month held more than one occurrence so the cell title can say so.
 */
function derivedFor(rows: readonly DerivedRow[]): Map<string, DerivedMonth> {
  const tally = new Map<string, PpmOccurrences & { doneOn: string | null }>();
  for (const r of rows) {
    if (!r.status || !DERIVED_STATUSES.has(r.status)) continue;
    const status = r.status as 'done' | 'missed' | 'due';
    let t = tally.get(r.period_month);
    if (!t) { t = { done: 0, missed: 0, due: 0, total: 0, doneOn: null }; tally.set(r.period_month, t); }
    t[status] += 1;
    t.total += 1;
    if (status === 'done' && !t.doneOn && r.done_on) t.doneOn = r.done_on;
  }
  const out = new Map<string, DerivedMonth>();
  for (const [month, t] of tally) {
    const status: PpmCellStatus = t.missed > 0 ? 'missed' : t.done > 0 ? 'done' : 'due';
    const cell: DerivedMonth = { status, doneOn: status === 'done' ? t.doneOn : null };
    if (t.total > 1) cell.occurrences = { done: t.done, missed: t.missed, due: t.due, total: t.total };
    out.set(month, cell);
  }
  return out;
}

/** "2 occurrences: 1 done, 1 missed" for a cell that holds several, else null. */
export function occurrenceSummary(cell: Pick<MergedCell, 'occurrences'>): string | null {
  const o = cell.occurrences;
  if (!o || o.total < 2) return null;
  const parts = (['done', 'missed', 'due'] as const).filter((k) => o[k] > 0).map((k) => `${o[k]} ${k}`);
  return `${o.total} occurrences: ${parts.join(', ')}`;
}

/**
 * Merge one plan line's derived rows, its report overrides and (optionally) the legacy
 * `months` cells into a cell per month of `months`. Every month in the window gets a cell.
 */
export function mergePpmGrid(
  months: readonly string[],
  derived: readonly DerivedRow[],
  overrides: Readonly<Record<string, PpmOverride>> = {},
  legacy: Readonly<Record<string, PpmCell>> | null = null,
): Record<string, MergedCell> {
  const byMonth = derivedFor(derived);
  const grid: Record<string, MergedCell> = {};
  for (const mk of months) {
    const d = byMonth.get(mk);
    const derivedStatus = d?.status ?? null;
    const o = overrides[mk];
    const overrideStatus = o ? asPpmStatus(o.status) : null;
    if (o && overrideStatus) {
      grid[mk] = { status: overrideStatus, source: 'override', note: typeof o.note === 'string' ? o.note : '', doneOn: d?.doneOn ?? null, derivedStatus };
      if (d?.occurrences) grid[mk].occurrences = d.occurrences;
      continue;
    }
    if (d) {
      grid[mk] = { status: d.status, source: 'derived', doneOn: d.doneOn, derivedStatus };
      if (d.occurrences) grid[mk].occurrences = d.occurrences;
      continue;
    }
    const l = asPpmStatus(legacy?.[mk]?.status);
    if (l) {
      grid[mk] = { status: l, source: 'legacy', derivedStatus: null };
      continue;
    }
    grid[mk] = { status: null, source: 'none', derivedStatus: null };
  }
  return grid;
}

/**
 * The slice of a `ppm_services` row the merge needs (plan link, overrides, legacy months).
 * `overrides` and `months` are jsonb and arrive untyped; `overridesOf` / `legacyMonthsOf`
 * narrow them at the client boundary and `mergePpmGrid` validates each status.
 */
export interface PpmGridRow {
  id: string;
  plan_service_id?: string | null;
  overrides?: unknown;
  months?: unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** `ppm_services.overrides` as a map, or {} for anything that is not a plain object. */
export function overridesOf(v: unknown): Record<string, PpmOverride> {
  return isPlainObject(v) ? (v as Record<string, PpmOverride>) : {};
}

/** `ppm_services.months` as a cell map, or {} for anything that is not a plain object. */
export function legacyMonthsOf(v: unknown): Record<string, PpmCell> {
  return isPlainObject(v) ? (v as Record<string, PpmCell>) : {};
}

/**
 * Merge every report row into its grid: plan-backed rows get override > derived > legacy
 * months; legacy rows (no `plan_service_id`) get their `months` as 'legacy' cells. The
 * window is widened per row by any legacy month key outside it, so a cell captured by hand
 * before the plan existed is never dropped by a consumer that only looks at the window.
 *
 * Pure: hand it the view rows already fetched (see `fetchMergedPpmGrids` in ppmGridFetch.ts).
 */
export function mergePpmGrids(
  rows: readonly PpmGridRow[],
  derived: readonly DerivedRow[],
  window: readonly string[],
): Map<string, Record<string, MergedCell>> {
  const byService = derivedByService(derived);
  const out = new Map<string, Record<string, MergedCell>>();
  for (const row of rows) {
    const legacy = legacyMonthsOf(row.months);
    const months = [...new Set([...window, ...Object.keys(legacy)])].sort();
    const derivedRows = row.plan_service_id ? byService.get(row.plan_service_id) ?? [] : [];
    const overrides = row.plan_service_id ? overridesOf(row.overrides) : {};
    out.set(row.id, mergePpmGrid(months, derivedRows, overrides, legacy));
  }
  return out;
}

/** Sorted "YYYY-MM" keys whose merged cell reads 'done' (the PDF's "serviced" column). */
export function doneMonthsFromGrid(grid: Record<string, MergedCell>): string[] {
  return Object.keys(grid).filter((mk) => grid[mk].status === 'done').sort();
}

/**
 * K11 over merged grids: a row counts as serviced when any cell reads 'done', whatever
 * layer produced it. Delegates to `ppmCompletion` so there is one definition of "done".
 */
export function ppmCompletionFromGrid(rows: readonly Record<string, MergedCell>[]): PpmCompletion {
  return ppmCompletion(rows.map((months) => ({ months })));
}

/** True when at least one cell in the grid was filled by any layer (for "captured" checks). */
export function gridHasData(grid: Record<string, MergedCell>): boolean {
  return Object.values(grid).some((c) => c.source !== 'none');
}
