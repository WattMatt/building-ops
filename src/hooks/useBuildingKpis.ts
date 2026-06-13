/**
 * Computes the Fortress building KPIs (K1–K18 + O1–O9) from the latest approved
 * reports. Each KPI reads the SQL views / section tables (never client math that can
 * drift from the source): K1 = compliance_scores, O2 = compliance_critical_scores,
 * K4 = expense_recoveries, K8 = utilities, etc. KPIs with no data return null →
 * the cards render an honest empty-state.
 */
import { useQuery } from '@tanstack/react-query';
import { fdb } from '@/integrations/supabase/fortress-db';
import { classify, THRESHOLDS, type KpiStatus } from '@/lib/fortressKpis';

export type KpiFormat = 'pct' | 'zar' | 'count' | 'number';
export interface Kpi {
  id: string;
  label: string;
  value: number | null;
  format: KpiFormat;
  status: KpiStatus;
  sub?: string;
}
export interface OhsAction {
  responseId: string;
  prompt: string;
  section: string;
  comment: string | null;
  templateItemId: string;
  issueId: string | null;
}
export interface SectionScore { section_no: string; section_title: string | null; section_pct: number | null }

async function latestApproved(buildingId: string, type: string) {
  const rows = await fdb.from('reports').select('*')
    .eq('building_id', buildingId).eq('report_type', type)
    .order('report_period', { ascending: false }).limit(1);
  return rows.data?.[0] ?? null;
}

