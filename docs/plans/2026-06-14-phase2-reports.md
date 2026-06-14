# Phase 2 — Reports Ring-Fenced Per Building + Portfolio Rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Generate the (already-working) H&S compliance PDF from *inside* each building, add an admin-only org-wide portfolio rollup PDF, and remove the dead report buttons/cards on the standalone Reports page.

**Architecture:** The H&S PDF generator (`generateHsCompliancePdf`) and `computeHsScores` already exist and work. We (1) extract the H&S data-assembly orchestration into a shared `src/lib/hsReportData.ts` so both the org page and the per-building tab call one code path (DRY), (2) surface it in `ReportsTab`, (3) add a new `generatePortfolioSummaryPdf` fed by `computeHsScores`, and (4) repurpose the standalone Reports page into an admin/manager-only "Portfolio Reports" view, deleting the 4 unimplemented report cards and wiring the dead "Generate New Report" button to the portfolio PDF.

**Tech Stack:** React 18, Vite, TS, Supabase, pdfMake, vitest, lucide-react, shadcn/ui.

Source spec: `docs/2026-06-14_WEB_OPS_OVERHAUL_SESSION_PLAN.md` (WS-B). Baseline gate: `tsc --noEmit = 0`; tests via `npx vitest run <file>` (pool forks).

**Branch:** `feat/web-ops-phase2` (already created off `main`). Verify with `git branch --show-current`; do not switch.

---

## Task 1: Extract shared H&S report helper (DRY)

Pull the ~90-line H&S data-assembly + PDF call out of `Reports.tsx` into a reusable function so the per-building tab (Task 2) can call the exact same path.

**Files:**
- Create: `src/lib/hsReportData.ts`
- Modify: `src/pages/Reports.tsx`

- [ ] **Step 1: Create `src/lib/hsReportData.ts`**

```tsx
import { supabase } from '@/integrations/supabase/client';
import { resolveStorageUrl } from '@/integrations/supabase/storage';
import { generateHsCompliancePdf } from './pdfGenerator';
import type { HsTask, HsDocument } from './hsComplianceReport';

const MAX_EMBEDDED_PHOTOS = 30;

export interface HsReportBranding {
  name: string;
  logoUrl?: string | null;
  primaryColor: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * Assemble one building's H&S evidence data over a date range and download a
 * branded PDF. Shared by the org Reports page (building picker) and the
 * per-building Reports tab so both produce an identical report.
 */
export async function generateBuildingHsReport(opts: {
  buildingId: string;
  buildingName: string;
  rangeStart: string; // yyyy-MM-dd
  rangeEnd: string;
  branding: HsReportBranding;
}): Promise<void> {
  const { buildingId, buildingName, rangeStart, rangeEnd, branding } = opts;

  const { data: taskRows, error: tasksError } = await supabase
    .from('task_instances')
    .select('id, task_name, category, status, due_date, completed_at, completed_by, completion_notes, photo_urls, signature_url')
    .eq('building_id', buildingId)
    .gte('due_date', rangeStart)
    .lte('due_date', rangeEnd)
    .not('category', 'is', null)
    .order('due_date');
  if (tasksError) throw tasksError;

  const completerIds = [...new Set((taskRows || []).map((t) => t.completed_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (completerIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', completerIds);
    (profiles || []).forEach((p) => names.set(p.id, p.full_name ?? 'Unknown'));
  }

  const tasks: HsTask[] = (taskRows || []).map((t) => ({
    id: t.id,
    task_name: t.task_name,
    category: t.category,
    status: t.status,
    due_date: t.due_date,
    completed_at: t.completed_at,
    completed_by_name: t.completed_by ? (names.get(t.completed_by) ?? 'Unknown') : null,
    completion_notes: t.completion_notes,
    photo_urls: Array.isArray(t.photo_urls) ? (t.photo_urls as string[]) : [],
    signature_confirmed: Boolean(t.signature_url),
  }));

  const { data: docRows, error: docsError } = await supabase
    .from('building_documents')
    .select('id, name, document_type, expiry_date, issuing_authority, reference_number')
    .eq('building_id', buildingId)
    .order('document_type');
  if (docsError) throw docsError;
  const documents: HsDocument[] = (docRows || []).map((d) => ({ ...d, document_type: d.document_type ?? 'other' }));

  const photoDataUrls: Record<string, string[]> = {};
  let embedded = 0;
  const completedWithPhotos = tasks
    .filter((t) => t.status === 'completed' && t.photo_urls.length > 0)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  for (const t of completedWithPhotos) {
    if (embedded >= MAX_EMBEDDED_PHOTOS) break;
    try {
      const signed = await resolveStorageUrl(t.photo_urls[0]);
      if (!signed) continue;
      const blob = await (await fetch(signed)).blob();
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      photoDataUrls[t.id] = [dataUrl];
      embedded += 1;
    } catch {
      // photo unavailable — report shows "N photo(s) on file" without thumbnail
    }
  }

  await generateHsCompliancePdf({
    buildingName,
    rangeStart,
    rangeEnd,
    tasks,
    documents,
    photoDataUrls,
    branding,
  });
}
```

