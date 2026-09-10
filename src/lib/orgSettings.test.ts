import { describe, it, expect } from 'vitest';
import { DEFAULT_ORG_SETTINGS, parseOrgSettings } from './orgSettings';

describe('parseOrgSettings', () => {
  it('returns the defaults for null, {}, arrays and garbage', () => {
    for (const raw of [null, undefined, {}, [], 'x', 42]) expect(parseOrgSettings(raw)).toEqual(DEFAULT_ORG_SETTINGS);
  });
  it('keeps valid overrides and fills the rest', () => {
    const s = parseOrgSettings({ sla_hours: { critical: 2 }, features: { share_links: true }, report_due_day: 10 });
    expect(s.sla_hours).toEqual({ critical: 2, high: 24, medium: 72, low: 168 });
    expect(s.features).toEqual({ share_links: true, report_schedules: false, tenant_intake: false });
    expect(s.report_due_day).toBe(10);
  });
  it('clamps and coerces', () => {
    const s = parseOrgSettings({ sla_hours: { critical: '0', low: 99999, medium: 'abc' }, report_due_day: 31.6, features: { tenant_intake: 'yes' } });
    expect(s.sla_hours.critical).toBe(1);
    expect(s.sla_hours.low).toBe(8760);
    expect(s.sla_hours.medium).toBe(72);
    expect(s.report_due_day).toBe(28);
    expect(s.features.tenant_intake).toBe(false);
  });
  it('trims distribution_from and nulls an empty one', () => {
    expect(parseOrgSettings({ distribution_from: '  Ops Team  ' }).distribution_from).toBe('Ops Team');
    expect(parseOrgSettings({ distribution_from: '   ' }).distribution_from).toBeNull();
  });
});
