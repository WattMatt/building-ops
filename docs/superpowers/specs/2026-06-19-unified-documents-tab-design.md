# Unified Documents Tab — Design Spec

- **Date:** 2026-06-19
- **Status:** Approved (brainstorming) → ready for implementation plan
- **Scope:** Web only (`gmi-operations`, buildingops.app). iOS out of scope.
- **Related:** [[2026-06-18-insight-linker-building-tab-design]] (the read-only insight-linker integration this builds on)

---

## 1. Problem & goal

A building's documents currently live in **two disconnected places**:

1. **GMI-managed register** — the existing "Documents" tab (`building_documents` table). Editable (add/edit/delete), building-level, private bucket.
2. **Insight-linker documents** — surfaced only inside the "Electrical & Compliance" tab, buried in per-shop expandable drawers + a small site-docs panel. Read-only, live via FDW, public buckets.

**Goal:** rebuild the "Documents" tab into a single unified browser where a user can **see every document for a building/site in one place** and **search · filter · group · preview on screen · download** — with a flawless, clean add/update flow for the managed documents. Proper review, planning, testing, deployment.

### Non-goals
- iOS changes (keeps its current `building_documents` Docs tab).
- Photos (insight-linker `inspection_photo_refs`) — they stay in the Electrical & Compliance tab.
- Touching the Electrical & Compliance tab (it carries non-document electrical data: meters, CT ratios, COC rollups).
- New notification/alerting system for expiries.
- New SQL migrations / new storage buckets / new path prefixes.

---

## 2. Decisions (from brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Architecture | **Unified Documents tab** (both sources) + keep Electrical tab as-is |
| 2 | Platform | **Web first** (gmi-operations only) |
| 3 | Photos | **Documents only** — photos stay in Electrical tab |
| 4 | Preview UX | **Full modal / lightbox** with prev/next across the filtered list |
| 5 | Add/edit scope | **Power features**: drag-drop multi-file upload, bulk select/delete, inline metadata edit, + the URL bug fix |
| 6 | Bulk download | **Sequential single-file** downloads — no client-side zip (can add later) |
| 7 | Default organisation | **Section → category** (nested): Building / each Shop / Site-level → category sub-groups in source order. Selector also offers Category · Source · Status · None |
| 8 | Backend | **Reuse** `building_insight_linker` RPC; one small read-only migration `sql/2026-06-19_03` adds `category_order` (= `document_categories.order_index`) for exact category ordering |

---

## 3. Current-state facts (verified 2026-06-19)

### 3.1 Managed register — System A
- **Web:** `src/components/building/DocumentsTab.tsx` (~540 lines, props `{ buildingId }`).
- **iOS:** `BuildingDocumentsTab` in `GMI - Operations/.../Views/Buildings/BuildingDetailView.swift` — same table, same 12 cols, separate UI.
- **Table `building_documents`** (cols): `id, building_id, name, document_type, reference_number, issue_date, expiry_date, issuing_authority, file_url, notes, uploaded_by, created_at`. FK `building_id → buildings(id)`. Required on insert: `name`, `building_id`.
- **Doc-type list (hardcoded, 12):** compliance_certificate, fire_certificate, electrical_coc, occupancy_certificate, insurance, floor_plan, building_plan, municipal_rates, water_certificate, gas_certificate, lift_certificate, other.
- **Storage:** private `tenant-documents` bucket; upload path `documents/{buildingId}/{timestamp}-{random}.{ext}`.
- **Open/preview today:** `openStorageFile(file_url)` → `resolveStorageUrl()` in `src/integrations/supabase/storage.ts` re-signs (1h) then `window.open`.
- **Today's capabilities:** substring search (name/type/ref) + type-filter dropdown; sort by name; no grouping, no pagination, no inline preview, no optimistic updates (full re-fetch after each mutation).
- **Expiry logic:** `differenceInDays` → Expired (<0) / Expiring soon (≤30) / Expires in 3mo (≤90) / Valid.

