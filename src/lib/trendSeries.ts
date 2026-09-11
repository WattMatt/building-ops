/**
 * Pure shaping of snapshot rows into series, monthly points (PDF) and a change leaderboard (/trends).
 * Rows are the TrendRow shape (the narrow TREND_COLUMNS read; a full SnapshotRow also fits), ordered by
 * day ascending as the hooks return them.
 */
import { num, type TrendRow } from '@/lib/snapshotClient';

export type SeriesKey = 'compliance_pct' | 'task_completion_30d_pct' | 'issues_open' | 'tasks_overdue' | 'docs_expiring_30' | 'issues_breached';

export function series(rows: Pick<TrendRow, SeriesKey>[], key: SeriesKey): (number | null)[] {
  return rows.map((r) => num(r[key]));
}

export interface MonthlyPoint {
  /** `YYYY-MM` */
  month: string;
  compliancePct: number | null;
  taskPct: number | null;
  issuesOpen: number | null;
  tasksOverdue: number | null;
}

/** `YYYY-MM` for the month n months before the month of `period` (`YYYY-MM-DD`). */
export function monthShift(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
}

/** Last day of the month containing `period`, `YYYY-MM-DD`. */
export function monthEnd(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

type MonthlyRow = Pick<TrendRow, 'day' | 'compliance_pct' | 'task_completion_30d_pct' | 'issues_open' | 'tasks_overdue'>;

/**
 * The last snapshot row of each of the `months` months ending with the month of `endPeriod`. A month with no
 * row yields nulls (never a fabricated value), so the PDF says "—" where the data starts.
 */
export function monthlyPoints(rows: MonthlyRow[], endPeriod: string, months = 12): MonthlyPoint[] {
  const last = new Map<string, MonthlyRow>();
  for (const r of rows) {
    const key = r.day.slice(0, 7);
    const prev = last.get(key);
    if (!prev || prev.day < r.day) last.set(key, r);
  }
  const out: MonthlyPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const month = monthShift(endPeriod, i);
    const r = last.get(month);
    out.push({
      month,
      compliancePct: r ? num(r.compliance_pct) : null,
      taskPct: r ? num(r.task_completion_30d_pct) : null,
      issuesOpen: r ? num(r.issues_open) : null,
      tasksOverdue: r ? num(r.tasks_overdue) : null,
    });
  }
  return out;
}

export interface DeltaRow { buildingId: string; first: number; last: number; delta: number }

/**
 * Change in `key` from the first to the last non-null value per building; buildings with < 2 values are
 * left out. "First" and "last" are positional: the rows of each building MUST already be in ascending
 * day order (the hooks order the read that way and group without re-sorting) — this does not sort.
 */
export function deltaLeaderboard(byBuilding: Record<string, Pick<TrendRow, SeriesKey>[]>, key: SeriesKey): DeltaRow[] {
  const out: DeltaRow[] = [];
  for (const [buildingId, rows] of Object.entries(byBuilding)) {
    const vals = series(rows, key).filter((v): v is number => v !== null);
    if (vals.length < 2) continue;
    const first = vals[0];
    const last = vals[vals.length - 1];
    out.push({ buildingId, first, last, delta: Math.round((last - first) * 10) / 10 });
  }
  return out.sort((a, b) => b.delta - a.delta);
}

/** Index of the first non-reconstructed row, or -1 when every row is a reconstruction. */
export function reconstructionBoundary(rows: { reconstructed: boolean }[]): number {
  return rows.findIndex((r) => !r.reconstructed);
}
