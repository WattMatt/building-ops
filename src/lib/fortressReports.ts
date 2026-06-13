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
    { key: 'ohs_compliance', label: 'OHS Act Compliance', hint: 'Weighted compliance — scored live from the template.' },
    { key: 'building_inspection', label: 'Building Inspection', hint: 'Monthly acceptable / action checklist.' },
    { key: 'expense_recoveries', label: 'Expense Recoveries', hint: 'YTD expense vs recovery per service.' },
    { key: 'utilities', label: 'Utilities', hint: 'Meter readings + borehole/solar yields.' },
    { key: 'ppm', label: 'PPM', hint: 'Planned maintenance status (read-only roll-up).' },
    { key: 'masterfile', label: 'Masterfile', hint: 'Document completeness register.' },
  ],
  cm_monthly: [
    { key: 'building_overview', label: 'Building Overview', hint: 'Narrative.' },
    { key: 'turnover', label: 'Turnover', hint: 'Per-tenant trading density, COO, growth.' },
    { key: 'footfall_toilet', label: 'Footfall & Toilet Fund', hint: 'Entrance counts + toilet fund.' },
    { key: 'leasing', label: 'Leasing', hint: 'Vacancies, waitlist, movements.' },
    { key: 'trading_arrears', label: 'Trading Hours & Arrears', hint: 'Breaches + arrears.' },
    { key: 'utility_management', label: 'Utility Management', hint: 'Loadshedding + service interruptions.' },
    { key: 'tenant_compliance', label: 'Tenant OHS & HK', hint: 'Per-tenant compliance matrix.' },
    { key: 'shop_spec', label: 'Shop Spec', hint: 'Per-tenant shop specification (versioned).' },
    { key: 'security_incidents', label: 'Security Incidents', hint: 'Monthly incident counts by type.' },
  ],
  annual_inspection: [
    { key: 'condition_inspection', label: 'Condition Inspection', hint: '33-section equipment & fabric inspection.' },
    { key: 'capex', label: 'Capex Register', hint: 'Capital expenditure motivations.' },
  ],
};

/** Sections that must have at least one saved row before a report can be submitted. */
export const REQUIRED_SECTIONS: Record<ReportType, string[]> = {
  ops_monthly: ['ohs_compliance'],
  cm_monthly: ['turnover'],
  annual_inspection: ['condition_inspection'],
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
