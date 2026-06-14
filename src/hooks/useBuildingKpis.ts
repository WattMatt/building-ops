/**
 * Computes the Fortress building KPIs (K1–K18 + O1–O9) from the latest approved
 * reports. Each KPI reads the SQL views / section tables (never client math that can
 * drift from the source): K1 = compliance_scores, O2 = compliance_critical_scores,
 * K4 = expense_recoveries, K8 = utilities, etc. KPIs with no data return null →
 * the cards render an honest empty-state.
 */
import { useQuery } from '@tanstack/react-query';
import { fdb } from '@/integrations/supabase/fortress-db';
import { classify, ratioPct, waterDeltaPct, THRESHOLDS, type KpiStatus } from '@/lib/fortressKpis';
import { ppmCompletion, type PpmServiceLike } from '@/lib/ppmStatus';

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
          fdb.from('compliance_responses').select('id,response,comment,template_item_id,issue_id,compliance_template_items(prompt,section_no,section_title)')
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

        // O1 Building Compliance — same source as K1 (compliance_scores.compliance_pct); O1 is the spec headline.
        kpis.push({ id: 'O1', label: 'Building Compliance', value: num(k1), format: 'pct', status: classify(num(k1), THRESHOLDS.compliance) });

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
          templateItemId: r.template_item_id, issueId: r.issue_id ?? null,
        }));
        sectionScores = (secRows.data ?? []) as SectionScore[];

        // K2 inspection pass %, K3 open actions
        const insp = inspRows.data ?? [];
        const acc = insp.filter((r) => r.acceptable === 'yes').length;
        const ans = insp.filter((r) => r.acceptable === 'yes' || r.acceptable === 'no').length;
        const k2 = ratioPct(acc, ans);
        kpis.push({ id: 'K2', label: 'Inspection Pass', value: k2, format: 'pct', status: classify(k2, THRESHOLDS.inspectionPass) });
        const openActions = insp.filter((r) => r.action_required && r.action_required !== 'none').length;
        kpis.push({ id: 'K3', label: 'Open Action Items', value: openActions, format: 'count', status: classify(openActions, THRESHOLDS.openActions) });

        // K4 recovery
        const exp = sum(recov.data, 'ytd_expense'); const rec = sum(recov.data, 'ytd_recovery');
        const k4 = ratioPct(rec, exp);
        kpis.push({ id: 'K4', label: 'Expense Recovery', value: k4, format: 'pct', status: classify(k4, THRESHOLDS.recovery), sub: k4 !== null ? `R${Math.round(rec).toLocaleString()} / R${Math.round(exp).toLocaleString()}` : undefined });

        // K8 water bulk vs site total Δ
        const rds = readings.data ?? [];
        const bulk = rds.find((r) => r.utility === 'water' && r.meter_name === 'Bulk Check')?.reading;
        const site = rds.find((r) => r.utility === 'water' && (r.meter_name ?? '').includes('Site Daily'))?.reading;
        const k8 = waterDeltaPct(num(bulk), num(site));
        kpis.push({ id: 'K8', label: 'Water Bulk Δ', value: k8, format: 'pct', status: classify(k8, THRESHOLDS.waterDelta) });

        // K9 solar / K10 borehole yield
        const solar = num(yields.data?.find((y) => y.source === 'solar')?.pct_achieved ?? null);
        const bore = num(yields.data?.find((y) => y.source === 'borehole')?.pct_achieved ?? null);
        kpis.push({ id: 'K9', label: 'Solar Yield', value: solar, format: 'pct', status: classify(solar, THRESHOLDS.yield) });
        kpis.push({ id: 'K10', label: 'Borehole Yield', value: bore, format: 'pct', status: classify(bore, THRESHOLDS.yield) });

        // K12 masterfile completeness — on_file is a text column ('yes'/'no'), not a boolean.
        const mf = master.data ?? [];
        const onFile = mf.filter((m) => m.on_file === 'yes').length;
        const k12 = ratioPct(onFile, mf.length);
        kpis.push({ id: 'K12', label: 'Masterfile Complete', value: k12, format: 'pct', status: classify(k12, THRESHOLDS.masterfile), sub: mf.length ? `${onFile}/${mf.length}` : undefined });

        // O5 Lowest Section — MIN section_pct across the building's section scores; sub = that section's no + title.
        const secWithPct = sectionScores.filter((s) => num(s.section_pct) !== null);
        let o5: number | null = null; let o5Sub: string | undefined;
        if (secWithPct.length) {
          const lowest = secWithPct.reduce((min, s) => (num(s.section_pct)! < num(min.section_pct)! ? s : min));
          o5 = num(lowest.section_pct);
          o5Sub = `${lowest.section_no} ${lowest.section_title ?? ''}`.trim();
        }
        kpis.push({ id: 'O5', label: 'Lowest Section', value: o5, format: 'pct', status: classify(o5, THRESHOLDS.compliance), sub: o5Sub });
      }

      // trend across all approved ops reports
      const allOps = await fdb.from('reports').select('id,report_period').eq('building_id', bid).eq('report_type', 'ops_monthly').order('report_period');
      const trendRows = await Promise.all((allOps.data ?? []).map(async (r) => {
        const s = await fdb.from('compliance_scores').select('compliance_pct').eq('report_id', r.id);
        return { period: r.report_period as string, pct: num(s.data?.[0]?.compliance_pct ?? null) };
      }));
      trend = trendRows;

      // O8 Compliance Trend Δ — latest minus previous non-null point of the trend array; null if <2 points.
      const trendPts = trend.map((t) => t.pct).filter((v): v is number => v !== null);
      const o8 = trendPts.length >= 2
        ? Math.round((trendPts[trendPts.length - 1] - trendPts[trendPts.length - 2]) * 10) / 10
        : null;
      kpis.push({ id: 'O8', label: 'Compliance Trend Δ', value: o8, format: 'pct', status: o8 === null ? 'info' : (o8 >= 0 ? 'good' : 'bad') });

      if (cm) {
        const [turn, inc, tcomp, vac, arr, load] = await Promise.all([
          fdb.from('tenant_turnover').select('annual_trading_density,annual_growth_pct,rank_band').eq('report_id', cm.id),
          fdb.from('security_incidents').select('period,count').eq('report_id', cm.id),
          fdb.from('tenant_compliance').select('*').eq('report_id', cm.id),
          fdb.from('vacancies').select('area').eq('report_id', cm.id),
          fdb.from('tenant_arrears').select('closing_balance').eq('report_id', cm.id),
          fdb.from('loadshedding_log').select('hours').eq('report_id', cm.id),
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

        // K13 Tenant Compliance — tenant_compliance has NO overall status column; each row is a tenant with
        // ~20 text check fields coded 'yes'/null. "Compliant" = share of those check fields answered 'yes'.
        // (% of all yes/no-style answers across all tenant rows that are 'yes'.)
        const TC_CHECK_FIELDS = [
          'hvac_records_current', 'generator_records_current', 'fire_sprinkler_weekly', 'fire_sprinkler_annual',
          'fire_sprinkler_3yr', 'smoke_extraction_annual_service', 'smoke_detection_annual_service',
          'handheld_fire_current', 'evac_plan_displayed', 'food_extraction_cert', 'grease_trap_clean',
          'fire_blanket', 'gas_coc', 'flammable_liquid_cert',
        ];
        const tcRows = (tcomp.data ?? []) as Record<string, unknown>[];
        let tcAnswered = 0; let tcYes = 0;
        for (const row of tcRows) {
          for (const f of TC_CHECK_FIELDS) {
            const v = row[f];
            if (v === 'yes' || v === 'no') { tcAnswered++; if (v === 'yes') tcYes++; }
          }
        }
        const k13 = ratioPct(tcYes, tcAnswered);
        kpis.push({ id: 'K13', label: 'Tenant Compliance', value: k13, format: 'pct', status: classify(k13, THRESHOLDS.tenantCompliance), sub: tcAnswered ? `${tcYes}/${tcAnswered}` : undefined });

        // K7 Footfall MoM — month-over-month change in total monthly footfall across the building's cm reports.
        // Needs ≥2 periods → null for a single report. Data-hygiene: footfall_counts has duplicate/ambiguous
        // "Public Toilets"/"Total Toilets" entrance rows; to avoid double-counting we prefer a single 'Total'
        // entrance row per report if present, else sum distinct entrances excluding the known duplicate label.
        const cmReports = await fdb.from('reports').select('id,report_period')
          .eq('building_id', bid).eq('report_type', 'cm_monthly').order('report_period');
        const footfallByPeriod = await Promise.all((cmReports.data ?? []).map(async (r) => {
          const ff = await fdb.from('footfall_counts').select('entrance,month_count').eq('report_id', r.id);
          const rows = (ff.data ?? []) as { entrance: string | null; month_count: number | null }[];
          const total = totalFootfall(rows);
          return { period: r.report_period as string, total };
        }));
        const ffPts = footfallByPeriod.map((f) => f.total).filter((v): v is number => v !== null);
        const k7 = ffPts.length >= 2 ? ratioPct(ffPts[ffPts.length - 1] - ffPts[ffPts.length - 2], ffPts[ffPts.length - 2]) : null;
        kpis.push({ id: 'K7', label: 'Footfall MoM', value: k7, format: 'pct', status: 'info' });

        // K15 Vacancy — vacant area for the latest cm report. No lettable-units/GLA column on buildings to form a
        // %, so we expose the vacant-area count as the honest figure (0 for AbaQulusi). invert threshold.
        const vacArea = sum(vac.data, 'area');
        const k15 = (vac.data?.length ?? 0) ? Math.round(vacArea) : null;
        kpis.push({ id: 'K15', label: 'Vacancy', value: k15, format: 'number', status: classify(k15, THRESHOLDS.vacancy), sub: k15 !== null ? 'm²' : undefined });

        // K16 Arrears — sum of tenant_arrears closing balances for the latest cm report; null if none.
        const k16 = (arr.data?.length ?? 0) ? sum(arr.data, 'closing_balance') : null;
        kpis.push({ id: 'K16', label: 'Arrears', value: k16, format: 'zar', status: 'info' });

        // K17 Loadshedding Hrs — sum of loadshedding_log hours for the latest cm report; null if none.
        const k17 = (load.data?.length ?? 0) ? sum(load.data, 'hours') : null;
        kpis.push({ id: 'K17', label: 'Loadshedding Hrs', value: k17, format: 'number', status: 'info' });
      }

      if (annual) {
        const inspIds = (await fdb.from('building_inspections').select('id').eq('report_id', annual.id)).data?.map((b) => b.id) ?? [];
        const [capex, due] = await Promise.all([
          fdb.from('capex_items').select('estimate').eq('report_id', annual.id),
          inspIds.length
            ? fdb.from('inspection_responses').select('next_service_due').in('inspection_id', inspIds)
            : Promise.resolve({ data: [] as { next_service_due: string | null }[] }),
        ]);
        const total = sum(capex.data, 'estimate');
        kpis.push({ id: 'K18', label: 'Annual Capex', value: total || null, format: 'zar', status: 'info' });

        // O6 Equipment Overdue — count of annual inspection responses whose next_service_due is in the past.
        const today = new Date().toISOString().slice(0, 10);
        const overdue = (due.data ?? []).filter((r) => r.next_service_due && r.next_service_due < today).length;
        kpis.push({ id: 'O6', label: 'Equipment Overdue', value: overdue, format: 'count', status: classify(overdue, THRESHOLDS.equipmentOverdue) });
      }

      // K11 PPM Serviced — ppm_services on the latest approved ops report: the share of
      // services that have been serviced at least once (any 'done' month cell) over the
      // report's 12-month window. null when there are no services (honest empty-state).
      let k11: number | null = null; let k11Sub: string | undefined;
      if (ops) {
        const ppm = await fdb.from('ppm_services').select('months').eq('report_id', ops.id);
        const { doneCount, total, pct } = ppmCompletion((ppm.data ?? []) as PpmServiceLike[]);
        k11 = pct;
        if (total > 0) k11Sub = `${doneCount}/${total}`;
      }
      kpis.push({ id: 'K11', label: 'PPM Serviced', value: k11, format: 'pct', status: classify(k11, THRESHOLDS.ppm), sub: k11Sub });

      // O7 Days Since Evac Drill — days since the most recent COMPLETED evacuation-drill task for the building.
      const evacTasks = await fdb.from('task_instances').select('id').eq('building_id', bid).ilike('task_name', '%evac%');
      const evacIds = (evacTasks.data ?? []).map((t) => t.id);
      let o7: number | null = null;
      if (evacIds.length) {
        const comps = await fdb.from('task_completions').select('created_at').in('task_instance_id', evacIds)
          .order('created_at', { ascending: false }).limit(1);
        const last = comps.data?.[0]?.created_at as string | undefined;
        if (last) o7 = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
      }
      kpis.push({ id: 'O7', label: 'Days Since Evac Drill', value: o7, format: 'number', status: 'info' });

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

/** Total monthly footfall for one report, handling the known footfall_counts data-hygiene issue:
 *  the "Public Toilets" and "Total Toilets" entrance rows duplicate the same count. If a single
 *  'Total' entrance row exists, use it. Otherwise sum distinct entrances, dropping the duplicate
 *  "Total Toilets" label (it mirrors "Public Toilets"). Returns null if the result is ambiguous. */
export function totalFootfall(rows: { entrance: string | null; month_count: number | null }[]): number | null {
  const clean = rows.filter((r) => num(r.month_count) !== null);
  if (!clean.length) return null;
  const totalRow = clean.find((r) => (r.entrance ?? '').trim().toLowerCase() === 'total');
  if (totalRow) return num(totalRow.month_count);
  // Drop the known duplicate "Total Toilets" (mirrors "Public Toilets"); sum the remaining distinct entrances.
  const seen = new Set<string>();
  let total = 0;
  for (const r of clean) {
    const label = (r.entrance ?? '').trim();
    if (label.toLowerCase() === 'total toilets') continue;
    if (seen.has(label.toLowerCase())) continue; // ambiguous duplicate label → skip
    seen.add(label.toLowerCase());
    total += num(r.month_count)!;
  }
  return total || null;
}
