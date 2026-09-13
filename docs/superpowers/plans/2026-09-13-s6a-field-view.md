# S6a "Field building view" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A field user (`user` role) who opens a building sees four tabs — Overview · Tasks · Forms · Notes — whose overview is "My work here": the tasks assigned to them in this building, completable in place with the same row, Complete button and queued chip as My Day. Building Reports, SLA clocks, month costs, expiring-document alerts, score chips and the empty "Administration" sidebar group no longer reach a field user. Admins and managers see exactly what they see today.

**Architecture:** Four small moves, no schema or function change. (1) The My Day task row becomes `src/components/myday/TaskRow.tsx` (`TaskRow`, `Row`, `dueLabel`, `queuedStateFor`) so My Day and the building page share one 56 px row; My Day keeps its markup and all 17 tests. (2) `src/components/building/MyWorkHere.tsx` calls the same `useMyWork()` as My Day, filters the three buckets by `building_id`, renders Overdue / Today / Next 7 days inside one card with My Day's loading, error and empty states, opens `CompleteTaskDialog` from its own state, and overlays the offline queue through `pendingOverlay`. (3) `BuildingDetails` mounts only the four field triggers and contents when `!isAdminOrManager`, sends every management `?tab=` value to Overview, skips the score chips (and their snapshot reads); `OverviewWidgets` takes `isAdminOrManager` as a **required prop** and renders `MyWorkHere` → `OpenIssuesWidget` for a field user (decision and reasons in Task 3). (4) Vocabulary: the two `/reports/fortress` routes get `allowedRoles`, the "Building Reports" nav item gets `roles`, `DashboardLayout` renders a sidebar group only when it has an accessible item, `Issues` gates the `SlaChip` and the SLA CSV columns on `isAdminOrManager`, `IssueDetailDialog` gates its chip and SLA line on `canManage`.

**Tech Stack:** React 18 + TS, TanStack Query (already behind `useMyWork`), vitest 3 + Testing Library (jsdom, `pool: 'forks'`), `src/test/mobile.ts` `mockViewport`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-13-pilot-field-design.md` §4 (constraints in §2). S6b (won't-do) is a separate plan; the two touch disjoint files.

**Ground rules for every agent:** never `git stash` / `checkout` / `switch` / `reset` / `worktree`; compare with `git show <sha>:<path>`; edit only the files your task names; commit with an explicit pathspec; retry after 5 s on `index.lock`; end commit messages with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; gate = `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E '<your files>'` prints nothing, `npm run test` green, global count ≤ `.github/typecheck-baseline.txt` (46); guardrail copy (queued / needs-attention chips, "could not be loaded", error messages) is plain text, never through `<Hint>`; coaching copy always through `<Hint>`; tap targets ≥ 44 px on phones; do not edit the shared components in `src/components/ui/`; no migration and no edge-function change anywhere in this plan — if a step seems to need one, stop and report.

**Facts every task relies on:** Branch `feat/pilot-field` is at `a276c1f` (spec commit) on top of `main` `eb5f327`. Baseline on that commit: `npm run test` → `Test Files  181 passed (181)`, `Tests  1932 passed (1932)`; `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'` → `46` (two Node `ExperimentalWarning: localStorage is not available` lines print before the summary and are harmless). `useAuth()` (`src/contexts/AuthContext.tsx`) exposes `user`, `role: AppRole | null`, `isAdminOrManager: boolean`, `signOut`; `AppRole` is `'admin' | 'manager' | 'user'` (`src/lib/constants.ts:12`). `useMyWork()` (`src/hooks/useMyWork.ts:87`) returns `{ today, buckets: { overdue, today, upcoming }, issues, signoffs, returnedReports, unread, isLoading, isError, error, isEmpty, refetch }`; `MyTask` (`src/lib/myWork.ts:2`) carries `building_id`, `building_name`, `due_date`, `requires_photo`, `requires_signature`; `bucketTasks` already bounds `upcoming` to 7 days (`UPCOMING_DAYS = 7`). `queuedTaskIds` / `failedTaskIds` (`src/lib/offline/pendingOverlay.ts:31,40`) project `useOfflineQueue().ops` to `Set<string>` of task instance ids. `CompleteTaskDialog` (`src/components/checklists/CompleteTaskDialog.tsx:21`) takes `open, onOpenChange, taskId, taskName, taskDescription?, requiresPhoto, requiresSignature, onSuccess?`. `track(event, props?)` takes `Record<string, string | number | boolean | null | undefined>` (`src/lib/analytics.ts:20,222`). `formatBuildingName` upper-cases (`src/lib/buildingName.ts:12`), so fixtures named `Alpha Tower` render `ALPHA TOWER`. `useBuildingScore(id)` and `useBuildingTrend(id, days)` both accept `string | undefined` and set `enabled: !!buildingId` (`src/hooks/useBuildingScore.ts:53-56`, `src/hooks/useBuildingTrend.ts:33-36`). `OverviewWidgets.test.tsx` renders the real widgets against a thenable Postgrest stub and has no `AuthContext` mock. `BuildingDetails.team.test.tsx` is the page harness to copy: hoisted `auth.isAdminOrManager`, every tab stubbed as `<div>NameTab</div>`, `BuildingScoreChips` stubbed as `<div>BuildingScoreChips</div>`, `Element.prototype.scrollIntoView` stubbed. The Overview trigger's `textContent` is `OverviewInfo` and Checklists' is `ChecklistsTasks` (two responsive spans each). `ProtectedRoute` is already unit-tested for `allowedRoles` (`src/components/ProtectedRoute.test.tsx`, 12 tests); there is no `App.test.tsx` and no `DashboardLayout` test. `DashboardLayout` renders `SidebarGroupLabel` as a `div[data-sidebar="group-label"]`; `SidebarProvider` wraps its own `TooltipProvider` and reads `useIsMobile()` (satisfied by the `matchMedia` stub in `src/test/setup.ts`). `ISSUE_CSV_COLUMNS` is imported by `src/components/reports/fortress/gridCsv.test.ts:17` and its header order is pinned there. `Issues.test.tsx` mocks `useAuth` as a fixed `{ isAdminOrManager: false }` object (lines 32–34) and currently asserts the SLA chip renders for that user. `IssueDetailDialog.test.tsx` has a `describe('SLA')` at lines 141–165. Fortress reports are created only through `NewReportDialog`, which `ReportsTab.tsx:91` renders for `isAdminOrManager` only, so no `user`-role author exists whom the route gate in Task 4 could strand.

