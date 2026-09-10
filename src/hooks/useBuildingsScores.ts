/**
 * Per-building scores for the Buildings grid. OHS reuses usePortfolioCompliance
 * (per-building, all visible buildings, approved-only). Tasks = one task_instances
 * query (last 30 days, bounded to `due_date <= today` so the 90-day generation horizon's
 * future rows never count as not-done) counted per building. The range is set explicitly
 * so PostgREST's 1000-row default cannot truncate a large portfolio. Returns a lookup
 * keyed by buildingId.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolioCompliance } from '@/hooks/usePortfolioCompliance';
import { taskCompletionPct } from '@/lib/buildingScore';
import { todayInOperatingTz } from '@/lib/myWork';

const WINDOW_DAYS = 30;

export interface BuildingScore { ohsPct: number | null; taskPct: number | null }

export function useBuildingsScores() {
  const portfolio = usePortfolioCompliance();

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
  for (const row of portfolio.rows) {
    scores[row.buildingId] = {
      ohsPct: row.compliancePct,
      taskPct: taskQuery.data?.[row.buildingId] ?? null,
    };
  }

  return { scores, isLoading: portfolio.isLoading || taskQuery.isLoading };
}
