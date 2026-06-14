# Phase 0 + 1 — Environment Baseline & Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a verified test baseline, then fix the duplicate building logo, remove the Audit Archive tab, and add a read-only checklist preview.

**Architecture:** Surgical edits to existing React pages plus one new presentational dialog component. UI deletions are verified by typecheck + lint + build + manual QA (matching this repo's logic-only/smoke test culture); the one new component (`PreviewTemplateDialog`) gets a real `@testing-library/react` unit test — the project's first component test.

**Tech Stack:** React 18, Vite, TypeScript, Tailwind + shadcn/ui (Radix), Supabase, vitest + @testing-library/react, lucide-react icons.

Source spec: `docs/2026-06-14_WEB_OPS_OVERHAUL_SESSION_PLAN.md` (WS-0, WS-A, WS-C, WS-D).

---

## Task 0: Environment baseline & branch (WS-0)

**Files:**
- Modify: repo root (lockfile), no source changes

- [ ] **Step 1: Create the implementation branch**

```bash
cd "/Users/spud/Documents/DEVELOPER/WEB_REPOS/gmi-operations"
git checkout main
git pull --ff-only
git checkout -b feat/web-ops-phase1
```

- [ ] **Step 2: Choose npm as the canonical runner, remove the stray lockfile**

Both `bun.lockb` and `package-lock.json` exist. These tasks use npm. Remove the bun lockfile so installs are deterministic. (If the team standardises on bun instead, skip this step and substitute `bun install` / `bun run` throughout.)

```bash
git rm bun.lockb
```

- [ ] **Step 3: Install and confirm the dev server boots**

```bash
npm install
npm run dev
```
Expected: Vite prints `Local: http://localhost:5173/` (or `8080`) with no install errors. Stop it with Ctrl-C once confirmed.

- [ ] **Step 4: Record the test + typecheck baseline**

```bash
npm run test
npx tsc --noEmit 2>&1 | grep -c "error TS"
```
Expected: vitest runs `src/lib/hsScore.test.ts` and `src/test/example.test.ts` to completion (PASS). The `tsc` line prints an integer (the pre-existing error count, expected ~140). **Recorded:** `BASELINE_TSC_ERRORS = 0` (the repo's `tsc --noEmit` is clean — the stale "~140" note was wrong; main was fixed by the recent Fortress PR). Every later task must keep the count at `0`. (Also recorded: vitest = 40 passed across 7 files; build OK. The default vitest `threads` pool hangs in this env — fixed to `pool: 'forks'`.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: standardise on npm, record phase-1 test baseline"
```

---

## Task 1: Remove duplicate logo in building detail header (WS-A part 1)

The detail header renders the logo twice: a positioned overlay (`BuildingDetails.tsx:~104-116`) and an in-flow `BuildingAvatar` (`:~122-147`). Per the approved spec we keep the **positioned overlay** and delete the avatar. The avatar currently hosts the admin "change avatar" button, so we move that button onto the overlay to avoid losing avatar editing.

**Files:**
- Modify: `src/pages/BuildingDetails.tsx`

- [ ] **Step 1: Add the edit button to the positioned overlay**

Replace the positioned-overlay block:

```tsx
          {/* Positioned Logo Overlay */}
          {hasCustomLogo && (
            <div
              className={cn(
                'absolute z-10',
                logoPosition === 'top-left' && 'top-0 left-10 sm:left-12',
                logoPosition === 'top-center' && 'top-0 left-1/2 -translate-x-1/2',
                logoPosition === 'top-right' && 'top-0 right-0'
              )}
            >
              <img
                src={building.logo_url!}
                alt="Building logo"
                className="w-8 h-8 sm:w-10 sm:h-10 object-contain rounded-md bg-background/95 backdrop-blur-sm border shadow-sm"
              />
            </div>
          )}
```

with (adds `group` to the wrapper and an admin-only hover edit button over the image):

```tsx
          {/* Positioned Logo Overlay (single source of the building logo) */}
          {hasCustomLogo && (
            <div
              className={cn(
                'absolute z-10 group',
                logoPosition === 'top-left' && 'top-0 left-10 sm:left-12',
                logoPosition === 'top-center' && 'top-0 left-1/2 -translate-x-1/2',
                logoPosition === 'top-right' && 'top-0 right-0'
              )}
            >
              <img
                src={building.logo_url!}
                alt="Building logo"
                className="w-8 h-8 sm:w-10 sm:h-10 object-contain rounded-md bg-background/95 backdrop-blur-sm border shadow-sm"
              />
              {isAdminOrManager && (
                <button
                  onClick={() => setAvatarDialogOpen(true)}
                  className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-md cursor-pointer"
                  title="Change logo"
                >
                  <Camera className="h-4 w-4 text-white" />
                </button>
              )}
            </div>
          )}
```

- [ ] **Step 2: Delete the in-flow avatar block**

Remove the avatar `<div>` (keep the wrapping flex container and the title `<div>` that follow it). Delete exactly this block:

```tsx
            {/* Avatar with edit overlay for admins/managers */}
            <div className="relative group shrink-0">
              <BuildingAvatar 
                name={building.name} 
                logoUrl={building.logo_url} 
                avatarColor={building.avatar_color}
                size="lg" 
                className="w-10 h-10 sm:w-12 sm:h-12"
              />
              {isAdminOrManager && (
                <button
                  onClick={() => setAvatarDialogOpen(true)}
                  className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg cursor-pointer"
                  title="Change avatar"
                >
                  <Camera className="h-4 w-4 text-white" />
                </button>
              )}
            </div>
```

After deletion, the container is `<div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">` directly followed by `<div className={cn("min-w-0 flex-1", hasCustomLogo && logoPosition === 'top-center' && "pt-10 sm:pt-12")}>`.

- [ ] **Step 3: Remove the now-unused BuildingAvatar import**

Delete line 21:

```tsx
import { BuildingAvatar } from '@/components/building/BuildingAvatar';
```

(`BuildingAvatarDialog`, `isAdminOrManager`, `avatarDialogOpen`, and `setAvatarDialogOpen` all remain in use — do not remove them.)

- [ ] **Step 4: Typecheck and lint the file**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx eslint src/pages/BuildingDetails.tsx
```
Expected: tsc count ≤ `BASELINE_TSC_ERRORS`; eslint reports no errors (specifically no `no-unused-vars` for `BuildingAvatar`).

- [ ] **Step 5: Manual QA**

```bash
npm run dev
```
Open a building with a custom logo for each `logo_position` value (top-left, top-center, top-right). Expected: exactly one logo in the header, correctly positioned, no overlap. As an admin, hover the logo → a "Change logo" camera button appears and opens the avatar dialog. As a non-admin, no camera button. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/pages/BuildingDetails.tsx
git commit -m "fix: render building logo once in detail header (WS-A)"
```

---

## Task 2: Remove redundant "Logo" badge on building cards (WS-A part 2)

The list card shows a top-right "avatar type indicator" badge ("Logo"/"Pattern"/"Initials") layered over the real avatar — a dev affordance the operator reads as a second logo. Remove the whole indicator block.

**Files:**
- Modify: `src/pages/Buildings.tsx`

- [ ] **Step 1: Delete the indicator badge block**

Remove exactly this block (inside the `.map((building) => {` card render, just under `<Card ...>`):

```tsx
                {/* Avatar type indicator badge */}
                <div className="absolute top-2 right-2 z-10">
                  {hasCustomLogo ? (
                    <Badge variant="secondary" className="text-xs gap-1 px-1.5 py-0.5 bg-primary/10 text-primary border-primary/20">
                      <ImageIcon className="h-3 w-3" />
                      <span className="hidden sm:inline">Logo</span>
                    </Badge>
                  ) : hasPattern ? (
                    <Badge variant="secondary" className="text-xs gap-1 px-1.5 py-0.5">
                      <Building2 className="h-3 w-3" />
                      <span className="hidden sm:inline">Pattern</span>
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs gap-1 px-1.5 py-0.5">
                      <Type className="h-3 w-3" />
                      <span className="hidden sm:inline">Initials</span>
                    </Badge>
                  )}
                </div>
```

- [ ] **Step 2: Delete the now-orphaned `hasCustomLogo` and `hasPattern` consts**

At the top of the `.map` callback, remove these two lines (keep `const position = ...`):

```tsx
            const hasCustomLogo = building.logo_url && !building.logo_url.includes('dicebear');
            const hasPattern = building.logo_url?.includes('dicebear');
```

- [ ] **Step 3: Remove the now-orphaned icon imports**

In the `lucide-react` import block, delete the `ImageIcon,` and `Type,` lines. **Keep `Building2`** — it is still used at lines ~98 and ~170.

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx eslint src/pages/Buildings.tsx
```
Expected: tsc count ≤ baseline; eslint clean (no unused `ImageIcon`, `Type`, `hasCustomLogo`, `hasPattern`).

- [ ] **Step 5: Manual QA**

`npm run dev` → Buildings page. Expected: each card shows a single avatar (logo / pattern / initials) with no "Logo"/"Pattern"/"Initials" badge in the top-right corner. The avatar still renders in its `logo_position`, and the admin hover "change avatar" button still works.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Buildings.tsx
git commit -m "fix: drop redundant avatar-type badge on building cards (WS-A)"
```

---

## Task 3: Remove the Audit Archive tab (WS-C)

Remove the page, its route, its import, and its nav entry. Keep the `audit_logs` table, all audit *writing*, and the Audit Compliance Pack report.

**Files:**
- Delete: `src/pages/AuditArchive.tsx`
- Modify: `src/App.tsx`, `src/components/layout/DashboardLayout.tsx`

- [ ] **Step 1: Remove the route and import in App.tsx**

Delete the import line:

```tsx
import AuditArchive from "./pages/AuditArchive";
```

Delete the route block:

```tsx
            <Route path="/audit" element={
              <ProtectedRoute>
                <DashboardLayout><AuditArchive /></DashboardLayout>
              </ProtectedRoute>
            } />
```

(The `/reports/fortress/:id` route before it and the `/forms` route after it remain.)

- [ ] **Step 2: Remove the nav item and its orphaned icon in DashboardLayout.tsx**

In `reportsNavItems`, delete the Audit Archive object so the array becomes:

```tsx
const reportsNavItems: NavItem[] = [
  {
    title: 'Compliance Reports',
    href: '/reports',
    icon: <BarChart3 className="w-4 h-4" />,
  },
  {
    title: 'Forms Library',
    href: '/forms',
    icon: <FileSpreadsheet className="w-4 h-4" />,
  },
];
```

Then remove `FileText,` from the `lucide-react` import block (it was used only by that entry).

- [ ] **Step 3: Delete the page file**

```bash
git rm src/pages/AuditArchive.tsx
```

- [ ] **Step 4: Typecheck, lint, build**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx eslint src/App.tsx src/components/layout/DashboardLayout.tsx
npm run build
```
Expected: tsc count ≤ baseline; eslint clean (no unused `FileText`, no dangling `AuditArchive` reference); build succeeds.

- [ ] **Step 5: Manual QA + audit-logging regression**

`npm run dev`:
- The sidebar "Reports & Audit" group no longer lists "Audit Archive"; "Compliance Reports" and "Forms Library" remain.
- Navigating to `/audit` directly renders the NotFound page (no crash).
- As an admin, complete a checklist task, then confirm an `audit_logs` row was still written (query in the Supabase dashboard: `select * from audit_logs order by created_at desc limit 5;`). This proves we removed only the *viewer*, not the *logging*.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/layout/DashboardLayout.tsx
git commit -m "feat: remove Audit Archive tab (WS-C); audit logging retained"
```

---

## Task 4: PreviewTemplateDialog component, test-first (WS-D part 1)

A read-only dialog that lists a checklist template's items. Built as a presentational component (`PreviewTemplateDialog`) wrapping a testable body (`TemplatePreviewBody`). The body is unit-tested — the repo's first `@testing-library/react` test.

**Files:**
- Create: `src/components/checklists/PreviewTemplateDialog.tsx`
- Test: `src/components/checklists/PreviewTemplateDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/checklists/PreviewTemplateDialog.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TemplatePreviewBody, type PreviewItem, type PreviewTemplate } from './PreviewTemplateDialog';

const template: PreviewTemplate = { id: 't1', name: 'Daily Fire Safety', frequency: 'daily' };
const items: PreviewItem[] = [
  { id: 'i2', task_name: 'Check extinguishers', task_description: 'All floors', responsible_party: 'Security', requires_photo: true, requires_signature: false, display_order: 2 },
  { id: 'i1', task_name: 'Test alarm panel', task_description: null, responsible_party: null, requires_photo: false, requires_signature: true, display_order: 1 },
];

describe('TemplatePreviewBody', () => {
  it('renders every task, ordered by display_order', () => {
    render(<TemplatePreviewBody template={template} items={items} />);
    const alarm = screen.getByText(/Test alarm panel/);
    const ext = screen.getByText(/Check extinguishers/);
    expect(alarm).toBeInTheDocument();
    expect(ext).toBeInTheDocument();
    expect(alarm.compareDocumentPosition(ext) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows photo and signature requirement badges', () => {
    render(<TemplatePreviewBody template={template} items={items} />);
    expect(screen.getByText('Photo')).toBeInTheDocument();
    expect(screen.getByText('Signature')).toBeInTheDocument();
  });

  it('is read-only — no action buttons', () => {
    render(<TemplatePreviewBody template={template} items={items} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows an empty state when the template has no tasks', () => {
    render(<TemplatePreviewBody template={template} items={[]} />);
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/components/checklists/PreviewTemplateDialog.test.tsx
```
Expected: FAIL — cannot resolve `./PreviewTemplateDialog` (module does not exist yet).

- [ ] **Step 3: Write the component**

Create `src/components/checklists/PreviewTemplateDialog.tsx`:

```tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Camera, FileSignature, ListChecks, Eye } from 'lucide-react';

export interface PreviewTemplate {
  id: string;
  name: string;
  frequency: string;
  description?: string | null;
}

export interface PreviewItem {
  id: string;
  task_name: string;
  task_description: string | null;
  responsible_party: string | null;
  requires_photo: boolean;
  requires_signature: boolean;
  display_order: number;
}

export function TemplatePreviewBody({ template, items }: { template: PreviewTemplate; items: PreviewItem[] }) {
  const ordered = [...items].sort((a, b) => a.display_order - b.display_order);

  if (ordered.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <ListChecks className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>This checklist has no tasks yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {ordered.map((item, index) => (
        <div key={item.id} className="rounded-md border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{index + 1}. {item.task_name}</p>
              {item.task_description && (
                <p className="text-sm text-muted-foreground mt-1">{item.task_description}</p>
              )}
              {item.responsible_party && (
                <p className="text-xs text-muted-foreground mt-1">Responsible: {item.responsible_party}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              {item.requires_photo && (
                <Badge variant="secondary" className="gap-1"><Camera className="h-3 w-3" />Photo</Badge>
              )}
              {item.requires_signature && (
                <Badge variant="secondary" className="gap-1"><FileSignature className="h-3 w-3" />Signature</Badge>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PreviewTemplateDialog({
  template,
  items,
  open,
  onOpenChange,
}: {
  template: PreviewTemplate | null;
  items: PreviewItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Eye className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="truncate">{template.name}</DialogTitle>
              <p className="text-sm text-muted-foreground capitalize">{template.frequency} checklist · preview</p>
            </div>
          </div>
        </DialogHeader>
        <TemplatePreviewBody template={template} items={items} />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/components/checklists/PreviewTemplateDialog.test.tsx
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/checklists/PreviewTemplateDialog.tsx src/components/checklists/PreviewTemplateDialog.test.tsx
git commit -m "feat: add read-only PreviewTemplateDialog with tests (WS-D)"
```

---

## Task 5: Wire Preview into the Checklists page (WS-D part 2)

Add a "Preview" affordance to each template card, available to all roles (read-only), opening the dialog with that template's already-loaded items.

**Files:**
- Modify: `src/pages/Checklists.tsx`

- [ ] **Step 1: Import the dialog and the Eye icon**

Add to the imports:

```tsx
import PreviewTemplateDialog from '@/components/checklists/PreviewTemplateDialog';
```

Add `Eye,` to the existing `lucide-react` import block (alongside `ListChecks`, `Send`, etc.).

- [ ] **Step 2: Add preview state and handler**

After the existing dialog-state hooks (near `const [selectedTemplate, setSelectedTemplate] = ...`), add:

```tsx
const [previewOpen, setPreviewOpen] = useState(false);
const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);

const handlePreviewTemplate = (template: Template) => {
  setPreviewTemplate(template);
  setPreviewOpen(true);
};
```

- [ ] **Step 3: Add the Preview button to each card**

In the template card's `CardContent`, replace the right-hand Apply button:

```tsx
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleApplyTemplate(template)}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Building2 className="h-3 w-3 mr-1" />
            Apply
          </Button>
```

with a button group that adds an always-visible Preview button (so non-admins can preview even though Apply is admin-driven):

```tsx
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePreviewTemplate(template)}
            >
              <Eye className="h-3 w-3 mr-1" />
              Preview
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleApplyTemplate(template)}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Building2 className="h-3 w-3 mr-1" />
              Apply
            </Button>
          </div>
```

- [ ] **Step 4: Render the dialog**

In the dialog render section (next to `<TemplateItemDialog ... />` and `<ApplyTemplateDialog ... />`), add:

```tsx
{/* Template Preview Dialog */}
<PreviewTemplateDialog
  open={previewOpen}
  onOpenChange={setPreviewOpen}
  template={previewTemplate}
  items={items.filter((i) => i.template_id === previewTemplate?.id)}
/>
```

(`items` is the already-fetched `TemplateItem[]`; its shape satisfies `PreviewItem[]` structurally.)

- [ ] **Step 5: Typecheck, lint, full test run**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx eslint src/pages/Checklists.tsx
npm run test
```
Expected: tsc count ≤ baseline; eslint clean; all vitest tests pass.

- [ ] **Step 6: Manual QA**

`npm run dev` → Checklists page:
- Every template card shows a "Preview" button, visible to all roles (test by logging in as a `user`).
- Clicking Preview opens a dialog titled with the template name + frequency, listing all its tasks in `display_order`, with Photo/Signature badges where required.
- The dialog has no edit/delete/apply controls. Closing it returns to the page unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Checklists.tsx
git commit -m "feat: add checklist template preview action (WS-D)"
```

---

## Final verification (whole branch)

- [ ] **Run the full suite + build one more time**

```bash
npm run test
npx tsc --noEmit 2>&1 | grep -c "error TS"
npm run build
```
Expected: all tests pass, tsc count ≤ `BASELINE_TSC_ERRORS`, build succeeds.

- [ ] **Push and open a PR**

```bash
git push -u origin feat/web-ops-phase1
```
PR title: `Phase 1 quick wins: logo de-dupe, Audit Archive removal, checklist preview`. In the PR body, record the tsc baseline number and the manual-QA results.

---

## Self-Review (completed during plan authoring)

- **Spec coverage:** WS-0 → Task 0; WS-A (detail) → Task 1; WS-A (list) → Task 2; WS-C → Task 3; WS-D → Tasks 4–5. All Phase 0/1 spec items covered. (WS-B reports, WS-E forms sign-off are separate plans.)
- **Placeholders:** none — every edit shows exact before/after code and exact commands.
- **Type consistency:** `PreviewTemplate`/`PreviewItem` defined in Task 4 and consumed unchanged in Task 5; `TemplateItem` (from `Checklists.tsx`) structurally satisfies `PreviewItem`.
- **Orphan analysis verified against source:** `BuildingAvatar` (detail), `ImageIcon`+`Type`+`hasCustomLogo`+`hasPattern` (list), `FileText` (nav) — each confirmed unused after its edit; `Building2` retained (3 other uses).