**Task order:** Task 1 → Task 2 → Task 3 (each imports the previous task's file). Task 4 touches none of those files and may run in parallel with Tasks 1–3. Task 5 is controller-only.

**Controller-only steps:** Task 5 (full gate, manual phone check in the browser, record, push). No migration, no function deploy; the normal Vercel push is the whole deploy.

---

### Task 1: Extract `TaskRow` from My Day

**Files:**
- Create: `src/components/myday/TaskRow.tsx`, `src/components/myday/TaskRow.test.tsx`
- Modify: `src/pages/MyDay.tsx`

Why: `MyDay.tsx:109-118` (`Row`), `:56-62` (`dueLabel`), `:166-175` (`queuedChip`) and `:177-196` (`taskRow`) are the row the building page needs. Moving them to one module means one 56 px row, one Complete button and one queued chip for both pages. `Row` is exported too because My Day's issue, sign-off and returned-report rows use it; keeping a copy in My Day would be the drift this task exists to prevent.

- [x] **Step 1: Failing component test**

```tsx
// src/components/myday/TaskRow.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MyTask } from '@/lib/myWork';
import { TaskRow, dueLabel, queuedStateFor } from './TaskRow';

const task: MyTask = {
  id: 't1',
  task_name: 'Check fire extinguishers',
  task_description: null,
  due_date: '2026-09-09',
  building_id: 'b1',
  building_name: 'Alpha Tower',
  requires_photo: true,
  requires_signature: false,
  status: 'overdue',
};
const TODAY = '2026-09-10';

describe('dueLabel', () => {
  it('reads today, a past date and a future date against the operating day', () => {
    expect(dueLabel('2026-09-10', TODAY)).toBe('Due today');
    expect(dueLabel('2026-09-09', TODAY)).toBe('Was due Wed 9 Sep');
    expect(dueLabel('2026-09-14', TODAY)).toBe('Due Mon 14 Sep');
  });

  it('falls back to the raw value when the date does not parse', () => {
    expect(dueLabel('not-a-date', TODAY)).toBe('not-a-date');
  });
});

describe('queuedStateFor', () => {
  it('is none, queued or failed — and failed wins over queued', () => {
    expect(queuedStateFor('t1', new Set(), new Set())).toBe('none');
    expect(queuedStateFor('t1', new Set(['t1']), new Set())).toBe('queued');
    expect(queuedStateFor('t1', new Set(['t1']), new Set(['t1']))).toBe('failed');
    expect(queuedStateFor('t2', new Set(['t1']), new Set(['t1']))).toBe('none');
  });
});

describe('TaskRow', () => {
  it('shows the task, the building and the due line, and hands the task to onComplete', () => {
    const onComplete = vi.fn();
    render(<TaskRow task={task} today={TODAY} queued="none" onComplete={onComplete} showBuilding />);
    expect(screen.getByText('Check fire extinguishers')).toBeInTheDocument();
    // One <p> made of several text nodes, exactly as My Day renders it.
    expect(screen.getByText(/ALPHA TOWER · Was due Wed 9 Sep/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /complete/i }));
    expect(onComplete).toHaveBeenCalledWith(task);
  });

  it('leaves the building out when the page already is the building', () => {
    render(<TaskRow task={task} today={TODAY} queued="none" onComplete={vi.fn()} showBuilding={false} />);
    expect(screen.getByText('Was due Wed 9 Sep')).toBeInTheDocument();
    expect(screen.queryByText(/ALPHA TOWER/)).toBeNull();
  });

  it('replaces Complete with a Queued chip while the completion waits to sync', () => {
    render(<TaskRow task={task} today={TODAY} queued="queued" onComplete={vi.fn()} showBuilding />);
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /complete/i })).toBeNull();
  });

  it('says a rejected completion needs attention', () => {
    render(<TaskRow task={task} today={TODAY} queued="failed" onComplete={vi.fn()} showBuilding />);
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.queryByText('Queued')).toBeNull();
    expect(screen.queryByRole('button', { name: /complete/i })).toBeNull();
  });

  it('keeps the 56 px phone tap target on the row and 40 px on the action', () => {
    const { container } = render(<TaskRow task={task} today={TODAY} queued="none" onComplete={vi.fn()} showBuilding />);
    expect(container.firstElementChild?.className).toMatch(/\bmin-h-14\b/);
    expect(screen.getByRole('button', { name: /complete/i }).className).toMatch(/\bh-10\b/);
  });
});
```

Run: `npx vitest run src/components/myday/TaskRow.test.tsx`
Expected: `FAIL  src/components/myday/TaskRow.test.tsx` with `Error: Failed to resolve import "./TaskRow"` — `Test Files  1 failed (1)`.

- [x] **Step 2: The module** — moved verbatim from `MyDay.tsx` (the `Row` and `dueLabel` bodies and comments are unchanged; the queued chip and the row take their inputs as props instead of closing over page state):

```tsx
// src/components/myday/TaskRow.tsx
/**
 * One assigned task as a row: what it is, where it is (optional), when it is due, and one action.
 *
 * Shared by My Day and the building page's "My work here" card (spec: pilot-field §4.2) so the
 * two can never drift on the 56 px tap target, the Complete button or the queued chip. `Row` is
 * the shape of every My Day row (issues, sign-offs, returned reports too) and is exported so
 * My Day keeps one row primitive rather than a copy.
 */
import type { ReactNode } from 'react';
import { format } from 'date-fns';
import { CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatBuildingName } from '@/lib/buildingName';
import type { MyTask } from '@/lib/myWork';

/** Whether a completion for this task is already waiting in the offline queue, and how it stands. */
export type QueuedState = 'none' | 'queued' | 'failed';

/** The two pendingOverlay sets projected onto one row; `failed` wins because it needs the reader. */
export function queuedStateFor(taskId: string, queued: ReadonlySet<string>, failed: ReadonlySet<string>): QueuedState {
  if (failed.has(taskId)) return 'failed';
  if (queued.has(taskId)) return 'queued';
  return 'none';
}

/**
 * A date-column value (YYYY-MM-DD) read against the operating day, not the browser's.
 * A past due date reads "Was due …": in a list mixing overdue and upcoming rows, a bare
 * "Due Mon 8 Sep" gives the reader no clue that the date has already gone.
 */
export function dueLabel(dueDate: string, today: string): string {
  if (dueDate === today) return 'Due today';
  const parsed = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dueDate;
  const when = format(parsed, 'EEE d MMM');
  return dueDate < today ? `Was due ${when}` : `Due ${when}`;
}

/**
 * Every row is the same shape: what it is, where it is, and one action. Spec §5.3: a 56 px
 * tap target on phones (min-h-14), relaxing to 40 px once the row lays out horizontally.
 */
export function Row({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex min-h-14 flex-col gap-3 rounded-lg bg-muted/50 p-3 sm:min-h-10 sm:flex-row sm:items-center sm:justify-between">
      {/* break-words here rather than on each title: long task names and issue titles
          arrive unhyphenated from the field and would otherwise widen the row on a phone. */}
      <div className="min-w-0 flex-1 break-words">{children}</div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

// Guardrail chips, not <Hint>s: the state of a queued write must survive hints being off.
function QueuedChip({ state }: { state: Exclude<QueuedState, 'none'> }) {
  return state === 'failed' ? (
    <Badge variant="destructive" className="h-10 w-full justify-center sm:w-auto sm:h-auto">
      Needs attention
    </Badge>
  ) : (
    <Badge variant="secondary" className="h-10 w-full justify-center sm:w-auto sm:h-auto">
      Queued
    </Badge>
  );
}

export interface TaskRowProps {
  task: MyTask;
  /** Today as YYYY-MM-DD in the operating timezone (from useMyWork), so the due line agrees with the buckets. */
  today: string;
  queued: QueuedState;
  onComplete: (task: MyTask) => void;
  /** True on My Day, where rows span buildings; false on a page that already is the building. */
  showBuilding: boolean;
}

export function TaskRow({ task, today, queued, onComplete, showBuilding }: TaskRowProps) {
  return (
    <Row
      action={
        queued !== 'none' ? (
          <QueuedChip state={queued} />
        ) : (
          <Button className="h-10 w-full sm:w-auto" onClick={() => onComplete(task)}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Complete
          </Button>
        )
      }
    >
      <p className="font-medium text-sm">{task.task_name}</p>
      <p className="text-sm text-muted-foreground">
        {showBuilding && <>{formatBuildingName(task.building_name)} · </>}
        {dueLabel(task.due_date, today)}
      </p>
    </Row>
  );
}
```

Run: `npx vitest run src/components/myday/TaskRow.test.tsx`
Expected: `✓ src/components/myday/TaskRow.test.tsx (8 tests)` — `Test Files  1 passed (1)`.

- [x] **Step 3: My Day uses it (zero behaviour change)** — in `src/pages/MyDay.tsx`:

Add after line 37 (`import { WeekStrip } from '@/components/myday/WeekStrip';`):

```ts
import { Row, TaskRow, queuedStateFor } from '@/components/myday/TaskRow';
```

Delete lines 51–62 (the `dueLabel` doc comment and function) entirely. Delete lines 105–118 (the `Row` doc comment and function) entirely. `whenLabel` (lines 64–69) and `Section` (71–103) stay.

Replace lines 165–196 (from the `// Guardrail chips, not <Hint>s` comment through the closing `);` of `taskRow`) with:

```tsx
  const taskRow = (task: MyTask) => (
    <TaskRow
      key={task.id}
      task={task}
      today={today}
      queued={queuedStateFor(task.id, queuedTasks, failedTasks)}
      onComplete={setTaskToComplete}
      showBuilding
    />
  );
```

Nothing else changes: `format`, `CheckCircle2`, `Badge`, `Button`, `formatBuildingName` and `type ReactNode` are all still used elsewhere in the file (the date header, the empty state, the unread badge, the issue rows, `Section`). The three `buckets.*.map(taskRow)` call sites at the old lines 290, 300 and 418 are untouched.

Run: `npx vitest run src/pages/MyDay.test.tsx src/components/myday`
Expected: `✓ src/pages/MyDay.test.tsx (17 tests)`, `✓ src/components/myday/TaskRow.test.tsx (8 tests)`, `✓ src/components/myday/WeekStrip.test.tsx` — `Test Files  3 passed (3)`.

- [x] **Step 4: gate, commit** — `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'MyDay|TaskRow'` prints nothing; `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'` ≤ 46; `git add src/components/myday/TaskRow.tsx src/components/myday/TaskRow.test.tsx src/pages/MyDay.tsx && git commit -m "My Day: extract TaskRow so the building page can share the row"` (+ blank line and trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`).

---

### Task 2: `MyWorkHere`

**Files:**
- Create: `src/components/building/MyWorkHere.tsx`, `src/components/building/MyWorkHere.test.tsx`

Depends on Task 1 (`TaskRow`). Not yet mounted anywhere — Task 3 mounts it.

- [x] **Step 1: Failing tests**

```tsx
// src/components/building/MyWorkHere.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { useMyWork } from '@/hooks/useMyWork';
import type { MyTask } from '@/lib/myWork';
import type { QueuedOp } from '@/lib/offline/types';

/** The card's whole data contract, so a field added to useMyWork fails here, not silently. */
type MyWork = ReturnType<typeof useMyWork>;

const state = vi.hoisted(() => ({
  work: {} as MyWork,
  hintsEnabled: true,
  queuedOps: [] as QueuedOp[],
}));
const track = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useMyWork', () => ({ useMyWork: () => state.work }));
// The real hook reaches for the Supabase client at import time; the card only cares whether
// hints are on, and toggling that is how we prove the coaching copy is a <Hint>.
vi.mock('@/hooks/useHints', () => ({
  useHints: () => ({ hintsEnabled: state.hintsEnabled, setHintsEnabled: vi.fn() }),
}));
vi.mock('@/lib/analytics', () => ({ track }));
// The queue hook reads IndexedDB through TanStack Query; the card only needs the ops list.
vi.mock('@/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({
    ops: state.queuedOps,
    pending: state.queuedOps.filter((o) => o.status === 'pending').length,
    failed: state.queuedOps.filter((o) => o.status === 'failed').length,
    retry: vi.fn(),
    discard: vi.fn(),
    retryAll: vi.fn(),
  }),
}));
// The dialog has its own tests; here we care that the card opens it and reacts to success.
vi.mock('@/components/checklists/CompleteTaskDialog', () => ({
  default: ({ open, taskName, onSuccess }: { open: boolean; taskName: string; onSuccess?: () => void }) => (
    <div>
      {`CompleteTaskDialog open=${open} task=${taskName}`}
      <button onClick={onSuccess}>dialog success</button>
    </div>
  ),
}));

import MyWorkHere from './MyWorkHere';

const here = (over: Partial<MyTask>): MyTask => ({
  id: 't1',
  task_name: 'Check fire extinguishers',
  task_description: null,
  due_date: '2026-09-09',
  building_id: 'b1',
  building_name: 'Alpha Tower',
  requires_photo: true,
  requires_signature: false,
  status: 'overdue',
  ...over,
});

