/**
 * Fortress report configuration: section metadata per report type, plus shared
 * formatters. Pure data/helpers only — no React, no component imports — so it can
 * be unit-tested and imported anywhere. The component registry that maps a section
 * key to its form lives in components/reports/fortress/sections/registry.tsx.
 */
import type { ReportType, YesNoNa } from '@/integrations/supabase/fortress-db';

export interface SectionMeta {
  /** stable key — also the registry key and the URL hash */
  key: string;
  label: string;
  /** short helper text shown under the section heading */
  hint?: string;
}

/** Ordered sections per report type (03_FORMS_SPEC.md §2). */
export const REPORT_SECTIONS: Record<ReportType, SectionMeta[]> = {
  ops_monthly: [
    { key: 'operational_overview', label: 'Operational Overview', hint: 'Narrative status per building system.' },
    { key: 'report_checklist', label: 'General Checklist', hint: 'Site-visit, night/roof inspection, asset register, SLAs.' },
    { key: 'ohs_compliance', label: 'OHS Act Compliance', hint: 'Weighted compliance — scored live from the template.' },
    { key: 'hazard_log', label: 'Hazard Log', hint: 'Potential hazards + corrective actions.' },
    { key: 'building_inspection', label: 'Building Inspection', hint: 'Monthly acceptable / action checklist.' },
    { key: 'expense_recoveries', label: 'Expense Recoveries', hint: 'YTD expense vs recovery per service.' },
    { key: 'utilities', label: 'Utilities', hint: 'Meter readings + borehole/solar yields.' },
    { key: 'ppm', label: 'PPM', hint: 'Planned maintenance status (read-only roll-up).' },
    { key: 'masterfile', label: 'Masterfile', hint: 'Document completeness register.' },
    { key: 'electrical_compliance', label: 'Electrical Compliance', hint: 'Live per-shop Certificate of Compliance data from insight-linker.' },
  ],
  cm_monthly: [
    { key: 'building_overview', label: 'Building Overview', hint: 'Narrative.' },
    { key: 'local_resources', label: 'Local Resources', hint: 'CPF / Police / Authority contacts & meetings.' },
    { key: 'report_checklist', label: 'General Checklist', hint: 'Roof/night/meter inspection dates + daily/weekly site checks.' },
    { key: 'building_turnover', label: 'Building Turnover', hint: 'Centre trading performance + computed growth.' },
    { key: 'turnover', label: 'Turnover', hint: 'Per-tenant trading density, COO, growth.' },
    { key: 'category_turnover', label: 'Top Categories', hint: 'Top-5 performing categories.' },
    { key: 'footfall_toilet', label: 'Footfall & Toilet Fund', hint: 'Entrance counts + toilet fund.' },
    { key: 'leasing', label: 'Leasing', hint: 'Vacancies, waitlist, movements.' },
    { key: 'trading_arrears', label: 'Trading Hours & Arrears', hint: 'Breaches + arrears.' },
    { key: 'utility_management', label: 'Utility Management', hint: 'Loadshedding + service interruptions.' },
    { key: 'tenant_compliance', label: 'Tenant OHS & HK', hint: 'Per-tenant compliance matrix.' },
    { key: 'shop_spec', label: 'Shop Spec', hint: 'Per-tenant shop specification (versioned).' },
    { key: 'security_incidents', label: 'Security Incidents', hint: 'Monthly incident counts by type.' },
    { key: 'electrical_compliance', label: 'Electrical Compliance', hint: 'Live per-shop Certificate of Compliance data from insight-linker.' },
  ],
  annual_inspection: [
    { key: 'building_profile', label: 'Building Profile', hint: 'Property profile (§3) — feeds the building KPIs.' },
    { key: 'condition_inspection', label: 'Condition Inspection', hint: '33-section equipment & fabric inspection.' },
    { key: 'capex', label: 'Capex Register', hint: 'Capital expenditure motivations.' },
    { key: 'electrical_compliance', label: 'Electrical Compliance', hint: 'Live per-shop Certificate of Compliance data from insight-linker.' },
  ],
};

/** Sections that must have at least one saved row before a report can be submitted. */
export const REQUIRED_SECTIONS: Record<ReportType, string[]> = {
  ops_monthly: ['ohs_compliance'],
  cm_monthly: ['turnover'],
  annual_inspection: ['condition_inspection'],
};

/** Report-scoped backing table per gated section — submit checks ≥1 row exists. */
export const REQUIRED_SECTION_TABLE: Record<string, string> = {
  ohs_compliance: 'compliance_assessments',
  turnover: 'tenant_turnover',
  condition_inspection: 'building_inspections',
};

/**
 * Where each section's CONTENT lives, so we can tell a filled section from an empty one
 * without opening it. Deliberately points at the table holding the user's answers, not at
 * a parent/header row: `compliance_assessments` and `building_inspections` are created
 * automatically the first time a tab is opened, so counting those would report every
 * section as filled. `via` means the rows hang off that parent by report_id.
 *
 * `key: 'building'` marks a section whose rows are scoped to the building rather than the
 * report (shop specs are versioned per tenant, not per month).
 */
