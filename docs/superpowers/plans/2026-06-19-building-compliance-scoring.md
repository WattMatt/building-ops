# Building Compliance Scoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a per-building OHS compliance % and task-completion % on the Buildings selection grid and the building detail header, and replace the dashboard's broken "Overall Compliance Score" with the real Portfolio OHS average.

**Architecture:** A pure `taskCompletionPct()` helper + a `BuildingScoreChips` component (colour-banded via the existing `classify`/`THRESHOLDS`/`STATUS_CLASS`). Two read-through hooks — `useBuildingScore(id)` (single building, detail header) and `useBuildingsScores()` (all buildings, grid; reuses `usePortfolioCompliance` for OHS + one task-count query). Dashboard reuses `usePortfolioCompliance.portfolioAvg`. No DB migration.

**Tech Stack:** React + TS + Vite, @tanstack/react-query, Vitest, `@/` alias. OHS reads via `fdb` (fortress-db); tasks via `supabase` (main client).

**Spec:** `docs/superpowers/specs/2026-06-19-building-compliance-scoring-design.md`

**Note on simplification vs spec:** the spec mentioned extracting `ScorePctBadge` from `PortfolioComplianceCard`. The chips are *labelled* (`OHS 92%`) while that badge is unlabelled, so there's no real reuse — we build `BuildingScoreChips` standalone and leave `PortfolioComplianceCard` untouched (more surgical).

---

### Task 1: Pure scoring helper + threshold

**Files:**
- Create: `src/lib/buildingScore.ts`
- Test: `src/lib/buildingScore.test.ts`
- Modify: `src/lib/fortressKpis.ts` (add `taskCompletion` threshold)

- [ ] **Step 1: Write the failing test**

Create `src/lib/buildingScore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { taskCompletionPct } from './buildingScore';

describe('taskCompletionPct', () => {
  it('computes completed ÷ (completed+pending+overdue)', () => {
    expect(taskCompletionPct({ completed: 7, pending: 2, overdue: 1 })).toBe(70);
  });
  it('all complete → 100', () => {
    expect(taskCompletionPct({ completed: 5, pending: 0, overdue: 0 })).toBe(100);
  });
  it('none complete → 0', () => {
    expect(taskCompletionPct({ completed: 0, pending: 3, overdue: 1 })).toBe(0);
  });
  it('no tasks → null (honest empty-state)', () => {
    expect(taskCompletionPct({ completed: 0, pending: 0, overdue: 0 })).toBeNull();
  });
  it('rounds to nearest integer', () => {
    expect(taskCompletionPct({ completed: 1, pending: 2, overdue: 0 })).toBe(33);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/buildingScore.test.ts`
