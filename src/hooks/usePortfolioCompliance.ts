/**
 * Portfolio OHS compliance rollup (audit finding H1, spec KPI O9).
 *
 * One row per building the user can see (RLS scopes the `buildings` query). For each
 * building we read its LATEST APPROVED `ops_monthly` report and pull, straight from the
 * Fortress SQL views/tables (never client math that can drift):
 *   - compliancePct      = compliance_scores.compliance_pct for that report
 *   - criticalPct        = compliance_critical_scores.critical_pct for that report's assessment
 *   - openNonCompliances = count of compliance_responses.response='no' for that assessment
 *   - period             = the report's report_period
 * Buildings with no approved ops report → all null / period null (never fabricated).
 *
 * O9 (portfolioAvg) = mean of the non-null compliancePct values across buildings,
 * rounded to 1dp; null when no building has a score.
 *
 * N+1 per-building queries are acceptable at pilot scale (a handful of buildings).
 */
import { useQuery } from '@tanstack/react-query';
import { fdb } from '@/integrations/supabase/fortress-db';

export interface PortfolioComplianceRow {
  buildingId: string;
  name: string;
  compliancePct: number | null;
  criticalPct: number | null;
  openNonCompliances: number | null;
  period: string | null;
}

export interface PortfolioCompliance {
  rows: PortfolioComplianceRow[];
  portfolioAvg: number | null;
  reportedCount: number;
  total: number;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

async function buildingRow(buildingId: string, name: string): Promise<PortfolioComplianceRow> {
  const empty: PortfolioComplianceRow = {
    buildingId,
    name,
    compliancePct: null,
    criticalPct: null,
    openNonCompliances: null,
    period: null,
  };

  // Latest APPROVED ops_monthly report for this building.
  const repRes = await fdb
    .from('reports')
    .select('id,report_period')
    .eq('building_id', buildingId)
    .eq('report_type', 'ops_monthly')
    .eq('status', 'approved')
    .order('report_period', { ascending: false })
    .limit(1);
  const report = repRes.data?.[0];
  if (!report) return empty;

  const [scoreRes, asmRes] = await Promise.all([
    fdb.from('compliance_scores').select('compliance_pct').eq('report_id', report.id),
    fdb.from('compliance_assessments').select('id').eq('report_id', report.id),
  ]);

  const compliancePct = num(scoreRes.data?.[0]?.compliance_pct ?? null);
  const assessmentId = asmRes.data?.[0]?.id ?? null;

  let criticalPct: number | null = null;
  let openNonCompliances: number | null = null;
  if (assessmentId) {
    const [critRes, respRes] = await Promise.all([
      fdb.from('compliance_critical_scores').select('critical_pct').eq('assessment_id', assessmentId),
      fdb.from('compliance_responses').select('id').eq('assessment_id', assessmentId).eq('response', 'no'),
    ]);
    criticalPct = num(critRes.data?.[0]?.critical_pct ?? null);
    openNonCompliances = respRes.data?.length ?? 0;
  }

  return {
    buildingId,
    name,
    compliancePct,
    criticalPct,
    openNonCompliances,
    period: (report.report_period as string | null) ?? null,
  };
}

export function usePortfolioCompliance() {
  const query = useQuery({
    queryKey: ['portfolio-compliance'],
    queryFn: async (): Promise<PortfolioCompliance> => {
      const bRes = await fdb.from('buildings').select('id,name').order('name');
      const buildings = (bRes.data ?? []) as { id: string; name: string | null }[];

      const rows = await Promise.all(
        buildings.map((b) => buildingRow(b.id, b.name ?? 'Unnamed building')),
      );

      const scored = rows.map((r) => r.compliancePct).filter((v): v is number => v !== null);
      const portfolioAvg = scored.length
        ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10
        : null;

      return {
        rows,
        portfolioAvg,
        reportedCount: scored.length,
        total: rows.length,
      };
    },
  });

  return {
    rows: query.data?.rows ?? [],
    portfolioAvg: query.data?.portfolioAvg ?? null,
    reportedCount: query.data?.reportedCount ?? 0,
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
  };
}
