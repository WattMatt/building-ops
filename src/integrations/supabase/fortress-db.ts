/**
 * Fortress reporting data access.
 *
 * The Fortress reporting tables (reports + section tables + template banks) are
 * additive and live in the same Postgres/Supabase project as the rest of the app.
 * We reuse the SAME runtime client (one auth session, one connection) but expose a
 * view of it typed against `FortressDatabase` so queries against the new tables are
 * fully type-checked. `./types.ts` is left untouched because it carries prod-only
 * `profiles` columns the app depends on — see fortress-types.ts header.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './client';
import type { FortressDatabase } from './fortress-types';

// Same client instance, re-typed to the Fortress schema.
export const fdb = supabase as unknown as SupabaseClient<FortressDatabase>;

type PublicSchema = FortressDatabase['public'];
export type FRow<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type FInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type FUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];
export type FViewRow<T extends keyof PublicSchema['Views']> = PublicSchema['Views'][T]['Row'];
export type FTableName = keyof PublicSchema['Tables'];

// ---- Convenience row aliases (used across hooks + section forms) -------------
export type Report = FRow<'reports'>;
export type ReportNarrative = FRow<'report_narratives'>;

export type ComplianceTemplate = FRow<'compliance_templates'>;
export type ComplianceTemplateItem = FRow<'compliance_template_items'>;
export type ComplianceAssessment = FRow<'compliance_assessments'>;
export type ComplianceResponse = FRow<'compliance_responses'>;

export type InspectionTemplate = FRow<'inspection_templates'>;
export type InspectionTemplateItem = FRow<'inspection_template_items'>;
export type BuildingInspection = FRow<'building_inspections'>;
export type InspectionResponse = FRow<'inspection_responses'>;

export type ExpenseRecovery = FRow<'expense_recoveries'>;
export type UtilityReading = FRow<'utility_readings'>;
export type UtilityYield = FRow<'utility_yields'>;
export type LoadsheddingLog = FRow<'loadshedding_log'>;
export type ServiceInterruption = FRow<'service_interruptions'>;
export type MasterfileItem = FRow<'masterfile_items'>;

export type TenantTurnover = FRow<'tenant_turnover'>;
export type FootfallCount = FRow<'footfall_counts'>;
export type ToiletFund = FRow<'toilet_fund'>;
export type Vacancy = FRow<'vacancies'>;
export type LeasingWaitlist = FRow<'leasing_waitlist'>;
export type TenantMovement = FRow<'tenant_movements'>;
export type TradingHourBreach = FRow<'trading_hour_breaches'>;
export type TenantArrears = FRow<'tenant_arrears'>;
export type SecurityIncident = FRow<'security_incidents'>;
export type CapexItem = FRow<'capex_items'>;

export type TenantCompliance = FRow<'tenant_compliance'>;
export type TenantShopSpec = FRow<'tenant_shop_spec'>;

// §6 delta tables (sql/2026-06-13_15.._18)
export type BuildingTurnover = FRow<'building_turnover'>;
export type CategoryTurnover = FRow<'category_turnover'>;
export type HazardLog = FRow<'hazard_log'>;
export type ReportChecklistItem = FRow<'report_checklist_items'>;
export type LocalResourceContact = FRow<'local_resources_contacts'>;
export type InspectionSubitem = FRow<'inspection_subitems'>;
export type BuildingTurnoverGrowth = FViewRow<'v_building_turnover'>;

export type ComplianceScore = FViewRow<'compliance_scores'>;
export type ComplianceSectionScore = FViewRow<'compliance_section_scores'>;
export type ComplianceCriticalScore = FViewRow<'compliance_critical_scores'>;
export type PpmMonthlyStatus = FViewRow<'ppm_monthly_status'>;

// ---- Domain enums (mirror the DB CHECK constraints; no pg enum exists) -------
export type ReportType = 'ops_monthly' | 'cm_monthly' | 'annual_inspection';
export type ReportStatus = 'draft' | 'submitted' | 'reviewed' | 'approved' | 'rejected';
export type YesNoNa = 'yes' | 'no' | 'na';
export type ConditionRating = 'good' | 'fair' | 'poor' | 'critical';
export type ActionRequired = 'none' | 'within_3_months' | 'immediate';

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  ops_monthly: 'Monthly OPS Report',
  cm_monthly: 'Monthly CM Report',
  annual_inspection: 'Annual Inspection',
};