Expected: FAIL — cannot resolve `./buildingScore`.
(If vitest can't start due to the known broken `node_modules`/PostCSS, fall back to the esbuild+node proof used in Task 7.)

- [ ] **Step 3: Write the implementation**

Create `src/lib/buildingScore.ts`:

```ts
/**
 * Per-building operational score: task completion over a rolling window.
 * completed ÷ (completed + pending + overdue) × 100, rounded; null when there are
 * no tasks (honest empty-state, never NaN). Display-only; the building's tasks live
 * in task_instances. Paired with the real OHS compliance % (compliance_scores).
 */
export interface TaskCounts {
  completed: number;
  pending: number;
  overdue: number;
}

export function taskCompletionPct(c: TaskCounts): number | null {
  const total = c.completed + c.pending + c.overdue;
  return total > 0 ? Math.round((c.completed / total) * 100) : null;
}
```

- [ ] **Step 4: Add the threshold**

In `src/lib/fortressKpis.ts`, inside the `THRESHOLDS` object, add after the `compliance` line:

```ts
  taskCompletion: { good: 90, warn: 75 } as KpiThreshold,        // building task-completion %
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/buildingScore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/buildingScore.ts src/lib/buildingScore.test.ts src/lib/fortressKpis.ts
git commit -m "feat: add taskCompletionPct helper + taskCompletion threshold"
```

---

### Task 2: BuildingScoreChips component

**Files:**
- Create: `src/components/building/BuildingScoreChips.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { ShieldCheck, ShieldOff, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { classify, STATUS_CLASS, THRESHOLDS, type KpiThreshold } from '@/lib/fortressKpis';

function Chip({
  label, value, threshold, icon, noDataIcon, noDataTitle,
}: {
  label: string;
  value: number | null;
  threshold: KpiThreshold;
  icon: React.ReactNode;
  noDataIcon: React.ReactNode;
  noDataTitle: string;
}) {
  const isNull = value === null;
  const c = STATUS_CLASS[classify(value, threshold)];
  return (
    <span
      title={isNull ? noDataTitle : undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums',
        isNull ? 'bg-muted text-muted-foreground' : c.badge,
      )}
    >
      {isNull ? noDataIcon : icon}
      {label} {isNull ? '—' : `${value}%`}
    </span>
  );
}

export function BuildingScoreChips({ ohsPct, taskPct }: { ohsPct: number | null; taskPct: number | null }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Chip
        label="OHS"
        value={ohsPct}
        threshold={THRESHOLDS.compliance}
        icon={<ShieldCheck className="h-3.5 w-3.5" />}
        noDataIcon={<ShieldOff className="h-3.5 w-3.5" />}
        noDataTitle="No approved OPS report"
      />
      <Chip
        label="Tasks"
        value={taskPct}
        threshold={THRESHOLDS.taskCompletion}
        icon={<ListChecks className="h-3.5 w-3.5" />}
        noDataIcon={<ListChecks className="h-3.5 w-3.5" />}
        noDataTitle="No tasks in the last 30 days"
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/building/BuildingScoreChips.tsx
git commit -m "feat: add BuildingScoreChips (OHS + Tasks colour-banded chips)"
```

---

### Task 3: useBuildingScore hook (single building — detail header)

**Files:**
- Create: `src/hooks/useBuildingScore.ts`

- [ ] **Step 1: Write the hook**

```ts
/**
 * Lightweight per-building score for the detail header. Two cheap reads (NOT the
 * ~30-query useBuildingKpis): OHS = compliance_scores.compliance_pct of the latest
 * APPROVED ops_monthly report (matches usePortfolioCompliance); Tasks = task
 * completion over the last 30 days. Read-through; nothing is written.
 */
import { useQuery } from '@tanstack/react-query';
import { fdb } from '@/integrations/supabase/fortress-db';
import { supabase } from '@/integrations/supabase/client';
import { taskCompletionPct } from '@/lib/buildingScore';

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

const WINDOW_DAYS = 30;

export function useBuildingScore(buildingId: string | undefined) {
  const query = useQuery({
    queryKey: ['building-score', buildingId],
    enabled: !!buildingId,
    queryFn: async () => {
      const bid = buildingId!;
      const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

      const [repRes, taskRes] = await Promise.all([
        fdb.from('reports').select('id,report_period')
          .eq('building_id', bid).eq('report_type', 'ops_monthly').eq('status', 'approved')
          .order('report_period', { ascending: false }).limit(1),
        supabase.from('task_instances').select('status').eq('building_id', bid).gte('due_date', since),
      ]);

      let ohsPct: number | null = null;
      let ohsPeriod: string | null = null;
      const report = repRes.data?.[0];
      if (report) {
        const score = await fdb.from('compliance_scores').select('compliance_pct').eq('report_id', report.id);
        ohsPct = num(score.data?.[0]?.compliance_pct ?? null);
        ohsPeriod = (report.report_period as string | null) ?? null;
      }

      const tasks = (taskRes.data ?? []) as { status: string | null }[];
      const counts = {
        completed: tasks.filter((t) => t.status === 'completed').length,
        pending: tasks.filter((t) => t.status === 'pending').length,
        overdue: tasks.filter((t) => t.status === 'overdue').length,
      };

      return { ohsPct, ohsPeriod, taskPct: taskCompletionPct(counts), taskCounts: counts };
    },
  });

  return {
    ohsPct: query.data?.ohsPct ?? null,
    ohsPeriod: query.data?.ohsPeriod ?? null,
    taskPct: query.data?.taskPct ?? null,
    isLoading: query.isLoading,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useBuildingScore.ts
git commit -m "feat: add useBuildingScore (single-building OHS + task score)"
```

---

### Task 4: useBuildingsScores hook (all buildings — grid)

**Files:**
- Create: `src/hooks/useBuildingsScores.ts`

- [ ] **Step 1: Write the hook**

```ts
/**
 * Per-building scores for the Buildings grid. OHS reuses usePortfolioCompliance
 * (per-building, all visible buildings, approved-only). Tasks = one task_instances
 * query (last 30 days) counted per building. Returns a lookup keyed by buildingId.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolioCompliance } from '@/hooks/usePortfolioCompliance';
import { taskCompletionPct } from '@/lib/buildingScore';

const WINDOW_DAYS = 30;

export interface BuildingScore { ohsPct: number | null; taskPct: number | null }

export function useBuildingsScores() {
  const portfolio = usePortfolioCompliance();

  const taskQuery = useQuery({
    queryKey: ['buildings-task-scores'],
    queryFn: async (): Promise<Record<string, number | null>> => {
      const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
      const res = await supabase.from('task_instances').select('building_id,status').gte('due_date', since);
      const rows = (res.data ?? []) as { building_id: string | null; status: string | null }[];
      const byBuilding = new Map<string, { completed: number; pending: number; overdue: number }>();
      for (const r of rows) {
        if (!r.building_id) continue;
        const c = byBuilding.get(r.building_id) ?? { completed: 0, pending: 0, overdue: 0 };
        if (r.status === 'completed') c.completed++;
        else if (r.status === 'pending') c.pending++;
        else if (r.status === 'overdue') c.overdue++;
        byBuilding.set(r.building_id, c);
      }
      const out: Record<string, number | null> = {};
      for (const [id, c] of byBuilding) out[id] = taskCompletionPct(c);
      return out;
    },
  });

  const scores: Record<string, BuildingScore> = {};
  for (const row of portfolio.rows) {
    scores[row.buildingId] = {
      ohsPct: row.compliancePct,
      taskPct: taskQuery.data?.[row.buildingId] ?? null,
    };
  }

  return { scores, isLoading: portfolio.isLoading || taskQuery.isLoading };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useBuildingsScores.ts
git commit -m "feat: add useBuildingsScores (per-building OHS + task scores for grid)"
```

---

### Task 5: Render chips — Buildings grid + detail header

**Files:**
- Modify: `src/pages/Buildings.tsx`
- Modify: `src/pages/BuildingDetails.tsx`

- [ ] **Step 1: Buildings.tsx — imports + hook call**

Add import after line 31 (`BuildingImportDialog` import):

```tsx
import { BuildingScoreChips } from '@/components/building/BuildingScoreChips';
import { useBuildingsScores } from '@/hooks/useBuildingsScores';
```

Inside the component (after line 36 `const { buildings, ... } = useBuildings();`):

```tsx
  const { scores } = useBuildingsScores();
```

- [ ] **Step 2: Buildings.tsx — render chips in the card body**

Find (the `CardContent` block, lines ~316-319):

```tsx
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {building.address}
                  </p>
```

Replace with:

```tsx
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {building.address}
                  </p>
                  <div className="mb-4">
                    <BuildingScoreChips
                      ohsPct={scores[building.id]?.ohsPct ?? null}
                      taskPct={scores[building.id]?.taskPct ?? null}
                    />
                  </div>
```

- [ ] **Step 3: BuildingDetails.tsx — imports + hook call**

Add import after line 24 (`BuildingAvatarDialog` import):

```tsx
import { BuildingScoreChips } from '@/components/building/BuildingScoreChips';
import { useBuildingScore } from '@/hooks/useBuildingScore';
```

Inside the component (after line 45 `const [activeTab, ...]`):

```tsx
  const { ohsPct, taskPct } = useBuildingScore(id);
```

- [ ] **Step 4: BuildingDetails.tsx — render chips under the address**

Find (lines ~157-160):

```tsx
              <p className="text-xs sm:text-sm text-muted-foreground flex items-center gap-1 truncate">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{building.address}, {building.city}</span>
              </p>
```

Replace with:

```tsx
              <p className="text-xs sm:text-sm text-muted-foreground flex items-center gap-1 truncate">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{building.address}, {building.city}</span>
              </p>
              <div className="mt-2">
                <BuildingScoreChips ohsPct={ohsPct} taskPct={taskPct} />
              </div>
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Buildings.tsx src/pages/BuildingDetails.tsx
git commit -m "feat: show OHS + task score chips on building cards and detail header"
```

---

### Task 6: Dashboard — real Portfolio OHS + remove orphaned metric

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/hooks/useDashboardStats.ts`

- [ ] **Step 1: Dashboard.tsx — imports**

Add after line 9 (`Progress` import):

```tsx
import { cn } from '@/lib/utils';
import { classify, THRESHOLDS, STATUS_CLASS } from '@/lib/fortressKpis';
import { usePortfolioCompliance } from '@/hooks/usePortfolioCompliance';
```

- [ ] **Step 2: Dashboard.tsx — call the portfolio hook**

Find where stats are pulled (the `useDashboardStats()` call near the top of the component) and add below it:

```tsx
  const { portfolioAvg, reportedCount, total } = usePortfolioCompliance();
```

- [ ] **Step 3: Dashboard.tsx — replace the compliance card**

Find (lines ~191-213):

```tsx
      {/* Compliance Score */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Overall Compliance Score</CardTitle>
              <CardDescription>Based on task completion across all buildings</CardDescription>
            </div>
            {stats.complianceRate > 0 && (
              <div className="flex items-center gap-2 text-success">
                <TrendingUp className="h-4 w-4" />
                <span className="text-sm font-medium">Today's progress</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="text-4xl font-bold">{stats.complianceRate}%</div>
            <Progress value={stats.complianceRate} className="flex-1 h-3" />
          </div>
        </CardContent>
      </Card>
```

Replace with:

```tsx
      {/* Portfolio OHS Compliance — real OHS Act compliance from approved monthly OPS reports */}
      <Card>
        <CardHeader>
          <CardTitle>Portfolio OHS Compliance</CardTitle>
          <CardDescription>Latest approved monthly OPS compliance score per building</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className={cn('text-4xl font-bold tabular-nums', STATUS_CLASS[classify(portfolioAvg, THRESHOLDS.compliance)].text)}>
              {portfolioAvg === null ? '—' : `${portfolioAvg}%`}
            </div>
            <Progress value={portfolioAvg ?? 0} className="flex-1 h-3" />
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {reportedCount} of {total} buildings reported
          </p>
        </CardContent>
      </Card>
```

- [ ] **Step 4: Dashboard.tsx — drop the now-unused `TrendingUp` import**

`TrendingUp` was only used in the removed card. Remove it from the lucide import block (lines 10-23). Leave the other icons.

- [ ] **Step 5: useDashboardStats.ts — remove the orphaned complianceRate**

In `src/hooks/useDashboardStats.ts`:
- In the `DashboardStats` interface (line 14), remove `complianceRate: number;`.
- In the initial state (line 48), remove `complianceRate: 0,`.
- Remove the computation (lines 129-131):
  ```ts
      const complianceRate = totalTasks > 0
        ? Math.round((completedCount / totalTasks) * 100)
        : 0;
  ```
  and the now-unused `const totalTasks = pendingCount + completedCount;` (line 128).
- In the `setStats({...})` call, remove the `complianceRate,` line (line 138).

(`pendingCount` and `completedCount` stay — still used for `pendingTasks`/`completedToday`.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (catches any missed `complianceRate`/`TrendingUp` reference).

- [ ] **Step 7: Commit**

```bash
git add src/pages/Dashboard.tsx src/hooks/useDashboardStats.ts
git commit -m "feat: dashboard shows real Portfolio OHS Compliance (drop broken task-throughput metric)"
```

---

### Task 7: Full verification

**Files:** none.

- [ ] **Step 1: Unit tests**

Run: `npx vitest run src/lib/buildingScore.test.ts`
Expected: PASS.
If vitest can't start (known broken `node_modules`/PostCSS), prove the helper via esbuild + Node:
```bash
npx esbuild src/lib/buildingScore.ts --format=esm --outfile=/tmp/bs.mjs --log-level=error
node --input-type=module -e 'import {taskCompletionPct} from "/tmp/bs.mjs"; const r=[[{completed:7,pending:2,overdue:1},70],[{completed:5,pending:0,overdue:0},100],[{completed:0,pending:3,overdue:1},0],[{completed:0,pending:0,overdue:0},null]]; let ok=0; for(const [i,w] of r){const g=taskCompletionPct(i); const p=g===w; if(p)ok++; console.log(p?"PASS":"FAIL",JSON.stringify(i),"->",g);} process.exit(ok===r.length?0:1)'
```

- [ ] **Step 2: Typecheck (whole project)**

Run: `npx tsc --noEmit`
Expected: exit 0, zero new errors.

- [ ] **Step 3: Re-confirm no stray references**

Run: `grep -rn "complianceRate" src` → expect NO matches. `grep -rn "TrendingUp" src/pages/Dashboard.tsx` → expect NO matches.

- [ ] **Step 4: Deploy / visual**

The full `vite build` + browser QA run remotely (local build is blocked by the known `node_modules` breakage). On deploy, confirm: Buildings grid cards show OHS + Tasks chips (incl. a `—` OHS card); the detail header shows the chips; the dashboard shows the real portfolio average; `compliance_scores` in the DB is unchanged.

---

## Self-Review

**Spec coverage:**
- Tasks % helper + threshold → Task 1. ✅
- Chips component (colour-banded, null states + tooltips) → Task 2. ✅
- Single-building hook (detail header) → Task 3. ✅
- All-buildings hook (grid; reuse usePortfolioCompliance + task query) → Task 4. ✅
- Render on Buildings grid + detail header → Task 5. ✅
- Dashboard real Portfolio OHS + remove orphaned `complianceRate` → Task 6. ✅
- No tab-strip indicators (none added). ✅
- Verification incl. broken-env fallback → Task 7. ✅

**Placeholder scan:** none; every code step is complete; line numbers are approximate (`~`) with exact match-strings.

**Type/name consistency:** `taskCompletionPct(TaskCounts)` defined in Task 1, used identically in Tasks 3/4. `BuildingScoreChips({ohsPct, taskPct})` defined in Task 2, used in Task 5. `useBuildingScore` returns `{ohsPct, ohsPeriod, taskPct, isLoading}`; `useBuildingsScores` returns `{scores, isLoading}` with `scores[id] = {ohsPct, taskPct}`. `THRESHOLDS.taskCompletion` added in Task 1, consumed in Task 2. Consistent.
