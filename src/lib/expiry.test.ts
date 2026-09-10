import { describe, it, expect } from 'vitest';
import { safeInAppUrl } from './pushUrl';
import {
  BUCKETS, BUCKET_LABELS, KIND_LABELS, bucketOf, countBuckets, expiryPhrase, itemUrl,
  type ExpiringKind,
} from './expiry';

const B = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';

describe('bucketOf', () => {
  it.each([
    [-1, 'expired'], [0, 'd30'], [30, 'd30'], [31, 'd60'], [60, 'd60'], [61, 'd90'], [90, 'd90'], [91, null],
  ] as const)('%i days left -> %s', (days, bucket) => {
    expect(bucketOf(days)).toBe(bucket);
  });

  it('labels every bucket', () => {
    for (const b of BUCKETS) expect(BUCKET_LABELS[b]).toBeTruthy();
  });
});

describe('countBuckets', () => {
  it('counts each bucket and ignores rows beyond 90 days', () => {
    const items = [-5, -1, 0, 7, 30, 31, 45, 61, 90, 91, 200].map((days_left) => ({ days_left }));
    expect(countBuckets(items)).toEqual({ expired: 2, d30: 3, d60: 2, d90: 2 });
  });

  it('returns zeros for no rows', () => {
    expect(countBuckets([])).toEqual({ expired: 0, d30: 0, d60: 0, d90: 0 });
  });
});

describe('itemUrl', () => {
  const TABLE: [ExpiringKind, string | null, string | null, string][] = [
    ['building_document', B, null, `/buildings/${B}?tab=documents`],
    ['tenant_document', B, P, `/buildings/${B}?tab=tenants`],
    ['contractor_document', null, P, `/contractors?open=${P}`],
    ['contractor_document', null, null, '/contractors'],
    ['asset_warranty', B, null, `/buildings/${B}?tab=assets`],
    ['asset_service', B, null, `/buildings/${B}?tab=assets`],
  ];

  it.each(TABLE)('%s -> %s', (kind, building_id, parent_id, expected) => {
    expect(itemUrl({ kind, building_id, parent_id })).toBe(expected);
  });

  // The alert function reuses these URLs in inbox rows, which the push allowlist has to accept.
  it.each(TABLE)('%s url is a safe in-app path', (kind, building_id, parent_id) => {
    const url = itemUrl({ kind, building_id, parent_id });
    expect(safeInAppUrl(url)).toBe(url);
  });

  it('labels every kind', () => {
    for (const kind of TABLE.map((r) => r[0])) expect(KIND_LABELS[kind]).toBeTruthy();
  });
});

describe('expiryPhrase', () => {
  it('phrases documents by days left', () => {
    expect(expiryPhrase({ kind: 'building_document', days_left: 3 })).toBe('expires in 3 days');
    expect(expiryPhrase({ kind: 'tenant_document', days_left: 1 })).toBe('expires in 1 day');
    expect(expiryPhrase({ kind: 'contractor_document', days_left: 0 })).toBe('expires today');
    expect(expiryPhrase({ kind: 'building_document', days_left: -5 })).toBe('expired 5 days ago');
    expect(expiryPhrase({ kind: 'building_document', days_left: -1 })).toBe('expired 1 day ago');
  });

  it('says "warranty" for asset warranties', () => {
    expect(expiryPhrase({ kind: 'asset_warranty', days_left: 12 })).toBe('warranty expires in 12 days');
    expect(expiryPhrase({ kind: 'asset_warranty', days_left: 0 })).toBe('warranty expires today');
    expect(expiryPhrase({ kind: 'asset_warranty', days_left: -2 })).toBe('warranty expired 2 days ago');
  });

  it('says "due" / "overdue" for service dates', () => {
    expect(expiryPhrase({ kind: 'asset_service', days_left: 4 })).toBe('service due in 4 days');
    expect(expiryPhrase({ kind: 'asset_service', days_left: 0 })).toBe('service due today');
    expect(expiryPhrase({ kind: 'asset_service', days_left: -9 })).toBe('service overdue by 9 days');
  });
});