- [ ] **Step 2: Refactor `Reports.tsx` `handleGenerateHsReport` to call the helper**

Replace the entire `handleGenerateHsReport` function body with:

```tsx
  const handleGenerateHsReport = async () => {
    if (!hsBuildingId) { toast.error('Select a building'); return; }
    setHsGenerating(true);
    try {
      const building = hsBuildings.find((b) => b.id === hsBuildingId)!;
      await generateBuildingHsReport({
        buildingId: hsBuildingId,
        buildingName: building.name,
        rangeStart: hsStart,
        rangeEnd: hsEnd,
        branding: {
          name: organization?.name || 'Building Ops',
          logoUrl: organization?.logo_url,
          primaryColor: organization?.primary_color || '#2563eb',
          address: organization?.address,
          phone: organization?.phone,
          email: organization?.email,
        },
      });
      toast.success('H&S Compliance Report downloaded');
      setHsDialogOpen(false);
    } catch (error) {
      console.error('H&S report error:', error);
      toast.error('Failed to generate H&S report');
    } finally {
      setHsGenerating(false);
    }
  };
```

- [ ] **Step 3: Fix imports in `Reports.tsx`**

Add: `import { generateBuildingHsReport } from '@/lib/hsReportData';`
Then remove imports that are now ONLY used by the moved code — run eslint to confirm which are orphaned (candidates: `generateHsCompliancePdf`, `resolveStorageUrl`, `type { HsTask, HsDocument }`, and the `MAX_EMBEDDED_PHOTOS` const at module scope). Remove exactly those that eslint reports unused; keep anything still referenced.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"   # must be 0
npx eslint src/pages/Reports.tsx src/lib/hsReportData.ts   # no NEW findings; no unused imports
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/hsReportData.ts src/pages/Reports.tsx
git commit -m "refactor: extract shared generateBuildingHsReport helper (WS-B)"
```

---

## Task 2: Per-building H&S report generation in ReportsTab

Surface the report inside each building (the "ring-fence per building"). Building is fixed (no picker); reuse `generateBuildingHsReport`.

**Files:**
- Modify: `src/components/building/ReportsTab.tsx`

- [ ] **Step 1: Add imports + state + handler**

At the top of `ReportsTab.tsx`, add imports:

```tsx
import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { generateBuildingHsReport } from '@/lib/hsReportData';
```

Inside the component (after the existing hooks), add:

```tsx
  const { organization } = useOrganization();
  const [hsOpen, setHsOpen] = useState(false);
  const [hsStart, setHsStart] = useState(format(subDays(new Date(), 90), 'yyyy-MM-dd'));
  const [hsEnd, setHsEnd] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [hsGenerating, setHsGenerating] = useState(false);

  const handleGenerateHs = async () => {
    setHsGenerating(true);
    try {
      await generateBuildingHsReport({
        buildingId,
        buildingName: buildingName ?? 'Building',
        rangeStart: hsStart,
        rangeEnd: hsEnd,
        branding: {
          name: organization?.name || 'Building Ops',
          logoUrl: organization?.logo_url,
          primaryColor: organization?.primary_color || '#2563eb',
          address: organization?.address,
          phone: organization?.phone,
          email: organization?.email,
        },
      });
      toast.success('H&S Compliance Report downloaded');
      setHsOpen(false);
    } catch (error) {
      console.error('H&S report error:', error);
      toast.error('Failed to generate H&S report');
    } finally {
      setHsGenerating(false);
    }
  };
