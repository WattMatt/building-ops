/**
 * LIVE per-building scores for the Buildings grid — the fallback behind the snapshot.
 *
 * The grid already reads the snapshot once for every building (useBuildingsTrends, for the sparklines),
 * and that read's latest fresh row per building is the chip value. This hook exists only for buildings
 * without such a row (created after the last run, or the cron is down): it reads nothing from the
 * snapshot table, so the page makes one snapshot read, not two, and the OHS and Tasks chips never mix a
 * snapshot number with a live one for the same building (`chipValues` picks one source per building).
 *
 * OHS: the latest APPROVED ops report per building (same rule as the snapshot, D10) — one reports query
 * plus one compliance_scores query for the whole portfolio, never per building. Tasks: one task_instances
 * query (last 30 days, bounded to `due_date <= today` so the 90-day generation horizon's future rows
 * never count as not-done) counted per building. Ranges are set explicitly so PostgREST's 1000-row
 * default cannot truncate a large portfolio.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fdb } from '@/integrations/supabase/fortress-db';
import { taskCompletionPct } from '@/lib/buildingScore';
import { todayInOperatingTz } from '@/lib/myWork';
import { num, type TrendRow } from '@/lib/snapshotClient';

const WINDOW_DAYS = 30;

export interface BuildingScore { ohsPct: number | null; taskPct: number | null }

export interface ChipValues extends BuildingScore {
  /** computed_at of the snapshot row the values came from; null on the live path. */
  asOf: string | null;
}

/**
 * One source per building: the fresh snapshot row when there is one (both chips, plus its "as of"),
 * otherwise the live scores. Never one chip from each.
 */
export function chipValues(latest: Pick<TrendRow, 'compliance_pct' | 'task_completion_30d_pct' | 'computed_at'> | undefined, live: BuildingScore | undefined): ChipValues {
  if (latest) return { ohsPct: num(latest.compliance_pct), taskPct: num(latest.task_completion_30d_pct), asOf: latest.computed_at };
  return { ohsPct: live?.ohsPct ?? null, taskPct: live?.taskPct ?? null, asOf: null };
}

export function useBuildingsScores() {
  const ohsQuery = useQuery({
    queryKey: ['buildings-ohs-scores'],
    queryFn: async (): Promise<Record<string, number | null>> => {
      const repRes = await fdb.from('reports').select('id,building_id,report_period')
        .eq('report_type', 'ops_monthly').eq('status', 'approved')
        .order('report_period', { ascending: false }).range(0, 4999);
      if (repRes.error) throw repRes.error;
      // Newest first, so the first report seen per building is its latest approved one.
      const latest = new Map<string, string>();
      for (const r of repRes.data ?? []) if (r.building_id && !latest.has(r.building_id)) latest.set(r.building_id, r.id);
      const out: Record<string, number | null> = {};
      if (!latest.size) return out;
      const scoreRes = await fdb.from('compliance_scores').select('report_id,compliance_pct').in('report_id', [...latest.values()]).range(0, 4999);
      if (scoreRes.error) throw scoreRes.error;
      const byReport = new Map((scoreRes.data ?? []).map((s) => [s.report_id, num(s.compliance_pct)]));
      for (const [bid, rid] of latest) out[bid] = byReport.get(rid) ?? null;
      return out;
    },
  });

  const taskQuery = useQuery({
    queryKey: ['buildings-task-scores'],
    queryFn: async (): Promise<Record<string, number | null>> => {
      const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
      const res = await supabase
        .from('task_instances')
        .select('building_id,status')
        .gte('due_date', since)
        .lte('due_date', todayInOperatingTz())
        .range(0, 4999);
      const rows = (res.data ?? []) as { building_id: string | null; status: string | null }[];
      const byBuilding = new Map<string, { completed: number; pending: number; overdue: number }>();
      for (const r of rows) {
        if (!r.building_id) continue;
        const c = byBuilding.get(r.building_id) ?? { completed: 0, pending: 0, overdue: 0 };
        if (r.status === 'completed') c.completed++;
        else if (r.status === 'pending') c.pending++;
        else if (r.status === 'overdue') c.overdue++;
        byBuilding.set(r.building_id, c);
      }
      const out: Record<string, number | null> = {};
      for (const [id, c] of byBuilding) out[id] = taskCompletionPct(c);
      return out;
    },
  });

  const scores: Record<string, BuildingScore> = {};
  for (const id of new Set([...Object.keys(ohsQuery.data ?? {}), ...Object.keys(taskQuery.data ?? {})])) {
    scores[id] = { ohsPct: ohsQuery.data?.[id] ?? null, taskPct: taskQuery.data?.[id] ?? null };
  }

  return { scores, isLoading: ohsQuery.isLoading || taskQuery.isLoading };
}
