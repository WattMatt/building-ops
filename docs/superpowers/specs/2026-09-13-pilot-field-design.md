# S6 Pilot field view and won't-do — design

Date 2026-09-13. Branch `feat/pilot-field` off `main` at the PR #5 merge (eb5f327). Follows the
field-readiness release (`2026-09-12-field-readiness-design.md`), which shipped assignment,
coverage, photo hardening, report integrity, nudges and the New Issue mobile pass. Arno approved
this slice on 2026-09-13 ("lets move onto the next").

## 1. What this changes, in one paragraph

A field user opening a building today gets the same eleven-tab management page as an admin, with
costs, expiring documents, form activity and compliance chips. This slice gives the `user` role a
four-tab building page whose overview is "My work here", closes three places where manager
vocabulary still reaches field users, and adds a fifth task outcome, "Can't do" with a mandatory
reason, so a locked plant room or a load-shedding window is recorded as a reason in the data rather
than as an unexplained gap or a false completion.

## 2. Constraints carried forward

Same as the field-readiness spec §2: additive migrations authored in `../GMI/sql/` and vendored;
RLS is the boundary; coaching copy through `<Hint>`, guardrails never; disjoint file lists per
implementer; SQL vendoring serialised; every task-status enumeration in the code base is touched
explicitly, never left to a default.

## 3. Two slices

| # | Slice | Migration | Owner-visible result |
|---|---|---|---|
| S6a | Field building view | none | `user` role sees Overview · Tasks · Forms · Notes; overview is "My work here"; Building Reports, SLA clocks and the empty Administration group no longer reach field users |
| S6b | Won't-do outcome | `2026-09-16_01_wont_do.sql` | "Can't do" with a reason on task completion; counted consistently everywhere; managers see it in the digest and on the task list |

S6a and S6b touch disjoint files except `CompleteTaskDialog` (S6b only) and `MyDay` (neither).

## 4. S6a — Field building view

### 4.1 Tabs

`BuildingDetails.tsx` renders, for `isAdminOrManager === false`: **overview, checklists, forms,
notes**. Triggers and contents for team, reports, tenants, assets, ppm, maintenance, electrical and
documents are not mounted for a field user (the `team` pattern at `:214`/`:351`), and the `?tab=`
fallback at `:204` sends any of those values to `overview`. Labels stay as they are (the phone
label for checklists is already "Tasks").

### 4.2 "My work here" overview

For the `user` role the overview column becomes, in order: a `MyWorkHere` card, the existing
`OpenIssuesWidget` (unchanged), then the contacts grid. `MyWorkHere` (`src/components/building/
MyWorkHere.tsx`) reuses `useMyWork()` and filters every bucket by `building_id === id` before
rendering three sections, Overdue / Today / Next 7 days, with the same 56 px rows, Complete
action, queued chip and empty states as My Day (extract the row into `src/components/myday/
TaskRow.tsx` so the two pages share it; My Day keeps its current markup and tests). The building
name is omitted from rows here because the page is the building. Sign-offs and returned reports
are not shown on this card.

For admin and manager the overview is unchanged.

### 4.3 Manager concepts hidden from field users

- `OverviewWidgets` receives `isAdminOrManager` from `BuildingDetails` as a required prop; `MonthCostsCard` and the three
  `AlertWidgets` render only for admin and manager. `TodayTasksWidget` is replaced by
  `MyWorkHere` for field users (it is portfolio-wide "today" for the building, not "mine").
- `BuildingScoreChips` in the header render only for admin and manager.
- `App.tsx`: `/reports/fortress` and `/reports/fortress/:id` get
  `allowedRoles={['admin','manager']}`; the "Building Reports" nav item gets `roles:
  ['admin','manager']`.
- `Issues.tsx`: the `SlaChip` and every SLA-clock column (five today) render only when `isAdminOrManager`;
  `IssueDetailDialog` shows the SLA block only when `canManage`.
- `DashboardLayout`: a sidebar group renders only when it has at least one item the user can
  access (fixes the empty "Administration" group; keeps "Reports & Audit" for the Forms Library).

### 4.4 Tests

`BuildingDetails.user.test.tsx` (tabs and fallback for a field user; manager unchanged),
`MyWorkHere.test.tsx` (filters by building, three buckets, Complete opens the dialog, queued chip,
empty state, hints toggle), `OverviewWidgets` role test, `Issues` SLA gating test, `DashboardLayout`
empty-group test, `App` route gate test if a pattern exists (otherwise `ProtectedRoute` is
already tested and the route table change is reviewed).

