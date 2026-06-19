# Unified Documents Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the building "Documents" tab in the GMI Operations web app into one unified browser that lists both the GMI-managed register and the read-only insight-linker documents, with search, filter, group, on-screen preview, and download.

**Architecture:** A client-side normalisation layer (`UnifiedDocument`) merges two existing data sources — the `building_documents` table (editable, react-query) and the already-deployed `building_insight_linker(building_id)` RPC (read-only). Pure functions handle mapping/filtering/grouping (unit-tested); focused React components handle the UI. No new SQL migrations, buckets, or path prefixes. The Electrical & Compliance tab and iOS are untouched.

**Tech Stack:** React + TypeScript (Vite), `@tanstack/react-query`, shadcn/ui, lucide-react, sonner (toast), date-fns, Supabase JS. Tests: vitest (`pool: 'forks'`).

---

## Conventions & environment notes (read first)

- **Local test/build reality (from last handoff):** `vite`/`vitest` may be broken on this machine. The reliable local gate is `npx tsc --noEmit`. Where a task says "run vitest", run it if the runner works; otherwise the test still ships and runs remotely. Never claim a test passed without seeing output.
- **No new deps.** Everything used here already exists in the repo.
- **Role gating:** `useAuth()` from `@/contexts/AuthContext` exposes `isAdminOrManager` (boolean) and `user` (`{ id }`). Edit/add/delete UI is shown only when `isAdminOrManager`.
- **Radix Tabs unmount inactive content**, so `DocumentsTab` only mounts when the Documents tab is active → the IL RPC fires only then. No `active` prop needed; keep the existing `{ buildingId }` prop and default export so `BuildingDetails.tsx` needs no change.
- **The bug fix:** never embed/download a managed doc's raw `file_url`. Always pass it through `resolveStorageUrl()` first. Do NOT change the stored URL format (iOS reads the same column). IL URLs are public — use directly.
- **Storage path for uploads stays `documents/<buildingId>/...`** (the storage policy keys off that prefix). Keep using `getPublicUrl()` to populate `file_url` exactly as the current code does.
- **Branch:** do this work on a feature branch off the current deployed branch. Commit after each task. (Push/PR only when the human asks.)

```bash
git checkout -b feat/unified-documents-tab
```

### File structure (created unless noted)

```
src/components/building/
  DocumentsTab.tsx                      # MODIFY (full rewrite — container)
  documents/
    documentTypes.ts                    # managed doc-type list + label lookup
    types.ts                            # UnifiedDocument + status types
    unifyDocuments.ts                   # pure mapper (managed + IL → UnifiedDocument[])
    unifyDocuments.test.ts
    filterDocuments.ts                  # pure search / filter / group / sort
    filterDocuments.test.ts
    resolveDocUrl.ts                    # resolve a UnifiedDocument to a usable URL
    resolveDocUrl.test.ts
    useBuildingDocuments.ts             # react-query: list + insert/update/delete/bulkDelete + multi-upload
  DocumentsToolbar.tsx                  # search + filters + group-by + Add
  DocumentsTable.tsx                    # grouped rows, multi-select, row actions
  DocumentPreviewModal.tsx              # lightbox (PDF iframe / image / download), prev/next
  DocumentFormDialog.tsx                # add/edit + drag-drop multi-upload
```

---

## Task 1: Extract doc-type constants and shared types

**Files:**
- Create: `src/components/building/documents/documentTypes.ts`
- Create: `src/components/building/documents/types.ts`

- [ ] **Step 1: Create `documentTypes.ts`** (moved verbatim from the current inline array, plus a lookup helper)

```ts
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
```

- [ ] **Step 2: Create `types.ts`**

```ts
export type DocSource = 'managed' | 'insight_linker';
export type DocScope = 'building' | 'shop' | 'site';
export type StatusKind = 'success' | 'warning' | 'danger' | 'neutral';

export interface DocStatus {
  label: string;
  kind: StatusKind;
}

/** The shape the managed `building_documents` rows arrive in. */
export interface BuildingDocumentRow {
  id: string;
  building_id: string;
  name: string;
  document_type: string;
  reference_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  issuing_authority: string | null;
  file_url: string | null;
  notes: string | null;
  uploaded_by: string | null;
  created_at: string;
}

/** Normalised, source-agnostic document used throughout the Documents tab UI. */
export interface UnifiedDocument {
  key: string;
  source: DocSource;
  name: string;
  type: string;          // human label (e.g. "Fire Certificate" or "01 COC")
  typeValue: string;     // stable value for the type filter
  scope: DocScope;
  shopNumber: string | null;
  tenantName: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  status: DocStatus;
  sizeBytes: number | null;
  editable: boolean;     // true for managed; false for insight-linker
  managedId: string | null;
  storedUrl: string | null; // managed: file_url (resolve before use); IL: direct public URL
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/building/documents/documentTypes.ts src/components/building/documents/types.ts
git commit -m "feat(documents): extract doc-type constants and unified document types"
```

---

## Task 2: `unifyDocuments` — pure mapper (TDD)

Merges managed rows + the IL RPC payload into `UnifiedDocument[]`, deriving status.