```

- [ ] **Step 2: Add the trigger button + dialog**

In the header row (the `<div className="flex items-center justify-between">` that holds the intro `<p>` and `NewReportDialog`), wrap the right-hand controls so both buttons sit together. Replace:

```tsx
        {isAdminOrManager && <NewReportDialog buildingId={buildingId} buildingName={buildingName} />}
```

with:

```tsx
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setHsOpen(true)}>
            <Download className="h-4 w-4 mr-2" />
            H&amp;S PDF
          </Button>
          {isAdminOrManager && <NewReportDialog buildingId={buildingId} buildingName={buildingName} />}
        </div>
```

Then add the dialog at the end of the component's returned JSX (just before the closing `</div>` of the root `<div className="space-y-6">`):

```tsx
      <Dialog open={hsOpen} onOpenChange={setHsOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>H&amp;S Compliance Report</DialogTitle>
            <DialogDescription>Branded PDF evidence pack for {buildingName ?? 'this building'} over a date range.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tab-hs-start">From</Label>
              <Input id="tab-hs-start" type="date" value={hsStart} onChange={(e) => setHsStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tab-hs-end">To</Label>
              <Input id="tab-hs-end" type="date" value={hsEnd} onChange={(e) => setHsEnd(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHsOpen(false)}>Cancel</Button>
            <Button onClick={handleGenerateHs} disabled={hsGenerating}>
              {hsGenerating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generate PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

(The H&S button is available to anyone who can view the building — matching the org page's no-gate behavior; report data is RLS-scoped to the building.)

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"   # 0
npx eslint src/components/building/ReportsTab.tsx   # no new findings
```

- [ ] **Step 4: Commit**

```bash
git add src/components/building/ReportsTab.tsx
git commit -m "feat: generate H&S compliance PDF from inside each building (WS-B)"
```

---

## Task 3: Portfolio summary — pure helper (test-first) + PDF generator

**Files:**
- Modify: `src/lib/hsScore.ts` (add `summarizePortfolio`)
- Test: `src/lib/hsScore.test.ts` (add a describe block)
- Modify: `src/lib/pdfGenerator.ts` (add `generatePortfolioSummaryPdf`)

- [ ] **Step 1: Write the failing test for `summarizePortfolio`**

Append to `src/lib/hsScore.test.ts`:

```tsx
import { summarizePortfolio } from './hsScore';

describe('summarizePortfolio', () => {
  const rows = [
    { building_id: 'a', name: 'A', total: 10, completed: 10, score: 100, hasExpiredCert: false },
    { building_id: 'b', name: 'B', total: 10, completed: 8, score: 80, hasExpiredCert: true },
    { building_id: 'c', name: 'C', total: 10, completed: 5, score: 50, hasExpiredCert: false },
    { building_id: 'd', name: 'D', total: 0, completed: 0, score: null, hasExpiredCert: false },
  ];
  it('counts bands, averages only scored buildings, and counts expired certs', () => {
    const s = summarizePortfolio(rows);
    expect(s.total).toBe(4);
    expect(s.good).toBe(1);      // 100
    expect(s.warning).toBe(1);   // 80
    expect(s.critical).toBe(1);  // 50
    expect(s.none).toBe(1);      // null
    expect(s.avgScore).toBe(77); // round((100+80+50)/3)
    expect(s.expiredCerts).toBe(1);
  });
  it('returns null average when no building has a score', () => {
    const s = summarizePortfolio([{ building_id: 'd', name: 'D', total: 0, completed: 0, score: null, hasExpiredCert: false }]);
    expect(s.avgScore).toBeNull();
    expect(s.none).toBe(1);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

```bash
npx vitest run src/lib/hsScore.test.ts
```
Expected: FAIL (`summarizePortfolio` is not exported).

- [ ] **Step 3: Implement `summarizePortfolio` in `src/lib/hsScore.ts`**

Append to `src/lib/hsScore.ts`:

```tsx
export interface PortfolioSummary {
  total: number;
  good: number;
  warning: number;
  critical: number;
  none: number;
  avgScore: number | null;
  expiredCerts: number;
}

/** Aggregate per-building scores into portfolio band counts + average. */
export function summarizePortfolio(rows: HsBuildingScore[]): PortfolioSummary {
  const scored = rows.filter((r) => r.score !== null) as (HsBuildingScore & { score: number })[];
  const avgScore = scored.length
    ? Math.round(scored.reduce((sum, r) => sum + r.score, 0) / scored.length)
    : null;
  return {
    total: rows.length,
    good: rows.filter((r) => scoreBand(r.score) === 'good').length,
    warning: rows.filter((r) => scoreBand(r.score) === 'warning').length,
    critical: rows.filter((r) => scoreBand(r.score) === 'critical').length,
    none: rows.filter((r) => scoreBand(r.score) === 'none').length,
    avgScore,
    expiredCerts: rows.filter((r) => r.hasExpiredCert).length,
  };
}
```

- [ ] **Step 4: Run the test, confirm it passes**

```bash
npx vitest run src/lib/hsScore.test.ts
```
Expected: PASS (all hsScore tests, including the 2 new ones).

- [ ] **Step 5: Add `generatePortfolioSummaryPdf` to `src/lib/pdfGenerator.ts`**

At the top of the file, extend the existing `./hsScore`-free imports — add this import near the other local imports:

```tsx
import { scoreBand, type HsBuildingScore, summarizePortfolio } from './hsScore';
```

Append this exported function at the end of `src/lib/pdfGenerator.ts`:

```tsx
export async function generatePortfolioSummaryPdf(opts: {
  rows: HsBuildingScore[];
  generatedAt: string; // yyyy-MM-dd
  branding: OrganizationBranding;
}): Promise<void> {
  const { rows, generatedAt, branding } = opts;
  const s = summarizePortfolio(rows);

  const body: Content[] = [
    [
      { text: 'Building', style: 'th' },
      { text: 'Done / Total', style: 'th' },
      { text: 'Score', style: 'th' },
      { text: 'Status', style: 'th' },
      { text: 'Cert', style: 'th' },
    ],
    ...rows.map((r) => [
      { text: r.name },
      { text: `${r.completed} / ${r.total}` },
      { text: r.score === null ? 'N/A' : `${r.score}%` },
      { text: scoreBand(r.score) },
      { text: r.hasExpiredCert ? 'EXPIRED' : 'OK' },
    ]),
  ] as unknown as Content[];

  const docDefinition: TDocumentDefinitions = {
    pageMargins: [40, 50, 40, 40],
    content: [
      { text: branding.name, style: 'org' },
      { text: 'Portfolio Compliance Summary', style: 'title' },
      { text: `Generated ${generatedAt}`, style: 'meta' },
      {
        text: `${s.total} buildings · ${s.avgScore === null ? 'no scored buildings' : `portfolio average ${s.avgScore}%`} · ${s.good} good, ${s.warning} warning, ${s.critical} critical, ${s.none} no data · ${s.expiredCerts} with an expired certificate`,
        style: 'summary',
      },
      {
        margin: [0, 12, 0, 0],
        layout: 'lightHorizontalLines',
        table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto'], body: body as unknown as Content[][] },
      },
    ],
    styles: {
      org: { color: branding.primaryColor, bold: true, fontSize: 12, margin: [0, 0, 0, 2] },
      title: { fontSize: 20, bold: true, margin: [0, 0, 0, 2] },
      meta: { color: '#6b7280', fontSize: 10, margin: [0, 0, 0, 8] },
      summary: { fontSize: 11, margin: [0, 0, 0, 4] },
      th: { bold: true, fontSize: 10, color: branding.primaryColor },
    },
    defaultStyle: { fontSize: 10 },
  };

  pdfMake.createPdf(docDefinition).download(`portfolio-compliance-${generatedAt}.pdf`);
}
```

If the `body`/`Content` casts trip the compiler, mirror the table-body typing already used by `generateHsCompliancePdf` elsewhere in this file (search for an existing `table: { ... body:` and match its element typing). The goal: a `headerRows:1` table with one row per building.

- [ ] **Step 6: Verify**

```bash
npx vitest run src/lib/hsScore.test.ts   # all pass
npx tsc --noEmit 2>&1 | grep -c "error TS"   # 0
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/hsScore.ts src/lib/hsScore.test.ts src/lib/pdfGenerator.ts
git commit -m "feat: portfolio compliance summary helper + PDF (WS-B)"
```

---

## Task 4: Repurpose the Reports page → admin-only Portfolio Reports

Gate the page to admin/manager, wire the dead "Generate New Report" button to the portfolio PDF, and delete the 4 unimplemented report cards + their dead PDF/CSV buttons. Keep the stats cards and the working H&S report card/dialog.

**Files:**
- Modify: `src/pages/Reports.tsx`, `src/components/layout/DashboardLayout.tsx`

- [ ] **Step 1: Gate the nav item**

In `src/components/layout/DashboardLayout.tsx`, add `roles` to the Compliance Reports entry in `reportsNavItems`:

```tsx
  {
    title: 'Compliance Reports',
    href: '/reports',
    icon: <BarChart3 className="w-4 h-4" />,
    roles: ['admin', 'manager'],
  },
```

(The `Forms Library` entry stays ungated.) Confirm `reportsNavItems` is filtered through `canAccessItem` where it's rendered — search for `reportsNavItems.` in the file; if it is rendered WITHOUT `.filter(canAccessItem)` (unlike `adminNavItems`), add `.filter(canAccessItem)` to its `.map(...)` exactly as `adminNavItems` does.

- [ ] **Step 2: Page-level guard + portfolio handler in `Reports.tsx`**

Add imports:

```tsx
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { computeHsScores, type HsScoreTask, type HsScoreDocument } from '@/lib/hsScore';
import { generatePortfolioSummaryPdf } from '@/lib/pdfGenerator';
```

Inside the component, near the other hooks, add:

```tsx
  const { isAdminOrManager } = useAuth();
  const navigate = useNavigate();
  const [portfolioGenerating, setPortfolioGenerating] = useState(false);

  useEffect(() => {
    if (!isAdminOrManager) navigate('/dashboard', { replace: true });
  }, [isAdminOrManager, navigate]);

  const handleGeneratePortfolio = async () => {
    setPortfolioGenerating(true);
    try {
      const today = new Date();
      const [{ data: buildings }, { data: tasks }, { data: documents }] = await Promise.all([
        supabase.from('buildings').select('id, name').order('name'),
        supabase.from('task_instances').select('building_id, status, due_date, category').not('category', 'is', null),
        supabase.from('building_documents').select('building_id, expiry_date'),
      ]);
      const rows = computeHsScores(
        buildings || [],
        (tasks || []) as HsScoreTask[],
        (documents || []) as HsScoreDocument[],
        today,
      );
      await generatePortfolioSummaryPdf({
        rows,
        generatedAt: format(today, 'yyyy-MM-dd'),
        branding: {
          name: organization?.name || 'Building Ops',
          logoUrl: organization?.logo_url,
          primaryColor: organization?.primary_color || '#2563eb',
          address: organization?.address,
          phone: organization?.phone,
          email: organization?.email,
        },
      });
      toast.success('Portfolio summary downloaded');
    } catch (error) {
      console.error('Portfolio report error:', error);
      toast.error('Failed to generate portfolio summary');
    } finally {
      setPortfolioGenerating(false);
    }
  };
```

Note: this fetch mirrors `src/components/dashboard/HsComplianceWidget.tsx`. **Read that file first** and match its exact building/task/document scoping (e.g. any status or date filtering it applies) so the portfolio PDF and the dashboard widget agree. If the widget applies extra filters, replicate them here.

- [ ] **Step 3: Wire the "Generate New Report" button**

Replace the header button:

```tsx
        <Button>
          <BarChart3 className="w-4 h-4 mr-2" />
          Generate New Report
        </Button>
```

with:

```tsx
        <Button onClick={handleGeneratePortfolio} disabled={portfolioGenerating}>
          {portfolioGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BarChart3 className="w-4 h-4 mr-2" />}
          Portfolio Summary PDF
        </Button>
```

- [ ] **Step 4: Delete the dead report cards + their dead buttons**

Remove the `reportTypes` array (the `const reportTypes = [ ... ]` block near the top) and the entire `{reportTypes.map((report) => ( ... ))}` block inside the "Available Reports" card (the cards with the inert `PDF` / `CSV` `<Button>`s). Keep the H&S Compliance Report row (the one with `onClick={openHsDialog}`) and the surrounding `Card`/`CardHeader`/`CardContent`. After removal, run eslint and drop any now-unused imports (likely `FileText`).

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"   # 0
npx eslint src/pages/Reports.tsx src/components/layout/DashboardLayout.tsx   # no new findings
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/Reports.tsx src/components/layout/DashboardLayout.tsx
git commit -m "feat: admin-only Portfolio Reports page; remove dead report cards (WS-B)"
```

---

## Final verification (whole branch)

- [ ] **Run suite + tsc + build**

```bash
npm run test                                  # all green (incl. new summarizePortfolio tests)
npx tsc --noEmit 2>&1 | grep -c "error TS"    # 0
npm run build                                 # succeeds
```

- [ ] **Manual QA (owner / browser):**
  - In a building → Reports tab: "H&S PDF" button opens the date-range dialog and downloads a branded PDF for THAT building.
  - As admin/manager: `/reports` shows the "Portfolio Summary PDF" button (working) and the H&S report; no dead PDF/CSV cards remain.
  - As a `user`/`reviewer`: the "Compliance Reports" nav item is hidden and visiting `/reports` redirects to the dashboard. (Per-building H&S still reachable from inside their assigned buildings.)

---

## Self-Review (completed during authoring)

- **Spec coverage (WS-B):** per-building generation → Task 2 (+ shared helper Task 1); portfolio rollup → Task 3 (data+PDF) + Task 4 (page wiring); dead buttons → Task 4 (button wired, cards deleted); admin-only → Task 4 (nav `roles` + page guard).
- **DRY:** the H&S assembly lives once in `hsReportData.ts`, called by both surfaces.
- **Tests:** `summarizePortfolio` is pure and unit-tested (TDD). PDF rendering + Supabase I/O follow the repo's no-unit-test-for-IO grain, verified by tsc + manual QA (consistent with the existing untested `generateHsCompliancePdf`).
- **Placeholders:** none — all edits show exact before/after. The one read-and-match instruction (HsComplianceWidget scoping in Task 4 Step 2; existing table typing in Task 3 Step 5) is deliberate, to avoid diverging from working code.
- **Regression guard:** Task 1 is a pure extraction (behavior-preserving — the moved code is verbatim); the org H&S report must still work after it.
