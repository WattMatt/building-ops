/**
 * Grid-based OPS/CM sections. Each is a thin declaration of typed columns over the
 * shared EditableGrid; composite sections (utilities, leasing, …) stack a few grids.
 * Computed columns (% recovery, % achieved) are derived live and never stored stale.
 */
import { EditableGrid, type GridColumn } from '../EditableGrid';
import { formatPct, formatZAR } from '@/lib/fortressReports';
import type { SectionProps } from './types';

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const ratioPct = (a: unknown, b: unknown): number | null => {
  const x = num(a); const y = num(b);
  if (x === null || y === null || y === 0) return null;
  return Math.round((x / y) * 1000) / 10;
};

// ---- OPS ---------------------------------------------------------------------
const EXPENSE_COLS: GridColumn[] = [
  { key: 'service', label: 'Service', type: 'text' },
  { key: 'ytd_expense', label: 'YTD Expense', type: 'number' },
  { key: 'ytd_recovery', label: 'YTD Recovery', type: 'number' },
  { key: 'pct_recovery', label: '% Recovery', type: 'number', compute: (r) => ratioPct(r.ytd_recovery, r.ytd_expense), format: (v) => formatPct(v as number) },
  { key: 'budget_pct_recovery', label: 'Budget %', type: 'number' },
  { key: 'records_uploaded', label: 'Records', type: 'bool' },
  { key: 'fault_found', label: 'Fault', type: 'text' },
  { key: 'comment', label: 'Comment', type: 'text' },
];

const UTIL_READING_COLS: GridColumn[] = [
  { key: 'utility', label: 'Utility', type: 'select', options: [{ value: 'water', label: 'Water' }, { value: 'electricity', label: 'Electricity' }] },
  { key: 'meter_name', label: 'Meter', type: 'text' },
  { key: 'reading', label: 'Reading', type: 'number' },
  { key: 'unit', label: 'Unit', type: 'text' },
  { key: 'category', label: 'Category', type: 'select', options: [
    { value: 'bulk', label: 'Bulk' }, { value: 'common_area', label: 'Common area' },
    { value: 'tenant', label: 'Tenant' }, { value: 'night_usage', label: 'Night usage' }, { value: 'unmetered', label: 'Unmetered' }] },
  { key: 'pct_of_bulk', label: '% of Bulk', type: 'number' },
  { key: 'comment', label: 'Comment', type: 'text' },
];

const UTIL_YIELD_COLS: GridColumn[] = [
  { key: 'source', label: 'Source', type: 'select', options: [{ value: 'borehole', label: 'Borehole' }, { value: 'solar', label: 'Solar' }] },
  { key: 'predicted_yield', label: 'Predicted', type: 'number' },
  { key: 'actual_yield', label: 'Actual', type: 'number' },
  { key: 'pct_achieved', label: '% Achieved', type: 'number', compute: (r) => ratioPct(r.actual_yield, r.predicted_yield), format: (v) => formatPct(v as number) },
  { key: 'unit', label: 'Unit', type: 'text' },
  { key: 'comment', label: 'Comment', type: 'text' },
];

const MASTERFILE_COLS: GridColumn[] = [
  { key: 'document_label', label: 'Document', type: 'text' },
  { key: 'on_file', label: 'On File', type: 'tristate', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unassessed', label: 'Unassessed' }] },
  { key: 'responsible', label: 'Responsible', type: 'text' },
  { key: 'comment', label: 'Comment', type: 'text' },
];

const LOADSHED_COLS: GridColumn[] = [
  { key: 'day', label: 'Day', type: 'date' },
  { key: 'week_no', label: 'Week', type: 'number' },
  { key: 'stage', label: 'Stage', type: 'text' },
  { key: 'hours', label: 'Hours', type: 'number' },
  { key: 'diesel_litres', label: 'Diesel (L)', type: 'number' },
  { key: 'diesel_date', label: 'Diesel Date', type: 'date' },
];

const INTERRUPTION_COLS: GridColumn[] = [
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'interruption_type', label: 'Type', type: 'text' },
  { key: 'start_time', label: 'Start', type: 'text' },
  { key: 'end_time', label: 'End', type: 'text' },
  { key: 'total_hours', label: 'Hours', type: 'number' },
  { key: 'council_ref', label: 'Council Ref', type: 'text' },
  { key: 'comment', label: 'Comment', type: 'text' },
];