**Files:**
- Create: `src/components/building/documents/unifyDocuments.ts`
- Test: `src/components/building/documents/unifyDocuments.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { unifyDocuments } from './unifyDocuments';
import type { BuildingDocumentRow } from './types';
import type { ILBuilding } from '@/integrations/supabase/insight-linker';

const managedRow = (over: Partial<BuildingDocumentRow> = {}): BuildingDocumentRow => ({
  id: 'm1', building_id: 'b1', name: 'Fire Cert 2026', document_type: 'fire_certificate',
  reference_number: 'FC-1', issue_date: '2026-01-01', expiry_date: '2099-01-01',
  issuing_authority: 'City', file_url: 'https://x/storage/v1/object/public/tenant-documents/documents/b1/a.pdf',
  notes: null, uploaded_by: 'u1', created_at: '2026-01-01', ...over,
});

const ilFixture: ILBuilding = {
  linked: true, fetched_at: '2026-06-19T00:00:00Z',
  shops: [{
    subsection_id: 's14', name: 'SHOP 14', tenant_name: 'Boxer', category: 'Retail',
    meter_serial_number: null, ct_ratio: null, metering_status: null,
    coc: { number: null, status: null, type: null, issue_date: null, expiry: null },
    matched_tenant: { id: 't14', shop_number: '14', shop_name: 'Boxer' },
    documents: [
      { file_name: 'SHOP14_COC.pdf', file_url: 'https://il/pub/shop14_coc.pdf', file_size: 2100000,
        category: '01 COC', coc_type: 'Fixed', coc_status: 'pass', coc_expiry_date: '2027-01-15' },
      { file_name: 'line.pdf', file_url: 'https://il/pub/line.pdf', file_size: 680000,
        category: '03 Line Diagram', coc_type: null, coc_status: null, coc_expiry_date: null },
    ],
    doc_count: 2, photos: [], photo_count: 0,
  }],
  site_documents: [
    { file_name: '08 Site Plan.pdf', file_url: 'https://il/pub/siteplan.pdf', category: 'Site Plan' },
  ],
};

describe('unifyDocuments', () => {
  it('maps managed rows to editable building-scope docs', () => {
    const out = unifyDocuments([managedRow()], undefined);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: 'managed', scope: 'building', editable: true, managedId: 'm1',
      type: 'Fire Certificate', typeValue: 'fire_certificate', name: 'Fire Cert 2026',
    });
    expect(out[0].status.kind).toBe('success'); // far-future expiry
  });

  it('marks an expired managed doc as danger and a soon-to-expire one as warning', () => {
    const past = unifyDocuments([managedRow({ id: 'p', expiry_date: '2000-01-01' })], undefined);
    expect(past[0].status).toEqual({ label: 'Expired', kind: 'danger' });
    const soon = new Date(); soon.setDate(soon.getDate() + 10);
    const soonRow = unifyDocuments([managedRow({ id: 's', expiry_date: soon.toISOString().slice(0, 10) })], undefined);
    expect(soonRow[0].status).toEqual({ label: 'Expiring soon', kind: 'warning' });
  });

  it('flattens IL shop documents to read-only shop-scope docs with COC status', () => {
    const out = unifyDocuments([], ilFixture).filter((d) => d.source === 'insight_linker' && d.scope === 'shop');
    expect(out).toHaveLength(2);
    const coc = out.find((d) => d.name === 'SHOP14_COC.pdf')!;
    expect(coc).toMatchObject({
      editable: false, scope: 'shop', shopNumber: '14', tenantName: 'Boxer',
      type: '01 COC', sizeBytes: 2100000, storedUrl: 'https://il/pub/shop14_coc.pdf',
    });
    expect(coc.status).toEqual({ label: 'COC pass', kind: 'success' });
    const line = out.find((d) => d.name === 'line.pdf')!;
    expect(line.status).toEqual({ label: 'Not classified', kind: 'neutral' });
  });

  it('flattens IL site documents to read-only site-scope reference docs', () => {
    const out = unifyDocuments([], ilFixture).filter((d) => d.scope === 'site');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'insight_linker', editable: false, type: 'Site Plan' });
    expect(out[0].status.kind).toBe('neutral');
  });

  it('produces unique keys across all sources', () => {
    const out = unifyDocuments([managedRow()], ilFixture);
    expect(new Set(out.map((d) => d.key)).size).toBe(out.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/building/documents/unifyDocuments.test.ts`
Expected: FAIL (`unifyDocuments` not defined). If vitest can't run locally, confirm via `npx tsc --noEmit` that the import is unresolved, and proceed.

- [ ] **Step 3: Write the implementation**

```ts
import { differenceInDays } from 'date-fns';
import { getTypeLabel } from './documentTypes';
import type { BuildingDocumentRow, UnifiedDocument, DocStatus } from './types';
import type { ILBuilding } from '@/integrations/supabase/insight-linker';

function managedStatus(expiry: string | null): DocStatus {
  if (!expiry) return { label: 'No expiry', kind: 'neutral' };
  const days = differenceInDays(new Date(expiry), new Date());
  if (days < 0) return { label: 'Expired', kind: 'danger' };
  if (days <= 30) return { label: 'Expiring soon', kind: 'warning' };
  if (days <= 90) return { label: 'Due in 3 months', kind: 'neutral' };
  return { label: 'Valid', kind: 'success' };
}

function cocStatus(status: string | null): DocStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'pass': return { label: 'COC pass', kind: 'success' };
    case 'fail': return { label: 'COC fail', kind: 'danger' };
    case 'pending': return { label: 'COC pending', kind: 'warning' };
    default: return { label: 'Not classified', kind: 'neutral' };
  }
}

export function unifyDocuments(
  managed: BuildingDocumentRow[],
  il: ILBuilding | undefined,
): UnifiedDocument[] {
  const out: UnifiedDocument[] = [];

  for (const row of managed) {
    out.push({
      key: `managed:${row.id}`,
      source: 'managed',
      name: row.name,
      type: getTypeLabel(row.document_type),
      typeValue: row.document_type,
      scope: 'building',
      shopNumber: null,
      tenantName: null,
      issueDate: row.issue_date,
      expiryDate: row.expiry_date,
      status: managedStatus(row.expiry_date),
      sizeBytes: null,
      editable: true,
      managedId: row.id,
      storedUrl: row.file_url,
    });
  }

  for (const shop of il?.shops ?? []) {
    const shopNumber = shop.matched_tenant?.shop_number ?? null;
    const tenantName = shop.tenant_name ?? shop.matched_tenant?.shop_name ?? null;
    shop.documents.forEach((d, idx) => {
      const category = d.category?.trim() || 'Uncategorised';
      out.push({
        key: `il:${shop.subsection_id}:${d.file_url ?? idx}`,
        source: 'insight_linker',
        name: d.file_name?.trim() || '(unnamed file)',
        type: category,
        typeValue: category.toLowerCase(),
        scope: 'shop',
        shopNumber,
        tenantName,
        issueDate: null,
        expiryDate: d.coc_expiry_date,
        status: cocStatus(d.coc_status),
        sizeBytes: d.file_size,
        editable: false,
        managedId: null,
        storedUrl: d.file_url,
      });
    });
  }

  (il?.site_documents ?? []).forEach((d, idx) => {
    const category = d.category?.trim() || 'Uncategorised';
    out.push({
      key: `il-site:${d.file_url ?? idx}`,
      source: 'insight_linker',
      name: d.file_name?.trim() || '(unnamed file)',
      type: category,
      typeValue: category.toLowerCase(),
      scope: 'site',
      shopNumber: null,
      tenantName: null,
      issueDate: null,
      expiryDate: null,
      status: { label: 'Reference', kind: 'neutral' },
      sizeBytes: null,
      editable: false,
      managedId: null,
      storedUrl: d.file_url,
    });
  });

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/building/documents/unifyDocuments.test.ts`
Expected: PASS (5 tests). If vitest is unavailable, `npx tsc --noEmit` must be clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/building/documents/unifyDocuments.ts src/components/building/documents/unifyDocuments.test.ts
git commit -m "feat(documents): unifyDocuments mapper merging managed + insight-linker docs"
```

---

## Task 3: `filterDocuments` — search / filter / group / sort (TDD)

**Files:**
- Create: `src/components/building/documents/filterDocuments.ts`
- Test: `src/components/building/documents/filterDocuments.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { searchDocuments, applyFilters, groupDocuments, needAttentionCount, type DocFilters } from './filterDocuments';
import type { UnifiedDocument } from './types';

