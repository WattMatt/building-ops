# Building Name Uppercase Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every building name in the web app in uppercase at display time, regardless of stored casing or source, without modifying the database.

**Architecture:** One shared pure formatter `formatBuildingName(name)` in `src/lib/`, applied at every building-name display site (JSX, the Leaflet/Mapbox popup HTML string, and the pdfMake PDF builder). Report titles — where the name is baked into a persisted composed string — are uppercased as a whole at their two render points only. No DB migration; storage is untouched.

**Tech Stack:** React + TypeScript + Vite, Vitest (jsdom, `pool: forks`), pdfMake, `@/` path alias.

**Spec:** `docs/superpowers/specs/2026-06-19-building-name-uppercase-display.md`

---

### Task 1: Shared display formatter `formatBuildingName`

**Files:**
- Create: `src/lib/buildingName.ts`
- Test: `src/lib/buildingName.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/buildingName.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatBuildingName } from './buildingName';

describe('formatBuildingName', () => {
  it('uppercases a lowercase name', () => {
    expect(formatBuildingName('broll centre')).toBe('BROLL CENTRE');
  });
  it('uppercases a mixed-case name', () => {
    expect(formatBuildingName('Broll Centre')).toBe('BROLL CENTRE');
  });
  it('leaves an already-uppercase name unchanged', () => {
    expect(formatBuildingName('BROLL CENTRE')).toBe('BROLL CENTRE');
  });
  it('returns empty string for null/undefined/empty', () => {
    expect(formatBuildingName(null)).toBe('');
    expect(formatBuildingName(undefined)).toBe('');
    expect(formatBuildingName('')).toBe('');
  });
  it('preserves digits, punctuation and spacing', () => {
    expect(formatBuildingName('31 a/b shop')).toBe('31 A/B SHOP');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/buildingName.test.ts`
Expected: FAIL — cannot resolve `./buildingName` / `formatBuildingName is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/buildingName.ts`:

```ts
/**
 * Building name display formatting — the single source of truth for how building
 * names are shown to users. Per product rule, building names are ALWAYS rendered
 * in uppercase, regardless of how they were entered, imported, or pulled from an
 * external source (manual entry, XLSX import, insight-linker FDW, …).
 *
 * DISPLAY-ONLY: the stored value in `buildings.name` is never modified. Use this
 * everywhere a building name reaches the UI — detail header, cards, map popups,
 * dropdowns, dialog text, and generated report/PDF output.
 */
export function formatBuildingName(name: string | null | undefined): string {
  return (name ?? '').toUpperCase();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/buildingName.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/buildingName.ts src/lib/buildingName.test.ts
git commit -m "feat: add formatBuildingName display formatter (uppercase, display-only)"
```

---

### Task 2: Apply formatter at in-app display sites

Mechanical wrap of each rendered building name with `formatBuildingName(...)`. Add the import `import { formatBuildingName } from '@/lib/buildingName';` to each file. **Do not** touch avatar-initials calls (`getBuildingAvatarHtml(building.name, …)`, `BuildingAvatar`/`BuildingAvatarPicker`) — initials are already uppercased.

**Files (exact before → after):**

- [ ] **Step 1: `src/pages/BuildingDetails.tsx` (header, line 155)**

```tsx
// before
<h1 className="text-lg sm:text-2xl font-bold truncate">{building.name}</h1>
// after
<h1 className="text-lg sm:text-2xl font-bold truncate">{formatBuildingName(building.name)}</h1>
```

- [ ] **Step 2: `src/pages/Buildings.tsx` (card title, ~line 246)**

```tsx
// before
<CardTitle className="text-base">{building.name}</CardTitle>
// after
<CardTitle className="text-base">{formatBuildingName(building.name)}</CardTitle>
```

- [ ] **Step 3: `src/components/map/BuildingMap.tsx` (popup HTML, line 196)**

```ts
// before
<h3 style="...">${building.name}</h3>
// after
<h3 style="...">${formatBuildingName(building.name)}</h3>
```
(Leave line 162 `getBuildingAvatarHtml(building.name, …)` unchanged.)