// ---- CM ----------------------------------------------------------------------
const TURNOVER_COLS: GridColumn[] = [
  { key: 'tenant_name', label: 'Tenant', type: 'text' },
  { key: 'gla', label: 'GLA m²', type: 'number' },
  { key: 'monthly_avg_turnover', label: 'Monthly Avg TO', type: 'number' },
  { key: 'annual_trading_density', label: 'Trading Density', type: 'number' },
  { key: 'coo_pct', label: 'COO %', type: 'number' },
  { key: 'annual_growth_pct', label: 'Growth %', type: 'number' },
  { key: 'rank_band', label: 'Band', type: 'select', options: [
    { value: 'anchor', label: 'Anchor' }, { value: 'top5', label: 'Top 5' }, { value: 'bottom5', label: 'Bottom 5' }, { value: 'other', label: 'Other' }] },
  { key: 'comment', label: 'Comment', type: 'text' },
];

const FOOTFALL_COLS: GridColumn[] = [
  { key: 'entrance', label: 'Entrance', type: 'text' },
  { key: 'month_count', label: 'Month', type: 'number' },
  { key: 'ytd_count', label: 'YTD', type: 'number' },
  { key: 'prev_ytd', label: 'Prev YTD', type: 'number' },
  { key: 'variance_pct', label: 'Variance %', type: 'number' },
  { key: 'source', label: 'Source', type: 'text' },
];

const TOILET_COLS: GridColumn[] = [
  { key: 'issued_bales', label: 'Issued Bales', type: 'number' },
  { key: 'stock_on_hand_bales', label: 'Stock Bales', type: 'number' },
  { key: 'actual_banked', label: 'Banked', type: 'number' },
  { key: 'budget', label: 'Budget', type: 'number' },
  { key: 'variance', label: 'Variance', type: 'number' },
  { key: 'profit_per_roll', label: 'Profit/Roll', type: 'number' },
];

const VACANCY_COLS: GridColumn[] = [
  { key: 'shop_no', label: 'Shop', type: 'text' },
  { key: 'area', label: 'Area m²', type: 'number' },
  { key: 'budget_relet_rpm', label: 'Budget Relet R/m²', type: 'number' },
  { key: 'gross_mandate_rpm', label: 'Gross Mandate R/m²', type: 'number' },
  { key: 'comment', label: 'Comment', type: 'text' },
];

const WAITLIST_COLS: GridColumn[] = [
  { key: 'trading_as', label: 'Trading As', type: 'text' },
  { key: 'contact', label: 'Contact', type: 'text' },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'optimal_size', label: 'Optimal Size', type: 'text' },
  { key: 'comment', label: 'Comment', type: 'text' },
];

const MOVEMENT_COLS: GridColumn[] = [
  { key: 'trading_as', label: 'Trading As', type: 'text' },
  { key: 'movement_type', label: 'Type', type: 'select', options: [
    { value: 'new', label: 'New' }, { value: 'vacate', label: 'Vacate' }, { value: 'beneficial_occupation', label: 'Beneficial Occupation' }] },
  { key: 'vacate_or_bo_date', label: 'Vacate/BO Date', type: 'date' },
  { key: 'prelim_inspection_date', label: 'Prelim Insp.', type: 'date' },
  { key: 'take_on_back_date', label: 'Take-on/back', type: 'date' },
  { key: 'first_trade_date', label: 'First Trade', type: 'date' },
  { key: 'comment', label: 'Comment', type: 'text' },
];

