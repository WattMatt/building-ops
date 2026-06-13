/** Portfolio OHS roll-up: latest OHS % per accessible building (RLS-scoped).
 *  Powers the compliance strip on the reports landing — "which centre is slipping". */
import { useQuery } from '@tanstack/react-query';
import { fdb } from '@/integrations/supabase/fortress-db';

export interface PortfolioRow { buildingId: string; reportId: string; period: string; pct: number | null }

export function usePortfolioCompliance() {
  return useQuery({
    queryKey: ['fortress-portfolio-compliance'],
    queryFn: async (): Promise<PortfolioRow[]> => {
      // latest ops report per building, with its compliance %
      const reports = (await fdb.from('reports')
        .select('id,building_id,report_period')
        .eq('report_type', 'ops_monthly')
        .order('report_period', { ascending: false })).data ?? [];
      const latestByBuilding = new Map<string, { id: string; period: string }>();
      for (const r of reports) {
        if (!latestByBuilding.has(r.building_id)) latestByBuilding.set(r.building_id, { id: r.id, period: r.report_period });
      }
      const scores = (await fdb.from('compliance_scores').select('report_id,compliance_pct')).data ?? [];
      const scoreByReport = new Map(scores.map((s) => [s.report_id, s.compliance_pct]));
      return [...latestByBuilding.entries()].map(([buildingId, r]) => ({
        buildingId, reportId: r.id, period: r.period,
        pct: scoreByReport.has(r.id) ? Number(scoreByReport.get(r.id)) : null,
      }));
    },
  });
}
