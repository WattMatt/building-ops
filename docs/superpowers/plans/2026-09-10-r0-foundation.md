# R0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the open high findings from the September reporting and access reviews and leave a clean base for R1, with no new user-facing features.

**Architecture:** Small, self-contained diffs inside the existing Fortress report editor, artifact persistence layer, auth guard, and hints hook. One additive migration on the web-owned `report_artifacts` table (in `supabase/migrations/`) and one additive migration on the shared `profiles` table (authored in the sibling `../GMI/sql/` repo, then vendored). Every behaviour change ships with a vitest.

**Tech Stack:** Vite + React 18 + TypeScript, TanStack Query, shadcn/ui, Supabase JS, pdfmake, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-10-daily-ops-v2-roadmap-design.md` §5 R0.

**Conventions to follow (from the codebase):**
- Every `.delete()` / `.update()` that must have hit a row chains `.select('id')` and treats zero rows as failure.
- Coaching copy goes through `<Hint>`; validation, warnings and unsaved-changes cues never do.
- Errors surface with their cause in the toast; DEV-only `console.error` for detail.
- Tests: `npm run test` (vitest run). Run a single file with `npx vitest run <path>`.
- Commit after each task with a message in the imperative, describing the user-visible effect.

---

### Task 1: K1 — KPI cards read only approved reports, and say so

**Files:**
- Modify: `src/hooks/useBuildingKpis.ts:32-37`
- Modify: `src/components/building/ReportsTab.tsx:33-34, 125-142`
- Create: `src/hooks/useBuildingKpis.test.ts`

- [ ] **Step 1: Write the failing test** — assert the query filters on `status = 'approved'`.

```ts
// src/hooks/useBuildingKpis.test.ts
import { describe, it, expect, vi } from 'vitest';

