import type { UnifiedDocument, DocSource, StatusKind } from './types';

export type GroupBy = 'section' | 'type' | 'source' | 'status' | 'none';

export interface DocFilters {
  source: DocSource | 'all';
  type: string | 'all'; // matches typeValue
  status: StatusKind | 'all';
  shop: string | 'all'; // matches shopNumber
}

/** A category sub-group within a section. `label: null` means render the docs with no sub-header. */
export interface DocSubGroup {
  label: string | null;
  docs: UnifiedDocument[];
}

/** A primary section (Building / a Shop / Site-level, or a single group for flat modes). */
export interface DocSection {
  label: string;
  count: number;
  subgroups: DocSubGroup[];
}

const MAX = Number.MAX_SAFE_INTEGER;

const byName = (a: UnifiedDocument, b: UnifiedDocument) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

const byLabel = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function searchDocuments(docs: UnifiedDocument[], query: string): UnifiedDocument[] {
  const q = query.trim().toLowerCase();
  if (!q) return docs;
  return docs.filter((d) =>
    [d.name, d.type, d.shopNumber ?? '', d.tenantName ?? '', d.shopName ?? ''].some((f) =>
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

function digits(s: string | null): number {
  if (!s) return NaN;
  const m = s.replace(/\D/g, '');
  return m ? parseInt(m, 10) : NaN;
}

/** Which primary section a document belongs to, and its sort rank. */
function sectionInfo(d: UnifiedDocument): { label: string; rank: number } {
  if (d.source === 'managed') return { label: 'Building documents', rank: 0 };
  if (d.scope === 'site') return { label: 'Site-level documents', rank: MAX };
  const num = !Number.isNaN(digits(d.shopNumber)) ? digits(d.shopNumber) : digits(d.shopName);
  const rank = Number.isNaN(num) ? MAX - 1 : 100 + num; // shops sit between building (0) and site (MAX)
  const base = d.shopName ?? (d.shopNumber ? `Shop ${d.shopNumber}` : 'Shop');
  const label = d.tenantName && d.tenantName !== base ? `${base} · ${d.tenantName}` : base;
  return { label, rank };
}

/** Two-level: section -> category sub-group (in source order). */
function groupBySection(docs: UnifiedDocument[]): DocSection[] {
  interface Cat {
    order: number;
    docs: UnifiedDocument[];
  }
  const secs = new Map<string, { rank: number; cats: Map<string, Cat> }>();

  for (const d of docs) {
    const { label, rank } = sectionInfo(d);
    let sec = secs.get(label);
    if (!sec) {
      sec = { rank, cats: new Map() };
      secs.set(label, sec);
    }
    // Managed building docs render flat (no category sub-headers); IL docs group by category.
    const catLabel = d.source === 'managed' ? null : d.type;
    const catKey = catLabel ?? '__flat__';
    let cat = sec.cats.get(catKey);
    if (!cat) {
      cat = { order: d.categoryOrder ?? MAX, docs: [] };
      sec.cats.set(catKey, cat);
    } else if (d.categoryOrder != null && d.categoryOrder < cat.order) {
      cat.order = d.categoryOrder;
    }
    cat.docs.push(d);
  }

  return [...secs.entries()]
    .sort((a, b) => a[1].rank - b[1].rank || byLabel(a[0], b[0]))
    .map(([label, sec]) => {
      const subgroups = [...sec.cats.entries()]
        .map(([catKey, cat]) => ({
          label: catKey === '__flat__' ? null : catKey,
          order: cat.order,
          docs: [...cat.docs].sort(byName),
        }))
        .sort((a, b) => a.order - b.order || byLabel(a.label ?? '', b.label ?? ''))
        .map(({ label: l, docs: ds }) => ({ label: l, docs: ds }));
      const count = subgroups.reduce((n, s) => n + s.docs.length, 0);
      return { label, count, subgroups };
    });
}

/** Single-level: one section per key, each with a single unlabelled sub-group. */
function groupFlat(docs: UnifiedDocument[], groupBy: 'type' | 'source' | 'status'): DocSection[] {
  const keyOf = (d: UnifiedDocument): string =>
    groupBy === 'type'
      ? d.type
      : groupBy === 'source'
        ? d.source === 'managed'
          ? 'Managed here (editable)'
          : 'Insight-linker (live, read-only)'
        : d.status.label;

  const map = new Map<string, UnifiedDocument[]>();
  for (const d of docs) {
    const k = keyOf(d);
    (map.get(k) ?? map.set(k, []).get(k)!).push(d);
  }

  const kindRank: Record<StatusKind, number> = { danger: 0, warning: 1, success: 2, neutral: 3 };
  const minCatOrder = (ds: UnifiedDocument[]) =>
    Math.min(...ds.map((d) => d.categoryOrder ?? MAX));

  const entries = [...map.entries()].sort((a, b) => {
    if (groupBy === 'type') return minCatOrder(a[1]) - minCatOrder(b[1]) || byLabel(a[0], b[0]);
    if (groupBy === 'source') return (a[0].startsWith('Managed') ? 0 : 1) - (b[0].startsWith('Managed') ? 0 : 1);
    return kindRank[a[1][0].status.kind] - kindRank[b[1][0].status.kind] || byLabel(a[0], b[0]);
  });

  return entries.map(([label, ds]) => ({
    label,
    count: ds.length,
    subgroups: [{ label: null, docs: [...ds].sort(byName) }],
  }));
}

export function groupDocuments(docs: UnifiedDocument[], groupBy: GroupBy): DocSection[] {
  if (groupBy === 'section') return groupBySection(docs);
  if (groupBy === 'none') {
    return [{ label: 'All documents', count: docs.length, subgroups: [{ label: null, docs: [...docs].sort(byName) }] }];
  }
  return groupFlat(docs, groupBy);
}

export function needAttentionCount(docs: UnifiedDocument[]): number {
  return docs.filter((d) => d.status.kind === 'danger' || d.status.kind === 'warning').length;
}
