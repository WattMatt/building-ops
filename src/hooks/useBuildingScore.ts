/**
 * Lightweight per-building score for the detail header. Since R4a the numbers come from the latest nightly
 * snapshot row (building_metrics_daily: compliance of the latest APPROVED ops report, task completion over
 * the last 30 days) — one read instead of three. When no snapshot is fresh (a building created after the
 * last run, or the cron has not run for SNAPSHOT_FRESH_DAYS), the original live queries answer instead,
 * so the header is never blank because of the cron. Read-through; nothing is written.
 */
import { useQuery } from '@tanstack/react-query';
import { fdb } from '@/integrations/supabase/fortress-db';
import { supabase } from '@/integrations/supabase/client';
import { taskCompletionPct } from '@/lib/buildingScore';
import { todayInOperatingTz } from '@/lib/myWork';
import { SNAPSHOT_FRESH_DAYS, daysAgo, num, snapshots } from '@/lib/snapshotClient';

const WINDOW_DAYS = 30;

export interface BuildingScoreData {
  ohsPct: number | null;
  ohsPeriod: string | null;
  taskPct: number | null;
  /** computed_at of the snapshot row, null on the live path. */
  asOf: string | null;
  source: 'snapshot' | 'live';
}

async function liveScore(bid: string): Promise<BuildingScoreData> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const [repRes, taskRes] = await Promise.all([
    fdb.from('reports').select('id,report_period')
      .eq('building_id', bid).eq('report_type', 'ops_monthly').eq('status', 'approved')
      .order('report_period', { ascending: false }).limit(1),
    supabase.from('task_instances').select('status').eq('building_id', bid)
      .gte('due_date', since).lte('due_date', todayInOperatingTz()),
  ]);
  let ohsPct: number | null = null;
  let ohsPeriod: string | null = null;
  const report = repRes.data?.[0];
  if (report) {
    const score = await fdb.from('compliance_scores').select('compliance_pct').eq('report_id', report.id);
    ohsPct = num(score.data?.[0]?.compliance_pct ?? null);
    ohsPeriod = (report.report_period as string | null) ?? null;
  }
  const tasks = (taskRes.data ?? []) as { status: string | null }[];
  const counts = {
    completed: tasks.filter((t) => t.status === 'completed').length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    overdue: tasks.filter((t) => t.status === 'overdue').length,
  };
  return { ohsPct, ohsPeriod, taskPct: taskCompletionPct(counts), asOf: null, source: 'live' };
}

export function useBuildingScore(buildingId: string | undefined) {
  const query = useQuery({
    queryKey: ['building-score', buildingId],
    enabled: !!buildingId,
    queryFn: async (): Promise<BuildingScoreData> => {
      const bid = buildingId!;
      const snap = await snapshots().eq('building_id', bid).gte('day', daysAgo(SNAPSHOT_FRESH_DAYS)).order('day', { ascending: false }).limit(1);
      const row = snap.data?.[0];
      if (row) {
        return { ohsPct: num(row.compliance_pct), ohsPeriod: row.compliance_period, taskPct: num(row.task_completion_30d_pct), asOf: row.computed_at, source: 'snapshot' };
      }
      return liveScore(bid);
    },
  });

  return {
    ohsPct: query.data?.ohsPct ?? null,
    ohsPeriod: query.data?.ohsPeriod ?? null,
    taskPct: query.data?.taskPct ?? null,
    asOf: query.data?.asOf ?? null,
    source: query.data?.source ?? null,
    isLoading: query.isLoading,
  };
}