const overdueHere = here({ id: 't1', task_name: 'Check fire extinguishers', due_date: '2026-09-09', status: 'overdue' });
const todayHere = here({ id: 't2', task_name: 'Test the alarm panel', due_date: '2026-09-10', status: 'pending' });
const upcomingHere = here({ id: 't3', task_name: 'Service the generator', due_date: '2026-09-14', status: 'pending' });
const overdueElsewhere = here({ id: 't4', task_name: 'Clear the gutters', due_date: '2026-09-08', status: 'overdue', building_id: 'b2', building_name: 'Beta House' });
const todayElsewhere = here({ id: 't5', task_name: 'Read the water meter', due_date: '2026-09-10', status: 'pending', building_id: 'b2', building_name: 'Beta House' });

const queuedCompletion = (taskInstanceId: string, status: QueuedOp['status'] = 'pending'): QueuedOp => ({
  id: `op-${taskInstanceId}`,
  uid: 'u1',
  createdAt: Date.now(),
  attempts: 0,
  status,
  lastError: status === 'failed' ? 'permission denied' : null,
  photos: [],
  payload: {
    kind: 'task_complete',
    completionId: `c-${taskInstanceId}`,
    taskInstanceId,
    taskName: 'Check fire extinguishers',
    notes: null,
    signatureConfirmed: false,
  },
});

function baseWork(overrides: Partial<MyWork> = {}): MyWork {
  return {
    today: '2026-09-10',
    buckets: { overdue: [overdueHere, overdueElsewhere], today: [todayHere, todayElsewhere], upcoming: [upcomingHere] },
    issues: [],
    signoffs: [],
    returnedReports: [],
    unread: 0,
    isLoading: false,
    isError: false,
    error: null,
    isEmpty: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

const renderCard = () => render(<MyWorkHere buildingId="b1" />);

describe('MyWorkHere', () => {
  beforeEach(() => {
    track.mockClear();
    state.hintsEnabled = true;
    state.queuedOps = [];
    state.work = baseWork();
  });

  it("shows only this building's tasks, in the three buckets, without the building name", () => {
    renderCard();
    expect(screen.getByText('My work here')).toBeInTheDocument();
    expect(screen.getByText('Overdue (1)')).toBeInTheDocument();
    expect(screen.getByText('Today (1)')).toBeInTheDocument();
    expect(screen.getByText('Next 7 days (1)')).toBeInTheDocument();
    expect(screen.getByText('Check fire extinguishers')).toBeInTheDocument();
    expect(screen.getByText('Test the alarm panel')).toBeInTheDocument();
    expect(screen.getByText('Service the generator')).toBeInTheDocument();
    // The other building's tasks are My Day's business, not this card's.
    expect(screen.queryByText('Clear the gutters')).toBeNull();
    expect(screen.queryByText('Read the water meter')).toBeNull();
    // The page is the building, so the row does not repeat it.
    expect(screen.queryByText(/ALPHA TOWER/)).toBeNull();
    expect(screen.getByText('Was due Wed 9 Sep')).toBeInTheDocument();
  });

  it('opens the complete dialog for the clicked task', () => {
    renderCard();
    expect(screen.queryByText(/CompleteTaskDialog/)).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /complete/i })[0]);
    expect(screen.getByText('CompleteTaskDialog open=true task=Check fire extinguishers')).toBeInTheDocument();
  });

  it('closes the dialog, refetches and tracks after a completion', () => {
    const refetch = vi.fn();
    state.work = baseWork({ refetch });
    renderCard();
    fireEvent.click(screen.getAllByRole('button', { name: /complete/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'dialog success' }));
    expect(screen.queryByText(/CompleteTaskDialog/)).toBeNull();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('task_completed', { taskId: 't1', surface: 'my_work_here' });
  });

  it('shows a Queued chip instead of Complete while the completion waits to sync', () => {
    state.queuedOps = [queuedCompletion('t1')];
    renderCard();
    expect(screen.getByText('Queued')).toBeInTheDocument();
    // t2 and t3 are not queued, so two Complete buttons remain.
    expect(screen.getAllByRole('button', { name: /complete/i })).toHaveLength(2);
    // Still counted: the server has not accepted it yet.
    expect(screen.getByText('Overdue (1)')).toBeInTheDocument();
  });

  it('says a rejected completion needs attention', () => {
    state.queuedOps = [queuedCompletion('t1', 'failed')];
    renderCard();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.queryByText('Queued')).toBeNull();
  });

  it('shows the empty state when nothing in this building is mine, even if My Day is not empty', () => {
    state.work = baseWork({ buckets: { overdue: [overdueElsewhere], today: [todayElsewhere], upcoming: [] }, isEmpty: false });
    renderCard();
    expect(screen.getByText('Nothing assigned to you here')).toBeInTheDocument();
    expect(screen.queryByText(/\(\d+\)/)).toBeNull();
  });

  it('shows a spinner while loading, not an empty card', () => {
    state.work = baseWork({ isLoading: true, buckets: { overdue: [], today: [], upcoming: [] } });
    renderCard();
    expect(screen.getByLabelText('Loading your work here')).toBeInTheDocument();
    expect(screen.queryByText('Nothing assigned to you here')).toBeNull();
  });

  it('offers a retry rather than an empty card when the load fails', () => {
    const refetch = vi.fn();
    state.work = baseWork({
      isError: true,
      error: new Error('permission denied for table task_instances'),
      buckets: { overdue: [], today: [], upcoming: [] },
      refetch,
    });
    renderCard();
    expect(screen.getByText('Your work here could not be loaded')).toBeInTheDocument();
    // The reason, not just the fact — otherwise a report to support says only "it broke".
    expect(screen.getByText('permission denied for table task_instances')).toBeInTheDocument();
    expect(screen.queryByText('Nothing assigned to you here')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('routes the coaching copy through the hints toggle', () => {
    const { unmount } = renderCard();
    expect(screen.getByText('Tasks assigned to you in this building. Everything else that is yours is on My Day.')).toBeInTheDocument();
    expect(screen.getByText('Past their due date — clear these first.')).toBeInTheDocument();
    unmount();

    // Hints off: the coaching lines go, the headings, counts and rows stay.
    state.hintsEnabled = false;
    renderCard();
    expect(screen.queryByText(/Everything else that is yours is on My Day/)).toBeNull();
    expect(screen.queryByText('Past their due date — clear these first.')).toBeNull();
    expect(screen.getByText('Overdue (1)')).toBeInTheDocument();
    expect(screen.getByText('Check fire extinguishers')).toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/components/building/MyWorkHere.test.tsx`
Expected: `FAIL  src/components/building/MyWorkHere.test.tsx` with `Error: Failed to resolve import "./MyWorkHere"` — `Test Files  1 failed (1)`.

- [x] **Step 2: The card**

```tsx
// src/components/building/MyWorkHere.tsx
/**
 * "My work here": the tasks assigned to me in this building — the overview a field user opens
 * the building page for (spec: pilot-field §4.2).
 *
 * Same data as My Day (`useMyWork`, filtered to one building) so the two pages can never
 * disagree about what is mine, and the same row, Complete action and queued chip (`TaskRow`)
 * so completing from here behaves exactly as completing from My Day. The building name is
 * left off the rows because the page is the building. Sign-offs and returned reports are My
 * Day's, not this card's. Mobile-first: one column, nothing side by side.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardCheck, ListChecks, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { useMyWork } from '@/hooks/useMyWork';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { failedTaskIds, queuedTaskIds } from '@/lib/offline/pendingOverlay';
import type { MyTask } from '@/lib/myWork';
import { TaskRow, queuedStateFor } from '@/components/myday/TaskRow';
import CompleteTaskDialog from '@/components/checklists/CompleteTaskDialog';
import { track } from '@/lib/analytics';

interface MyWorkHereProps {
  buildingId: string;
}

/** One bucket inside the card: a heading with its count, optional coaching line, then rows. */
function Group({
  title,
  count,
  icon,
  tone = 'default',
  description,
  children,
}: {
  title: string;
  count: number;
  icon: ReactNode;
  tone?: 'default' | 'destructive';
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className={cn('flex items-center gap-2 text-sm font-semibold', tone === 'destructive' && 'text-destructive')}>
        <span className={cn('shrink-0', tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground')}>{icon}</span>
        {`${title} (${count})`}
      </h3>
      {/* Coaching copy through <Hint>; the heading, count and rows are state cues and stay. */}
      {description && <Hint>{description}</Hint>}
      {children}
    </section>
  );
}

export default function MyWorkHere({ buildingId }: MyWorkHereProps) {
  const { today, buckets, isLoading, isError, error, refetch } = useMyWork();

  // Completions waiting in the offline queue: the server still lists those tasks as due, so
  // the row must say "already done, waiting to sync" rather than offer Complete a second time.
  const { ops: queuedOps } = useOfflineQueue();
  const queuedTasks = queuedTaskIds(queuedOps);
  const failedTasks = failedTaskIds(queuedOps);

  const [taskToComplete, setTaskToComplete] = useState<MyTask | null>(null);

  const here = useMemo(
    () => ({
      overdue: buckets.overdue.filter((t) => t.building_id === buildingId),
      today: buckets.today.filter((t) => t.building_id === buildingId),
      upcoming: buckets.upcoming.filter((t) => t.building_id === buildingId),
    }),
    [buckets, buildingId],
  );
  // Decided here, not from useMyWork().isEmpty: My Day can be busy while this building is clear.
  const isEmpty = here.overdue.length + here.today.length + here.upcoming.length === 0;

  const taskRow = (task: MyTask) => (
    <TaskRow
      key={task.id}
      task={task}
      today={today}
      queued={queuedStateFor(task.id, queuedTasks, failedTasks)}
      onComplete={setTaskToComplete}
      showBuilding={false}
    />
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          My work here
        </CardTitle>
        <Hint>Tasks assigned to you in this building. Everything else that is yours is on My Day.</Hint>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading your work here" />
          </div>
        )}

        {/* A failed load must not read as "nothing here" — that is the one wrong answer. */}
        {!isLoading && isError && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
                Your work here could not be loaded
              </p>
              <Button variant="outline" size="sm" className="h-10" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Tasks may still be assigned to you. Try again, or open the Tasks tab.
            </p>
            {/* The actual failure, so a report to support says more than "it didn't work".
                Not a <Hint>: this is an error detail, and must survive hints being off. */}
            {error?.message && <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>}
          </div>
        )}

        {!isLoading && !isError && isEmpty && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-success" aria-hidden="true" />
            <p className="font-medium">Nothing assigned to you here</p>
            <p className="text-sm text-muted-foreground">
              No overdue, due-today or upcoming tasks in this building are yours.
            </p>
          </div>
        )}

        {!isLoading && !isError && !isEmpty && (
          <>
            {here.overdue.length > 0 && (
              <Group
                title="Overdue"
                count={here.overdue.length}
                tone="destructive"
                icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
                description="Past their due date — clear these first."
              >
                {here.overdue.map(taskRow)}
              </Group>
            )}
            {here.today.length > 0 && (
              <Group title="Today" count={here.today.length} icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />}>
                {here.today.map(taskRow)}
              </Group>
            )}
            {here.upcoming.length > 0 && (
              <Group title="Next 7 days" count={here.upcoming.length} icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />}>
                {here.upcoming.map(taskRow)}
              </Group>
            )}
          </>
        )}
      </CardContent>

      {taskToComplete && (
        <CompleteTaskDialog
          open
          onOpenChange={(open) => {
            if (!open) setTaskToComplete(null);
          }}
          taskId={taskToComplete.id}
          taskName={taskToComplete.task_name}
          taskDescription={taskToComplete.task_description}
          requiresPhoto={taskToComplete.requires_photo}
          requiresSignature={taskToComplete.requires_signature}
          onSuccess={() => {
            track('task_completed', { taskId: taskToComplete.id, surface: 'my_work_here' });
            setTaskToComplete(null);
            refetch();
          }}
        />
      )}
    </Card>
  );
}
```

Run: `npx vitest run src/components/building/MyWorkHere.test.tsx`
Expected: `✓ src/components/building/MyWorkHere.test.tsx (9 tests)` — `Test Files  1 passed (1)`.

- [x] **Step 3: gate, commit** — `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'MyWorkHere'` prints nothing; global count ≤ 46; `git add src/components/building/MyWorkHere.tsx src/components/building/MyWorkHere.test.tsx && git commit -m "Building: My work here card (spec pilot-field §4.2)"` (+ trailer).

---

### Task 3: The four-tab field page

**Files:**
- Create: `src/pages/BuildingDetails.user.test.tsx`
- Modify: `src/pages/BuildingDetails.tsx`, `src/components/building/OverviewWidgets.tsx`, `src/components/building/OverviewWidgets.test.tsx`

Depends on Task 2.

**Decision — how `OverviewWidgets` learns the role: a required `isAdminOrManager: boolean` prop, passed from `BuildingDetails`.** The spec's wording (§4.3) has the widget read `useAuth()` itself; the behaviour is identical either way, and the prop is chosen for three reasons. (1) `BuildingDetails.tsx:46` is already the page's single role read and drives the tabs, the edit button, the avatar buttons and (now) the chips from it; a second read inside the overview could never disagree, but a reader checking "what does a field user get on this page" should find one decision, not two. (2) `OverviewWidgets` stays a pure function of props: the existing 10 tests keep their harness (no `AuthContext` mock, which would otherwise be forced onto a file that renders real widgets against a Postgrest stub) and the role test is a prop flip. (3) Required, not defaulted: TypeScript makes every future caller decide, so the field layout cannot be reached by omission.

- [x] **Step 1: Failing page tests** — copy the Team harness and add the field-user cases:

```tsx
// src/pages/BuildingDetails.user.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const auth = vi.hoisted(() => ({ isAdminOrManager: false }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdminOrManager: auth.isAdminOrManager, user: { id: 'u1' } }) }));
const score = vi.hoisted(() => ({ calls: [] as (string | undefined)[] }));
vi.mock('@/hooks/useBuildingScore', () => ({
  useBuildingScore: (id: string | undefined) => { score.calls.push(id); return { ohsPct: 80, taskPct: 90, asOf: null }; },
}));
vi.mock('@/hooks/useBuildingTrend', () => ({
  useBuildingTrend: () => ({ rows: [], series: { compliance: [], tasks: [], issuesOpen: [], tasksOverdue: [], docsExpiring30: [] }, latest: null, isLoading: false }),
}));
// Each tab has its own tests; here only the shell matters (same stubs as BuildingDetails.team.test.tsx:12-26).
vi.mock('@/components/building/TenantsTab', () => ({ default: () => <div>TenantsTab</div> }));
vi.mock('@/components/building/AssetsTab', () => ({ default: () => <div>AssetsTab</div> }));
vi.mock('@/components/building/PpmTab', () => ({ default: () => <div>PpmTab</div> }));
vi.mock('@/components/building/DocumentsTab', () => ({ default: () => <div>DocumentsTab</div> }));
vi.mock('@/components/building/BuildingCalendarTab', () => ({ default: () => <div>BuildingCalendarTab</div> }));
vi.mock('@/components/building/NotesTab', () => ({ default: () => <div>NotesTab</div> }));
// Echoes the role prop so the page's one decision is visible from here.
vi.mock('@/components/building/OverviewWidgets', () => ({
  default: ({ isAdminOrManager }: { isAdminOrManager: boolean }) => <div>{`OverviewWidgets isAdminOrManager=${isAdminOrManager}`}</div>,
}));
vi.mock('@/components/building/ChecklistsTab', () => ({ default: () => <div>ChecklistsTab</div> }));
vi.mock('@/components/building/FormsTab', () => ({ default: () => <div>FormsTab</div> }));
vi.mock('@/components/building/ReportsTab', () => ({ default: () => <div>ReportsTab</div> }));
vi.mock('@/components/building/InsightLinkerTab', () => ({ default: () => <div>InsightLinkerTab</div> }));
vi.mock('@/components/building/team/TeamTab', () => ({ default: () => <div>TeamTab</div> }));
vi.mock('@/components/building/BuildingAvatar', () => ({ BuildingAvatar: () => <div>BuildingAvatar</div> }));
vi.mock('@/components/building/BuildingAvatarDialog', () => ({ BuildingAvatarDialog: () => null }));
vi.mock('@/components/building/BuildingScoreChips', () => ({ BuildingScoreChips: () => <div>BuildingScoreChips</div> }));

const building = { id: 'b1', name: 'Alpha', address: '1 Road', city: 'Cape Town', logo_url: null, logo_position: null, avatar_color: null, emergency_contacts: null, created_at: '2026-01-01T00:00:00Z' };
vi.mock('@/integrations/supabase/client', () => {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: building, error: null })) };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return { supabase: { from: vi.fn(() => query) } };
});

