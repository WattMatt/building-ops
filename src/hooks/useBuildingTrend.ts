/**
 * Snapshot series for one building (header sparklines) and for every visible building at once (the
 * buildings grid and /trends, one paged read). Rows come back ascending by day; RLS scopes both to the
 * caller's buildings. Only TREND_COLUMNS are selected — a tenth of the row.
 */
import { useQuery } from '@tanstack/react-query';
import { SNAPSHOT_FRESH_DAYS, TREND_COLUMNS, daysAgo, fetchAll, snapshotQueryDefaults, snapshots, type TrendRow } from '@/lib/snapshotClient';
import { series } from '@/lib/trendSeries';

export interface TrendSeries {
  compliance: (number | null)[];
  tasks: (number | null)[];
  issuesOpen: (number | null)[];
  tasksOverdue: (number | null)[];
  docsExpiring30: (number | null)[];
}

export function toSeries(rows: TrendRow[]): TrendSeries {
  return {
    compliance: series(rows, 'compliance_pct'),
    tasks: series(rows, 'task_completion_30d_pct'),
    issuesOpen: series(rows, 'issues_open'),
    tasksOverdue: series(rows, 'tasks_overdue'),
    docsExpiring30: series(rows, 'docs_expiring_30'),
  };
}

const EMPTY: TrendSeries = { compliance: [], tasks: [], issuesOpen: [], tasksOverdue: [], docsExpiring30: [] };

/** `days` rows ending today: 30 d is today and the 29 days before it, not 31. */
const sinceDay = (days: number) => daysAgo(days - 1);

export function useBuildingTrend(buildingId: string | undefined, days = 90) {
  const query = useQuery({
    queryKey: ['building-trend', buildingId, days],
    enabled: !!buildingId,
    ...snapshotQueryDefaults,
    queryFn: async (): Promise<TrendRow[]> => {
      const res = await fetchAll(() =>
        snapshots<TrendRow>(TREND_COLUMNS).eq('building_id', buildingId!).gte('day', sinceDay(days)).order('day', { ascending: true }));
      if (res.error) throw res.error;
      return res.data;
    },
  });
  const rows = query.data ?? [];
  return { rows, series: rows.length ? toSeries(rows) : EMPTY, latest: rows[rows.length - 1] ?? null, isLoading: query.isLoading };
}

interface BuildingsTrends {
  rows: Record<string, TrendRow[]>;
  byBuilding: Record<string, TrendSeries>;
  /** Newest FRESH row per building (within SNAPSHOT_FRESH_DAYS); absent when the cron has not run for it. */
  latest: Record<string, TrendRow>;
}

/** Group + shape once per fetch, not per render — this runs inside react-query's `select`. */
export function shapeBuildingsTrends(all: TrendRow[], freshSince: string): BuildingsTrends {
  const rows: Record<string, TrendRow[]> = {};
  for (const r of all) (rows[r.building_id] ??= []).push(r);
  const byBuilding: Record<string, TrendSeries> = {};
  const latest: Record<string, TrendRow> = {};
  for (const [id, list] of Object.entries(rows)) {
    byBuilding[id] = toSeries(list);
    const last = list[list.length - 1];
    if (last.day >= freshSince) latest[id] = last;
  }
  return { rows, byBuilding, latest };
}

export function useBuildingsTrends(days = 30) {
  const query = useQuery({
    queryKey: ['buildings-trends', days],
    ...snapshotQueryDefaults,
    queryFn: async (): Promise<TrendRow[]> => {
      // 47 buildings × 365 days ≈ 17 000 rows, well past the server's 1 000-row cap: fetchAll pages.
      // The secondary order makes the pages deterministic where several buildings share a day.
      const res = await fetchAll(() =>
        snapshots<TrendRow>(TREND_COLUMNS).gte('day', sinceDay(days)).order('day', { ascending: true }).order('building_id', { ascending: true }));
      if (res.error) throw res.error;
      return res.data;
    },
    select: (all) => shapeBuildingsTrends(all, daysAgo(SNAPSHOT_FRESH_DAYS)),
  });
  return { rows: query.data?.rows ?? {}, byBuilding: query.data?.byBuilding ?? {}, latest: query.data?.latest ?? {}, isLoading: query.isLoading };
}
