/**
 * Lightweight per-building score for the detail header. Two cheap reads (NOT the
 * ~30-query useBuildingKpis): OHS = compliance_scores.compliance_pct of the latest
 * APPROVED ops_monthly report (matches usePortfolioCompliance); Tasks = task
 * completion over the last 30 days. Read-through; nothing is written.
 */
import { useQuery } from '@tanstack/react-query';
import { fdb } from '@/integrations/supabase/fortress-db';
import { supabase } from '@/integrations/supabase/client';
import { taskCompletionPct } from '@/lib/buildingScore';

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

const WINDOW_DAYS = 30;

export function useBuildingScore(buildingId: string | undefined) {
  const query = useQuery({
    queryKey: ['building-score', buildingId],
    enabled: !!buildingId,
    queryFn: async () => {
      const bid = buildingId!;
      const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

      const [repRes, taskRes] = await Promise.all([
        fdb.from('reports').select('id,report_period')
          .eq('building_id', bid).eq('report_type', 'ops_monthly').eq('status', 'approved')
          .order('report_period', { ascending: false }).limit(1),
        supabase.from('task_instances').select('status').eq('building_id', bid).gte('due_date', since),
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

      return { ohsPct, ohsPeriod, taskPct: taskCompletionPct(counts), taskCounts: counts };
    },
  });

  return {
    ohsPct: query.data?.ohsPct ?? null,
    ohsPeriod: query.data?.ohsPeriod ?? null,
    taskPct: query.data?.taskPct ?? null,
    isLoading: query.isLoading,
  };
}