import BuildingDetails from './BuildingDetails';

beforeEach(() => { auth.isAdminOrManager = false; score.calls = []; Element.prototype.scrollIntoView = vi.fn(); });

const renderAt = (url: string) =>
  render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/buildings/:id" element={<BuildingDetails />} /></Routes></MemoryRouter>);

/** Every tab value a field user must not reach (spec pilot-field §4.1). */
const MANAGEMENT_TABS = ['team', 'reports', 'tenants', 'assets', 'ppm', 'maintenance', 'electrical', 'documents'];
const MANAGEMENT_CONTENT = /TeamTab|ReportsTab|TenantsTab|AssetsTab|PpmTab|BuildingCalendarTab|InsightLinkerTab|DocumentsTab/;

describe('BuildingDetails for a field user (spec pilot-field §4)', () => {
  it('mounts only Overview, Tasks, Forms and Notes, and hands the overview the role', async () => {
    renderAt('/buildings/b1');
    const tabs = (await screen.findAllByRole('tab')).map((t) => t.textContent);
    // Overview and Checklists carry two responsive labels each; the strip is exactly these four.
    expect(tabs).toEqual(['OverviewInfo', 'ChecklistsTasks', 'Forms', 'Notes']);
    expect(screen.getByText('OverviewWidgets isAdminOrManager=false')).toBeInTheDocument();
    expect(screen.queryByText(MANAGEMENT_CONTENT)).toBeNull();
  });

  it('sends every management ?tab= value to Overview', async () => {
    for (const tab of MANAGEMENT_TABS) {
      const { unmount } = renderAt(`/buildings/b1?tab=${tab}`);
      await screen.findByRole('tablist');
      expect(screen.getByRole('tab', { selected: true }), tab).toHaveTextContent('Overview');
      expect(screen.queryByText(MANAGEMENT_CONTENT), tab).toBeNull();
      unmount();
    }
  });

  it('still deep-links to a field tab', async () => {
    renderAt('/buildings/b1?tab=notes');
    await screen.findByRole('tablist');
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Notes');
    expect(screen.getByText('NotesTab')).toBeInTheDocument();
  });

  it('leaves the score chips out and does not read the snapshot for them', async () => {
    renderAt('/buildings/b1');
    await screen.findByRole('tablist');
    expect(screen.queryByText('BuildingScoreChips')).toBeNull();
    // The hook is still called (hooks cannot be conditional) but with no id, which disables its query.
    expect(score.calls.every((id) => id === undefined)).toBe(true);
  });
});