- [ ] **Step 4: `src/components/forms/FormSubmissionsDialog.tsx` (name map, line 150)**

```ts
// before
[building.id]: building.name,
// after
[building.id]: formatBuildingName(building.name),
```
(Downstream read at ~line 328 `buildings?.[id] || 'Unknown'` still works — `formatBuildingName` never returns `undefined`, and `''` falls through to `'Unknown'`.)

- [ ] **Step 5: `src/components/forms/FillableFormDialog.tsx` (selector, ~line 452)**

```tsx
// before
{building.name}
// after
{formatBuildingName(building.name)}
```

- [ ] **Step 6: `src/components/checklists/ApplyTemplateDialog.tsx` (~line 247)**

```tsx
// before
<span className="flex-1">{building.name}</span>
// after
<span className="flex-1">{formatBuildingName(building.name)}</span>
```

- [ ] **Step 7: `src/components/checklists/ReportIssueDialog.tsx` (~line 158)**

```tsx
// before
Building: <strong>{buildingName}</strong>
// after
Building: <strong>{formatBuildingName(buildingName)}</strong>
```

- [ ] **Step 8: `src/components/building/BuildingAvatarDialog.tsx` (~line 147)**

```tsx
// before
Upload a logo or choose a pattern for {buildingName}
// after
Upload a logo or choose a pattern for {formatBuildingName(buildingName)}
```

- [ ] **Step 9: `src/pages/Reports.tsx` (SelectItem, ~line 291)**

```tsx
// before
<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
// after
<SelectItem key={b.id} value={b.id}>{formatBuildingName(b.name)}</SelectItem>
```

- [ ] **Step 10: `src/pages/NewIssue.tsx` (~line 170)**

```tsx
// before
{building.name}
// after
{formatBuildingName(building.name)}
```

- [ ] **Step 11: `src/pages/Dashboard.tsx` (~line 260)**

```tsx
// before
{task.building_name}
// after
{formatBuildingName(task.building_name)}
```

- [ ] **Step 12: `src/pages/MySignoffs.tsx` (line 46)**

```tsx
// before
{it.building_name || 'No building'}
// after
{formatBuildingName(it.building_name) || 'No building'}
```

- [ ] **Step 13: Grep sweep for stragglers**

Run:
```bash
grep -rnE "building\.name|buildingName|building_name|\bb\.name\b" src \
  --include="*.tsx" --include="*.ts" \
  | grep -v "formatBuildingName" \
  | grep -viE "getBuildingAvatarHtml|BuildingAvatar|\.test\.|getInitials"
```
Review each remaining hit. If it **renders** a building name to the user (JSX text, a string shown in UI, a prop a child renders as text — e.g. the `buildingName` prop passed into `ChecklistsTab`/`FormsTab`/`ReportsTab` if/where they render it), wrap it with `formatBuildingName(...)` and add the import. Skip: data-only usages (query keys, mutation payloads, `building_id` lookups, sort/filter logic), avatar-initials, and report `title` composition (handled in Task 3). Note in the commit body any hit deliberately left unwrapped and why.

