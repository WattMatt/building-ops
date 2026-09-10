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

export interface MergedCell {
  status: PpmCellStatus | null;
  source: MergedSource;
  /** Override note, when `source` is 'override'. */
  note?: string;
  /** Completion date from execution, when derived. */
  doneOn?: string | null;
  /** What execution says, kept alongside an override so the UI can offer "keep derived". */
  derivedStatus: PpmCellStatus | null;
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

const DERIVED_STATUSES = new Set<string>(['done', 'missed', 'due']);
/** When a month holds several occurrences, the strongest signal wins. */
const DERIVED_RANK: Record<string, number> = { done: 3, missed: 2, due: 1 };

/**
 * "YYYY-MM" keys for a 12-month window anchored on the SA fiscal year (July). `anchor` is a
 * YYYY-MM-DD (a report's `report_period`) or a Date; defaults to today.
 */
export function fiscalWindow(anchor?: string | Date | null): string[] {
  const base = anchor instanceof Date ? anchor : anchor ? new Date(`${anchor.slice(0, 10)}T00:00:00`) : new Date();
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

function derivedFor(rows: readonly DerivedRow[]): Map<string, { status: PpmCellStatus; doneOn: string | null }> {
  const out = new Map<string, { status: PpmCellStatus; doneOn: string | null }>();
  for (const r of rows) {
    if (!r.status || !DERIVED_STATUSES.has(r.status)) continue;
    const status = r.status as PpmCellStatus;
    const cur = out.get(r.period_month);
    if (!cur || DERIVED_RANK[status] > DERIVED_RANK[cur.status]) {
      out.set(r.period_month, { status, doneOn: status === 'done' ? (r.done_on ?? null) : null });
    } else if (cur.status === 'done' && status === 'done' && !cur.doneOn && r.done_on) {
      cur.doneOn = r.done_on;
    }
  }
  return out;
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
    if (o && o.status) {
      grid[mk] = { status: o.status, source: 'override', note: o.note ?? '', doneOn: d?.doneOn ?? null, derivedStatus };
      continue;
    }
    if (d) {
      grid[mk] = { status: d.status, source: 'derived', doneOn: d.doneOn, derivedStatus };
      continue;
    }
    const l = legacy?.[mk]?.status ?? null;
    if (l) {
      grid[mk] = { status: l, source: 'legacy', derivedStatus: null };
      continue;
    }
    grid[mk] = { status: null, source: 'none', derivedStatus: null };
  }
  return grid;
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
