import type { UnifiedDocument, DocSource, StatusKind, DocScope } from './types';

export type GroupBy = 'source' | 'type' | 'shop' | 'status' | 'scope' | 'none';

export interface DocFilters {
  source: DocSource | 'all';
  type: string | 'all'; // matches typeValue
  status: StatusKind | 'all';
  shop: string | 'all'; // matches shopNumber
}

export interface DocGroup {
  label: string;
  docs: UnifiedDocument[];
}

const byName = (a: UnifiedDocument, b: UnifiedDocument) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

export function searchDocuments(docs: UnifiedDocument[], query: string): UnifiedDocument[] {
  const q = query.trim().toLowerCase();
  if (!q) return docs;
  return docs.filter((d) =>
    [d.name, d.type, d.shopNumber ?? '', d.tenantName ?? ''].some((f) =>
      f.toLowerCase().includes(q),
    ),
  );
}

export function applyFilters(docs: UnifiedDocument[], f: DocFilters): UnifiedDocument[] {
  return docs.filter(
    (d) =>
      (f.source === 'all' || d.source === f.source) &&
      (f.type === 'all' || d.typeValue === f.type) &&
      (f.status === 'all' || d.status.kind === f.status) &&
      (f.shop === 'all' || (d.shopNumber ?? '') === f.shop),
  );
}

const SCOPE_LABEL: Record<DocScope, string> = {
  building: 'Building',
  shop: 'Shop',
  site: 'Site-level',
};

export function groupDocuments(docs: UnifiedDocument[], groupBy: GroupBy): DocGroup[] {
  const sorted = [...docs].sort(byName);
  if (groupBy === 'none') return [{ label: 'All documents', docs: sorted }];

  if (groupBy === 'source') {
    const managed = sorted.filter((d) => d.source === 'managed');
    const il = sorted.filter((d) => d.source === 'insight_linker');
    const groups: DocGroup[] = [];
    if (managed.length) groups.push({ label: 'Managed here (editable)', docs: managed });
    if (il.length) groups.push({ label: 'Insight-linker (live, read-only)', docs: il });
    return groups;
  }

  const keyFn = (d: UnifiedDocument): string => {
    switch (groupBy) {
      case 'type':
        return d.type;
      case 'shop':
        return d.scope === 'shop'
          ? `Shop ${d.shopNumber ?? '—'}${d.tenantName ? ` · ${d.tenantName}` : ''}`
          : SCOPE_LABEL[d.scope];
      case 'status':
        return d.status.label;
      case 'scope':
        return SCOPE_LABEL[d.scope];
      default:
        return 'All documents';
    }
  };

  const map = new Map<string, UnifiedDocument[]>();
  for (const d of sorted) {
    const k = keyFn(d);
    (map.get(k) ?? map.set(k, []).get(k)!).push(d);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([label, ds]) => ({ label, docs: ds }));
}

export function needAttentionCount(docs: UnifiedDocument[]): number {
  return docs.filter((d) => d.status.kind === 'danger' || d.status.kind === 'warning').length;
}