const doc = (over: Partial<UnifiedDocument>): UnifiedDocument => ({
  key: Math.random().toString(), source: 'managed', name: 'Doc', type: 'Fire Certificate',
  typeValue: 'fire_certificate', scope: 'building', shopNumber: null, tenantName: null,
  issueDate: null, expiryDate: null, status: { label: 'Valid', kind: 'success' },
  sizeBytes: null, editable: true, managedId: 'x', storedUrl: null, ...over,
});

const docs: UnifiedDocument[] = [
  doc({ key: 'a', name: 'Fire Cert', source: 'managed', status: { label: 'Expired', kind: 'danger' } }),
  doc({ key: 'b', name: 'SHOP14_COC', source: 'insight_linker', scope: 'shop', shopNumber: '14', tenantName: 'Boxer', typeValue: '01 coc', type: '01 COC', status: { label: 'COC fail', kind: 'danger' } }),
  doc({ key: 'c', name: 'Site Plan', source: 'insight_linker', scope: 'site', typeValue: 'site plan', type: 'Site Plan', status: { label: 'Reference', kind: 'neutral' } }),
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
    expect(applyFilters(docs, { ...allFilters, status: 'danger' }).map((d) => d.key)).toEqual(['a', 'b']);
  });
  it('filters by shop number', () => {
    expect(applyFilters(docs, { ...allFilters, shop: '14' }).map((d) => d.key)).toEqual(['b']);
  });
});

