# Building Compliance Scoring — Design

**Date:** 2026-06-19
**Repo:** `gmi-operations` (web, buildingops.app)
**Status:** Approved (design, via mockups)

## Problem

The dashboard "Overall Compliance Score" is a misleading task-throughput proxy
(`completedToday ÷ (allPendingOrOverdue + completedToday)` — mismatched time
windows, trends toward ~0, not real compliance). Meanwhile the app already has a
*genuine* per-building OHS compliance % (`compliance_scores.compliance_pct` from
the latest **approved** `ops_monthly` report) that is never surfaced where users
browse buildings. Goal: surface a trustworthy score per building where it's most
useful — the **Buildings selection grid** — and fix the dashboard headline.

## Decisions (confirmed with owner, via mockups)

1. **Two scores per building:**
   - **OHS %** — real OHS Act compliance, `compliance_scores.compliance_pct` of the latest **approved** `ops_monthly` report. Null (renders `—`) for buildings with no approved report (most sites today — expected, not a bug).
   - **Tasks %** — operational task completion: `completed ÷ (completed + pending + overdue)` for the building's `task_instances` **due in the last 30 days** (rolling). Universal (any building with tasks).
2. **Placements:**
   - **Buildings selection grid** (`Buildings.tsx` cards) — the primary ask. Two colour-banded chips in the card body.
   - Building **detail header** (`BuildingDetails.tsx`) — same two chips under the name/address, visible from every tab.
   - **Dashboard** — replace the broken card with the real **Portfolio OHS Compliance** average (`usePortfolioCompliance.portfolioAvg`, KPI O9).
3. **No** indicators on the building-detail **tab strip** (owner declined).
4. **Display-only / read-through.** No DB migration. Colour bands reuse the existing
   `classify()` + `THRESHOLDS` + `STATUS_CLASS` (≥90 good/emerald, ≥75 warn/amber,
   <75 bad/red, null → muted `—`).

## Non-goals

- No DB migration or write-path change.
- No iOS changes.
- No tab-strip indicators.
- Not changing how `compliance_pct` itself is computed (SQL views own that).
- The secondary "Pending Tasks → Due today" mislabel on the dashboard is noted but
  out of scope unless asked.

## Architecture

### Shared primitives

- **`src/lib/buildingScore.ts`** — pure helper + threshold:
  ```ts
  export interface TaskCounts { completed: number; pending: number; overdue: number }
  /** completed ÷ (completed+pending+overdue) × 100, rounded; null when no tasks. */
  export function taskCompletionPct(c: TaskCounts): number | null {
    const total = c.completed + c.pending + c.overdue;
    return total > 0 ? Math.round((c.completed / total) * 100) : null;
  }
  ```
- **`THRESHOLDS.taskCompletion = { good: 90, warn: 75 }`** added to `src/lib/fortressKpis.ts`
  (same shape/cutoffs as `compliance`; separate key so it can diverge later).
- **`ScorePctBadge`** — extract the existing `PctBadge` (local in `PortfolioComplianceCard.tsx`)
  into `src/components/reports/fortress/ScorePctBadge.tsx` (exported), reused by the card,
  header, and grid. Renders `—` (muted) when value is null; else colour-banded `{value}%`.
- **`BuildingScoreChips`** — `src/components/building/BuildingScoreChips.tsx`. Props
  `{ ohsPct, taskPct, size? }`. Renders the two labelled chips (`OHS`/`Tasks` with icons),
  using `classify` + `THRESHOLDS.compliance` / `THRESHOLDS.taskCompletion`. `OHS —` shows
  a `title="No approved OPS report"` tooltip when null.

### Hooks

- **`useBuildingScore(buildingId)`** — `src/hooks/useBuildingScore.ts`. Single building
  (detail header). Lightweight (~4 queries; NOT the 30-query `useBuildingKpis`):
  - latest **approved** `ops_monthly` report → `compliance_scores.compliance_pct` + `report_period`
  - task counts: `task_instances` for the building with `due_date >= today-30d`, grouped by status (pending/overdue/completed) → `taskCompletionPct`
  - returns `{ ohsPct, ohsPeriod, taskPct, taskCounts, isLoading }`.
- **`useBuildingsScores()`** — `src/hooks/useBuildingsScores.ts`. All visible buildings
  (selection grid). Returns `Map<buildingId, { ohsPct, taskPct }>`:
  - **OHS:** reuse `usePortfolioCompliance()` rows (already per-building, all buildings, approved-only).
  - **Tasks:** one query of `task_instances (building_id, status)` with `due_date >= today-30d`, counted per building client-side via `taskCompletionPct`.
  - N+1 on the OHS side is the existing `usePortfolioCompliance` pattern — acceptable at pilot scale (≤40 buildings), react-query cached.

### Render sites

- **`src/pages/Buildings.tsx`** — call `useBuildingsScores()`; in each card's `CardContent`
  (after the address, before the location/View row) render `<BuildingScoreChips ohsPct taskPct />`
  from the map (default to nulls while loading / missing → chips show `—`).
- **`src/pages/BuildingDetails.tsx`** — call `useBuildingScore(building.id)`; render
  `<BuildingScoreChips>` under the address line (`:160`).
- **`src/pages/Dashboard.tsx`** — replace the `Overall Compliance Score` card body with the
  Portfolio OHS headline: title "Portfolio OHS Compliance", `{portfolioAvg}%` colour-banded
  via `classify(portfolioAvg, THRESHOLDS.compliance)`, `<Progress value={portfolioAvg ?? 0}>`,
  subtitle "{reportedCount} of {total} buildings reported". Source: `usePortfolioCompliance()`.
- **`src/hooks/useDashboardStats.ts`** — remove the now-orphaned `complianceRate` field +
  its computation (lines ~128-131, 138, and the interface field). `pendingCount`/`completedCount`
  stay (still used by the Pending Tasks / Completed Today cards).

## Edge cases

- **No approved OPS report** → `ohsPct = null` → `OHS —` (muted, tooltip). Expected for most buildings.
- **No tasks in window** → `taskPct = null` → `Tasks —`.
- **Portfolio with zero reported** → dashboard headline shows `—` and "0 of N buildings reported"
  (existing `usePortfolioCompliance` already returns `portfolioAvg = null`).
- **RLS** — site-restricted users see only their buildings; both hooks inherit the RLS-scoped
  `buildings`/`reports` queries.

## Verification

1. `taskCompletionPct` unit tests (`src/lib/buildingScore.test.ts`): normal ratio, all-complete→100,
   none-complete→0, zero-total→null, rounding.
2. `tsc --noEmit` clean.
3. Remote Vercel build succeeds (local `vite build`/`vitest` blocked by the known `node_modules` breakage).
4. Visual: Buildings grid cards show both chips (incl. a `—` OHS card); detail header shows chips;
   dashboard shows the real portfolio average; DB `compliance_scores` untouched.