- [ ] **Step 14: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: no new errors introduced by these edits. (The repo carries a known tsc baseline of pre-existing errors — compare against `git stash` baseline if unsure; these edits must add zero new errors.)

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat: render building names in uppercase across web UI (display-only)"
```

---

### Task 3: Uppercase report / PDF titles at render

The building name is baked into the persisted `reports.title` string, so the whole composed title is uppercased at its two render points. Storage and creation (`NewReportDialog.tsx`, `useFortressReports.ts`) are **not** changed.

**Files:**
- Modify: `src/lib/fortressReportDoc.ts:65`
- Modify: `src/components/reports/fortress/FortressReportEditor.tsx:143`
- Test: `src/lib/fortressReportDoc.test.ts`

- [ ] **Step 1: Write the failing test (pdfMake title)**

Add to `src/lib/fortressReportDoc.test.ts` (inside the existing top-level, after the `ops_monthly` describe block):

```ts
describe('buildReportDoc — title casing', () => {
  it('uppercases the whole composed report title in the PDF header', () => {
    const doc = buildReportDoc(
      { title: 'Monthly OPS — Broll Centre — May 2026', report_period: '2026-05-01', report_type: 'ops_monthly', managers: [] },
      { compliancePct: 100 },
      { color: '#123456', orgName: 'Acme' },
    );
    const { text } = collect(doc);
    expect(text).toContain('MONTHLY OPS — BROLL CENTRE — MAY 2026');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/fortressReportDoc.test.ts -t "title casing"`
Expected: FAIL — collected text contains the original mixed-case title, not the uppercase form.

- [ ] **Step 3: Implement (pdfMake title, `fortressReportDoc.ts:65`)**

```ts
// before
{ text: report.title ?? 'Report', fontSize: 10, bold: true, color, alignment: 'right' },
// after — building names always display uppercase (name is baked into the composed title)
{ text: (report.title ?? 'Report').toUpperCase(), fontSize: 10, bold: true, color, alignment: 'right' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/fortressReportDoc.test.ts -t "title casing"`
Expected: PASS.

- [ ] **Step 5: Implement (on-screen report header, `FortressReportEditor.tsx:143`)**

```tsx
// before
<h1 className="text-2xl font-semibold">{report.title}</h1>
// after — building names always display uppercase (name is baked into the composed title)
<h1 className="text-2xl font-semibold">{report.title?.toUpperCase()}</h1>
```

- [ ] **Step 6: Run the full report-doc suite (no regressions)**

Run: `npx vitest run src/lib/fortressReportDoc.test.ts`
Expected: PASS (existing tests still green — their titles like `'Annual — Test'`/`'OPS'` are asserted via section text, not title casing).

- [ ] **Step 7: Commit**

```bash
git add src/lib/fortressReportDoc.ts src/lib/fortressReportDoc.test.ts "src/components/reports/fortress/FortressReportEditor.tsx"
git commit -m "feat: uppercase report titles in PDF + report header (display-only)"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS — including the new `buildingName` tests and the report-title casing test; no regressions.

- [ ] **Step 2: Re-run the grep sweep (confirm no un-wrapped display site remains)**

Run the Task 2 Step 13 grep again. Expected: every remaining hit is a deliberate data-only usage (documented) or avatar-initials — zero un-wrapped display sites.

- [ ] **Step 3: Typecheck + build clean**

Run: `npx tsc --noEmit` then `npm run build`
Expected: zero new errors vs the pre-change baseline; build succeeds.

- [ ] **Step 4: Manual visual check (dev server)**

Run: `npm run dev`, then confirm uppercase rendering at: buildings list cards, building detail header, map popup, a building dropdown (Reports page), an issue dialog, the dashboard list, and a generated report PDF (download one). Confirm a building's `buildings.name` row in the DB is unchanged (still original case).

- [ ] **Step 5: Final commit (if any sweep fixups were made)**

```bash
git add -A
git commit -m "chore: building-name uppercase sweep fixups + verification"
```

---

## Self-Review

**Spec coverage:**
- Display-only formatter → Task 1. ✅
- All in-app display sites (the 12 audited + grep sweep incl. tab-component props) → Task 2. ✅
- Report/PDF titles (on-screen h1 + pdfMake) with whole-title uppercase trade-off → Task 3. ✅
- No DB migration / creation path untouched → enforced (Task 3 explicitly leaves `NewReportDialog`/`useFortressReports`). ✅
- Avatar initials unchanged → called out in Tasks 2 & sweep. ✅
- Verification (tests, grep, build, manual, DB unchanged) → Task 4. ✅

**Placeholder scan:** No TBD/TODO; every code step shows exact before→after; line numbers are approximate (`~`) only where the file may have drifted, with exact before-strings to match on. ✅

**Type/name consistency:** `formatBuildingName(name: string | null | undefined): string` defined in Task 1, used identically everywhere. Report-title uses inline `.toUpperCase()` (intentionally not `formatBuildingName`, since the value is a composed title, not a building name) — documented in spec & Task 3 comments. ✅
