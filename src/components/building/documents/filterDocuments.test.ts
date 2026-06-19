import { describe, it, expect } from 'vitest';
import {
  searchDocuments,
  applyFilters,
  groupDocuments,
  needAttentionCount,
  type DocFilters,
} from './filterDocuments';
import type { UnifiedDocument } from './types';

const doc = (over: Partial<UnifiedDocument>): UnifiedDocument => ({
  key: Math.random().toString(),
  source: 'managed',
  name: 'Doc',
  type: 'Fire Certificate',
  typeValue: 'fire_certificate',
  scope: 'building',
  shopNumber: null,
  tenantName: null,
  issueDate: null,
  expiryDate: null,
  status: { label: 'Valid', kind: 'success' },
  sizeBytes: null,
  editable: true,
  managedId: 'x',
  storedUrl: null,
  ...over,
});

const docs: UnifiedDocument[] = [
  doc({ key: 'a', name: 'Fire Cert', source: 'managed', status: { label: 'Expired', kind: 'danger' } }),
  doc({
    key: 'b',
    name: 'SHOP14_COC',
    source: 'insight_linker',
    scope: 'shop',
    shopNumber: '14',
    tenantName: 'Boxer',
    typeValue: '01 coc',
    type: '01 COC',
    status: { label: 'COC fail', kind: 'danger' },
  }),
  doc({
    key: 'c',
    name: 'Site Plan',
    source: 'insight_linker',
    scope: 'site',
    typeValue: 'site plan',
    type: 'Site Plan',
    status: { label: 'Reference', kind: 'neutral' },
  }),
];

const allFilters: DocFilters = { source: 'all', type: 'all', status: 'all', shop: 'all' };

describe('searchDocuments', () => {
  it('matches name, type, shop number and tenant', () => {
    expect(searchDocuments(docs, 'boxer').map((d) => d.key)).toEqual(['b']);
    expect(searchDocuments(docs, '14').map((d) => d.key)).toEqual(['b']);
    expect(searchDocuments(docs, 'fire').map((d) => d.key)).toEqual(['a']);
    expect(searchDocuments(docs, '').map((d) => d.key)).toEqual(['a', 'b', 'c']);
  });
});

describe('applyFilters', () => {
  it('filters by source', () => {
    expect(applyFilters(docs, { ...allFilters, source: 'managed' }).map((d) => d.key)).toEqual(['a']);
  });
  it('filters by status kind', () => {
    expect(applyFilters(docs, { ...allFilters, status: 'danger' }).map((d) => d.key)).toEqual([
      'a',
      'b',
    ]);
  });
  it('filters by shop number', () => {
    expect(applyFilters(docs, { ...allFilters, shop: '14' }).map((d) => d.key)).toEqual(['b']);
  });
});

describe('groupDocuments', () => {
  it('groups by source with editable group first', () => {
    const groups = groupDocuments(docs, 'source');
    expect(groups.map((g) => g.label)).toEqual([
      'Managed here (editable)',
      'Insight-linker (live, read-only)',
    ]);
    expect(groups[0].docs.map((d) => d.key)).toEqual(['a']);
  });
  it('returns a single group for "none"', () => {
    const groups = groupDocuments(docs, 'none');
    expect(groups).toHaveLength(1);
    expect(groups[0].docs).toHaveLength(3);
  });
  it('sorts docs by name within a group', () => {
    const groups = groupDocuments(docs, 'none');
    expect(groups[0].docs.map((d) => d.name)).toEqual(['Fire Cert', 'SHOP14_COC', 'Site Plan']);
  });
});

describe('needAttentionCount', () => {
  it('counts danger + warning statuses', () => {
    expect(needAttentionCount(docs)).toBe(2);
  });
});
