/**
 * Typed access to the R4a snapshot table and its portfolio view. Both are absent from the generated types
 * until the controller regenerates them after the migration ships, so this is the one file that casts —
 * every hook and the PDF read through here and stay cast-free.
 */
import { supabase } from '@/integrations/supabase/client';
import { todayInOperatingTz } from '@/lib/myWork';

export interface SnapshotRow {
  building_id: string;
  day: string;
  compliance_pct: number | string | null;
  critical_pct: number | string | null;
  inspection_pass_pct: number | string | null;
  compliance_period: string | null;
  ohs_open_nc: number | null;
  ppm_done_pct: number | string | null;
  task_completion_30d_pct: number | string | null;
  tasks_overdue: number | null;
  tasks_due_7d: number | null;
  issues_open: number | null;
  issues_open_by_priority: Record<string, number> | null;
  issues_breached: number | null;
  issues_resolved_30d: number | null;
  docs_expiring_30: number | null;
  docs_expiring_60: number | null;
  docs_expiring_90: number | null;
  docs_expired: number | null;
  assets_overdue: number | null;
  report_state: Record<string, { period: string; status: string }> | null;
  reconstructed: boolean;
  computed_at: string;
}

export interface PortfolioRow {
  day: string;
  buildings: number;
  compliance_avg: number | string | null;
  critical_avg: number | string | null;
  inspection_pass_avg: number | string | null;
  ppm_done_avg: number | string | null;
  task_completion_avg: number | string | null;
  tasks_overdue: number | null;
  tasks_due_7d: number | null;
  issues_open: number | null;
  issues_breached: number | null;
  issues_resolved_30d: number | null;
  docs_expiring_30: number | null;
  docs_expiring_60: number | null;
  docs_expiring_90: number | null;
  docs_expired: number | null;
  assets_overdue: number | null;
  contractor_docs_expiring_30: number | null;
  contractor_docs_expiring_60: number | null;
  contractor_docs_expiring_90: number | null;
  contractor_docs_expired: number | null;
  reconstructed: boolean;
}

export interface PgErrLike { message: string; code?: string }
export interface RowBuilder<Row> extends PromiseLike<{ data: Row[] | null; error: PgErrLike | null }> {
  eq(column: string, value: string): RowBuilder<Row>;
  in(column: string, values: string[]): RowBuilder<Row>;
  gte(column: string, value: string): RowBuilder<Row>;
  lte(column: string, value: string): RowBuilder<Row>;
  order(column: string, opts?: { ascending: boolean }): RowBuilder<Row>;
  limit(n: number): RowBuilder<Row>;
  range(from: number, to: number): RowBuilder<Row>;
}
interface SnapshotClient {
  from(table: 'building_metrics_daily'): { select(columns: '*'): RowBuilder<SnapshotRow> };
  from(table: 'portfolio_metrics_daily'): { select(columns: '*'): RowBuilder<PortfolioRow> };
}
// building_metrics_daily and portfolio_metrics_daily are not yet in the generated types; regenerate after the
// migration ships and replace this cast with the typed client.
const client = supabase as unknown as SnapshotClient;

export function snapshots(): RowBuilder<SnapshotRow> { return client.from('building_metrics_daily').select('*'); }
export function portfolioSnapshots(): RowBuilder<PortfolioRow> { return client.from('portfolio_metrics_daily').select('*'); }

/** `YYYY-MM-DD` n days before today in the operating timezone. */
export function daysAgo(n: number, today: string = todayInOperatingTz()): string {
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/** The cron writes at 05:00 SAST; anything older than this many days means it has not run and live data wins. */
export const SNAPSHOT_FRESH_DAYS = 3;

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** "05:02, 10 Sep" in the operating timezone, for the "as of" caption. */
export function formatAsOf(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
}