export function useBuildingKpis(buildingId: string | undefined) {
  return useQuery({
    queryKey: ['fortress-building-kpis', buildingId],
    enabled: !!buildingId,
    queryFn: async () => {
      const bid = buildingId!;
      const [ops, cm, annual] = await Promise.all([
        latestApproved(bid, 'ops_monthly'),
        latestApproved(bid, 'cm_monthly'),
        latestApproved(bid, 'annual_inspection'),
      ]);

      const kpis: Kpi[] = [];
      let sectionScores: SectionScore[] = [];
      let actions: OhsAction[] = [];
      let trend: { period: string; pct: number | null }[] = [];

      if (ops) {
        const [scoreRows, critRows, secRows, respRows, inspRows, recov, readings, yields, master] = await Promise.all([
          fdb.from('compliance_scores').select('compliance_pct').eq('report_id', ops.id),
          fdb.from('compliance_critical_scores').select('critical_pct').eq('building_id', bid),
          fdb.from('compliance_section_scores').select('section_no,section_title,section_pct').eq('building_id', bid),
          fdb.from('compliance_responses').select('id,response,comment,template_item_id,compliance_template_items(prompt,section_no,section_title)')
            .in('assessment_id', (await fdb.from('compliance_assessments').select('id').eq('report_id', ops.id)).data?.map((a) => a.id) ?? ['00000000-0000-0000-0000-000000000000']),
          fdb.from('inspection_responses').select('acceptable,action_required')
            .in('inspection_id', (await fdb.from('building_inspections').select('id').eq('report_id', ops.id)).data?.map((b) => b.id) ?? ['00000000-0000-0000-0000-000000000000']),
          fdb.from('expense_recoveries').select('ytd_expense,ytd_recovery').eq('report_id', ops.id),
          fdb.from('utility_readings').select('meter_name,reading,utility,category').eq('report_id', ops.id),
          fdb.from('utility_yields').select('source,pct_achieved').eq('report_id', ops.id),
          fdb.from('masterfile_items').select('on_file').eq('report_id', ops.id),
        ]);

        const k1 = scoreRows.data?.[0]?.compliance_pct ?? null;
        kpis.push({ id: 'K1', label: 'OHS Compliance', value: num(k1), format: 'pct', status: classify(num(k1), THRESHOLDS.compliance) });

        const o2 = critRows.data?.[0]?.critical_pct ?? null;
        kpis.push({ id: 'O2', label: 'Critical Equipment', value: num(o2), format: 'pct', status: classify(num(o2), THRESHOLDS.critical) });

        const resp = (respRows.data ?? []) as any[];
        const noCount = resp.filter((r) => r.response === 'no').length;
        const naCount = resp.filter((r) => r.response === 'na').length;
        kpis.push({ id: 'O3', label: 'Open Non-Compliances', value: noCount, format: 'count', status: classify(noCount, THRESHOLDS.openNonCompliance) });
        kpis.push({ id: 'O4', label: 'Items N/A', value: naCount, format: 'count', status: 'info' });
        actions = resp.filter((r) => r.response === 'no').map((r) => ({
          responseId: r.id, prompt: r.compliance_template_items?.prompt ?? '', comment: r.comment,
          section: `${r.compliance_template_items?.section_no ?? ''} ${r.compliance_template_items?.section_title ?? ''}`.trim(),
          templateItemId: r.template_item_id, issueId: null,
        }));
        sectionScores = (secRows.data ?? []) as SectionScore[];

        // K2 inspection pass %, K3 open actions
        const insp = inspRows.data ?? [];
        const acc = insp.filter((r) => r.acceptable === 'yes').length;
        const ans = insp.filter((r) => r.acceptable === 'yes' || r.acceptable === 'no').length;
        const k2 = ans ? Math.round((acc / ans) * 1000) / 10 : null;
        kpis.push({ id: 'K2', label: 'Inspection Pass', value: k2, format: 'pct', status: classify(k2, THRESHOLDS.inspectionPass) });
        const openActions = insp.filter((r) => r.action_required && r.action_required !== 'none').length;
        kpis.push({ id: 'K3', label: 'Open Action Items', value: openActions, format: 'count', status: classify(openActions, THRESHOLDS.openActions) });

        // K4 recovery
        const exp = sum(recov.data, 'ytd_expense'); const rec = sum(recov.data, 'ytd_recovery');
        const k4 = exp ? Math.round((rec / exp) * 1000) / 10 : null;
        kpis.push({ id: 'K4', label: 'Expense Recovery', value: k4, format: 'pct', status: classify(k4, THRESHOLDS.recovery), sub: k4 !== null ? `R${Math.round(rec).toLocaleString()} / R${Math.round(exp).toLocaleString()}` : undefined });

        // K8 water bulk vs site total Δ
        const rds = readings.data ?? [];
        const bulk = rds.find((r) => r.utility === 'water' && r.meter_name === 'Bulk Check')?.reading;
        const site = rds.find((r) => r.utility === 'water' && (r.meter_name ?? '').includes('Site Daily'))?.reading;
        const k8 = bulk && site ? Math.round((Math.abs(num(site)! - num(bulk)!) / num(bulk)!) * 1000) / 10 : null;
        kpis.push({ id: 'K8', label: 'Water Bulk Δ', value: k8, format: 'pct', status: classify(k8, THRESHOLDS.waterDelta) });

        // K9 solar / K10 borehole yield
        const solar = num(yields.data?.find((y) => y.source === 'solar')?.pct_achieved ?? null);
        const bore = num(yields.data?.find((y) => y.source === 'borehole')?.pct_achieved ?? null);
        kpis.push({ id: 'K9', label: 'Solar Yield', value: solar, format: 'pct', status: classify(solar, THRESHOLDS.yield) });
        kpis.push({ id: 'K10', label: 'Borehole Yield', value: bore, format: 'pct', status: classify(bore, THRESHOLDS.yield) });

        // K12 masterfile completeness
        const mf = master.data ?? [];
        const onFile = mf.filter((m) => m.on_file === true).length;
        const k12 = mf.length ? Math.round((onFile / mf.length) * 1000) / 10 : null;
        kpis.push({ id: 'K12', label: 'Masterfile Complete', value: k12, format: 'pct', status: classify(k12, THRESHOLDS.masterfile), sub: mf.length ? `${onFile}/${mf.length}` : undefined });
      }

      // trend across all approved ops reports
      const allOps = await fdb.from('reports').select('id,report_period').eq('building_id', bid).eq('report_type', 'ops_monthly').order('report_period');
      const trendRows = await Promise.all((allOps.data ?? []).map(async (r) => {
        const s = await fdb.from('compliance_scores').select('compliance_pct').eq('report_id', r.id);
        return { period: r.report_period as string, pct: num(s.data?.[0]?.compliance_pct ?? null) };
      }));
      trend = trendRows;

      if (cm) {
        const [turn, inc] = await Promise.all([
          fdb.from('tenant_turnover').select('annual_trading_density,annual_growth_pct,rank_band').eq('report_id', cm.id),
          fdb.from('security_incidents').select('period,count').eq('report_id', cm.id),
        ]);
        const dens = avg(turn.data, 'annual_trading_density');
        kpis.push({ id: 'K5', label: 'Trading Density', value: dens, format: 'zar', status: 'info', sub: 'R/m²' });
        const growth = num(turn.data?.find((t) => t.rank_band === 'anchor')?.annual_growth_pct ?? null);
        const growthPct = growth !== null ? Math.round(growth * 1000) / 10 : null;
        kpis.push({ id: 'K6', label: 'Anchor Growth', value: growthPct, format: 'pct', status: growthPct !== null ? (growthPct >= 0 ? 'good' : 'bad') : 'info' });
        // K14 latest-period incidents
        const periods = [...new Set((inc.data ?? []).map((i) => i.period))].sort();
        const latest = periods[periods.length - 1];
        const incCount = (inc.data ?? []).filter((i) => i.period === latest).reduce((a, i) => a + (i.count ?? 0), 0);
        kpis.push({ id: 'K14', label: 'Security Incidents', value: incCount || null, format: 'count', status: 'info', sub: latest ? new Date(latest + 'T00:00:00').toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' }) : undefined });
      }

      if (annual) {
        const capex = await fdb.from('capex_items').select('estimate').eq('report_id', annual.id);
        const total = sum(capex.data, 'estimate');
        kpis.push({ id: 'K18', label: 'Annual Capex', value: total || null, format: 'zar', status: 'info' });
      }

      return { ops, cm, annual, kpis, sectionScores, actions, trend };
    },
  });
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sum(rows: any[] | null | undefined, key: string): number {
  return (rows ?? []).reduce((a, r) => a + (num(r[key]) ?? 0), 0);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function avg(rows: any[] | null | undefined, key: string): number | null {
  const vals = (rows ?? []).map((r) => num(r[key])).filter((v): v is number => v !== null);
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length)) : null;
}