describe('BuildingDetails for a manager (unchanged)', () => {
  it('keeps all eleven tabs plus Team, the score chips and the management overview', async () => {
    auth.isAdminOrManager = true;
    renderAt('/buildings/b1?tab=ppm');
    const tabs = (await screen.findAllByRole('tab')).map((t) => t.textContent);
    expect(tabs).toEqual([
      'OverviewInfo', 'ChecklistsTasks', 'Team', 'Forms', 'Reports', 'Tenants', 'Assets', 'PPM',
      'CalendarCal.', 'Electrical & ComplianceElec.', 'DocumentsDocs', 'Notes',
    ]);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('PPM');
    expect(screen.getByText('PpmTab')).toBeInTheDocument();
    expect(screen.getByText('BuildingScoreChips')).toBeInTheDocument();
    expect(score.calls).toContain('b1');
    // The overview is not mounted while PPM is active; switch to it through the URL.
    expect(screen.queryByText(/OverviewWidgets/)).toBeNull();
  });
});
```

Run: `npx vitest run src/pages/BuildingDetails.user.test.tsx`
Expected: `FAIL` — 4 failures in the field-user describe (the tab strip has 12 entries, `OverviewWidgets isAdminOrManager=undefined`, PPM content mounts, chips present, `score.calls` is `['b1']`); the manager test passes. `Tests  4 failed | 1 passed (5)`.

- [x] **Step 2: The page** — in `src/pages/BuildingDetails.tsx`:

Add after line 41 (the closing `}` of `interface Building`):

```ts
/**
 * The tabs a field user gets (spec: pilot-field §4.1). Everything else on this page is
 * management vocabulary — costs, tenants, assets, PPM, compliance, documents, reports, team —
 * and is not mounted for the `user` role at all, so a deep link cannot reach it either.
 */
const FIELD_TABS: readonly string[] = ['overview', 'checklists', 'forms', 'notes'];
```

Replace lines 51–52:

```ts
  const { ohsPct, taskPct, asOf } = useBuildingScore(id);
  const trend = useBuildingTrend(id, 90);
```

with (the chips are hidden for a field user below; no id disables both snapshot queries, so the page does not read what it will not show):

```ts
  const { ohsPct, taskPct, asOf } = useBuildingScore(isAdminOrManager ? id : undefined);
  const trend = useBuildingTrend(isAdminOrManager ? id : undefined, 90);
```

Replace lines 117–119 (`const contacts …` through `const logoPosition …`) with:

```ts
  const contacts = building.emergency_contacts || {};
  const hasCustomLogo = building.logo_url && !building.logo_url.includes('dicebear');
  const logoPosition = building.logo_position || 'top-left';
  // A field user following a management deep link (?tab=ppm, ?tab=team, …) lands on Overview:
  // the trigger is not mounted, so the URL value cannot select anything else.
  const tabValue = !isAdminOrManager && !FIELD_TABS.includes(activeTab) ? 'overview' : activeTab;
```

Replace lines 186–188 (the `<div className="mt-2">` holding `BuildingScoreChips`) with:

```tsx
              {/* Compliance and completion scores are management vocabulary (spec pilot-field §4.3). */}
              {isAdminOrManager && (
                <div className="mt-2">
                  <BuildingScoreChips ohsPct={ohsPct} taskPct={taskPct} ohsTrend={trend.series.compliance} taskTrend={trend.series.tasks} asOf={asOf} />
                </div>
              )}
```

Replace lines 202–204 (the two comments and the `<Tabs …>` opening tag) with:

```tsx
      {/* Tabs - Mobile optimized with icons */}
      {/* Management tabs exist for admins and managers only; see `tabValue` for the deep-link fallback. */}
      <Tabs value={tabValue} onValueChange={handleTabChange} className="w-full">
```

Wrap the triggers at lines 218–234 (`reports` through `documents`, i.e. from `<TabsTrigger value="reports"` to the closing `</TabsTrigger>` of `documents`; the `team` trigger at 214–216 is already wrapped and the `forms` trigger at 217 stays outside) in a fragment:

```tsx
          {isAdminOrManager && (
            <>
              <TabsTrigger value="reports" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">Reports</TabsTrigger>
              <TabsTrigger value="tenants" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">Tenants</TabsTrigger>
              <TabsTrigger value="assets" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">Assets</TabsTrigger>
              <TabsTrigger value="ppm" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">PPM</TabsTrigger>
              {/* Value stays `maintenance` so existing ?tab=maintenance deep links keep working. */}
              <TabsTrigger value="maintenance" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">
                <span className="hidden sm:inline">Calendar</span>
                <span className="sm:hidden">Cal.</span>
              </TabsTrigger>
              <TabsTrigger value="electrical" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">
                <span className="hidden sm:inline">Electrical &amp; Compliance</span>
                <span className="sm:hidden">Elec.</span>
              </TabsTrigger>
              <TabsTrigger value="documents" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">
                <span className="hidden sm:inline">Documents</span>
                <span className="sm:hidden">Docs</span>
              </TabsTrigger>
            </>
          )}
```

Replace line 246 (`<OverviewWidgets buildingId={building.id} onTabChange={handleTabChange} />`) with:

```tsx
              <OverviewWidgets buildingId={building.id} onTabChange={handleTabChange} isAdminOrManager={isAdminOrManager} />
```

Wrap the contents at lines 361–387 (`reports` through `documents`; `team` at 351–355 is already wrapped; `forms` at 357–359 and `notes` at 389–391 stay outside) in a fragment:

```tsx
        {isAdminOrManager && (
          <>
            <TabsContent value="reports" className="mt-6">
              <ReportsTab buildingId={building.id} buildingName={building.name} />
            </TabsContent>

            <TabsContent value="tenants" className="mt-6">
              <TenantsTab buildingId={building.id} />
            </TabsContent>

            <TabsContent value="electrical" className="mt-6">
              <InsightLinkerTab buildingId={building.id} active={activeTab === 'electrical'} />
            </TabsContent>

            <TabsContent value="assets" className="mt-6">
              <AssetsTab buildingId={building.id} buildingName={building.name} />
            </TabsContent>

            <TabsContent value="ppm" className="mt-6">
              <PpmTab buildingId={building.id} />
            </TabsContent>

            <TabsContent value="maintenance" className="mt-6">
              <BuildingCalendarTab buildingId={building.id} buildingName={building.name} />
            </TabsContent>

            <TabsContent value="documents" className="mt-6">
              <DocumentsTab buildingId={building.id} />
            </TabsContent>
          </>
        )}