### 3.2 ⚠️ The bug to fix
Web upload stores a `getPublicUrl()` link, but `tenant-documents` is **private** → that stored URL **403s** if used directly. It only works today because `openStorageFile()` re-signs on the fly.

**Fix (refined during planning — surgical, iOS-safe):** always resolve managed URLs through `resolveStorageUrl()` before embedding (preview iframe) or downloading — never use the raw stored URL directly. **Keep the stored format as the public-URL form; do NOT switch to a bare object path.** Reason: `resolveStorageUrl`'s `parseBucketPath` (and the mirrored iOS `resolveFileURL`) parse `/object/[public/]<bucket>/<path>` URLs but **not** bare paths, and iOS reads the same `file_url` column — storing a bare path would break iOS and any direct readers. `parseBucketPath` already handles the legacy public-URL form, so existing rows + iOS keep working unchanged. New uploads keep writing the same `getPublicUrl()` form; correctness comes from always resolving on read.

### 3.3 Insight-linker documents — System B (read-only, shipped 2026-06-18)
- **RPC:** `public.building_insight_linker(p_building_id uuid) returns jsonb` — `SECURITY DEFINER`, gated by `can_access_building()`. Web wrapper: `src/integrations/supabase/insight-linker.ts` (`useBuildingInsightLinker`).
- Returns (document-bearing parts):
  - `shops[].documents[]` = `{ file_name, file_url, file_size, category, coc_type, coc_status, coc_expiry_date }` (per-shop; `file_url` = direct **public** URL).
  - `shops[].matched_tenant` = `{ id, shop_number, shop_name } | null` (shop linkage).
  - `site_documents[]` = `{ file_name, file_url, category }` (site-level; public URL).
  - plus `shops[].photos[]` (OUT OF SCOPE here), site/counts/coc_rollup metadata.
- **Storage:** insight-linker public `documents` bucket — direct URLs, **no signing**.
- **Coverage:** 22/40 buildings have IL docs; ~13% are classified COCs (rest general electrical files); AbaQulusi 65 docs / Yarona 4 site docs.
- **Component already rendering this:** `src/components/building/InsightLinkerTab.tsx`; helpers in `src/lib/insight-linker-format.ts` (`cocBadgeVariant`, `formatFileSize`).

### 3.4 UI primitives available
shadcn/ui: table, dialog, select, input, textarea, button, badge, dropdown-menu, card, tabs, alert, command. Icons: lucide-react. Dates: date-fns.

---

## 4. Target design

### 4.1 Unified data model (client-side, no schema change)
A normalized view-model produced by a **pure mapper** so it is unit-testable:

```ts
type DocSource = 'managed' | 'insight_linker';
type DocScope  = 'building' | 'shop' | 'site';

interface UnifiedDocument {
  key: string;            // stable id: managed→row id; IL→`${source}:${file_url}`
  source: DocSource;
  name: string;           // managed.name | IL.file_name
  type: string;           // managed.document_type label | IL.category (may be null→'Uncategorised')
  scope: DocScope;
  shopRef?: { shopNumber?: string; tenantName?: string }; // IL per-shop only
  issueDate?: string;     // managed.issue_date | IL.coc_issue_date
  expiryDate?: string;    // managed.expiry_date | IL.coc_expiry_date
  status: DocStatus;      // derived: expiry bucket (managed) OR COC pass/fail/pending/none (IL)
  sizeBytes?: number;     // IL.file_size
  editable: boolean;      // true only for managed (+ role gate)
  // resolution: managed→sign object path; IL→use direct url
  resolve(): Promise<string>;
}
```

Built by merging:
- `building_documents` rows (managed), and
- the flattened `building_insight_linker` payload (`shops[].documents[]` + `site_documents[]`).

