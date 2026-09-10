/**
 * Coverage of the portfolio for one period: which report types each building owes, and what state each
 * is in. Pure so the grid derivation is unit-tested; the page feeds it the reports list and the buildings
 * (with their report_types) it already loads.
 */
import type { ReportType } from '@/integrations/supabase/fortress-db';
import { todayInOperatingTz } from '@/lib/myWork';

export const COVERAGE_TYPES: ReportType[] = ['ops_monthly', 'cm_monthly', 'annual_inspection'];
export const COVERAGE_TYPE_LABELS: Record<ReportType, string> = { ops_monthly: 'OPS', cm_monthly: 'CM', annual_inspection: 'Annual' };

/** `na` = the building does not owe this type (buildings.report_types). */
export type CoverageStatus = 'missing' | 'na' | 'draft' | 'submitted' | 'reviewed' | 'approved' | 'rejected';
/** Display order for the header counts; `na` is never counted. */
export const COVERAGE_STATUS_ORDER: CoverageStatus[] = ['approved', 'reviewed', 'submitted', 'rejected', 'draft', 'missing'];

export interface CoverageBuilding { id: string; name: string; report_types: string[] }
export interface CoverageReport { id: string; building_id: string; report_type: string; report_period: string; status: string }
export interface CoverageCell { status: CoverageStatus; reportId: string | null }
export interface CoverageRow { buildingId: string; name: string; cells: Record<ReportType, CoverageCell> }
export type CoverageSummary = Record<ReportType, Record<CoverageStatus, number>>;

/** First of the previous month, `YYYY-MM-01`, in the operating timezone. */
export function previousMonthPeriod(today: string = todayInOperatingTz()): string {
  const [y, m] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}

/** Annual reports cover a year: any period in the same calendar year counts. Monthly types match the month. */
export function periodMatches(type: string, reportPeriod: string, period: string): boolean {
  return type === 'annual_inspection' ? reportPeriod.slice(0, 4) === period.slice(0, 4) : reportPeriod.slice(0, 7) === period.slice(0, 7);
}

const RANK: Record<string, number> = { approved: 5, reviewed: 4, submitted: 3, rejected: 2, draft: 1 };

function emptySummary(): CoverageSummary {
  const zero = (): Record<CoverageStatus, number> => ({ missing: 0, na: 0, draft: 0, submitted: 0, reviewed: 0, approved: 0, rejected: 0 });
  return { ops_monthly: zero(), cm_monthly: zero(), annual_inspection: zero() };
}

export function buildCoverage(buildings: CoverageBuilding[], reports: CoverageReport[], period: string): { rows: CoverageRow[]; summary: CoverageSummary } {
  const summary = emptySummary();
  const rows = buildings.map((b): CoverageRow => {
    const cells = {} as Record<ReportType, CoverageCell>;
    for (const type of COVERAGE_TYPES) {
      if (!b.report_types.includes(type)) {
        cells[type] = { status: 'na', reportId: null };
        continue;
      }
      // The most advanced matching report wins (annual can have several in a year).
      const best = reports
        .filter((r) => r.building_id === b.id && r.report_type === type && periodMatches(type, r.report_period, period))
        .sort((a, c) => (RANK[c.status] ?? 0) - (RANK[a.status] ?? 0))[0];
      const status: CoverageStatus = best && best.status in RANK ? (best.status as CoverageStatus) : 'missing';
      cells[type] = { status, reportId: best?.id ?? null };
      summary[type][status] += 1;
    }
    return { buildingId: b.id, name: b.name, cells };
  });
  return { rows, summary };
}

/** "31 approved · 4 submitted · 12 missing" — zero counts and n/a omitted. */
export function summaryLine(counts: Record<CoverageStatus, number>): string {
  return COVERAGE_STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${s}`).join(' · ') || 'nothing due';
}
