import { describe, it, expect } from 'vitest';
import { safeInAppUrl, PUSH_URL_PREFIXES, PUSH_URL_MAX, PUSH_FALLBACK_URL } from './pushUrl';
import { ALLOWED_URL_PREFIXES, URL_MAX, isAllowedUrl } from '../../supabase/functions/_shared/notifyRules';

describe('safeInAppUrl', () => {
  // [input, expected]. Anything not allowlisted falls back to the inbox.
  const TABLE: [unknown, string][] = [
    ['/issues', '/issues'],
    ['/issues?open=abc', '/issues?open=abc'],
    ['/issues/', '/issues/'],
    ['/buildings/123?tab=checklists', '/buildings/123?tab=checklists'],
    ['/reports/fortress/abc', '/reports/fortress/abc'],
    ['/my-signoffs', '/my-signoffs'],
    ['/forms', '/forms'],
    ['/inbox', '/inbox'],
    ['/my-day', '/my-day'],
    ['/my-day?d=2026-09-10', '/my-day?d=2026-09-10'],
    ['/calendar', '/calendar'],
    ['/calendar?date=2026-09-10&view=week', '/calendar?date=2026-09-10&view=week'],
    ['/contractors', '/contractors'],
    ['/contractors?open=abc', '/contractors?open=abc'],
    // A bare prefix is a route boundary, not a free-text prefix.
    ['/my-dayx', '/inbox'],
    ['/calendarx', '/inbox'],
    ['/contractorsx', '/inbox'],
    ['/issuesanything', '/inbox'],
    ['/inboxx', '/inbox'],
    ['/buildingsx', '/inbox'],
    // Not on the allowlist, however in-app it looks.
    ['/settings', '/inbox'],
    ['/', '/inbox'],
    ['', '/inbox'],
    // Off-site, or a path that resolves off-site once a browser normalises it.
    ['//evil.example/issues', '/inbox'],
    ['/issues\\evil', '/inbox'],
    ['https://evil.example/issues', '/inbox'],
    ['javascript:alert(1)', '/inbox'],
    // Not a string at all: the payload is untrusted JSON.
    [undefined, '/inbox'],
    [null, '/inbox'],
    [42, '/inbox'],
    [{ url: '/issues' }, '/inbox'],
    [['/issues'], '/inbox'],
  ];

  it.each(TABLE)('%j -> %s', (url, expected) => {
    expect(safeInAppUrl(url)).toBe(expected);
  });

  it('accepts a url of exactly the maximum length and rejects one over it', () => {
    const max = `/issues?${'a'.repeat(PUSH_URL_MAX - '/issues?'.length)}`;
    expect(max).toHaveLength(PUSH_URL_MAX);
    expect(safeInAppUrl(max)).toBe(max);
    expect(safeInAppUrl(`${max}a`)).toBe(PUSH_FALLBACK_URL);
  });

  it('never throws on garbage', () => {
    for (const v of [Symbol('x'), () => '/issues', 10n, NaN, new Date()]) {
      expect(() => safeInAppUrl(v)).not.toThrow();
      expect(safeInAppUrl(v)).toBe(PUSH_FALLBACK_URL);
    }
  });
});

// The service worker cannot import the Deno module, so the rules are copied. These tests are
// the tripwire: change one side and this fails until the other side matches.
describe('parity with notifyRules.isAllowedUrl', () => {
  it('uses the same prefix list, in the same order', () => {
    expect([...PUSH_URL_PREFIXES]).toEqual([...ALLOWED_URL_PREFIXES]);
  });

  it('uses the same maximum length', () => {
    expect(PUSH_URL_MAX).toBe(URL_MAX);
  });

  it('accepts exactly what isAllowedUrl accepts', () => {
    const probes = [
      '/issues', '/issues?open=x', '/issues/', '/issuesanything', '/buildings/', '/buildings/abc',
      '/buildingsx', '/reports/fortress/', '/reports/fortress/r1', '/reports/fortressx',
      '/my-signoffs', '/my-signoffsx', '/forms', '/forms/1', '/formsx', '/inbox', '/inbox?x=1',
      '/inboxx', '/my-day', '/my-day?d=1', '/my-day/', '/my-dayx', '/calendar', '/calendar?date=1&view=week',
      '/calendarx', '/contractors', '/contractors?open=1', '/contractorsx', '/settings', '/', '',
      '//evil.example/issues', '/issues\\evil', 'https://x/issues', ' /issues',
      `/issues?${'a'.repeat(292)}`, `/issues?${'a'.repeat(293)}`,
      // Every prefix, on its own and followed by each boundary character.
      ...ALLOWED_URL_PREFIXES.flatMap((p) => [p, `${p}/`, `${p}?a=1`, `${p}x`]),
    ];
    for (const url of probes) {
      expect(safeInAppUrl(url), url).toBe(isAllowedUrl(url) ? url : PUSH_FALLBACK_URL);
    }
  });
});
