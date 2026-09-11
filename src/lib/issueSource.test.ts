import { describe, it, expect } from 'vitest';
import { isTenantIssue, parseReporter, reporterSummary, TENANT_SOURCE } from './issueSource';

describe('parseReporter', () => {
  it('rejects anything that is not a reporter object', () => {
    expect(parseReporter(null)).toBeNull();
    expect(parseReporter(undefined)).toBeNull();
    expect(parseReporter('Thandi')).toBeNull();
    expect(parseReporter([{ name: 'Thandi' }])).toBeNull();
    expect(parseReporter({})).toBeNull();
    // A blank name is no name: the reporter block would render an empty line.
    expect(parseReporter({ name: '   ' })).toBeNull();
  });

  it('trims the values it keeps and nulls everything missing or blank', () => {
    expect(parseReporter({ name: '  Thandi  ', shop_number: ' 12 ', phone: '', email: 'a@b.co' })).toEqual({
      name: 'Thandi',
      shop_number: '12',
      shop: null,
      unit: null,
      phone: null,
      email: 'a@b.co',
    });
  });

  it('ignores non-string values on the known keys', () => {
    expect(parseReporter({ name: 'Thandi', shop_number: 12, unit: { a: 1 } })).toEqual({
      name: 'Thandi', shop_number: null, shop: null, unit: null, phone: null, email: null,
    });
  });
});

describe('reporterSummary', () => {
  const base = { name: 'Thandi', shop_number: null, shop: null, unit: null, phone: null, email: null };

  it('falls back to "Tenant" when there is no reporter', () => {
    expect(reporterSummary(null)).toBe('Tenant');
    expect(reporterSummary(undefined)).toBe('Tenant');
  });

  it('names the shop and its number together when both are known', () => {
    expect(reporterSummary({ ...base, shop: 'Kool Kids', shop_number: '12', unit: 'G12' }))
      .toBe('Thandi · Kool Kids (Shop 12) · Unit G12');
  });

  it('uses whichever of the shop name and number it has', () => {
    expect(reporterSummary({ ...base, shop: 'Kool Kids' })).toBe('Thandi · Kool Kids');
    expect(reporterSummary({ ...base, shop_number: '12' })).toBe('Thandi · Shop 12');
    expect(reporterSummary(base)).toBe('Thandi');
  });
});

describe('isTenantIssue', () => {
  it('is true only for the tenant_intake source', () => {
    expect(isTenantIssue({ source: TENANT_SOURCE })).toBe(true);
    expect(isTenantIssue({ source: 'app' })).toBe(false);
    expect(isTenantIssue({ source: null })).toBe(false);
    expect(isTenantIssue({})).toBe(false);
  });
});
