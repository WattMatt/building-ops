import { describe, it, expect } from 'vitest';
import { formatBuildingName } from './buildingName';

describe('formatBuildingName', () => {
  it('uppercases a lowercase name', () => {
    expect(formatBuildingName('broll centre')).toBe('BROLL CENTRE');
  });
  it('uppercases a mixed-case name', () => {
    expect(formatBuildingName('Broll Centre')).toBe('BROLL CENTRE');
  });
  it('leaves an already-uppercase name unchanged', () => {
    expect(formatBuildingName('BROLL CENTRE')).toBe('BROLL CENTRE');
  });
  it('returns empty string for null/undefined/empty', () => {
    expect(formatBuildingName(null)).toBe('');
    expect(formatBuildingName(undefined)).toBe('');
    expect(formatBuildingName('')).toBe('');
  });
  it('preserves digits, punctuation and spacing', () => {
    expect(formatBuildingName('31 a/b shop')).toBe('31 A/B SHOP');
  });
});
