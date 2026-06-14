/**
 * Section key → component registry. Sections are registered here; the editor renders
 * the matching component or a friendly placeholder for keys not yet implemented.
 * Adding a section = add a file in this folder and one line here.
 */
import type { ComponentType } from 'react';
import type { SectionProps } from './types';
import OperationalOverviewSection from './OperationalOverviewSection';
import ComplianceSection from './ComplianceSection';
import BuildingInspectionSection from './BuildingInspectionSection';
import BuildingOverviewSection from './BuildingOverviewSection';
import PpmSection from './PpmSection';
import ConditionInspectionSection from './ConditionInspectionSection';
import TenantComplianceSection from './TenantComplianceSection';
import ShopSpecSection from './ShopSpecSection';
import BuildingTurnoverSection from './BuildingTurnoverSection';
import {
  ExpenseRecoveriesSection,
  MasterfileSection,
  TurnoverSection,
  SecurityIncidentsSection,
  CapexSection,
  UtilitiesSection,
  FootfallToiletSection,
  LeasingSection,
  TradingArrearsSection,
  UtilityManagementSection,
  CategoryTurnoverSection,
  LocalResourcesSection,
  ReportChecklistSection,
} from './gridSections';

export const SECTION_REGISTRY: Record<string, ComponentType<SectionProps>> = {
  // OPS
  operational_overview: OperationalOverviewSection,
  ohs_compliance: ComplianceSection,
  building_inspection: BuildingInspectionSection,
  expense_recoveries: ExpenseRecoveriesSection,
  utilities: UtilitiesSection,
  ppm: PpmSection,
  masterfile: MasterfileSection,
  // CM
  building_overview: BuildingOverviewSection,
  turnover: TurnoverSection,
  footfall_toilet: FootfallToiletSection,
  leasing: LeasingSection,
  trading_arrears: TradingArrearsSection,
  utility_management: UtilityManagementSection,
  tenant_compliance: TenantComplianceSection,
  shop_spec: ShopSpecSection,
  security_incidents: SecurityIncidentsSection,
  building_turnover: BuildingTurnoverSection,
  category_turnover: CategoryTurnoverSection,
  local_resources: LocalResourcesSection,
  report_checklist: ReportChecklistSection,
  // Annual
  condition_inspection: ConditionInspectionSection,
  capex: CapexSection,
};

export function getSectionComponent(key: string): ComponentType<SectionProps> | undefined {
  return SECTION_REGISTRY[key];
}