export interface SectionSource {
  /** Table to count rows in. Omitted for sections fed by a live RPC. */
  table?: string;
  /** Building-scoped RPC returning `{ rows: [...] }`; counted instead of a table. */
  rpc?: string;
  key: 'report' | 'building';
  /** Parent table to resolve first; rows are then matched on `parentFk`. */
  via?: { table: string; parentFk: string };
  /** Only count rows matching this section_key (several sections share one table). */
  sectionKey?: string;
}

export const SECTION_SOURCE: Record<string, SectionSource> = {
  // OPS
  operational_overview: { table: 'report_narratives', key: 'report' },
  report_checklist: { table: 'report_checklist_items', key: 'report' },
  ohs_compliance: { table: 'compliance_responses', key: 'report', via: { table: 'compliance_assessments', parentFk: 'assessment_id' } },
  hazard_log: { table: 'hazard_log', key: 'report', via: { table: 'compliance_assessments', parentFk: 'assessment_id' } },
  building_inspection: { table: 'inspection_responses', key: 'report', via: { table: 'building_inspections', parentFk: 'inspection_id' } },
  expense_recoveries: { table: 'expense_recoveries', key: 'report' },
  utilities: { table: 'utility_readings', key: 'report' },
  ppm: { table: 'ppm_services', key: 'report' },
  masterfile: { table: 'masterfile_items', key: 'report' },
  // CM
  building_overview: { table: 'report_narratives', key: 'report', sectionKey: 'building_overview' },
  local_resources: { table: 'report_narratives', key: 'report', sectionKey: 'local_resources' },
  building_turnover: { table: 'building_turnover', key: 'report' },
  turnover: { table: 'tenant_turnover', key: 'report' },
  category_turnover: { table: 'category_turnover', key: 'report' },
  footfall_toilet: { table: 'footfall_counts', key: 'report' },
  leasing: { table: 'vacancies', key: 'report' },
  trading_arrears: { table: 'tenant_arrears', key: 'report' },
  utility_management: { table: 'loadshedding_log', key: 'report' },
  tenant_compliance: { table: 'tenant_compliance', key: 'report' },
  shop_spec: { table: 'tenant_shop_spec', key: 'building' },
  security_incidents: { table: 'security_incidents', key: 'report' },
  // Live from insight-linker via RPC, not a report-scoped table. `rpc` tells the count
  // hook to call report_electrical_compliance rather than counting rows — without an
  // entry here the hook short-circuits to null and the section can never read as filled,
  // which is why annual reports were permanently stuck at "3 of 4 sections have content".
  electrical_compliance: { rpc: 'report_electrical_compliance', key: 'building' },
  // Annual
  building_profile: { table: 'report_narratives', key: 'report', sectionKey: 'building_profile' },
  condition_inspection: { table: 'inspection_responses', key: 'report', via: { table: 'building_inspections', parentFk: 'inspection_id' } },
  capex: { table: 'capex_items', key: 'report' },
};

/**
 * Group-weighted OHS compliance %, N/A counts as a pass, only scored items count
 * (11_MARKING_AND_PERCENTAGES.md §1.5). Equivalent to the SQL compliance_scores view —
 * used for the live in-form preview before the persisted view reloads. Unanswered
 * scored items are excluded from their group's denominator until answered.
 */
export interface ScoredItem {
  id: string;
  group_code: string;
  group_weight: number;
  is_scored: boolean;
}
export function computeBuildingPct(
  items: ScoredItem[],
  responses: Record<string, YesNoNa | undefined>,
): number | null {
  const byGroup = new Map<string, { weight: number; total: number; compliant: number }>();
  for (const it of items) {
    if (!it.is_scored) continue;
    const r = responses[it.id];
    if (!r) continue;
    const g = byGroup.get(it.group_code) ?? { weight: Number(it.group_weight) || 0, total: 0, compliant: 0 };
    g.total += 1;
    if (r === 'yes' || r === 'na') g.compliant += 1;
    byGroup.set(it.group_code, g);
  }
  let wSum = 0;
  let acc = 0;
  for (const g of byGroup.values()) {
    if (g.total === 0) continue;
    acc += g.weight * (g.compliant / g.total);
    wSum += g.weight;
  }
  if (wSum === 0) return null;
  return Math.round((acc / wSum) * 100 * 10) / 10;
}

const zar = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 2,
});

/** ZAR money formatter — every Fortress money value renders through this. */
export function formatZAR(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return zar.format(Number(value));
}

export function formatPct(value: number | null | undefined, dp = 1): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(dp)}%`;
}

/** First-of-month ISO date (YYYY-MM-01) from a "YYYY-MM" month input. */
export function periodFromMonthInput(month: string): string {
  return `${month}-01`;
}

/** "YYYY-MM" for an <input type="month"> from a stored YYYY-MM-DD period. */
export function monthInputFromPeriod(period: string): string {
  return period.slice(0, 7);
}

/** "October 2025" for display from a YYYY-MM-DD period. */
export function formatPeriodLabel(period: string | null | undefined): string {
  if (!period) return '—';
  const d = new Date(`${period.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return period;
  return d.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
}

export const REPORT_STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline',
  submitted: 'secondary',
  reviewed: 'secondary',
  approved: 'default',
  rejected: 'destructive',
};
