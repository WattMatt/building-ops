export const BUILDING_TYPES = [
  { value: 'office', label: 'Office / Commercial' },
  { value: 'retail', label: 'Retail / Shopping Centre' },
  { value: 'industrial', label: 'Industrial / Warehousing' },
  { value: 'mixed_use', label: 'Mixed Use' },
] as const;

export type BuildingType = (typeof BUILDING_TYPES)[number]['value'];

export const COMPLIANCE_CATEGORIES = [
  { value: 'fire_safety', label: 'Fire Safety', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' },
  { value: 'electrical', label: 'Electrical', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300' },
  { value: 'emergency_preparedness', label: 'Emergency Preparedness', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300' },
  { value: 'occupational_safety', label: 'Occupational Safety', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' },
  { value: 'public_liability', label: 'Public Liability', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300' },
  { value: 'security', label: 'Security', color: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300' },
  { value: 'water_systems', label: 'Water Systems', color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300' },
  { value: 'statutory_certificates', label: 'Statutory Certificates', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300' },
  { value: 'housekeeping', label: 'Housekeeping', color: 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-300' },
] as const;

export type ComplianceCategory = (typeof COMPLIANCE_CATEGORIES)[number]['value'];

export function categoryMeta(value: string | null | undefined) {
  if (!value) return null;
  return COMPLIANCE_CATEGORIES.find((c) => c.value === value) ?? null;
}

/**
 * Mirrors the generator's SQL: `applies_to_building_types is null or building_type = any(...)`.
 * null = applies to every building; an EMPTY array matches nothing (`= any('{}')` is never true),
 * so the UI must not read `[]` as "all". The dialog writes null, never `[]`, for "every building".
 */
export function templateAppliesToBuilding(
  appliesTo: string[] | null | undefined,
  buildingType: string | null | undefined
): boolean {
  if (appliesTo == null) return true;
  if (!buildingType) return false;
  return appliesTo.includes(buildingType);
}
