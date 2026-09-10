/**
 * Snapshot series for one building (header sparklines) and for every visible building at once (the
 * buildings grid, one query). Rows come back ascending by day; RLS scopes both to the caller's buildings.
 */
import { useQuery } from '@tanstack/react-query';
import { daysAgo, snapshots, type SnapshotRow } from '@/lib/snapshotClient';
import { series } from '@/lib/trendSeries';

export interface TrendSeries {
  compliance: (number | null)[];
  tasks: (number | null)[];
  issuesOpen: (number | null)[];
  tasksOverdue: (number | null)[];
  docsExpiring30: (number | null)[];
}

export function toSeries(rows: SnapshotRow[]): TrendSeries {
  return {
    compliance: series(rows, 'compliance_pct'),
    tasks: series(rows, 'task_completion_30d_pct'),
    issuesOpen: series(rows, 'issues_open'),
    tasksOverdue: series(rows, 'tasks_overdue'),
    docsExpiring30: series(rows, 'docs_expiring_30'),
  };
}

const EMPTY: TrendSeries = { compliance: [], tasks: [], issuesOpen: [], tasksOverdue: [], docsExpiring30: [] };

export function useBuildingTrend(buildingId: string | undefined, days = 90) {
  const query = useQuery({
    queryKey: ['building-trend', buildingId, days],
    enabled: !!buildingId,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<SnapshotRow[]> => {
      const res = await snapshots().eq('building_id', buildingId!).gte('day', daysAgo(days)).order('day', { ascending: true }).range(0, 999);
      if (res.error) throw res.error;
      return res.data ?? [];
    },
  });
  const rows = query.data ?? [];
  return { rows, series: rows.length ? toSeries(rows) : EMPTY, latest: rows[rows.length - 1] ?? null, isLoading: query.isLoading };
}

export function useBuildingsTrends(days = 30) {
  const query = useQuery({
    queryKey: ['buildings-trends', days],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Record<string, SnapshotRow[]>> => {
      // 47 buildings × 30 days ≈ 1 400 rows; the range keeps PostgREST's 1 000-row default from truncating.
      const res = await snapshots().gte('day', daysAgo(days)).order('day', { ascending: true }).range(0, 19999);
      if (res.error) throw res.error;
      const out: Record<string, SnapshotRow[]> = {};
      for (const r of res.data ?? []) (out[r.building_id] ??= []).push(r);
      return out;
    },
  });
  const byBuilding: Record<string, TrendSeries> = {};
  for (const [id, rows] of Object.entries(query.data ?? {})) byBuilding[id] = toSeries(rows);
  return { rows: query.data ?? {}, byBuilding, isLoading: query.isLoading };
}
