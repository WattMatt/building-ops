# Building Name Uppercase Display — Design

**Date:** 2026-06-19
**Repo:** `gmi-operations` (web, buildingops.app)
**Status:** Approved (design)

## Problem

Building names are entered, imported, and pulled from external sources (manual
entry, XLSX import, insight-linker FDW) with inconsistent casing. The product
rule is: **every building name reflected to the user must render in uppercase**,
regardless of how it was stored or where it came from.

## Decisions (confirmed with owner)

1. **Platform:** Web app only (`gmi-operations`). iOS is out of scope for this change.
2. **Mechanism:** **Display-only.** The stored value in `buildings.name` (and
   `reports.title`) is never modified. Uppercasing happens at render time only,
   so it automatically covers externally-sourced names and is fully reversible.
3. **Scope:** **Everywhere the name is reflected** — in-app UI *and* generated
   report/PDF output.

## Non-goals

- No database migration. No change to write/insert/import paths.
- No iOS changes.
- No change to avatar initials (already uppercased) or to unrelated labels that
  happen to use a Tailwind `uppercase` class.

## Approach

A single shared pure formatter, applied at every display site. This is the only
approach that reaches all surfaces — JSX, the Leaflet popup's raw-HTML string,
and the pdfMake PDF builder (pdfMake ignores CSS, so a `text-transform`/Tailwind
`uppercase` solution cannot reach the PDF). It also matches the existing shared
display-util convention (`src/lib/tenantSort.ts` / `byShopNumber`).

### New util — `src/lib/buildingName.ts`

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

Plain `.toUpperCase()` (not `toLocaleUpperCase`) — building names are English/
Afrikaans (ZA); no locale-specific casing needed.

### Tests — `src/lib/buildingName.test.ts` (vitest)

- lowercase → uppercase
- mixed case → uppercase
- already uppercase → unchanged
- `null` → `''`, `undefined` → `''`, `''` → `''`
- digits / punctuation / spaces preserved (e.g. `"31 a/b"` → `"31 A/B"`)

## Display sites to update

Apply `formatBuildingName(...)` at each site. The list below is the audited set;
implementation must also run a grep sweep (`building\.name`, `buildingName`,
`building_name`) to catch any straggler (notably the tab components that receive a
`buildingName` prop — wrap wherever they actually render it).

| File | Line | Current | Change |
|---|---|---|---|
| `src/pages/BuildingDetails.tsx` | 155 | `{building.name}` (header `<h1>`) | wrap |
| `src/pages/Buildings.tsx` | 246 | `{building.name}` (card title) | wrap |
| `src/components/building/BuildingMap.tsx` | 196 | `${building.name}` (popup HTML string) | wrap |
| `src/components/forms/FillableFormDialog.tsx` | 452 | `{building.name}` (selector) | wrap |
| `src/components/forms/FormSubmissionsDialog.tsx` | 150 | `[building.id]: building.name` (name map) | wrap at map build so all reads inherit |
| `src/components/checklists/ApplyTemplateDialog.tsx` | 247 | `{building.name}` | wrap |
| `src/components/checklists/ReportIssueDialog.tsx` | 158 | `{buildingName}` | wrap |
| `src/components/building/BuildingAvatarDialog.tsx` | 147 | `…for {buildingName}` (sentence copy) | wrap |
| `src/pages/Reports.tsx` | 291 | `{b.name}` (SelectItem) | wrap |
| `src/pages/NewIssue.tsx` | 170 | `{building.name}` | wrap |
| `src/pages/Dashboard.tsx` | 260 | `{task.building_name}` | wrap |
| `src/pages/MySignoffs.tsx` | 46 | `{it.building_name \|\| 'No building'}` | `{formatBuildingName(it.building_name) \|\| 'No building'}` |

No change: `BuildingAvatar.tsx` / `BuildingAvatarPicker.tsx` (initials already
uppercased).

## Report / PDF titles (special case)

The building name is **baked into a composed, persisted string**:
`reports.title` = `"Monthly OPS — Broll Centre — May 2026"` (built at creation in
`NewReportDialog.tsx:49`, saved via `useFortressReports.ts`). There is no separate
building-name field at render time, and splitting the title on `" — "` is fragile.

Resolution: uppercase the **whole composed title** at its two render points only.
Creation/storage is untouched (display-only).

| File | Site | Change |
|---|---|---|
| `src/components/reports/fortress/FortressReportEditor.tsx` | 143 `<h1>{report.title}</h1>` | `{report.title?.toUpperCase()}` (commented) |
| `src/lib/fortressReportDoc.ts` | title `text:` in `titleStack` | uppercase the title string (commented) |

The PDF download **filename** (derived from `report.title`, sanitized) is left as-is.

### Accepted trade-off

Because the name is inseparable from the stored title string, the report title
uppercases the **report type and period too**
(`"MONTHLY OPS — BROLL CENTRE — MAY 2026"`). This reads as a deliberate report
header and is preferred over fragile string-splitting. Owner approved.

## Verification

1. `formatBuildingName` unit tests pass (`vitest`).
2. Grep sweep returns no un-wrapped building-name display site.
3. Manual/visual: detail header, buildings list cards, map popup, a building
   dropdown, an issue dialog, dashboard list, and a generated report PDF all show
   the name uppercase; the `buildings` table row is unchanged in the DB.