// Records every chained call so the test can assert the filter was applied.
const calls = vi.hoisted(() => ({ eq: [] as [string, unknown][] }));
vi.mock('@/integrations/supabase/fortress-db', () => {
  const builder: any = {
    select: () => builder,
    eq: (c: string, v: unknown) => { calls.eq.push([c, v]); return builder; },
    in: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return { fdb: { from: () => builder } };
});

import { latestApprovedReport } from './useBuildingKpis';

describe('latestApprovedReport', () => {
  it('only considers approved reports', async () => {
    calls.eq.length = 0;
    await latestApprovedReport('b1', 'ops_monthly');
    expect(calls.eq).toContainEqual(['status', 'approved']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/hooks/useBuildingKpis.test.ts`
Expected: FAIL — `latestApprovedReport` is not exported.

- [ ] **Step 3: Implement** — rename, export, and filter by status. Replace lines 32-37 of `src/hooks/useBuildingKpis.ts`:

```ts
/**
 * The newest APPROVED report of a type for a building. Dashboards and KPI cards
 * read from this, so a half-filled draft or a rejected report can never become the
 * building's headline numbers (finding K1). Exported for the unit test.
 */
export async function latestApprovedReport(buildingId: string, type: string) {
  const rows = await fdb.from('reports').select('*')
    .eq('building_id', buildingId).eq('report_type', type).eq('status', 'approved')
    .order('report_period', { ascending: false }).limit(1);
  return rows.data?.[0] ?? null;
}
```

Then replace the three `latestApproved(bid, …)` calls at lines 46-48 with `latestApprovedReport(bid, …)`.

- [ ] **Step 4: Caption the KPI block with provenance.** In `src/components/building/ReportsTab.tsx`, the hook already returns `ops` and `cm`. Where the KPI tab content renders (around line 142, the `.map((k) => <KpiCard …/>)`), add above the grid:

```tsx
<p className="mb-2 text-xs text-muted-foreground">
  From {kpiData?.ops ? `Monthly OPS Report — ${formatPeriodLabel(kpiData.ops.report_period)} · approved` : ''}
  {kpiData?.ops && kpiData?.cm ? ' · ' : ''}
  {kpiData?.cm ? `Monthly CM Report — ${formatPeriodLabel(kpiData.cm.report_period)} · approved` : ''}
</p>
```

Import `formatPeriodLabel` from `@/lib/fortressReports` if not already imported. Where `hasApproved` is false (line 125 branch), the existing tab is hidden; add an explanatory line in the place the tabs would render:

```tsx
{!hasApproved && (
  <p className="text-sm text-muted-foreground">KPIs appear once a monthly report is approved.</p>
)}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/hooks/useBuildingKpis.test.ts && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'`
Expected: test PASS; error count ≤ 70 (the baseline).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useBuildingKpis.ts src/hooks/useBuildingKpis.test.ts src/components/building/ReportsTab.tsx
git commit -m "Make building KPIs read only approved reports, and caption where they come from"
```

---

### Task 2: R1 — A report cannot be returned without a note

**Files:**
- Modify: `src/components/reports/fortress/FortressReportEditor.tsx:269-275, 353-358`

- [ ] **Step 1: Disable Return until a note is typed.** Replace the footer button at lines 356-358:

```tsx
<Button
  variant="destructive"
  disabled={lifecycle.isPending || !reviewNotes.trim()}
  onClick={() => reviewOpen && transition(reviewOpen, reviewNotes.trim())}
>
  Return to author
</Button>
```

And under the `<Textarea>` add a visible (non-Hint) requirement line:

```tsx
{!reviewNotes.trim() && (
  <p className="text-xs text-muted-foreground">A note is required — it is the only thing the author will see.</p>
)}
```

- [ ] **Step 2: Fallback banner for legacy empty-note rejections.** Replace lines 269-275:

```tsx
{status === 'rejected' && (
  <Card className="border-destructive/40">
    <CardContent className="pt-4 text-sm">
      <span className="font-medium text-destructive">Returned: </span>
      {report.review_notes?.trim() || 'No note was left with this return. Ask the reviewer what needs to change.'}
    </CardContent>
  </Card>
)}
```

- [ ] **Step 3: Typecheck and run the suite**

Run: `npm run test && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'`
Expected: all tests pass; error count ≤ 70.

- [ ] **Step 4: Commit**

```bash
git add src/components/reports/fortress/FortressReportEditor.tsx
git commit -m "Require a note when returning a report, and never show a returned report with no reason"
```

---

### Task 3: E3 — Saved Reports card shows a load error as an error

**Files:**
- Modify: `src/components/reports/SavedReportsCard.tsx:35-42, 104-111`

- [ ] **Step 1: Destructure the error state.** Line 35 becomes:

```ts
const { data, isLoading, isError, refetch } = useQuery({
```

- [ ] **Step 2: Add the error branch** between the loading and empty branches (replace lines 104-111):

```tsx
{isLoading ? (
  <div className="flex items-center justify-center py-8">
    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
  </div>
) : isError ? (
  <div className="py-4 text-sm">
    <p className="text-destructive">Could not load saved reports.</p>
    <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>Try again</Button>
  </div>
) : !data || data.length === 0 ? (
  <p className="py-4 text-sm text-muted-foreground">
    No saved reports yet. Generated PDFs will appear here automatically.
  </p>
) : (
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'`
Expected: ≤ 70.

- [ ] **Step 4: Commit**

```bash
git add src/components/reports/SavedReportsCard.tsx
git commit -m "Stop reporting a failed Saved Reports load as an empty list"
```

---

### Task 4: M-1 and M-8 — no dead-end Settings link, and a fetch failure is not "Access Denied"

**Files:**
- Modify: `src/contexts/AuthContext.tsx` (expose `refreshRole`)
- Modify: `src/components/ProtectedRoute.tsx:45-56`
- Modify: `src/components/layout/DashboardLayout.tsx:282-285`
- Modify: `src/components/ProtectedRoute.test.tsx`

- [ ] **Step 1: Write the failing tests.** Append to `src/components/ProtectedRoute.test.tsx` (the file already has `authState`, `renderGuard`, and mocks for `useAuth` and `react-router-dom`; extend the `authState.current` shape with `refreshRole: vi.fn()` in the hoisted default):

```tsx
describe('access-denied copy', () => {
  it('names a role-fetch failure and offers a retry', () => {
    authState.current = { ...authState.current, role: null, authError: true };
    renderGuard(['admin']);
    expect(screen.getByText(/couldn.t verify your access/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('keeps the plain permission message when the role is simply wrong', () => {
    authState.current = { ...authState.current, role: 'user', authError: false };
    renderGuard(['admin']);
    expect(screen.getByText(/don.t have permission/i)).toBeInTheDocument();
    expect(screen.getByText(/back to dashboard/i)).toBeInTheDocument();
  });
});
```

The `react-router-dom` mock must also provide `Link`: add `Link: ({ to, children }: { to: string; children: ReactNode }) => h('a', { href: to }, children)` to the mocked module.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/ProtectedRoute.test.tsx`
Expected: FAIL — copy not found.

- [ ] **Step 3: Expose `refreshRole` from AuthContext.** In `src/contexts/AuthContext.tsx`, add to the context value type and provider:

```ts
/** Re-run the role/profile fetch for the current session (M-8: a transient failure
 *  must not read as a permissions problem, and the user needs a way to retry). */
refreshRole: () => Promise<void>;
```

Implementation next to the other handlers:

```ts
const refreshRole = async () => {
  if (!user?.id) return;
  setLoading(true);
  await fetchUserRole(user.id);
};
```

Add `refreshRole` to the provider `value` object.

- [ ] **Step 4: Branch the denied screen.** Replace lines 45-56 of `src/components/ProtectedRoute.tsx`:

```tsx
if (allowedRoles && (authError || !role || !allowedRoles.includes(role))) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="max-w-sm text-center">
        {authError ? (
          <>
            <h1 className="mb-2 text-2xl font-bold">Couldn’t verify your access</h1>
            <p className="text-muted-foreground">
              Your role could not be loaded, so this page is locked for now. This is usually a connection problem, not a permissions one.
            </p>
            <button
              type="button"
              className="mt-4 rounded-md border px-4 py-2 text-sm"
              onClick={() => { void refreshRole(); }}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-2xl font-bold text-destructive">Access Denied</h1>
            <p className="text-muted-foreground">You don't have permission to access this page.</p>
          </>
        )}
        <p className="mt-4 text-sm">
          <Link to="/" className="underline">Back to dashboard</Link>
        </p>
      </div>
    </div>
  );
}
```

Update the imports: `import { Link, Navigate, useLocation } from 'react-router-dom';` and destructure `refreshRole` from `useAuth()`.

- [ ] **Step 5: Gate the footer Settings item.** In `src/components/layout/DashboardLayout.tsx` line 134 add `isAdminOrManager` to the `useAuth()` destructure (it is exported by the context; check `AuthContext.tsx` for the exact name — it is used by `FortressReportEditor.tsx:32`). Replace lines 282-285:

```tsx
{isAdminOrManager && (
  <DropdownMenuItem onClick={() => navigate('/settings')}>
    <Settings className="w-4 h-4 mr-2" />
    Settings
  </DropdownMenuItem>
)}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/components/ProtectedRoute.test.tsx && npm run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/contexts/AuthContext.tsx src/components/ProtectedRoute.tsx src/components/ProtectedRoute.test.tsx src/components/layout/DashboardLayout.tsx
git commit -m "Tell users when access could not be verified (with retry), and hide Settings from roles that cannot open it"
```

---

### Task 5: D1 — Unsaved section edits are never silently discarded

**Files:**
- Create: `src/components/reports/fortress/dirtySections.ts`
- Create: `src/components/reports/fortress/dirtySections.test.ts`
- Modify: `src/components/reports/fortress/EditableGrid.tsx:43-61`
- Modify: `src/components/reports/fortress/FortressReportEditor.tsx` (nav, back button, submit, export, beforeunload)

Design: a tiny module-level store (no provider). Only the active section is mounted, so any dirty grid belongs to the current section; the editor needs "any dirty" plus the count.

- [ ] **Step 1: Write the failing store test**

```ts
// src/components/reports/fortress/dirtySections.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { dirtySections } from './dirtySections';

describe('dirtySections store', () => {
  beforeEach(() => dirtySections.reset());

  it('starts clean', () => {
    expect(dirtySections.count()).toBe(0);
  });

  it('tracks ids and notifies subscribers', () => {
    let seen = -1;
    const off = dirtySections.subscribe(() => { seen = dirtySections.count(); });
    dirtySections.set('expense_recoveries', true);
    dirtySections.set('utility_readings', true);
    expect(seen).toBe(2);
    dirtySections.set('expense_recoveries', false);
    expect(seen).toBe(1);
    off();
  });

  it('reset clears everything', () => {
    dirtySections.set('a', true);
    dirtySections.reset();
    expect(dirtySections.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/reports/fortress/dirtySections.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store and hooks**

```ts
// src/components/reports/fortress/dirtySections.ts
/**
 * Which report-section grids currently hold unsaved edits (finding D1).
 *
 * Grids keep their edits locally until "Save section"; switching section, pressing
 * Back, refreshing, or submitting used to unmount the grid and drop the edits with no
 * warning. This store lets the editor know a section is dirty so it can confirm before
 * navigating, guard `beforeunload`, and block Submit / Export until saved.
 *
 * Module-level rather than a React context so grids nested at any depth can report
 * without prop drilling, and so it is trivially unit-testable.
 */
import { useEffect, useSyncExternalStore } from 'react';

const ids = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function emit() { version += 1; listeners.forEach((l) => l()); }

export const dirtySections = {
  set(id: string, dirty: boolean) {
    const had = ids.has(id);
    if (dirty && !had) { ids.add(id); emit(); }
    if (!dirty && had) { ids.delete(id); emit(); }
  },
  count() { return ids.size; },
  reset() { if (ids.size) { ids.clear(); emit(); } },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};

/** Report this grid's dirty state; clears itself on unmount. */
export function useReportDirty(id: string, dirty: boolean) {
  useEffect(() => { dirtySections.set(id, dirty); }, [id, dirty]);
  useEffect(() => () => dirtySections.set(id, false), [id]);
}

/** Number of grids with unsaved edits in the mounted section. */
export function useDirtyCount(): number {
  return useSyncExternalStore(dirtySections.subscribe, () => version && dirtySections.count(), () => 0);
}
```

Note: `version && dirtySections.count()` keeps the snapshot referentially stable between emits while still returning the count; when `version` is 0 the count is also 0.

- [ ] **Step 4: Run the store test**

Run: `npx vitest run src/components/reports/fortress/dirtySections.test.ts`
Expected: PASS.

- [ ] **Step 5: Report from EditableGrid.** In `src/components/reports/fortress/EditableGrid.tsx` add the import and one hook call after the `dirty` state (line 46):

```ts
import { useReportDirty } from './dirtySections';
// …inside the component, after `const [dirty, setDirty] = useState(false);`
useReportDirty(table, dirty);
```

- [ ] **Step 6: Guard the editor.** In `src/components/reports/fortress/FortressReportEditor.tsx`:

Imports:
```ts
import { dirtySections, useDirtyCount } from './dirtySections';
```

After `const [submitting, setSubmitting] = useState(false);`:
```ts
const dirtyCount = useDirtyCount();
const anyDirty = dirtyCount > 0;

// Refresh / tab close with unsaved edits: the browser shows its own confirm.
useEffect(() => {
  if (!anyDirty) return;
  const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}, [anyDirty]);

// Leaving the editor entirely must not leave stale ids behind for the next report.
useEffect(() => () => dirtySections.reset(), []);

/** True when it is safe to leave the current section (clean, or the user chose to discard). */
const confirmLeave = () => {
  if (!anyDirty) return true;
  const ok = window.confirm('This section has unsaved changes. Discard them?');
  if (ok) dirtySections.reset();
  return ok;
};
```

Back button (line 214): `onClick={() => { if (confirmLeave()) navigate(`/buildings/${report.building_id}?tab=reports`); }}`

Nav button (line 290): `onClick={() => { if (s.key === current || confirmLeave()) setActiveKey(s.key); }}` and add an unsaved dot beside the label for the current section:

```tsx
<span className="flex min-w-0 items-center gap-1.5">
  <span className="truncate">{s.label}</span>
  {current === s.key && anyDirty && (
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-label="Unsaved changes" />
  )}
</span>
```

Submit: at the top of `validateAndSubmit`, before `setSubmitting(true)`:
```ts
if (anyDirty) { toast.error('Save your changes in this section before submitting.'); return; }
```

Export: at the top of `handleExport`:
```ts
if (anyDirty) { toast.error('Save your changes in this section before exporting.'); return; }
```

- [ ] **Step 7: Run the suite and typecheck**

Run: `npm run test && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'`
Expected: PASS; ≤ 70.

- [ ] **Step 8: Commit**

```bash
git add src/components/reports/fortress/dirtySections.ts src/components/reports/fortress/dirtySections.test.ts src/components/reports/fortress/EditableGrid.tsx src/components/reports/fortress/FortressReportEditor.tsx
git commit -m "Never silently discard unsaved section edits: confirm on leave, guard refresh, block Submit and Export while dirty"
```

---

### Task 6: E1 and E2 — Export confirms completeness, drafts are watermarked, artifacts record their status

**Files:**
- Create: `supabase/migrations/2026-09-10_01_report_artifacts_report_status.sql`
- Modify: `src/lib/reportArtifacts.ts:40-56, 117-127, 171-184`
- Modify: `src/lib/fortressReportDoc.ts:143, 603-619`
- Modify: `src/lib/fortressReportDoc.test.ts` (add case)
- Modify: `src/lib/fortressReportPdf.ts:722-726`
- Modify: `src/components/reports/fortress/FortressReportEditor.tsx` (export confirm dialog, supersede toast)
- Modify: `src/components/reports/fortress/ReportSavedVersions.tsx:94-105`

- [ ] **Step 1: Migration (web-owned table, so it lives in `supabase/migrations/`).** Apply staging-first via the Management API per project practice; this repo never runs `db push`.

```sql
-- 2026-09-10_01_report_artifacts_report_status.sql
-- Record the lifecycle state of the source report at export time (finding E2), so a PDF
-- issued from a draft is distinguishable from one issued after approval — in the app
-- and in the version list. Nullable: pre-existing rows and non-Fortress kinds have none.
-- Idempotent. Apply order: staging (vkrihpmjajjcxmzgjqdr) -> verify -> prod (qdzgkttiosahdfqresvz).
begin;

alter table public.report_artifacts
  add column if not exists report_status text
  check (report_status is null or report_status in ('draft','submitted','reviewed','approved','rejected'));

comment on column public.report_artifacts.report_status is
  'Status of the source report when this PDF was generated; null for ad-hoc kinds.';

commit;
```

- [ ] **Step 2: Failing doc test — DRAFT watermark.** Append to `src/lib/fortressReportDoc.test.ts`:

```ts
describe('buildReportDoc — provenance', () => {
  it('watermarks the document when a watermark is requested', () => {
    const doc = buildReportDoc(
      { title: 'X', report_period: '2026-06-01', report_type: 'ops_monthly' },
      {},
      { color: '#2563eb', orgName: 'Org', watermark: 'DRAFT' },
    );
    expect((doc as { watermark?: { text: string } }).watermark?.text).toBe('DRAFT');
  });

  it('has no watermark by default', () => {
    const doc = buildReportDoc(
      { title: 'X', report_period: '2026-06-01', report_type: 'ops_monthly' },
      {},
      { color: '#2563eb', orgName: 'Org' },
    );
    expect((doc as { watermark?: unknown }).watermark).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/fortressReportDoc.test.ts`
Expected: FAIL — `watermark` not in `DocOptions` (type error) / undefined.

- [ ] **Step 4: Add the watermark option.** `src/lib/fortressReportDoc.ts` line 143:

```ts
export interface DocOptions { color: string; orgName: string; logoDataUrl?: string | null; watermark?: string | null }
```

In the returned definition (lines 603-619) add, after `pageMargins`:

```ts
...(opts.watermark
  ? { watermark: { text: opts.watermark, color: '#9ca3af', opacity: 0.08, bold: true, italics: false } }
  : {}),
```

If `src/types/pdfmake.d.ts` does not declare `watermark` on `TDocumentDefinitions`, add:

```ts
watermark?: string | { text: string; color?: string; opacity?: number; bold?: boolean; italics?: boolean; fontSize?: number; angle?: number };
```

- [ ] **Step 5: Run the doc test**

Run: `npx vitest run src/lib/fortressReportDoc.test.ts`
Expected: PASS.

- [ ] **Step 6: Watermark non-approved exports and return the status.** In `src/lib/fortressReportPdf.ts`:

`GeneratedFortressPdf` gains `reportStatus: string;`. Lines 722-726 become:

```ts
const doc = buildReportDoc(
  { title: report.title, report_period: report.report_period, report_type: report.report_type as ReportType, managers, prepared_for: report.prepared_for ?? null },
  data,
  {
    color, orgName: branding.name, logoDataUrl,
    // Anything not yet approved is visibly a draft in the client's hands (E2).
    watermark: report.status === 'approved' ? null : 'DRAFT',
  },
);
```

And the return at line 731: `return { blob, fileName, buildingId: report.building_id, reportType: report.report_type as ReportType, reportStatus: report.status };`

- [ ] **Step 7: Persist the status on the artifact row.** In `src/lib/reportArtifacts.ts`:

`ReportArtifactRow` gains `report_status: string | null;`. `SaveReportArtifactInput` gains:
```ts
/** Lifecycle status of the source report at export time; omit for ad-hoc kinds. */
reportStatus?: string | null;
```
The insert (lines 173-184) adds `report_status: input.reportStatus ?? null,`. `ReportArtifactInsert` is derived from the row type so it picks the field up automatically.

- [ ] **Step 8: Export confirm in the editor.** In `FortressReportEditor.tsx`:

State: `const [exportConfirm, setExportConfirm] = useState(false);`

Rename the existing `handleExport` body to `runExport` (unchanged logic, but pass `reportStatus: generated.reportStatus` into `saveReportArtifact`, and after `if (saved.ok)` add:
```ts
if (saved.supersedeWarning) toast.warning(saved.supersedeWarning);
```
). New `handleExport`:

```ts
const emptySections = counts
  ? sections.filter((s) => getSectionComponent(s.key) && counts[s.key] === 0).map((s) => s.label)
  : [];
const handleExport = () => {
  if (anyDirty) { toast.error('Save your changes in this section before exporting.'); return; }
  if (emptySections.length || status !== 'approved') { setExportConfirm(true); return; }
  void runExport();
};
```

Note `sections`, `counts` and `status` are computed after the early returns in the current file; move the `handleExport`/`runExport` definitions below `const status = …` (line 129) so they can read them, or hoist those three values above the early returns. Hoisting is simpler: compute `sections`, `status`, `emptySections` right after `filledCount`, guarded with `report?.` optional chaining.

Dialog, next to the review dialog:

```tsx
<Dialog open={exportConfirm} onOpenChange={setExportConfirm}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Export this report as a PDF?</DialogTitle>
      <DialogDescription>
        {status !== 'approved' && <>This report is <b>{status}</b>, not approved — the PDF will carry a DRAFT watermark. </>}
        {emptySections.length > 0 && <>{emptySections.length} of {sections.length} sections are empty: {emptySections.join(', ')}. </>}
        Every export is kept as the next issued version.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" onClick={() => setExportConfirm(false)}>Cancel</Button>
      <Button onClick={() => { setExportConfirm(false); void runExport(); }}>Export anyway</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 9: Show provenance in the version list.** In `ReportSavedVersions.tsx` replace lines 103-105:

```tsx
{a.status === 'issued' && <Badge className="text-xs">Current</Badge>}
{a.status === 'superseded' && <Badge variant="outline" className="text-xs">superseded</Badge>}
{a.report_status && a.report_status !== 'approved' && (
  <Badge variant="outline" className="text-xs">exported while {a.report_status}</Badge>
)}
```

- [ ] **Step 10: Run the suite and typecheck**

Run: `npm run test && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'`
Expected: PASS; ≤ 70. `reportArtifacts.test.ts` (if present) may need its fake insert row extended with `report_status: null`.

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/2026-09-10_01_report_artifacts_report_status.sql src/lib/reportArtifacts.ts src/lib/fortressReportDoc.ts src/lib/fortressReportDoc.test.ts src/lib/fortressReportPdf.ts src/types/pdfmake.d.ts src/components/reports/fortress/FortressReportEditor.tsx src/components/reports/fortress/ReportSavedVersions.tsx
git commit -m "Confirm before exporting an incomplete or unapproved report, watermark drafts, and record the status on each issued PDF"
```

---

### Task 7: Hints preference moves to `profiles.show_hints`

**Files:**
- Create: `../GMI/sql/2026-09-10_01_profiles_show_hints.sql` (canonical, shared table)
- Run: `npm run schema:vendor` → updates `supabase/schema/`
- Modify: `src/hooks/useHints.tsx`
- Modify: `src/hooks/useHints.test.tsx`

- [ ] **Step 1: Migration in the canonical repo**

```sql
-- 2026-09-10_01_profiles_show_hints.sql
-- Per-user in-app hints preference (web). Replaces the localStorage fallback so the
-- choice follows the user across devices. Default on: first-time users get guidance.
-- Additive, idempotent. The existing profiles update policy (own row) covers writes.
begin;
alter table public.profiles add column if not exists show_hints boolean not null default true;
commit;
```

Then: `npm run schema:vendor` and confirm `supabase/schema/2026-09-10_01_profiles_show_hints.sql` appears and `.source` updated.

- [ ] **Step 2: Failing hook test.** Read `src/hooks/useHints.test.tsx` first; it mocks `useAuth`. Add a mock for `@/integrations/supabase/client` that records `update` calls and returns `{ data: { show_hints: false }, error: null }` for the select, then add:

```tsx
it('reads the preference from the profile and writes changes back', async () => {
  // profile says off → hintsEnabled false after load
  // setHintsEnabled(true) → supabase.from('profiles').update({ show_hints: true }).eq('id', userId)
});
```

Fill the body against the file's existing render helper; assert the update mock was called with `{ show_hints: true }`.

- [ ] **Step 3: Implement.** Replace the body of `HintsProvider` in `src/hooks/useHints.tsx`:

```tsx
import { supabase } from '@/integrations/supabase/client';

export function HintsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [hintsEnabled, setEnabled] = useState(true);

  // Profile column is the source of truth; localStorage remains a fallback so the
  // toggle still works if the column is not yet migrated or the read fails.
  useEffect(() => {
    let cancelled = false;
    const local = () => {
      try { return window.localStorage.getItem(storageKey(user?.id)) !== 'off'; } catch { return true; }
    };
    if (!user?.id) { setEnabled(local()); return; }
    (async () => {
      const { data, error } = await supabase.from('profiles').select('show_hints').eq('id', user.id).maybeSingle();
      if (cancelled) return;
      const v = (data as { show_hints?: boolean } | null)?.show_hints;
      setEnabled(error || typeof v !== 'boolean' ? local() : v);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const value = useMemo<HintsContextValue>(() => ({
    hintsEnabled,
    setHintsEnabled: (on: boolean) => {
      setEnabled(on);
      try { window.localStorage.setItem(storageKey(user?.id), on ? 'on' : 'off'); } catch { /* best-effort */ }
      if (user?.id) {
        void supabase.from('profiles').update({ show_hints: on } as never).eq('id', user.id).then(({ error }) => {
          if (error && import.meta.env.DEV) console.warn('show_hints not saved to profile:', error.message);
        });
      }
    },
  }), [hintsEnabled, user?.id]);

  return <HintsContext.Provider value={value}>{children}</HintsContext.Provider>;
}
```

Update the file header comment to say the profile column is now the store and localStorage the fallback.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/hooks/useHints.test.tsx && npm run test`
Expected: PASS.

- [ ] **Step 5: Commit (both repos)**

```bash
git -C ../GMI add sql/2026-09-10_01_profiles_show_hints.sql && git -C ../GMI commit -m "Add profiles.show_hints for the web hints preference"
git add supabase/schema src/hooks/useHints.tsx src/hooks/useHints.test.tsx
git commit -m "Store the hints preference on the profile so it follows the user across devices"
```

---

### Task 8: Quality ratchet — lower the typecheck baseline, add the Fortress smokes to the chain

**Files:**
- Modify: `.github/typecheck-baseline.txt`
- Modify: `package.json:15`

- [ ] **Step 1: Count current errors**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'`
Expected: a number ≤ 70. Write that number into `.github/typecheck-baseline.txt` (no trailing whitespace beyond a newline).

- [ ] **Step 2: Fix the cheapest errors.** List them: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | sort | uniq -c | sort -rn | head -20`. Fix any TS7053 (`any` index) or TS2339 in files touched by this plan. Re-count and lower the baseline again. Do not chase all 70; stop after the ones in touched files.

- [ ] **Step 3: Add the Fortress smokes.** In `package.json` append to the `smoke` script:

```
&& node scripts/fortress-smoke.mjs && node scripts/fortress-pdf-smoke.mjs
```

Confirm both scripts exist: `ls scripts/fortress-smoke.mjs scripts/fortress-pdf-smoke.mjs`.

- [ ] **Step 4: Full verification**

Run: `npm run test && npm run build && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'`
Expected: tests pass, build succeeds, count equals the new baseline.

- [ ] **Step 5: Commit**

```bash
git add .github/typecheck-baseline.txt package.json
git commit -m "Lower the typecheck baseline and run the Fortress smokes in the standing battery"
```

---

### Task 9: Owner actions (not code — hand to Arno)

- [ ] Open a PR from `feat/reports-access-hardening` to `main` and merge.
- [ ] Apply `supabase/migrations/2026-09-10_01_report_artifacts_report_status.sql` and `GMI/sql/2026-09-10_01_profiles_show_hints.sql` to staging, run `npm run smoke`, then prod, then smoke again.
- [ ] Deploy edge functions changed on the branch: `set-user-role`, `invite-user`, `notify-signoff-request`, `notify-signoff-complete`, and `notify-expiring-alerts` (set its cron secret).
- [ ] Set `SMOKE_SUPABASE_URL`, `SMOKE_SUPABASE_ANON_KEY`, `SMOKE_SUPABASE_SERVICE_ROLE_KEY` repository secrets for the **staging** project so `.github/workflows/smoke.yml` runs.
- [ ] Set `building_type` on the two production buildings.
- [ ] Regenerate types after the migrations: `supabase gen types typescript --project-id qdzgkttiosahdfqresvz > src/integrations/supabase/types.ts`.

---

## Self-review

- Spec coverage (R0 list in the design doc): merge branch → Task 9; staging secrets → Task 9; K1 → Task 1; D1 → Task 5; R1 → Task 2; E1/E2 → Task 6; E3 → Task 3; M-1/M-8 → Task 4; expiring-alerts deploy → Task 9; show_hints → Task 7; building_type → Task 9; baseline + smokes → Task 8. All covered.
- Placeholders: none. Every code step shows the code.
- Type consistency: `latestApprovedReport` (Task 1) used consistently; `useReportDirty`/`useDirtyCount`/`dirtySections` (Task 5) match between store and consumers; `reportStatus` on `GeneratedFortressPdf` and `SaveReportArtifactInput`, `report_status` on the row (Task 6); `refreshRole` (Task 4) added to the context and consumed by the guard.