const BREACH_COLS: GridColumn[] = [
  { key: 'tenant_name', label: 'Tenant', type: 'text' },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'time', label: 'Time', type: 'text' },
  { key: 'letter_sent_to', label: 'Letter Sent To', type: 'text' },
  { key: 'comment', label: 'Comment', type: 'text' },
];

const ARREARS_COLS: GridColumn[] = [
  { key: 'trading_as', label: 'Trading As', type: 'text' },
  { key: 'deposit_held', label: 'Deposit Held', type: 'number' },
  { key: 'closing_balance', label: 'Closing Balance', type: 'number' },
  { key: 'contact', label: 'Contact', type: 'text' },
];

const INCIDENT_TYPES = [
  'arrests', 'sexual_harassment', 'after_hours_break_in', 'attempted_motor_theft', 'motor_theft',
  'break_in_theft', 'snatch_and_grab', 'weapon_discharge', 'motor_accident', 'armed_robbery',
  'robbery', 'unsecure_premises', 'shoplifting', 'assault_fight', 'lost_property', 'property_damage',
  'medical', 'fraud', 'refuse_to_pay', 'theft', 'vehicle_jamming', 'drinking_in_public',
  'public_indecency', 'atm_robbery', 'atm_bombing', 'cable_theft', 'malicious_damage', 'other',
];
const INCIDENT_COLS: GridColumn[] = [
  { key: 'incident_type', label: 'Type', type: 'select', options: INCIDENT_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })) },
  { key: 'period', label: 'Month', type: 'date' },
  { key: 'count', label: 'Count', type: 'number' },
  { key: 'narrative', label: 'Narrative', type: 'text' },
];

const CAPEX_COLS: GridColumn[] = [
  { key: 'item', label: 'Item', type: 'text' },
  { key: 'motivation', label: 'Motivation', type: 'text' },
  { key: 'estimate', label: 'Estimate', type: 'number', format: (v) => formatZAR(v as number) },
  { key: 'year', label: 'Year', type: 'number' },
  { key: 'priority', label: 'Priority', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
];

const CATEGORY_TURNOVER_COLS: GridColumn[] = [
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'monthly_turnover', label: 'Monthly TO', type: 'number' },
  { key: 'trading_density', label: 'Trading Density', type: 'number' },
  { key: 'rank', label: 'Rank', type: 'number' },
  { key: 'comment', label: 'Comment', type: 'text' },
];

const LOCAL_RESOURCES_COLS: GridColumn[] = [
  { key: 'resource_type', label: 'Type', type: 'select', options: [{ value: 'cpf', label: 'CPF' }, { value: 'police', label: 'Police' }, { value: 'authority', label: 'Authority' }] },
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'last_meeting_date', label: 'Last Meeting', type: 'date' },
  { key: 'frequency', label: 'Frequency', type: 'text' },
  { key: 'contact_person', label: 'Contact', type: 'text' },
  { key: 'contact_number', label: 'Number', type: 'text' },
];

const CHECKLIST_COLS: GridColumn[] = [
  { key: 'section_key', label: 'Section', type: 'text' },
  { key: 'item_key', label: 'Item', type: 'text' },
  { key: 'value_text', label: 'Value', type: 'text' },
  { key: 'value_date', label: 'Date', type: 'date' },
  { key: 'response', label: 'Y/N/NA', type: 'tristate' },
  { key: 'comment', label: 'Comment', type: 'text' },
];

// ---- Section components ------------------------------------------------------
export const ExpenseRecoveriesSection = (p: SectionProps) =>
  <EditableGrid {...p} table="expense_recoveries" title="Expense Recoveries" hint="YTD expense vs recovery per service. % recovery is computed." columns={EXPENSE_COLS} addLabel="Add service" />;

export const MasterfileSection = (p: SectionProps) =>
  <EditableGrid {...p} table="masterfile_items" title="Masterfile" hint="Document completeness register." columns={MASTERFILE_COLS} addLabel="Add document" />;

