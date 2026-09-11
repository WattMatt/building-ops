/**
 * Portfolio OHS compliance rollup (audit finding H1, spec KPI O9).
 *
 * Two sources, and they do NOT share semantics — the row says which one it used via `scorePeriod`:
 *
 *  - Snapshot path (R4a, one query for every building): `compliancePct`/`criticalPct`/`openNonCompliances`
 *    are the nightly snapshot's, i.e. the latest APPROVED ops report (D10). `scorePeriod` is that report's
 *    period. A second query lists the latest FILED ops report per building so `period`/`status` can still
 *    say "submitted, awaiting approval" rather than "no report".
 *  - Live fallback (`buildingRow`, per building, for any building without a FRESH snapshot row and for
 *    every building when the snapshot read fails): the figures are the latest FILED report's (submitted,
 *    reviewed or approved), because a filed-but-unsigned report must not read as "nothing filed". Here
 *    `scorePeriod` is that filed report's period whenever it produced a score.
 *
 * So a building's score can be from an approved report on the snapshot path and from a merely submitted
 * one on the live path; the card is right to show `scorePeriod` next to the number.
 */
import { useQuery } from '@tanstack/react-query';
import { fdb } from '@/integrations/supabase/fortress-db';
import { SNAPSHOT_FRESH_DAYS, daysAgo, fetchAll, num, snapshotQueryDefaults, snapshotRowsOrEmpty, snapshots, type SnapshotRow } from '@/lib/snapshotClient';

export interface PortfolioComplianceRow {
  buildingId: string;
  name: string;
  compliancePct: number | null;
  criticalPct: number | null;
  openNonCompliances: number | null;
  /** Period of the latest FILED ops report (any of submitted/reviewed/approved), null when none. */
  period: string | null;
  /** Lifecycle status of that latest filed report; null when none was found. */
  status: string | null;
  /** Period of the report `compliancePct` was scored from — approved-only on the snapshot path. Null when unscored. */
  scorePeriod: string | null;
}

export interface PortfolioCompliance {
  rows: PortfolioComplianceRow[];
  portfolioAvg: number | null;
  /** Buildings that have FILED an ops report (regardless of whether it is scored). */
  reportedCount: number;
  /** Buildings that additionally have a compliance SCORE — the average's denominator. */
  scoredCount: number;
  total: number;
  /** Newest snapshot computed_at among the rows, null when every row came from live queries. */
  asOf: string | null;
}

async function buildingRow(buildingId: string, name: string): Promise<PortfolioComplianceRow> {
  const empty: PortfolioComplianceRow = {
    buildingId,
    name,
    compliancePct: null,
    criticalPct: null,
    openNonCompliances: null,
    period: null,
    status: null,
    scorePeriod: null,
  };

  // Latest FILED ops_monthly report for this building.
  //
  // This used to require status='approved', which made the portfolio look empty whenever
  // reports had been filed but not yet signed off: a bulk import lands 30+ reports as
  // 'submitted', and every one of those buildings rendered as "No approved report" — the
  // same words the card uses for a building that filed nothing at all. A submitted report
  // has been filed; it just has not been signed off. The row now carries its status so the
  // card can say which, instead of the reader having to assume.
  const repRes = await fdb
    .from('reports')
    .select('id,report_period,status')
    .eq('building_id', buildingId)
    .eq('report_type', 'ops_monthly')
    .in('status', ['submitted', 'reviewed', 'approved'])
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

  const period = (report.report_period as string | null) ?? null;
  return {
    buildingId,
    name,
    compliancePct,
    criticalPct,
    openNonCompliances,
    period,
    status: (report.status as string | null) ?? null,
    scorePeriod: compliancePct === null ? null : period,
  };
}

export function usePortfolioCompliance() {
  const query = useQuery({
    queryKey: ['portfolio-compliance'],
    ...snapshotQueryDefaults,
    queryFn: async (): Promise<PortfolioCompliance> => {
      const bRes = await fdb.from('buildings').select('id,name').order('name');
      // Without this the query "succeeds" with zero buildings on any failure, and
      // the card reports "0 of 0 buildings reported" as if the portfolio were empty.
      if (bRes.error) throw bRes.error;
      const buildings = (bRes.data ?? []) as { id: string; name: string | null }[];

      const [snapRes, repRes] = await Promise.all([
        // Fresh window only: ≤ 4 rows per building. Newest first, building_id as the tiebreak so paging is stable.
        fetchAll(() => snapshots().gte('day', daysAgo(SNAPSHOT_FRESH_DAYS)).order('day', { ascending: false }).order('building_id', { ascending: true })),
        fdb.from('reports').select('building_id,report_period,status')
          .eq('report_type', 'ops_monthly').in('status', ['submitted', 'reviewed', 'approved'])
          .order('report_period', { ascending: false }).range(0, 4999),
      ]);
      // A failed snapshot read is "no fresh rows": every building takes the live path below, and the
      // card shows live figures with no "as of" — never an error for a table that may not exist yet.
      const snapRows = snapshotRowsOrEmpty(snapRes, 'usePortfolioCompliance');
      if (repRes.error) throw repRes.error;

      // Both lists are newest-first, so the first row seen per building is the latest.
      const latestSnap = new Map<string, SnapshotRow>();
      for (const r of snapRows) if (!latestSnap.has(r.building_id)) latestSnap.set(r.building_id, r);
      const latestFiled = new Map<string, { period: string; status: string }>();
      for (const r of repRes.data ?? []) if (!latestFiled.has(r.building_id)) latestFiled.set(r.building_id, { period: r.report_period, status: r.status });

      const rows = await Promise.all(buildings.map(async (b): Promise<PortfolioComplianceRow> => {
        const name = b.name ?? 'Unnamed building';
        const s = latestSnap.get(b.id);
        if (!s) return buildingRow(b.id, name);
        const filed = latestFiled.get(b.id);
        const compliancePct = num(s.compliance_pct);
        return {
          buildingId: b.id, name,
          compliancePct,
          criticalPct: num(s.critical_pct),
          openNonCompliances: s.ohs_open_nc ?? null,
          period: filed?.period ?? s.compliance_period ?? null,
          status: filed?.status ?? null,
          scorePeriod: compliancePct === null ? null : s.compliance_period,
        };
      }));

      const scored = rows.map((r) => r.compliancePct).filter((v): v is number => v !== null);
      const portfolioAvg = scored.length ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10 : null;
      const asOf = [...latestSnap.values()].map((s) => s.computed_at).sort().pop() ?? null;
      return {
        rows,
        portfolioAvg,
        // "Reported" means a report exists, not that it produced a score. Counting scores
        // here made the headline read "2 of 47 buildings reported" while 35 had filed.
        reportedCount: rows.filter((r) => r.period !== null).length,
        scoredCount: scored.length,
        total: rows.length,
        asOf,
      };
    },
  });

  return {
    rows: query.data?.rows ?? [],
    portfolioAvg: query.data?.portfolioAvg ?? null,
    reportedCount: query.data?.reportedCount ?? 0,
    scoredCount: query.data?.scoredCount ?? 0,
    total: query.data?.total ?? 0,
    asOf: query.data?.asOf ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
