/**
 * Per-building scores for the Buildings grid. OHS reuses usePortfolioCompliance
 * (per-building, all visible buildings, approved-only). Tasks = one task_instances
 * query (last 30 days) counted per building. Returns a lookup keyed by buildingId.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolioCompliance } from '@/hooks/usePortfolioCompliance';
import { taskCompletionPct } from '@/lib/buildingScore';

const WINDOW_DAYS = 30;

export interface BuildingScore { ohsPct: number | null; taskPct: number | null }

export function useBuildingsScores() {
  const portfolio = usePortfolioCompliance();

  const taskQuery = useQuery({
    queryKey: ['buildings-task-scores'],
    queryFn: async (): Promise<Record<string, number | null>> => {
      const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
      const res = await supabase.from('task_instances').select('building_id,status').gte('due_date', since);
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
  for (const row of portfolio.rows) {
    scores[row.buildingId] = {
      ohsPct: row.compliancePct,
      taskPct: taskQuery.data?.[row.buildingId] ?? null,
    };
  }

  return { scores, isLoading: portfolio.isLoading || taskQuery.isLoading };
}