## 5. S6b — Won't-do outcome

### 5.1 Model

A fifth `task_instances.status` value, `wont_do`. The completion row records the outcome:
`task_completions.outcome text not null default 'completed' check (outcome in
('completed','wont_do'))` and `task_completions.reason text` (required when `wont_do`, enforced by
the RPC). `task_instances` gains no column; the reason lives on the completion, which the task
list and the evidence pack already read.

Reason codes (`src/lib/wontDo.ts`, mirrored in the RPC's check): `area_locked`, `load_shedding`,
`contractor_absent`, `no_materials`, `other`. `other` requires free text; the stored `reason` is
`<code>` or `other: <text>` (one column, human readable, filterable by prefix).

### 5.2 RPC

`complete_task` gains `p_outcome text default 'completed'` and `p_reason text default null`
(replace the function with the wider signature; existing callers keep working). Rules: outcome must
be one of the two; `wont_do` requires a non-blank reason; `completed` ignores the reason. On
`wont_do` the instance flips to `status = 'wont_do'`, `completed_at = now()`, `completed_by =
auth.uid()` (the timestamp means "closed at"; the status carries the meaning). Signature and photo
are not required for `wont_do` at the RPC level; the dialog decides.

### 5.3 Every status enumeration, decided

| Site | Decision for `wont_do` |
|---|---|
| `task_instances_status_check` | added |
| `mark_overdue_tasks` | untouched (only `pending` flips) |
| `generate_scheduled_tasks` reschedule wrapper | untouched (survives like `issue_logged`) |
| `snapshot_building_metrics` | excluded from both numerator and denominator of completion %; never counted in `tasks_overdue` |
| `useBuildingScore` / `buildingScore.ts` | excluded from the denominator, explicitly (today `issue_logged` is dropped by omission; make both explicit) |
| `portfolio_coverage.completed_yesterday` | counted as activity (`completed`, `issue_logged`, `wont_do`) |
| `ppm_monthly_status` (both live definitions) | maps to `'missed'` |
| `useDashboardStats` | not open, not completed-today |
| `useMyWork`, `daily-digest` queries, `ics-feed` | untouched (positive lists) |
| `ChecklistsTab` lists | fourth list "Can't do" showing the reason |
| `TasksList` | status colour, icon, badge "Can't do", no actions |
| `constants.ts` `TASK_STATUS*` | label "Can't do" |
| `evidencePackData.loadTaskPack` | outcome and reason printed on the task row |
| digest coverage section | one line for admins/managers: "N tasks couldn't be done yesterday" with up to five "<building> · <task> · <reason>" lines |

### 5.4 Dialog and offline

`CompleteTaskDialog` gains a two-option segmented control at the top, "Done" / "Can't do". On
"Can't do": a reason select (labels from `wontDo.ts`), free text when `other`, photo optional,
signature not asked, notes stay optional, primary button reads "Record". The payload
`TaskCompletePayload` gains `outcome` and `reason`; `handlers.ts` passes them to the RPC. No new op
kind; replay stays idempotent on the client completion id. Toast copy: synced "Recorded as can't do"
/ queued as today. The My Day row's Complete button opens the same dialog, so no change there.

### 5.5 Tests

SQL on the throwaway Postgres (wont_do without reason refused; with reason flips status and stores
reason; completed ignores reason; second call already_completed; snapshot and coverage counts),
`rls-smoke`/`checklist-smoke` assertions, `CompleteTaskDialog` (switch, required reason, payload),
`handlers` pass-through, `TasksList`/`ChecklistsTab` rendering, `buildingScore` unit, digest
composition.

## 6. Deploy

Same loop as S1–S5: two-stage review per slice, integration review, gates, staging apply +
smoke + function deploys (`daily-digest` for the digest line), then prod, types regeneration,
checklist section "Pilot field (S6)". If no Management API token is available, the temporary
edge-function runner used on 2026-09-12 is acceptable again, deleted afterwards.

## 7. Out of scope

Form signatures to the real table, the unsaved-edit navigation guard, phase-five R4 findings,
manager notification per won't-do (the digest line is the channel), a per-building filter on My
Day itself.
