export interface DocumentTypeOption {
  value: string;
  label: string;
}

export const DOCUMENT_TYPES: DocumentTypeOption[] = [
  { value: 'compliance_certificate', label: 'Compliance Certificate' },
  { value: 'fire_certificate', label: 'Fire Certificate' },
  { value: 'electrical_coc', label: 'Electrical COC' },
  { value: 'occupancy_certificate', label: 'Occupancy Certificate' },
  { value: 'insurance', label: 'Insurance Policy' },
  { value: 'floor_plan', label: 'Floor Plan' },
  { value: 'building_plan', label: 'Building Plan' },
  { value: 'municipal_rates', label: 'Municipal Rates' },
  { value: 'water_certificate', label: 'Water Certificate' },
  { value: 'gas_certificate', label: 'Gas Certificate' },
  { value: 'lift_certificate', label: 'Lift Certificate' },
  { value: 'other', label: 'Other' },
];

export function getTypeLabel(value: string): string {
  return DOCUMENT_TYPES.find((t) => t.value === value)?.label ?? value;
}
