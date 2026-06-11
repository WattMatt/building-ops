import { describe, it, expect } from 'vitest';
import { templateAppliesToBuilding, categoryMeta, COMPLIANCE_CATEGORIES, BUILDING_TYPES } from './compliance';

describe('templateAppliesToBuilding', () => {
  it('null applies_to matches any building, typed or not', () => {
    expect(templateAppliesToBuilding(null, 'office')).toBe(true);
    expect(templateAppliesToBuilding(null, null)).toBe(true);
  });
  it('scoped template matches listed type', () => {
    expect(templateAppliesToBuilding(['retail', 'mixed_use'], 'retail')).toBe(true);
    expect(templateAppliesToBuilding(['retail', 'mixed_use'], 'mixed_use')).toBe(true);
  });
  it('scoped template rejects other types and untyped buildings', () => {
    expect(templateAppliesToBuilding(['retail', 'mixed_use'], 'office')).toBe(false);
    expect(templateAppliesToBuilding(['retail', 'mixed_use'], null)).toBe(false);
  });
  it('empty array behaves like null (applies to all)', () => {
    expect(templateAppliesToBuilding([], 'office')).toBe(true);
  });
});

describe('categoryMeta', () => {
  it('returns meta for known categories and null for unknown', () => {
    expect(categoryMeta('fire_safety')?.label).toBe('Fire Safety');
    expect(categoryMeta('nonsense')).toBeNull();
    expect(categoryMeta(null)).toBeNull();
  });
  it('has 9 categories and 4 building types per spec', () => {
    expect(COMPLIANCE_CATEGORIES).toHaveLength(9);
    expect(BUILDING_TYPES).toHaveLength(4);
  });
});
