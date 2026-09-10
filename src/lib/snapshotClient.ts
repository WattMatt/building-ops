/**
 * Access to the R4a snapshot table (building_metrics_daily) and its portfolio view (portfolio_metrics_daily)
 * through the generated types, plus the three behaviours every snapshot reader shares:
 *  - `fetchAll` pages past PostgREST's server-side max-rows cap (see the note on it);
 *  - `snapshotRowsOrEmpty` turns a read error into "no rows", so hooks with a live fallback take it;
 *  - `snapshotQueryDefaults` stops react-query hammering a table that does not exist yet.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { todayInOperatingTz } from '@/lib/myWork';

/**
 * The generator types Postgres `numeric` as `number`, but a numeric can arrive as a string on the wire, so
 * the percentage columns are widened and every reader goes through `num`. The client's own row type is
 * narrower and assigns into these without a cast.
 */
type Widen<Row, K extends keyof Row> = Omit<Row, K> & { [P in K]: number | string | null };

/** One row of building_metrics_daily. */
export type SnapshotRow = Widen<Tables<'building_metrics_daily'>, 'compliance_pct' | 'critical_pct' | 'inspection_pass_pct' | 'ppm_done_pct' | 'task_completion_30d_pct'>;

/** portfolio_metrics_daily as generated: a view, so the generator marks every column nullable. */
export type PortfolioViewRow = Widen<Tables<'portfolio_metrics_daily'>, 'compliance_avg' | 'critical_avg' | 'inspection_pass_avg' | 'ppm_done_avg' | 'task_completion_avg'>;
/**
 * A portfolio row the page can use: `day` is the view's GROUP BY key, `buildings` its count(*) and
 * `reconstructed` its bool_and, none of which is ever null. `isPortfolioRow` narrows a fetched row.
 */
export type PortfolioRow = Omit<PortfolioViewRow, 'day' | 'buildings' | 'reconstructed'> & { day: string; buildings: number; reconstructed: boolean };
export function isPortfolioRow<R extends PortfolioViewRow>(r: R): r is R & Pick<PortfolioRow, 'day' | 'buildings' | 'reconstructed'> {
  return r.day !== null && r.buildings !== null && r.reconstructed !== null;
}

/** The columns the series, sparklines, leaderboard and PDF trend need — a fraction of the row. */
export const TREND_COLUMNS =
  'building_id,day,compliance_pct,task_completion_30d_pct,issues_open,tasks_overdue,docs_expiring_30,issues_breached,reconstructed,computed_at';
export type TrendRow = Pick<
  SnapshotRow,
  'building_id' | 'day' | 'compliance_pct' | 'task_completion_30d_pct' | 'issues_open' | 'tasks_overdue' | 'docs_expiring_30' | 'issues_breached' | 'reconstructed' | 'computed_at'
>;

export interface PgErrLike { message: string; code?: string }
export interface PgResult<Row> { data: Row[] | null; error: PgErrLike | null }
/** What `fetchAll` resolves to: the rows are always an array (possibly partial when `error` is set). */
export interface PagedResult<Row> { data: Row[]; error: PgErrLike | null }
export interface RowBuilder<Row> extends PromiseLike<PgResult<Row>> {
  eq(column: string, value: string): RowBuilder<Row>;
  in(column: string, values: string[]): RowBuilder<Row>;
  gte(column: string, value: string): RowBuilder<Row>;
  lte(column: string, value: string): RowBuilder<Row>;
  order(column: string, opts?: { ascending: boolean }): RowBuilder<Row>;
  limit(n: number): RowBuilder<Row>;
  range(from: number, to: number): RowBuilder<Row>;
}
/**
 * A select on the snapshot table. The column list is a literal so the client's own select parser types the
 * rows: `snapshots()` reads the full SnapshotRow, `snapshots(TREND_COLUMNS)` exactly the TrendRow columns.
 */
export function snapshots<Columns extends string = '*'>(columns: Columns = '*' as Columns) {
  return supabase.from('building_metrics_daily').select(columns);
}
/** The whole portfolio view (the /trends CSV prints every column); narrow the rows with `isPortfolioRow`. */
export function portfolioSnapshots() {
  return supabase.from('portfolio_metrics_daily').select('*');
}

/**
 * Read every row a query matches, `pageSize` at a time.
 *
 * PostgREST enforces a server-side `max-rows` cap (1 000 on a default Supabase project) on EVERY
 * response, and `.range(0, 19999)` does not lift it — the server silently returns the first 1 000 and
 * the caller never learns the rest were cut. 47 buildings × 365 days is 17 000 rows, so the /trends
 * page would have shown the oldest month only. This pages with `.range(i, i + pageSize - 1)` until a
 * page comes back short; `pageSize` must not exceed the server cap or the short-page test never fires.
 * The factory is called once per page because a builder cannot be reused after it has been awaited.
 * A page error stops the loop and is returned (not thrown) so callers choose between throwing and
 * falling back to live data.
 */
export async function fetchAll<Row>(builderFactory: () => RowBuilder<Row>, pageSize = 1000): Promise<PagedResult<Row>> {
  const out: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const res = await builderFactory().range(from, from + pageSize - 1);
    if (res.error) return { data: out, error: res.error };
    const page = res.data ?? [];
    out.push(...page);
    if (page.length < pageSize) return { data: out, error: null };
  }
}

/**
 * Rows from a snapshot read, or `[]` when it failed. For hooks that have a live fallback: a missing table
 * (before the migration), a permissions change or a 5xx should land on the live path, not on an error
 * state, and "no rows" is exactly what makes them take that path. Loud in dev so the fallback is not
 * mistaken for the snapshot working.
 */
export function snapshotRowsOrEmpty<Row>(res: PgResult<Row>, where: string): Row[] {
  if (res.error) {
    if (import.meta.env.DEV) console.warn(`[${where}] snapshot read failed; using live data:`, res.error.message);
    return [];
  }
  return res.data ?? [];
}

/**
 * PostgREST "relation does not exist" (PGRST205 via the schema cache, 42P01 straight from Postgres) or
 * "function does not exist" (PGRST202): an object the migration has not created yet.
 */
const MISSING_OBJECT = /PGRST205|42P01|PGRST202/;

/**
 * react-query options every snapshot hook spreads in (RPC readers borrow `retry` alone). Before the
 * migration is applied the table or function is missing on every attempt, and the default three retries
 * × N hooks × every mount was a storm of 404s; a missing object is never retried, anything else once.
 * Snapshots change once a night, so ten minutes of staleness costs nothing.
 */
export const snapshotQueryDefaults = {
  retry: (failureCount: number, error: unknown): boolean =>
    failureCount < 1 && !MISSING_OBJECT.test(String((error as PgErrLike | null)?.code ?? '')),
  staleTime: 10 * 60_000,
};

/** `YYYY-MM-DD` n days before today in the operating timezone. */
export function daysAgo(n: number, today: string = todayInOperatingTz()): string {
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/**
 * The cron writes at 05:00 SAST. A row dated within `daysAgo(SNAPSHOT_FRESH_DAYS)`..today counts as fresh
 * — that is four calendar days inclusive, so one or two missed nights still show the (slightly old)
 * snapshot with its "as of" caption rather than flipping every card to the live queries. Older than that
 * means the cron is not running and live data wins.
 */
export const SNAPSHOT_FRESH_DAYS = 3;

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** "10 Sept, 05:02" (en-ZA: day, abbreviated month, then time) in the operating timezone, for the "as of" caption. */
export function formatAsOf(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
}