### 4.2 Components (replace the monolith with focused units)
- `DocumentsTab.tsx` — container: fetches both sources, owns filter/group/select state, renders summary cards + toolbar + table + modal.
- `documents/unifyDocuments.ts` — **pure mapper** (managed + IL → `UnifiedDocument[]`).
- `documents/useBuildingDocuments.ts` — managed CRUD hook (fetch/insert/update/delete + upload).
- `DocumentsToolbar.tsx` — search · source filter · type filter · status filter · shop filter · group-by · Add.
- `DocumentsTable.tsx` — grouped rows, multi-select checkboxes, role-gated row actions (preview/download always; edit/delete managed-only).
- `DocumentPreviewModal.tsx` — lightbox: PDF via `<iframe>`, image via `<img>`, other → download-only state; prev/next across the **currently filtered+sorted** list.
- `DocumentFormDialog.tsx` — add/edit; drag-drop multi-file upload; validation + friendly errors.
- `documents/documentTypes.ts` — the doc-type list (extracted from the inline array).

### 4.3 Behaviours
- **Summary cards:** All documents · Managed · Insight-linker · Need attention (expired/expiring/COC-fail count).
- **Search:** name + type + shop. **Filters:** source · type/category · status · shop. **Organise by (nested):** Section → category (default — Building / each Shop / Site-level, collapsible sections + category sub-headers in `order_index` order) · Category · Source · Status · None.
- **Source affordance:** managed = "Managed" (pencil) badge; IL = "Live" (lock) badge → never shows edit/delete.
- **Preview:** modal/lightbox, prev/next.
- **Download:** single-file (managed = signed; IL = direct). "Download selected" = sequential downloads (no zip).
- **Add/update/delete (managed only, admin/manager gated):** drag-drop multi-upload, inline metadata edit, bulk select→delete. Optimistic-friendly or re-fetch (implementer's call; must not flicker).
- **Expiry:** status badges + "Need attention" filter/count. No new notifications.

### 4.4 Security & cross-platform constraints
- IL security posture unchanged (RPC `SECURITY DEFINER` + `can_access_building`); no direct `insight_linker.*` exposure; no new buckets/prefixes.
- Managed writes are role-gated in UI to match `building_documents` RLS (admin/manager write).
- `file_url` stored format is **unchanged** (keeps iOS + existing rows working); the 403 is fixed by always resolving through `resolveStorageUrl()` before embed/download — never using the raw URL directly.

---

## 5. Testing & deployment

- **Local gate:** `tsc --noEmit` (vite/vitest reportedly broken on this machine — last handoff).
- **Unit tests** (vitest, `pool:'forks'`): `unifyDocuments` mapper; filter/group/sort logic; URL resolution (path vs legacy URL; managed vs IL). Run remotely if local is broken.
- **Manual QA on a Vercel preview deploy** against real data:
  - AbaQulusi (rich shop docs, matched + unmatched shops),
  - a building with **no** IL docs (managed-only path),
  - Yarona (site-level docs).
  - Verify: search/filter/group/preview/download; add (drag-drop multi), edit, bulk delete; role-gating (read-only user sees no edit/delete); expiry states; the 403 bug is gone (old + new docs open).
- **Ship:** `vercel --prod` after owner visual-QA sign-off (per [[reference_web_deploy]]).

---

## 6. Open flags / can-revisit
- Bulk download is sequential, not zip. Zip = +JSZip dependency + more failure modes; add only if requested.
- Default group-by = Source; trivial to change.
- A dedicated thin "documents-only" RPC could replace reuse of `building_insight_linker` if the full electrical payload proves too heavy for this tab — deferred (YAGNI) until measured.
- **Revision 2026-06-19 (post-preview-QA):** initial flat single-level grouping replaced with two-level **Section → category** nesting (collapsible sections + category sub-headers) after QA showed insight-linker docs dumping as one flat list. Exact category order surfaced via `sql/2026-06-19_03` (`category_order` = `document_categories.order_index`), applied to prod + staging. Managed building docs render flat (no sub-headers); IL shop + site docs group by category.