```

Run: `npx vitest run src/pages/BuildingDetails`
Expected: `✓ src/pages/BuildingDetails.user.test.tsx (5 tests)`, `✓ src/pages/BuildingDetails.team.test.tsx (2 tests)`, `✓ src/pages/BuildingDetails.mobile.test.tsx (2 tests)` — `Test Files  3 passed (3)`, `Tests  9 passed (9)`. (vitest does not typecheck: the page now passes `isAdminOrManager` to a widget whose props do not yet declare it, so `tsc` reports one `TS2322` at the `<OverviewWidgets …>` line of `BuildingDetails.tsx` until Step 4 lands. Do not commit between here and Step 4.)

- [x] **Step 3: Failing widget tests** — in `src/components/building/OverviewWidgets.test.tsx`:

Add after line 69 (the closing `});` of the supabase mock, before `import OverviewWidgets`):

```tsx
// My work here has its own tests and reaches useMyWork/useAuth; here only its position matters.
vi.mock('@/components/building/MyWorkHere', () => ({
  default: ({ buildingId }: { buildingId: string }) => <div>{`MyWorkHere ${buildingId}`}</div>,
}));
```

Replace lines 76–83 (the `renderWidgets` signature and the `<Route path="/buildings/:id" …>` line) so the role is a parameter that defaults to the manager view every existing test assumes:

```tsx
function renderWidgets(onTabChange = vi.fn(), isAdminOrManager = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;
  render(
    wrap(
      <MemoryRouter initialEntries={['/buildings/b1']}>
        <Routes>
          <Route path="/buildings/:id" element={<OverviewWidgets buildingId="b1" onTabChange={onTabChange} isAdminOrManager={isAdminOrManager} />} />
```

Append at the end of the file:

```tsx
describe('OverviewWidgets — field user (spec pilot-field §4.3)', () => {
  it('renders My work here, then Open issues, and none of the management widgets', async () => {
    renderWidgets(vi.fn(), false);
    const mine = await screen.findByText('MyWorkHere b1');
    const issues = await screen.findByRole('button', { name: /open issues/i });
    expect(mine.compareDocumentPosition(issues) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: /today's tasks/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /this month's costs/i })).toBeNull();
    expect(screen.queryByText('Document Expiry Alerts')).toBeNull();
    expect(screen.queryByText('Maintenance Alerts')).toBeNull();
    expect(screen.queryByText('Form Activity')).toBeNull();
    // Nothing is fetched for the widgets that are not shown.
    expect(state.calls.some((c) => c.table === 'building_documents' || c.table === 'building_assets' || c.table === 'form_submissions' || c.table === 'building_month_costs')).toBe(false);
  });

  it('keeps My work here off the manager overview', async () => {
    renderWidgets();
    await screen.findByRole('button', { name: /today's tasks/i });
    expect(screen.queryByText(/MyWorkHere/)).toBeNull();
  });
});
```

Run: `npx vitest run src/components/building/OverviewWidgets.test.tsx`
Expected: the first new test fails (`Unable to find an element with the text: MyWorkHere b1`); `Tests  1 failed | 11 passed (12)`.

- [x] **Step 4: The widget** — in `src/components/building/OverviewWidgets.tsx`:

Add after line 12 (`import MonthCostsCard from './MonthCostsCard';`):

```ts
import MyWorkHere from './MyWorkHere';
```

Replace lines 14–17 (`interface OverviewWidgetsProps { … }`) with:

```ts
/** What every widget below needs. */
interface WidgetProps {
  buildingId: string;
  onTabChange?: (tab: string) => void;
}

interface OverviewWidgetsProps extends WidgetProps {
  /**
   * Passed down from BuildingDetails, the page's single role read, rather than read here from
   * useAuth(): one decision drives the tabs, the chips and this layout, and the widget stays a
   * pure function of its props. Required so no caller can reach the field layout by omission.
   */
  isAdminOrManager: boolean;
}
```

Change line 182 `function TodayTasksWidget({ buildingId, onTabChange }: OverviewWidgetsProps) {` to use `WidgetProps`; line 212 `function OpenIssuesWidget({ buildingId }: OverviewWidgetsProps) {` to `function OpenIssuesWidget({ buildingId }: WidgetProps) {`; line 263 `function AlertWidgets({ buildingId, onTabChange }: OverviewWidgetsProps) {` to use `WidgetProps`.

Replace lines 245–257 (the default export) with:

```tsx
export default function OverviewWidgets({ buildingId, onTabChange, isAdminOrManager }: OverviewWidgetsProps) {
  // Field user (spec pilot-field §4.2–4.3): "my work here", then open issues — one column, and
  // none of the management widgets. Today's tasks is portfolio "today for the building", not
  // "mine", so My work here replaces it rather than sitting beside it. Costs, expiring documents,
  // asset service and form activity are manager vocabulary and are not fetched at all.
  if (!isAdminOrManager) {
    return (
      <div className="space-y-4">
        <MyWorkHere buildingId={buildingId} />
        <OpenIssuesWidget buildingId={buildingId} onTabChange={onTabChange} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <TodayTasksWidget buildingId={buildingId} onTabChange={onTabChange} />
        <OpenIssuesWidget buildingId={buildingId} onTabChange={onTabChange} />
      </div>
      {/* Spec §8: the month-cost card sits right after the two "what needs me now" widgets. */}
      <MonthCostsCard buildingId={buildingId} />
      <AlertWidgets buildingId={buildingId} onTabChange={onTabChange} />
    </div>
  );
}
```

Run: `npx vitest run src/components/building/OverviewWidgets.test.tsx src/pages/BuildingDetails`
Expected: `✓ src/components/building/OverviewWidgets.test.tsx (12 tests)`, `✓ src/pages/BuildingDetails.user.test.tsx (5 tests)`, `✓ src/pages/BuildingDetails.team.test.tsx (2 tests)`, `✓ src/pages/BuildingDetails.mobile.test.tsx (2 tests)` — `Test Files  4 passed (4)`.

- [x] **Step 5: gate, commit** — `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'BuildingDetails|OverviewWidgets'` prints nothing; global count ≤ 46; `git add src/pages/BuildingDetails.tsx src/pages/BuildingDetails.user.test.tsx src/components/building/OverviewWidgets.tsx src/components/building/OverviewWidgets.test.tsx && git commit -m "Building Details: four-tab field view with My work here (spec pilot-field §4.1-4.3)"` (+ trailer).

---

### Task 4: Manager vocabulary out of the field user's way

**Files:**
- Create: `src/components/layout/DashboardLayout.test.tsx`
- Modify: `src/App.tsx`, `src/components/layout/DashboardLayout.tsx`, `src/pages/Issues.tsx`, `src/pages/Issues.test.tsx`, `src/components/reports/fortress/gridCsv.test.ts`, `src/components/issues/IssueDetailDialog.tsx`, `src/components/issues/IssueDetailDialog.test.tsx`

Independent of Tasks 1–3 (no shared files). Four sub-parts, each TDD, one commit at the end.

#### 4a — Sidebar groups and the Building Reports item

- [x] **Step 1: Failing layout test** (there is none today; this is the minimal one)

```tsx
// src/components/layout/DashboardLayout.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppRole } from '@/lib/constants';

/**
 * Only the sidebar's role shaping is under test: which items and which GROUPS render for a role
 * (spec pilot-field §4.3: a group with nothing the reader can open is not drawn). Every shell
 * piece with its own data source is stubbed; the sidebar primitives run for real.
 */
const auth = vi.hoisted(() => ({
  current: { user: { id: 'u1', email: 'thabo@example.com' }, role: 'user' as AppRole | null, isAdminOrManager: false, signOut: vi.fn() },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('@/hooks/useOrganization', () => ({ useOrganization: () => ({ organization: null }) }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => ({ profile: null, loading: false }) }));
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ unreadByKind: () => 0 }),
  useNotificationsRealtime: () => {},
}));
vi.mock('@/lib/auth-audit', () => ({ recordAuthEvent: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/components/shell/useHotkey', () => ({ useHotkey: () => {} }));
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/HintsToggle', () => ({ HintsToggle: () => null }));
vi.mock('@/components/notifications/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/pwa/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/pwa/UpdateToast', () => ({ UpdateToast: () => null }));
vi.mock('@/components/offline/OfflineQueueRunner', () => ({ OfflineQueueRunner: () => null }));
vi.mock('@/components/offline/SyncStatusPill', () => ({ SyncStatusPill: () => null }));
vi.mock('@/components/shell/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/components/shell/QuickCreateMenu', () => ({ QuickCreateMenu: () => null }));

import DashboardLayout from './DashboardLayout';

const setRole = (role: AppRole | null) => {
  auth.current = { ...auth.current, role, isAdminOrManager: role === 'admin' || role === 'manager' };
};

const renderLayout = () =>
  render(
    <MemoryRouter initialEntries={['/my-day']}>
      <DashboardLayout>
        <div>page</div>
      </DashboardLayout>
    </MemoryRouter>,
  );

const groupLabels = () =>
  Array.from(document.querySelectorAll('[data-sidebar="group-label"]')).map((el) => el.textContent);

const link = (name: string) => screen.queryByRole('link', { name });

describe('DashboardLayout sidebar', () => {
  beforeEach(() => setRole('user'));

  it('draws only the groups a field user can open: no Building Reports, no Administration (spec pilot-field §4.3)', () => {
    renderLayout();
    expect(groupLabels()).toEqual(['Main', 'Reports & Audit']);
    expect(link('My Day')).not.toBeNull();
    expect(link('Forms Library')).not.toBeNull();
    expect(link('Building Reports')).toBeNull();
    expect(link('Trends')).toBeNull();
    expect(link('Compliance Reports')).toBeNull();
    expect(link('Contractors')).toBeNull();
    expect(link('Settings')).toBeNull();
    expect(link('Dashboard')).toBeNull();
  });

  it('draws all three groups for a manager, with Building Reports and without User Management', () => {
    setRole('manager');
    renderLayout();
    expect(groupLabels()).toEqual(['Main', 'Reports & Audit', 'Administration']);
    expect(link('Building Reports')).not.toBeNull();
    expect(link('Contractors')).not.toBeNull();
    expect(link('User Management')).toBeNull();
  });

  it('adds User Management for an admin', () => {
    setRole('admin');
    renderLayout();
    expect(link('User Management')).not.toBeNull();
    expect(link('Building Reports')).not.toBeNull();
  });

  it('fails closed with no role: ungated items only, no Administration group', () => {
    setRole(null);
    renderLayout();
    expect(groupLabels()).toEqual(['Main', 'Reports & Audit']);
    expect(link('Building Reports')).toBeNull();
    expect(link('Dashboard')).toBeNull();
    expect(link('Forms Library')).not.toBeNull();
  });
});
```

Run: `npx vitest run src/components/layout/DashboardLayout.test.tsx`
Expected: tests 1 and 4 fail — `groupLabels()` is `['Main', 'Reports & Audit', 'Administration']` and `link('Building Reports')` is not null; tests 2 and 3 pass. `Tests  2 failed | 2 passed (4)`.

- [x] **Step 2: The layout** — in `src/components/layout/DashboardLayout.tsx`:

Replace lines 127–135 (the start of `reportsNavItems` through the `badgeKinds` line of "Building Reports"; the `},` on line 136 stays) with:

```ts
const reportsNavItems: NavItem[] = [
  {
    // The monthly OPS/CM and annual reports themselves. Previously reachable only by
    // opening a building and finding its Reports tab, which meant no way to see a month
    // across the portfolio at all. Authored and reviewed by admins and managers only
    // (spec pilot-field §4.3): the routes are gated to match in App.tsx.
    title: 'Building Reports',
    href: '/reports/fortress',
    icon: <FileText className="w-4 h-4" />,
    roles: ['admin', 'manager'],
    badgeKinds: ['report_submitted', 'report_returned', 'report_approved'],
```

Add after line 178 (the closing `];` of `adminNavItems`):

```ts
interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  { label: 'Main', items: mainNavItems },
  { label: 'Reports & Audit', items: reportsNavItems },
  { label: 'Administration', items: adminNavItems },
];
```

Replace lines 254–329 (the whole `<SidebarContent>…</SidebarContent>` block — three near-identical `<SidebarGroup>`s) with one loop that also decides whether a group is drawn at all:

```tsx
          <SidebarContent>
            {navGroups.map((group) => {
              const items = group.items.filter(canAccessItem);
              // A heading over nothing (the field user's "Administration") is not drawn: a
              // group appears only when it holds at least one item this reader can open.
              if (items.length === 0) return null;
              return (
                <SidebarGroup key={group.label}>
                  <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {items.map((item) => {
                        const n = item.badgeKinds ? unreadByKind(item.badgeKinds) : 0;
                        return (
                          <SidebarMenuItem key={item.href}>
                            <SidebarMenuButton
                              asChild
                              isActive={location.pathname === item.href}
                            >
                              <Link to={item.href}>
                                {item.icon}
                                <span>{item.title}</span>
                                {n > 0 && <NavBadge count={n} />}
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              );
            })}
          </SidebarContent>
```

Run: `npx vitest run src/components/layout/DashboardLayout.test.tsx`
Expected: `✓ src/components/layout/DashboardLayout.test.tsx (4 tests)`.

#### 4b — Route gates

- [x] **Step 3: The two routes** — in `src/App.tsx`, replace lines 141–151 with:

```tsx
            {/* Static path first so it is never captured by the :id route below. Both are
                management surfaces (spec pilot-field §4.3): reports are created only through
                NewReportDialog, which ReportsTab shows to admins and managers, so no field-user
                author exists for the gate to lock out. The sidebar item is gated to match. */}
            <Route path="/reports/fortress" element={
              <ProtectedRoute allowedRoles={['admin', 'manager']}>
                <DashboardLayout><FortressReports /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/reports/fortress/:id" element={
              <ProtectedRoute allowedRoles={['admin', 'manager']}>
                <DashboardLayout><FortressReportEditor /></DashboardLayout>
              </ProtectedRoute>
            } />
```

No `App` test exists and the spec allows "route table change is reviewed" when none does; the guard itself is covered by `src/components/ProtectedRoute.test.tsx` (12 tests, `allowedRoles` denies `user`, null role and `authError`). Verify the table by inspection:

Run: `grep -n -A1 'path="/reports/fortress' src/App.tsx`
Expected (the one-line comment became four, so the routes sit four lines lower than before):
```
145:            <Route path="/reports/fortress" element={
146-              <ProtectedRoute allowedRoles={['admin', 'manager']}>
--
150:            <Route path="/reports/fortress/:id" element={
151-              <ProtectedRoute allowedRoles={['admin', 'manager']}>
```

Run: `npx vitest run src/components/ProtectedRoute.test.tsx`
Expected: `✓ src/components/ProtectedRoute.test.tsx (12 tests)`.

#### 4c — Issues register: chip and CSV columns

- [x] **Step 4: Failing register tests** — in `src/pages/Issues.test.tsx`:

Replace lines 32–34 (the fixed `useAuth` mock) with a switchable one and a CSV-button probe:

```tsx
const auth = vi.hoisted(() => ({ isAdminOrManager: false }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAdminOrManager: auth.isAdminOrManager, user: { id: 'u1' } }),
}));
// The real button drives a download; here it only has to say which columns it was handed.
vi.mock('@/components/ui/export-csv-button', () => ({
  ExportCsvButton: ({ columns }: { columns: readonly { header: string }[] }) => (
    <div data-testid="csv-columns">{columns.map((c) => c.header).join('|')}</div>
  ),
}));
```

Add `auth.isAdminOrManager = false;` as the first line of the `beforeEach` inside `describe('Issues', …)` (originally line 119; nine lines lower after the mock edit above).

Replace the test `'shows the SLA clock on an issue that has a target'` (originally lines 165–171) with these three:

```tsx
  it('shows the SLA clock to a manager on an issue that has a target', () => {
    auth.isAdminOrManager = true;
    // Reported half an hour ago with a 72 h target: 71.5 h left, floored to whole days.
    const created = new Date(Date.now() - 30 * 60_000).toISOString();
    state.data = baseData({ issues: [{ ...liveIssue, id: 'i2', title: 'Slow lift', sla_target_hours: 72, created_at: created }] });
    renderPage();
    expect(screen.getByText('Due in 2d')).toHaveAttribute('data-sla', 'ok');
  });

  it('keeps the SLA clock and the SLA CSV columns away from a field user (spec pilot-field §4.3)', () => {
    const created = new Date(Date.now() - 30 * 60_000).toISOString();
    state.data = baseData({ issues: [{ ...liveIssue, id: 'i2', title: 'Slow lift', sla_target_hours: 72, created_at: created }] });
    renderPage();
    expect(screen.getByText('Slow lift')).toBeInTheDocument();
    expect(document.querySelector('[data-sla]')).toBeNull();
    const headers = screen.getByTestId('csv-columns').textContent ?? '';
    expect(headers).toBe('Title|Building|Priority|Status|Category|Reported|Deadline|Resolved at|Corrective action');
  });

  it('exports the SLA columns for a manager', () => {
    auth.isAdminOrManager = true;
    renderPage();
    const headers = screen.getByTestId('csv-columns').textContent ?? '';
    expect(headers).toContain('|SLA target (hours)|SLA due|SLA state|SLA breached at|First response|');
  });
```

Run: `npx vitest run src/pages/Issues.test.tsx`
Expected: the field-user test fails (`[data-sla]` present, headers include the SLA columns); `Tests  1 failed | 17 passed (18)`.

- [x] **Step 5: Failing column-set test** — in `src/components/reports/fortress/gridCsv.test.ts`, change line 17 to:

```ts
import { ISSUE_CSV_COLUMNS, ISSUE_CSV_COLUMNS_FIELD } from '@/pages/Issues';
```

and append inside `describe('ISSUE_CSV_COLUMNS', …)` after the `'leaves every optional column blank…'` test:

```ts
  it('drops every SLA-clock column for a field user and keeps the rest in order (spec pilot-field §4.3)', () => {
    const headers = headerOf(toCsv([issue()], ISSUE_CSV_COLUMNS_FIELD));
    expect(headers).toEqual([
      'Title',
      'Building',
      'Priority',
      'Status',
      'Category',
      'Reported',
      'Deadline',
      'Resolved at',
      'Corrective action',
    ]);
  });
```

Run: `npx vitest run src/components/reports/fortress/gridCsv.test.ts`
Expected: `SyntaxError: The requested module '/src/pages/Issues.tsx' does not provide an export named 'ISSUE_CSV_COLUMNS_FIELD'` — `Test Files  1 failed (1)`.

- [x] **Step 6: The register** — in `src/pages/Issues.tsx`:

Add after line 89 (the closing `];` of `ISSUE_CSV_COLUMNS`):

```ts
/**
 * The same register for a field user. The SLA clock is manager vocabulary (spec pilot-field
 * §4.3), so every column derived from it stays out of their export — target, due, state, the
 * breach instant and the first-response instant. All five, not the three the chip spells out:
 * leaving "SLA breached at" in would hand the clock straight back.
 */
const SLA_CLOCK_HEADERS = new Set(['SLA target (hours)', 'SLA due', 'SLA state', 'SLA breached at', 'First response']);
export const ISSUE_CSV_COLUMNS_FIELD: CsvColumn<Issue>[] = ISSUE_CSV_COLUMNS.filter((c) => !SLA_CLOCK_HEADERS.has(c.header));
```

Replace line 233 (`<ExportCsvButton rows={filteredIssues} columns={ISSUE_CSV_COLUMNS} filename="issues" />`) with:

```tsx
          <ExportCsvButton rows={filteredIssues} columns={isAdminOrManager ? ISSUE_CSV_COLUMNS : ISSUE_CSV_COLUMNS_FIELD} filename="issues" />
```

Replace line 465 (`<SlaChip issue={issue} now={now} />`) with:

```tsx
                    {/* The SLA clock is a manager's instrument (spec pilot-field §4.3). */}
                    {isAdminOrManager && <SlaChip issue={issue} now={now} />}
```

Run: `npx vitest run src/pages/Issues.test.tsx src/components/reports/fortress/gridCsv.test.ts`
Expected: `✓ src/pages/Issues.test.tsx (18 tests)`, `✓ src/components/reports/fortress/gridCsv.test.ts (12 tests)`.

#### 4d — Issue detail: chip and SLA line on `canManage`

- [x] **Step 7: Failing dialog test** — in `src/components/issues/IssueDetailDialog.test.tsx`, append inside `describe('SLA', …)` after the `'shows no SLA line or chip without a target'` test (line 164):

```tsx
    it('keeps the chip and the line off for someone who cannot manage the issue (spec pilot-field §4.3)', async () => {
      const created = new Date(Date.now() - 30 * 60_000);
      render(
        <IssueDetailDialog
          issue={{ ...issue, created_at: created.toISOString(), sla_target_hours: 24 }}
          open onOpenChange={() => {}} canManage={false} onUpdated={() => {}}
        />,
      );
      await screen.findByRole('heading', { name: /leaking tap in kitchen/i });
      expect(screen.queryByText(/SLA target/)).not.toBeInTheDocument();
      expect(document.querySelector('[data-sla]')).toBeNull();
    });
```

Run: `npx vitest run src/components/issues/IssueDetailDialog.test.tsx`
Expected: that test fails (`[data-sla]` present, `SLA target 24 h` present); `Tests  1 failed | 15 passed (16)`.

- [x] **Step 8: The dialog** — in `src/components/issues/IssueDetailDialog.tsx`:

Replace line 298 (`<SlaChip issue={issue} now={now} />`) with:

```tsx
            {/* The SLA clock is a manager's instrument (spec pilot-field §4.3): chip and line below gate on canManage. */}
            {canManage && <SlaChip issue={issue} now={now} />}
```

Replace line 324 (`{issue.sla_target_hours != null && (`) with:

```tsx
          {canManage && issue.sla_target_hours != null && (
```

Run: `npx vitest run src/components/issues/IssueDetailDialog.test.tsx`
Expected: `✓ src/components/issues/IssueDetailDialog.test.tsx (16 tests)`.

- [x] **Step 9: gate, commit** — `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'App.tsx|DashboardLayout|Issues|IssueDetailDialog|gridCsv'` prints nothing; global count ≤ 46; `git add src/App.tsx src/components/layout/DashboardLayout.tsx src/components/layout/DashboardLayout.test.tsx src/pages/Issues.tsx src/pages/Issues.test.tsx src/components/reports/fortress/gridCsv.test.ts src/components/issues/IssueDetailDialog.tsx src/components/issues/IssueDetailDialog.test.tsx && git commit -m "Field vocabulary: gate Building Reports, SLA clocks and empty sidebar groups to managers (spec pilot-field §4.3)"` (+ trailer).

---

### Task 5 (controller): full gate, phone check, record

**Files:** none new (plan Status section only).

- [ ] **Step 1: Full gate**

```
npm run test
```
Expected: `Test Files  185 passed (185)`, `Tests  1964 passed (1964)` — the baseline 181 / 1932 plus four new files (`TaskRow` 8, `MyWorkHere` 9, `BuildingDetails.user` 5, `DashboardLayout` 4) and six added to existing files (`OverviewWidgets` +2, `Issues` +2, `gridCsv` +1, `IssueDetailDialog` +1). If either number is lower, a test was dropped or skipped — find which before going on. (The two Node `ExperimentalWarning: localStorage` lines and one `skipped` in `drafts.test.ts` / `queue.test.ts` on Node 20/22 are expected.)

```
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'
```
Expected: a number ≤ 46 (`cat .github/typecheck-baseline.txt`).

```
npm run build
```
Expected: `✓ built in …s`, no errors.

- [ ] **Step 2: Phone check in the browser** (the jsdom tests cannot see layout) — `npm run dev`, DevTools device toolbar at iPhone SE (375 × 667):
  1. Signed in as a **site user** with one assigned building that has at least one overdue and one upcoming task assigned to them: `/buildings/<id>` shows Info · Tasks · Forms · Notes only, no score chips under the address, no Edit button; the overview is the "My work here" card (Overdue / Today / Next 7 days), then "Open issues", then the three contact cards; every row is ≥ 56 px tall (inspect: computed height) and the Complete button spans the row width; `document.documentElement.scrollWidth === 375` in the console.
  2. Tap Complete → the same dialog as My Day; complete a task → toast, row gone, My Day agrees.
  3. Airplane mode, complete another → the row shows "Queued"; back online → it syncs and disappears.
  4. Type `/buildings/<id>?tab=ppm` in the address bar → Info tab active, nothing management-shaped on screen; `?tab=notes` → Notes.
  5. Sidebar: Main and Reports & Audit only; Reports & Audit holds Forms Library alone; no Administration heading. `/reports/fortress` typed directly → "Access Denied".
  6. `/issues`: no SLA chips on rows; open an issue → no SLA line; export CSV → header row ends `Resolved at,Corrective action`.
  7. Hints off in the header → the "My work here" coaching lines disappear; headings, counts, rows, Queued chip and any error text stay.
  8. Signed in as a **manager**: the building page is exactly as before (twelve tabs, chips, costs, alerts), the sidebar has all three groups, Issues rows carry SLA chips and the CSV has the SLA columns.

- [ ] **Step 3: Record and push** — add a `## Status (2026-09-1x)` section at the end of this plan listing the four commits and the Node version the suite ran on; push the branch (the Vercel preview is the deploy; nothing to apply to Supabase, no function to deploy).

---

## Self-review: spec §4 → tasks

| Spec §4 line | Where |
|---|---|
| §4.1 field user gets overview, checklists, forms, notes; management triggers and contents not mounted (the `team` pattern) | Task 3 (`FIELD_TABS`, two `isAdminOrManager &&` fragments around the eight triggers and seven contents; `team` already wrapped; user test asserts the strip is exactly four) |
| §4.1 `?tab=` fallback sends every hidden value to overview | Task 3 (`tabValue`; user test loops all eight values) |
| §4.1 labels unchanged ("Tasks" on the phone) | Task 3 (no label edits; tab `textContent` pinned in both tests) |
| §4.2 overview column for `user` = `MyWorkHere` → `OpenIssuesWidget` (unchanged) → contacts | Task 3 (`OverviewWidgets` field branch; contacts grid untouched in `BuildingDetails`; order asserted with `compareDocumentPosition`) |
| §4.2 `MyWorkHere` reuses `useMyWork()`, filters every bucket by `building_id`, three sections Overdue / Today / Next 7 days | Task 2 (`here` memo; `bucketTasks` already bounds upcoming to 7 days; headings `Overdue (n)`, `Today (n)`, `Next 7 days (n)`) |
| §4.2 same 56 px rows, Complete, queued chip, empty states as My Day | Task 1 (`TaskRow` extracted verbatim, `min-h-14`, `h-10` action, `Queued` / `Needs attention` chips), Task 2 (loading / error-with-retry-and-message / empty, mirroring `MyDay.tsx:232-278`) |
| §4.2 extract the row into `src/components/myday/TaskRow.tsx`; My Day keeps its markup and tests | Task 1 (`Row`, `dueLabel`, `queuedStateFor`, `TaskRow` exported; My Day's 17 tests unchanged and green) |
| §4.2 building name omitted on the card; sign-offs and returned reports not shown | Task 2 (`showBuilding={false}`; only `buckets` read from the hook; test asserts no `ALPHA TOWER`) |
| §4.2 admin/manager overview unchanged | Task 3 (manager branch is the previous body verbatim; existing 10 widget tests untouched except the harness parameter) |
| §4.3 `MonthCostsCard` and the three `AlertWidgets` only for admin/manager; `TodayTasksWidget` replaced by `MyWorkHere` for field users | Task 3 (field branch mounts neither; test asserts no `building_documents` / `building_assets` / `form_submissions` / `building_month_costs` query for a field user) |
| §4.3 `BuildingScoreChips` only for admin/manager | Task 3 (header gate; both snapshot hooks get `undefined` for a field user, so nothing is fetched for a chip that is not drawn) |
| §4.3 `/reports/fortress` and `/reports/fortress/:id` get `allowedRoles={['admin','manager']}`; "Building Reports" gets `roles` | Task 4b (routes), Task 4a (nav item; layout test asserts the link is absent for `user` and null role) |
| §4.3 `Issues.tsx`: `SlaChip` and the SLA CSV columns only when `isAdminOrManager`; `IssueDetailDialog` SLA block only when `canManage` | Task 4c (`ISSUE_CSV_COLUMNS_FIELD`, chip gate; 2 register tests + 1 column-set test), Task 4d (chip and line on `canManage`; 1 dialog test) |
| §4.3 sidebar group renders only when it has an accessible item; "Reports & Audit" stays for Forms Library | Task 4a (`navGroups` loop; test pins `['Main', 'Reports & Audit']` for `user` and for null role) |
| §4.4 `BuildingDetails.user.test.tsx` (tabs, fallback, manager unchanged) | Task 3 (5 tests) |
| §4.4 `MyWorkHere.test.tsx` (filter, three buckets, Complete opens dialog, queued chip, empty state, hints toggle) | Task 2 (9 tests, plus loading, error-retry and success-refetch) |
| §4.4 `OverviewWidgets` role test | Task 3 (2 tests) |
| §4.4 `Issues` SLA gating test | Task 4c |
| §4.4 `DashboardLayout` empty-group test | Task 4a (new file, 4 tests) |
| §4.4 `App` route gate test "if a pattern exists (otherwise `ProtectedRoute` is already tested and the route table change is reviewed)" | Task 4b: no `App.test.tsx` exists; `ProtectedRoute.test.tsx` (12 tests) covers `allowedRoles`; the table is verified by the `grep` step |
| §2 no migration; coaching through `<Hint>`, guardrails never; disjoint file lists | No SQL anywhere; `MyWorkHere` hints are the card intro and the Overdue line only, chips / errors / counts plain; Tasks 1–4 touch disjoint files (Task 4 can run alongside 1–3) |

**Ambiguities resolved (say so in review if you disagree):**

1. **Role into `OverviewWidgets`: prop, not `useAuth()`.** Spec §4.3 says the widget "reads `isAdminOrManager` from `useAuth()`"; the plan passes it as a required prop from `BuildingDetails` for the three reasons at the top of Task 3 (one role read per page, pure widget with an unchanged test harness, TypeScript forces every caller to decide). Behaviour is identical. Switching to `useAuth()` inside is a four-line change plus an `AuthContext` mock in `OverviewWidgets.test.tsx` if the reviewer prefers the spec's wording.
2. **How many SLA CSV columns.** The brief says "3 CSV columns"; the register has five columns that exist only because of the SLA clock (`SLA target (hours)`, `SLA due`, `SLA state`, `SLA breached at`, `First response`). Hiding three and exporting "SLA breached at" to a field user would defeat the gate, so all five are hidden. To go back to three, drop `'SLA breached at'` and `'First response'` from `SLA_CLOCK_HEADERS` and adjust the two header assertions.
3. **Section titles.** Spec §4.2 names the buckets "Overdue / Today / Next 7 days" and the card uses exactly those; My Day says "Due today" and "Upcoming". Rows, chips and states are shared (`TaskRow`); the titles follow the spec's words for this card.
4. **"Next 7 days" is not collapsible.** My Day collapses Upcoming because it is the last of six sections on a page that can be long; this card is one building's slice of it and the spec asks for three sections, so all three are open and only non-empty ones render.
5. **Empty state is per building.** `useMyWork().isEmpty` is portfolio-wide; the card decides emptiness from its own filtered buckets, so a busy My Day with nothing in this building reads "Nothing assigned to you here" (tested).
6. **Snapshot reads for hidden chips.** Spec only says the chips do not render; the plan also passes `undefined` to `useBuildingScore` / `useBuildingTrend` for a field user so the page does not read `building_metrics_snapshots` for a chip it will not draw. Hooks stay unconditionally called (React rules); the user test asserts the id is `undefined`.
7. **Field user's returned reports vs the `:id` route gate.** `MyDay` links "Reports returned to me" to `/reports/fortress/:id`, which is now admin/manager only. Reports are created only through `NewReportDialog`, shown by `ReportsTab.tsx:91` for `isAdminOrManager`, so a `user`-role author does not exist in the app and the row cannot appear for them. (RLS `reports_insert` would allow it — `can_access_building(building_id)` — but no UI path does; if that ever changes, the `:id` route should become session-only and the editor's own `isAuthor || isAdminOrManager` rules take over.)
8. **Analytics.** Spec is silent; the card fires the same `task_completed` event as My Day with `surface: 'my_work_here'` so completions from the two entry points can be told apart. No `viewed` event.
9. **Fail-closed sidebar with no role.** `canAccessItem` already returns falsy for a null role; with the group rule, a user whose role fetch failed sees Main and Reports & Audit (ungated items only) and no Administration heading (tested).
10. **`OverviewWidgets` still receives `onTabChange` in field mode** although `OpenIssuesWidget` ignores it; kept so the call site in `BuildingDetails` is one line for both roles.

**Open questions for the reviewer (none block implementation):**

- Ambiguity 1 (prop vs `useAuth()`) and 2 (five vs three CSV columns) are the two places the plan departs from the letter of the spec / brief; both are one-line reversals.
- Should the field user's building page also hide the "Edit" affordances that already gate on `isAdminOrManager`? They do already (`BuildingDetails.tsx:141,169,192,395`); nothing to do, noted for completeness.