export const TurnoverSection = (p: SectionProps) =>
  <EditableGrid {...p} table="tenant_turnover" title="Turnover" hint="Per-tenant trading density, COO and growth." columns={TURNOVER_COLS} addLabel="Add tenant" />;

export const SecurityIncidentsSection = (p: SectionProps) =>
  <EditableGrid {...p} table="security_incidents" title="Security Incidents" hint="Monthly incident counts by type." columns={INCIDENT_COLS} addLabel="Add incident type" />;

export const CapexSection = (p: SectionProps) =>
  <EditableGrid {...p} table="capex_items" title="Capex Register" hint="Capital expenditure motivations." columns={CAPEX_COLS} addLabel="Add capex item" />;

export const UtilitiesSection = (p: SectionProps) => (
  <div className="space-y-6">
    <EditableGrid {...p} table="utility_readings" title="Utility Readings" hint="Meter readings by category." columns={UTIL_READING_COLS} addLabel="Add meter" />
    <EditableGrid {...p} table="utility_yields" title="Borehole / Solar Yields" hint="Predicted vs actual. % achieved is computed." columns={UTIL_YIELD_COLS} addLabel="Add source" />
  </div>
);

export const FootfallToiletSection = (p: SectionProps) => (
  <div className="space-y-6">
    <EditableGrid {...p} table="footfall_counts" title="Footfall" hint="Entrance counts." columns={FOOTFALL_COLS} addLabel="Add entrance" />
    <EditableGrid {...p} table="toilet_fund" title="Toilet Fund" hint="Banked vs budget." columns={TOILET_COLS} addLabel="Add row" />
  </div>
);

export const LeasingSection = (p: SectionProps) => (
  <div className="space-y-6">
    <EditableGrid {...p} table="vacancies" title="Vacancies" hint="Available shops." columns={VACANCY_COLS} addLabel="Add vacancy" />
    <EditableGrid {...p} table="leasing_waitlist" title="Leasing Waitlist" hint="Prospective tenants." columns={WAITLIST_COLS} addLabel="Add prospect" />
    <EditableGrid {...p} table="tenant_movements" title="Tenant Movements" hint="New / vacate / beneficial occupation." columns={MOVEMENT_COLS} addLabel="Add movement" />
  </div>
);

export const TradingArrearsSection = (p: SectionProps) => (
  <div className="space-y-6">
    <EditableGrid {...p} table="trading_hour_breaches" title="Trading Hour Breaches" hint="After-hours / non-trading." columns={BREACH_COLS} addLabel="Add breach" />
    <EditableGrid {...p} table="tenant_arrears" title="Tenant Arrears" hint="Closing balances." columns={ARREARS_COLS} addLabel="Add tenant" />
  </div>
);

export const UtilityManagementSection = (p: SectionProps) => (
  <div className="space-y-6">
    <EditableGrid {...p} table="loadshedding_log" title="Loadshedding" hint="Per-day stage and diesel." columns={LOADSHED_COLS} addLabel="Add day" />
    <EditableGrid {...p} table="service_interruptions" title="Service Interruptions" hint="Municipal interruptions." columns={INTERRUPTION_COLS} addLabel="Add interruption" />
  </div>
);

export const CategoryTurnoverSection = (p: SectionProps) =>
  <EditableGrid {...p} table="category_turnover" title="Top Categories" hint="Top-5 performing categories by turnover." columns={CATEGORY_TURNOVER_COLS} addLabel="Add category" />;

export const LocalResourcesSection = (p: SectionProps) =>
  <EditableGrid {...p} table="local_resources_contacts" title="Local Resources" hint="CPF / Police / Authority contacts & meetings." columns={LOCAL_RESOURCES_COLS} addLabel="Add contact" />;

export const ReportChecklistSection = (p: SectionProps) =>
  <EditableGrid {...p} table="report_checklist_items" title="General Checklist" hint="Site-visit / inspection / asset-register checklist items." columns={CHECKLIST_COLS} addLabel="Add item" />;