describe('groupDocuments', () => {
  it('groups by source with editable group first', () => {
    const groups = groupDocuments(docs, 'source');
    expect(groups.map((g) => g.label)).toEqual(['Managed here (editable)', 'Insight-linker (live, read-only)']);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/building/documents/filterDocuments.test.ts`
Expected: FAIL (module not found). Fallback: `npx tsc --noEmit` shows unresolved import.

- [ ] **Step 3: Write the implementation**

```ts
import type { UnifiedDocument, DocSource, StatusKind, DocScope } from './types';

export type GroupBy = 'source' | 'type' | 'shop' | 'status' | 'scope' | 'none';

export interface DocFilters {
  source: DocSource | 'all';
  type: string | 'all';        // matches typeValue
  status: StatusKind | 'all';
  shop: string | 'all';        // matches shopNumber
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
    [d.name, d.type, d.shopNumber ?? '', d.tenantName ?? '']
      .some((f) => f.toLowerCase().includes(q)),
  );
}

export function applyFilters(docs: UnifiedDocument[], f: DocFilters): UnifiedDocument[] {
  return docs.filter((d) =>
    (f.source === 'all' || d.source === f.source) &&
    (f.type === 'all' || d.typeValue === f.type) &&
    (f.status === 'all' || d.status.kind === f.status) &&
    (f.shop === 'all' || (d.shopNumber ?? '') === f.shop),
  );
}

const SCOPE_LABEL: Record<DocScope, string> = { building: 'Building', shop: 'Shop', site: 'Site-level' };

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
      case 'type': return d.type;
      case 'shop': return d.scope === 'shop' ? `Shop ${d.shopNumber ?? '—'}${d.tenantName ? ` · ${d.tenantName}` : ''}` : SCOPE_LABEL[d.scope];
      case 'status': return d.status.label;
      case 'scope': return SCOPE_LABEL[d.scope];
      default: return 'All documents';
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/building/documents/filterDocuments.test.ts`
Expected: PASS. Fallback: `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/building/documents/filterDocuments.ts src/components/building/documents/filterDocuments.test.ts
git commit -m "feat(documents): search/filter/group/sort helpers for unified docs"
```

---

## Task 4: `resolveDocUrl` — the 403 fix (TDD)

Resolves a `UnifiedDocument` to a usable URL: managed → signed via `resolveStorageUrl`; IL → direct.

**Files:**
- Create: `src/components/building/documents/resolveDocUrl.ts`
- Test: `src/components/building/documents/resolveDocUrl.test.ts`

- [ ] **Step 1: Write the failing test** (mock the storage module so the branch logic is the unit under test)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveStorageUrl = vi.fn();
vi.mock('@/integrations/supabase/storage', () => ({ resolveStorageUrl: (...a: unknown[]) => resolveStorageUrl(...a) }));

import { resolveDocUrl } from './resolveDocUrl';
import type { UnifiedDocument } from './types';

const base: UnifiedDocument = {
  key: 'k', source: 'managed', name: 'n', type: 't', typeValue: 't', scope: 'building',
  shopNumber: null, tenantName: null, issueDate: null, expiryDate: null,
  status: { label: 'Valid', kind: 'success' }, sizeBytes: null, editable: true,
  managedId: 'm', storedUrl: 'https://x/object/public/tenant-documents/documents/b/a.pdf',
};

describe('resolveDocUrl', () => {
  beforeEach(() => resolveStorageUrl.mockReset());

  it('signs managed URLs via resolveStorageUrl', async () => {
    resolveStorageUrl.mockResolvedValue('https://signed');
    expect(await resolveDocUrl(base)).toBe('https://signed');
    expect(resolveStorageUrl).toHaveBeenCalledWith(base.storedUrl);
  });

  it('returns insight-linker URLs directly without signing', async () => {
    const il = { ...base, source: 'insight_linker' as const, editable: false, storedUrl: 'https://il/pub/x.pdf' };
    expect(await resolveDocUrl(il)).toBe('https://il/pub/x.pdf');
    expect(resolveStorageUrl).not.toHaveBeenCalled();
  });

  it('returns null when there is no stored url', async () => {
    expect(await resolveDocUrl({ ...base, storedUrl: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/building/documents/resolveDocUrl.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```ts
import { resolveStorageUrl } from '@/integrations/supabase/storage';
import type { UnifiedDocument } from './types';

/**
 * Resolve a document to a URL safe to embed/download.
 * Managed docs live in the PRIVATE tenant-documents bucket and must be signed
 * (the stored public-style URL 403s). Insight-linker docs are on public buckets.
 */
export async function resolveDocUrl(doc: UnifiedDocument): Promise<string | null> {
  if (!doc.storedUrl) return null;
  if (doc.source === 'insight_linker') return doc.storedUrl;
  return resolveStorageUrl(doc.storedUrl);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/building/documents/resolveDocUrl.test.ts`
Expected: PASS (3 tests). Fallback: `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/building/documents/resolveDocUrl.ts src/components/building/documents/resolveDocUrl.test.ts
git commit -m "fix(documents): resolve managed URLs via signed URL before use (403 fix)"
```

---

## Task 5: `useBuildingDocuments` — managed CRUD hook

react-query hook owning the managed register: list, multi-file upload + insert, update, single + bulk delete. Invalidates on mutation.

**Files:**
- Create: `src/components/building/documents/useBuildingDocuments.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { BuildingDocumentRow } from './types';

export interface DocumentFormValues {
  name: string;
  document_type: string;
  reference_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  issuing_authority: string | null;
  notes: string | null;
}

const KEY = (buildingId: string) => ['building-documents', buildingId];

async function uploadOne(buildingId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop();
  // Path prefix `documents/<buildingId>/` is required by the storage policy.
  const path = `documents/${buildingId}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const { error } = await supabase.storage.from('tenant-documents').upload(path, file);
  if (error) throw error;
  // Keep storing the public-URL form (iOS + existing rows read this column).
  return supabase.storage.from('tenant-documents').getPublicUrl(path).data.publicUrl;
}

export function useBuildingDocuments(buildingId: string) {
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: KEY(buildingId),
    queryFn: async (): Promise<BuildingDocumentRow[]> => {
      const { data, error } = await supabase
        .from('building_documents').select('*').eq('building_id', buildingId).order('name');
      if (error) throw error;
      return (data ?? []) as BuildingDocumentRow[];
    },
    enabled: !!buildingId,
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: KEY(buildingId) });

  /** Create one row per uploaded file (multi-upload), each with the same metadata. */
  const create = useMutation({
    mutationFn: async (args: { values: DocumentFormValues; files: File[]; userId: string | null }) => {
      const { values, files, userId } = args;
      if (files.length === 0) {
        const { error } = await supabase.from('building_documents')
          .insert({ ...values, building_id: buildingId, file_url: null, uploaded_by: userId });
        if (error) throw error;
        return;
      }
      const rows = await Promise.all(files.map(async (file, i) => ({
        ...values,
        // When multiple files share one metadata set, suffix the name to keep them distinct.
        name: files.length > 1 ? `${values.name} (${i + 1})` : values.name,
        building_id: buildingId,
        file_url: await uploadOne(buildingId, file),
        uploaded_by: userId,
      })));
      const { error } = await supabase.from('building_documents').insert(rows);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async (args: { id: string; values: DocumentFormValues; file: File | null; userId: string | null }) => {
      const { id, values, file, userId } = args;
      const file_url = file ? await uploadOne(buildingId, file) : undefined;
      const patch = { ...values, ...(file_url ? { file_url } : {}), uploaded_by: userId };
      const { error } = await supabase.from('building_documents').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('building_documents').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { list, create, update, remove };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (Note: `supabase.from('building_documents')` is in the generated types, so no casts needed.)

- [ ] **Step 3: Commit**

```bash
git add src/components/building/documents/useBuildingDocuments.ts
git commit -m "feat(documents): useBuildingDocuments hook (multi-upload create, update, bulk delete)"
```

---

## Task 6: `DocumentPreviewModal` — lightbox with prev/next

**Files:**
- Create: `src/components/building/DocumentPreviewModal.tsx`

Renders the resolved URL: PDFs in an `<iframe>`, images in `<img>`, anything else as a download prompt. Prev/next walk the passed (already filtered+sorted) list.

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Lock, Pencil } from 'lucide-react';
import { resolveDocUrl } from './documents/resolveDocUrl';
import type { UnifiedDocument } from './documents/types';

function kind(name: string): 'pdf' | 'image' | 'other' {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  return 'other';
}

interface Props {
  docs: UnifiedDocument[];        // the filtered+sorted list to navigate
  index: number | null;          // which doc is open; null = closed
  onIndexChange: (i: number | null) => void;
}

export default function DocumentPreviewModal({ docs, index, onIndexChange }: Props) {
  const open = index !== null;
  const doc = open ? docs[index] : null;
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!doc) { setUrl(null); return; }
    setLoading(true);
    resolveDocUrl(doc).then((u) => { if (!cancelled) { setUrl(u); setLoading(false); } });
    return () => { cancelled = true; };
  }, [doc]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && index! > 0) onIndexChange(index! - 1);
      if (e.key === 'ArrowRight' && index! < docs.length - 1) onIndexChange(index! + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, docs.length, onIndexChange]);

  if (!doc) return null;
  const k = kind(doc.name);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onIndexChange(null)}>
      <DialogContent className="max-w-4xl w-[90vw] h-[85vh] flex flex-col p-0 gap-0">
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium truncate">{doc.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {doc.scope === 'shop' ? `Shop ${doc.shopNumber ?? '—'}${doc.tenantName ? ` · ${doc.tenantName}` : ''}` : doc.scope === 'site' ? 'Site-level' : 'Building'}
              {doc.sizeBytes ? ` · ${(doc.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ''}
            </p>
          </div>
          <Badge variant="secondary" className="gap-1 shrink-0">
            {doc.editable ? <Pencil className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            {doc.editable ? 'Managed' : 'Live'}
          </Badge>
          {url && (
            <Button variant="outline" size="sm" asChild>
              <a href={url} download target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4 mr-1" /> Download
              </a>
            </Button>
          )}
        </div>

        <div className="flex-1 min-h-0 bg-muted/40 flex items-center justify-center overflow-auto">
          {loading ? (
            <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          ) : !url ? (
            <p className="text-sm text-muted-foreground">Could not load this file.</p>
          ) : k === 'pdf' ? (
            <iframe title={doc.name} src={url} className="w-full h-full" />
          ) : k === 'image' ? (
            <img src={url} alt={doc.name} className="max-w-full max-h-full object-contain" />
          ) : (
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">Preview isn’t available for this file type.</p>
              <Button asChild><a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 mr-1" /> Open file</a></Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t text-sm">
          <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => onIndexChange(index! - 1)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Previous
          </Button>
          <span className="text-muted-foreground">{index! + 1} of {docs.length}</span>
          <Button variant="ghost" size="sm" disabled={index === docs.length - 1} onClick={() => onIndexChange(index! + 1)}>
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/building/DocumentPreviewModal.tsx
git commit -m "feat(documents): on-screen preview lightbox (pdf/image/download) with prev-next"
```

---

## Task 7: `DocumentFormDialog` — add/edit with drag-drop multi-upload

**Files:**
- Create: `src/components/building/DocumentFormDialog.tsx`

Add mode allows multiple files (drag-drop or pick); edit mode allows a single replacement file. Validates name + type.

- [ ] **Step 1: Write the component**

```tsx
import { useState, useEffect, useCallback, type DragEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UploadCloud, X, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { DOCUMENT_TYPES } from './documents/documentTypes';
import type { UnifiedDocument } from './documents/types';
import type { DocumentFormValues } from './documents/useBuildingDocuments';

export interface DocumentFormSubmit {
  values: DocumentFormValues;
  files: File[];     // add mode: 0..n; edit mode: 0..1
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: UnifiedDocument | null;     // null = add mode
  editingMeta: DocumentFormValues | null; // prefill for edit (looked up by caller)
  submitting: boolean;
  onSubmit: (s: DocumentFormSubmit) => Promise<void>;
}

const ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png';

export default function DocumentFormDialog({ open, onOpenChange, editing, editingMeta, submitting, onSubmit }: Props) {
  const isEdit = !!editing;
  const [name, setName] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [issuingAuthority, setIssuingAuthority] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editingMeta ? editing!.name : '');
    setDocumentType(editingMeta?.document_type ?? '');
    setReferenceNumber(editingMeta?.reference_number ?? '');
    setIssueDate(editingMeta?.issue_date ?? '');
    setExpiryDate(editingMeta?.expiry_date ?? '');
    setIssuingAuthority(editingMeta?.issuing_authority ?? '');
    setNotes(editingMeta?.notes ?? '');
    setFiles([]);
  }, [open, editing, editingMeta]);

  const addFiles = useCallback((picked: FileList | null) => {
    if (!picked) return;
    const next = Array.from(picked);
    setFiles((prev) => (isEdit ? next.slice(0, 1) : [...prev, ...next]));
  }, [isEdit]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !documentType) { toast.error('Name and document type are required'); return; }
    const values: DocumentFormValues = {
      name: name.trim(), document_type: documentType,
      reference_number: referenceNumber.trim() || null,
      issue_date: issueDate || null, expiry_date: expiryDate || null,
      issuing_authority: issuingAuthority.trim() || null, notes: notes.trim() || null,
    };
    await onSubmit({ values, files });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit document' : 'Add documents'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update document information' : 'Add one or more documents to this building'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="doc-name">Document name *</Label>
              <Input id="doc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fire certificate 2026" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-type">Document type *</Label>
              <Select value={documentType} onValueChange={setDocumentType}>
                <SelectTrigger id="doc-type"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ref">Reference number</Label>
              <Input id="ref" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="auth">Issuing authority</Label>
              <Input id="auth" value={issuingAuthority} onChange={(e) => setIssuingAuthority(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="issue">Issue date</Label>
              <Input id="issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expiry">Expiry date</Label>
              <Input id="expiry" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{isEdit ? 'Replace file' : 'Files'}</Label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`rounded-md border border-dashed p-4 text-center text-sm ${dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'}`}
            >
              <UploadCloud className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground">Drag files here, or</p>
              <label className="text-primary underline cursor-pointer">
                browse
                <input type="file" className="hidden" accept={ACCEPT} multiple={!isEdit} onChange={(e) => addFiles(e.target.files)} />
              </label>
              {isEdit && editing?.storedUrl && files.length === 0 && (
                <p className="text-xs text-muted-foreground mt-2">Current file kept unless you choose a new one.</p>
              )}
            </div>
            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate flex-1">{f.name}</span>
                    <button type="button" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : isEdit ? 'Update' : files.length > 1 ? `Add ${files.length} documents` : 'Add document'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/building/DocumentFormDialog.tsx
git commit -m "feat(documents): add/edit dialog with drag-drop multi-file upload"
```

---

## Task 8: `DocumentsToolbar` — search, filters, group-by, add

**Files:**
- Create: `src/components/building/DocumentsToolbar.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus } from 'lucide-react';
import type { DocFilters, GroupBy } from './documents/filterDocuments';
import type { UnifiedDocument } from './documents/types';

interface Props {
  query: string;
  onQuery: (v: string) => void;
  filters: DocFilters;
  onFilters: (f: DocFilters) => void;
  groupBy: GroupBy;
  onGroupBy: (g: GroupBy) => void;
  docs: UnifiedDocument[];        // unfiltered, for building filter option lists
  canAdd: boolean;
  onAdd: () => void;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'danger', label: 'Expired / failed' },
  { value: 'warning', label: 'Expiring / pending' },
  { value: 'success', label: 'Valid / passed' },
  { value: 'neutral', label: 'No status' },
] as const;

export default function DocumentsToolbar({ query, onQuery, filters, onFilters, groupBy, onGroupBy, docs, canAdd, onAdd }: Props) {
  const types = Array.from(new Map(docs.map((d) => [d.typeValue, d.type])).entries())
    .sort((a, b) => a[1].localeCompare(b[1]));
  const shops = Array.from(new Set(docs.map((d) => d.shopNumber).filter((s): s is string => !!s)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[180px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search name, type, shop…" value={query} onChange={(e) => onQuery(e.target.value)} />
      </div>

      <Select value={filters.source} onValueChange={(v) => onFilters({ ...filters, source: v as DocFilters['source'] })}>
        <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sources</SelectItem>
          <SelectItem value="managed">Managed</SelectItem>
          <SelectItem value="insight_linker">Insight-linker</SelectItem>
        </SelectContent>
      </Select>

      <Select value={filters.type} onValueChange={(v) => onFilters({ ...filters, type: v })}>
        <SelectTrigger className="w-[160px]"><SelectValue placeholder="All types" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          {types.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={filters.status} onValueChange={(v) => onFilters({ ...filters, status: v as DocFilters['status'] })}>
        <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>

      {shops.length > 0 && (
        <Select value={filters.shop} onValueChange={(v) => onFilters({ ...filters, shop: v })}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="All shops" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All shops</SelectItem>
            {shops.map((s) => <SelectItem key={s} value={s}>Shop {s}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      <div className="flex items-center gap-1">
        <span className="text-sm text-muted-foreground">Group</span>
        <Select value={groupBy} onValueChange={(v) => onGroupBy(v as GroupBy)}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="source">Source</SelectItem>
            <SelectItem value="type">Type</SelectItem>
            <SelectItem value="shop">Shop / scope</SelectItem>
            <SelectItem value="status">Status</SelectItem>
            <SelectItem value="none">Nothing</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {canAdd && <Button onClick={onAdd}><Plus className="h-4 w-4 mr-1" /> Add</Button>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/building/DocumentsToolbar.tsx
git commit -m "feat(documents): toolbar with search, source/type/status/shop filters and group-by"
```

---

## Task 9: `DocumentsTable` — grouped rows, multi-select, row actions

**Files:**
- Create: `src/components/building/DocumentsTable.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FileText, MoreVertical, Eye, Download, Edit, Trash2, Lock, Pencil } from 'lucide-react';
import type { DocGroup } from './documents/filterDocuments';
import type { UnifiedDocument, StatusKind } from './documents/types';

const STATUS_VARIANT: Record<StatusKind, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  success: 'default', warning: 'outline', danger: 'destructive', neutral: 'secondary',
};

interface Props {
  groups: DocGroup[];
  flat: UnifiedDocument[];                 // visual order, for preview indexing
  canEdit: boolean;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleAll: (keys: string[], on: boolean) => void;
  onPreview: (doc: UnifiedDocument) => void;
  onDownload: (doc: UnifiedDocument) => void;
  onEdit: (doc: UnifiedDocument) => void;
  onDelete: (doc: UnifiedDocument) => void;
}

function sizeLabel(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DocumentsTable(p: Props) {
  if (p.flat.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 border rounded-lg">
        <FileText className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="font-medium">No documents found</p>
        <p className="text-sm text-muted-foreground">Try adjusting your search or filters.</p>
      </div>
    );
  }

  const selectableKeys = p.flat.filter((d) => d.editable).map((d) => d.key);
  const allSelected = selectableKeys.length > 0 && selectableKeys.every((k) => p.selected.has(k));

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            {p.canEdit && (
              <TableHead className="w-[40px]">
                <Checkbox checked={allSelected} onCheckedChange={(v) => p.onToggleAll(selectableKeys, !!v)} aria-label="Select all editable" />
              </TableHead>
            )}
            <TableHead>Name</TableHead>
            <TableHead>Type / category</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Linked to</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[60px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {p.groups.map((group) => (
            <>
              <TableRow key={`hd-${group.label}`} className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={p.canEdit ? 7 : 6} className="py-1.5 text-xs font-medium">
                  {group.label} · {group.docs.length}
                </TableCell>
              </TableRow>
              {group.docs.map((doc) => (
                <TableRow key={doc.key}>
                  {p.canEdit && (
                    <TableCell>
                      {doc.editable && (
                        <Checkbox checked={p.selected.has(doc.key)} onCheckedChange={() => p.onToggle(doc.key)} aria-label={`Select ${doc.name}`} />
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    <button className="flex items-center gap-2 text-left hover:underline" onClick={() => p.onPreview(doc)}>
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium truncate max-w-[220px]">{doc.name}</span>
                      {doc.sizeBytes ? <span className="text-xs text-muted-foreground">{sizeLabel(doc.sizeBytes)}</span> : null}
                    </button>
                  </TableCell>
                  <TableCell className="truncate max-w-[140px]">{doc.type}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="gap-1">
                      {doc.editable ? <Pencil className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                      {doc.editable ? 'Managed' : 'Live'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {doc.scope === 'shop' ? `Shop ${doc.shopNumber ?? '—'}${doc.tenantName ? ` · ${doc.tenantName}` : ''}` : doc.scope === 'site' ? 'Site-level' : 'Building'}
                  </TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[doc.status.kind]}>{doc.status.label}</Badge></TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => p.onPreview(doc)}><Eye className="h-4 w-4 mr-2" /> Preview</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => p.onDownload(doc)}><Download className="h-4 w-4 mr-2" /> Download</DropdownMenuItem>
                        {p.canEdit && doc.editable && (
                          <>
                            <DropdownMenuItem onClick={() => p.onEdit(doc)}><Edit className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => p.onDelete(doc)} className="text-destructive focus:text-destructive"><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Verify `checkbox` UI primitive exists**

Run: `ls src/components/ui/checkbox.tsx`
Expected: file exists (shadcn). If missing, add it: `npx shadcn@latest add checkbox` (or copy the standard shadcn checkbox component). Then re-run `npx tsc --noEmit`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/building/DocumentsTable.tsx
git commit -m "feat(documents): grouped table with multi-select and role-gated row actions"
```

---

## Task 10: `DocumentsTab` — container (full rewrite)

Wires data + state + all child components. Replaces the old file; same path + default export + `{ buildingId }` prop so `BuildingDetails.tsx` is untouched.

**Files:**
- Modify (full rewrite): `src/components/building/DocumentsTab.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useBuildingInsightLinker } from '@/integrations/supabase/insight-linker';
import { useBuildingDocuments } from './documents/useBuildingDocuments';
import { unifyDocuments } from './documents/unifyDocuments';
import { searchDocuments, applyFilters, groupDocuments, needAttentionCount, type DocFilters, type GroupBy } from './documents/filterDocuments';
import { resolveDocUrl } from './documents/resolveDocUrl';
import type { UnifiedDocument } from './documents/types';
import type { DocumentFormValues } from './documents/useBuildingDocuments';
import type { BuildingDocumentRow } from './documents/types';
import DocumentsToolbar from './DocumentsToolbar';
import DocumentsTable from './DocumentsTable';
import DocumentPreviewModal from './DocumentPreviewModal';
import DocumentFormDialog, { type DocumentFormSubmit } from './DocumentFormDialog';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

interface DocumentsTabProps { buildingId: string; }

const METRIC = 'rounded-md bg-muted/50 px-4 py-3';

export default function DocumentsTab({ buildingId }: DocumentsTabProps) {
  const { isAdminOrManager, user } = useAuth();
  const { list, create, update, remove } = useBuildingDocuments(buildingId);
  const il = useBuildingInsightLinker(buildingId, true);

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<DocFilters>({ source: 'all', type: 'all', status: 'all', shop: 'all' });
  const [groupBy, setGroupBy] = useState<GroupBy>('source');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UnifiedDocument | null>(null);

  const all = useMemo(() => unifyDocuments((list.data ?? []) as BuildingDocumentRow[], il.data), [list.data, il.data]);
  const visible = useMemo(() => applyFilters(searchDocuments(all, query), filters), [all, query, filters]);
  const groups = useMemo(() => groupDocuments(visible, groupBy), [visible, groupBy]);
  const flat = useMemo(() => groups.flatMap((g) => g.docs), [groups]);

  const managedRows = (list.data ?? []) as BuildingDocumentRow[];
  const metaFor = (doc: UnifiedDocument | null): DocumentFormValues | null => {
    if (!doc?.managedId) return null;
    const r = managedRows.find((x) => x.id === doc.managedId);
    if (!r) return null;
    return {
      name: r.name, document_type: r.document_type, reference_number: r.reference_number,
      issue_date: r.issue_date, expiry_date: r.expiry_date, issuing_authority: r.issuing_authority, notes: r.notes,
    };
  };

  const download = async (doc: UnifiedDocument) => {
    const url = await resolveDocUrl(doc);
    if (!url) { toast.error('Could not resolve this file'); return; }
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.download = doc.name;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const downloadSelected = async () => {
    const picked = flat.filter((d) => selected.has(d.key));
    for (const d of picked) { await download(d); } // sequential, no zip
  };

  const submitForm = async ({ values, files }: DocumentFormSubmit) => {
    try {
      if (editing?.managedId) {
        await update.mutateAsync({ id: editing.managedId, values, file: files[0] ?? null, userId: user?.id ?? null });
        toast.success('Document updated');
      } else {
        await create.mutateAsync({ values, files, userId: user?.id ?? null });
        toast.success(files.length > 1 ? `${files.length} documents added` : 'Document added');
      }
      setFormOpen(false); setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save document');
    }
  };

  const deleteOne = async (doc: UnifiedDocument) => {
    if (!doc.managedId || !confirm(`Delete ${doc.name}?`)) return;
    try { await remove.mutateAsync([doc.managedId]); toast.success('Document deleted'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to delete'); }
  };
  const deleteSelected = async () => {
    const ids = flat.filter((d) => selected.has(d.key) && d.managedId).map((d) => d.managedId!) as string[];
    if (ids.length === 0 || !confirm(`Delete ${ids.length} document(s)?`)) return;
    try { await remove.mutateAsync(ids); setSelected(new Set()); toast.success(`${ids.length} deleted`); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to delete'); }
  };

  const toggle = (key: string) => setSelected((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleAll = (keys: string[], on: boolean) => setSelected((s) => {
    const n = new Set(s); keys.forEach((k) => on ? n.add(k) : n.delete(k)); return n;
  });

  if (list.isLoading) {
    return <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  const managedCount = all.filter((d) => d.source === 'managed').length;
  const ilCount = all.length - managedCount;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={METRIC}><div className="text-xs text-muted-foreground">All documents</div><div className="text-2xl font-medium">{all.length}</div></div>
        <div className={METRIC}><div className="text-xs text-muted-foreground">Managed here</div><div className="text-2xl font-medium">{managedCount}</div></div>
        <div className={METRIC}><div className="text-xs text-muted-foreground">Insight-linker</div><div className="text-2xl font-medium">{ilCount}{il.isLoading ? '…' : ''}</div></div>
        <div className={METRIC}><div className="text-xs text-muted-foreground">Need attention</div><div className="text-2xl font-medium text-destructive">{needAttentionCount(all)}</div></div>
      </div>

      <DocumentsToolbar
        query={query} onQuery={setQuery}
        filters={filters} onFilters={setFilters}
        groupBy={groupBy} onGroupBy={setGroupBy}
        docs={all} canAdd={isAdminOrManager}
        onAdd={() => { setEditing(null); setFormOpen(true); }}
      />

      {isAdminOrManager && selected.size > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={downloadSelected}>Download selected</Button>
          <Button size="sm" variant="outline" className="text-destructive" onClick={deleteSelected}><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <DocumentsTable
        groups={groups} flat={flat} canEdit={isAdminOrManager}
        selected={selected} onToggle={toggle} onToggleAll={toggleAll}
        onPreview={(doc) => setPreviewIndex(flat.findIndex((d) => d.key === doc.key))}
        onDownload={download}
        onEdit={(doc) => { setEditing(doc); setFormOpen(true); }}
        onDelete={deleteOne}
      />

      <DocumentPreviewModal docs={flat} index={previewIndex} onIndexChange={setPreviewIndex} />
      {isAdminOrManager && (
        <DocumentFormDialog
          open={formOpen}
          onOpenChange={(o) => { setFormOpen(o); if (!o) setEditing(null); }}
          editing={editing} editingMeta={metaFor(editing)}
          submitting={create.isPending || update.isPending}
          onSubmit={submitForm}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. Fix any import path / prop-name mismatches against Tasks 6–9.

- [ ] **Step 3: Commit**

```bash
git add src/components/building/DocumentsTab.tsx
git commit -m "feat(documents): unified Documents tab container wiring all parts"
```

---

## Task 11: Build, full-suite typecheck, and preview-deploy QA

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no errors anywhere.

- [ ] **Step 2: Run the new unit tests (if the runner works)**

Run: `npx vitest run src/components/building/documents`
Expected: all tests pass. If vitest is broken locally, note it and rely on the remote build/CI.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds. (If local build is broken per the handoff, push a preview deploy instead — see Step 4.)

- [ ] **Step 4: Deploy a Vercel PREVIEW (not prod) and QA against real data**

Run: `vercel` (preview build, remote). Open the preview URL, log in, and verify on three buildings:

- **AbaQulusi** (rich IL shop docs, 48/56 matched): Documents tab shows managed + IL docs; group-by Source shows the two groups; search "boxer"/"14" finds the shop doc; the type/status/shop filters narrow correctly; clicking a doc opens the **lightbox** and the PDF renders; prev/next walks the list; download works for both an IL doc (direct) and a managed doc (signed — no 403).
- **A building with no IL docs**: only the managed group shows; Insight-linker count is 0; add/edit/delete still work.
- **Yarona** (site-level docs): the site-level docs appear (group-by Shop/scope shows a "Site-level" group).

Also verify:
- **Role gating:** as a non-admin (`user`/`reviewer`) account, no Add button, no edit/delete, no select checkboxes; preview + download still work.
- **Add (multi):** drag-drop 2 files in Add → two rows created; **edit** one → metadata updates; **bulk select → delete** removes them.
- **403 fix:** open an existing (pre-change) managed document — it opens (signed), not a 403.

- [ ] **Step 5: Ship to production (after human visual-QA sign-off)**

Run: `vercel --prod`
Then ask the human to confirm on buildingops.app.

---

## Self-review — spec coverage

- §2 unified tab + Electrical untouched → Task 10 keeps the file/prop; Electrical tab not modified. ✓
- §2 web-first, no photos → no iOS/photos touched; mapper ignores `photos`. ✓
- §3.2 403 fix, stored format unchanged → Tasks 4 + 5 (`getPublicUrl` kept; always resolve on read). ✓
- §4.1 unified data model → Tasks 1–2. ✓
- §4.2 component breakdown → Tasks 5–10 (one file each). ✓
- §4.3 search/filter/group/preview/download, summary cards, default group=source, sequential bulk download, no notifications → Tasks 3, 8, 9, 10. ✓
- §4.4 role gating + no new IL security/buckets → `isAdminOrManager` gating (Tasks 9–10); IL via existing RPC only. ✓
- §5 testing/deploy → Task 11 (tsc gate, vitest, preview QA on the 3 named buildings, then `vercel --prod`). ✓

No placeholders; types/signatures are consistent across tasks (`UnifiedDocument`, `DocFilters`, `GroupBy`, `DocGroup`, `DocumentFormValues`, `DocumentFormSubmit`, `resolveDocUrl`, `useBuildingDocuments`).
```
