# R4a "Snapshots & SLA" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One nightly row per building per day (`building_metrics_daily`) replaces the ~30-query KPI fan-out and the 4N+1 portfolio query, giving every building header a sparkline, the portfolio a `/trends` page and the OPS PDF a Trend section; issues get an SLA clock (org defaults, breach cron, inbox notification, chips); the portfolio reports page answers "did this month land?" per type and per status with an honest "missing" (per-building `report_types`) and a safe "Discard draft"; expiry alerts widen to 30/60/90 across `building_documents`, `tenant_documents`, `contractor_documents` and `building_assets` (warranty + service); org settings + feature flags ship dark; four latent defects from the survey are fixed first in the migration.

**Architecture:** One additive migration `2026-09-14_01_r4_snapshots_sla.sql` (canonical in `../GMI/sql`, vendored here). Fixes first (multi-role `is_admin*`/`app_role`, `building_assets` columns, `media_attachments` admin-only), then `organizations.settings` + the anon-safe `organization_branding` view, `building_metrics_daily` + `snapshot_building_metrics()` + `portfolio_metrics_daily` + 90-day backfill + cron 05:00 SAST, the SLA triggers + `mark_sla_breaches()` + cron every 15 min + the new notification kind, `buildings.report_types` + `delete_empty_report()`, and `expiring_items()` (invoker, RLS applies) that the snapshot, the widget and the alert function all read. Client: `useOrgSettings`/`useFeature`, Settings → Operations cards, `Sparkline` + `useBuildingTrend`, `/trends` (recharts, one file), snapshot-first `usePortfolioCompliance`/`useBuildingScore` with live fallback, PDF Trend section, `slaState` + chips, coverage grid + discard, `useExpiringItems` + rewritten `GlobalAlertsWidget`, retrofitted `notify-expiring-alerts` and `daily-digest`.

**Tech Stack:** Postgres 17 (plpgsql, security definer/invoker, `security_invoker` views, pg_cron), Supabase JS v2, React 18 + TS, TanStack Query v5, shadcn/ui, recharts 2.15 (already a dependency, used in one file), pdfmake, vitest 3, Deno edge functions.

**Spec:** `docs/superpowers/specs/2026-09-10-r4-insight-design.md` §2 (facts), §3 (constraints), §5.1–5.6 (schema), §6 (R4a), §9–11 (testing, risks, owner actions). Format model: `docs/superpowers/plans/2026-09-10-r3c-contractors-ppm-costs.md`.

**Branch:** `feat/reports-access-hardening` (HEAD `21449c7`, clean). Timezone `Africa/Johannesburg` wherever a day boundary matters.

**Ground rules for every agent:** never `git stash` / `checkout` / `switch` / `reset` / `worktree`; compare with `git show <sha>:<path>`; edit only the files your task names; commit with an explicit pathspec; retry after 5 s on `index.lock` (other agents commit concurrently); end commit messages with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; gate = `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E '<your files>'` prints nothing, `npm run test` green, the global `error TS` count ≤ `.github/typecheck-baseline.txt` (51) measured on a clean tree; new tables/columns/views/RPCs are not in the generated types until the controller regenerates — cast at the boundary with `// <name> is not yet in the generated types; regenerate after the migration ships.`; guardrail copy plain, coaching through `<Hint>` only; mobile-first, tap targets ≥ 44 px (`h-11` / `min-h-11`); every new SQL function `set search_path = ''`, `revoke all … from public`, explicit `revoke execute … from anon`; new tables get RLS in the same migration; cron via `cron.unschedule` guard then `cron.schedule`; SQL agents verify on a throwaway local Postgres 17 before handing over; the SQL file is edited in `../GMI/sql/` and vendored with `npm run schema:vendor`, staging only the new file and `supabase/schema/.source` (two agents vendoring at once collide on `.source` — only Task 1 vendors in this slice).

**Facts every task relies on (from the code as of `21449c7`):**
- RLS helpers: `public.is_active_user()`, `is_admin()`, `is_admin_or_manager()`, `can_access_building(uuid)` live in `supabase/schema/2026-09-11_03_deactivated_rls_gate.sql`; `is_admin`/`is_admin_or_manager` use a bare scalar subquery over `user_roles` (`unique (user_id, building_id)`, so a user can hold several rows) → `21000` for the first multi-row user; `app_role()` (`2026-06-10_01`) has no deactivation gate. Helpers are called from RLS policies evaluated as `anon` on anon-readable tables, so they are NOT revoked from anon (only new functions are).
- `notifications` (`2026-09-11_01`, kind check restated in `2026-09-12_01` with `task_due_today`): columns `recipient_id, actor_id, actor_name, kind, entity_type, entity_id, building_id, title, body, url, read_at, created_at`; entity types `task, issue, report, form_submission, signoff_request, document, asset`; no client insert policy. Kinds are mirrored in `supabase/functions/_shared/notifyRules.ts` (`NOTIFICATION_KINDS`, `governingFlag` exhaustive switch, `DIGEST_ONLY`, `PUSH_KINDS`, `CLIENT_KINDS`), `src/lib/notify.ts` (`NotificationKind` union) and `src/lib/notifyRules.test.ts` (`TABLE` covering every kind).
- `issues`: `priority ∈ low|medium|high|critical`, `status ∈ open|in_progress|escalated|resolved`; `sla_target_hours numeric`, `sla_breached_at`, `first_response_at`, `resolved_at` (stamped by `trg_issue_resolved_at` on UPDATE of status; null when reopened), `reported_by`, `assigned_to`, `created_at`. `issue_activity(issue_id, user_id, activity_type ∈ created|comment|status_change|assignment|contractor_assignment, created_at)`; `trg_issues_activity_log` (after insert/update on issues) writes the `created` row with `user_id = reported_by`. Prod has 0 issues.
- `task_instances(building_id, status ∈ pending|overdue|completed|issue_logged, due_date, completed_at, source_ppm_id)`; `task_completions(task_instance_id, created_at)`; `ppm_monthly_status` view (`building_id, ppm_service_id, service_name, period_month 'YYYY-MM', status ∈ done|missed|due, done_on`), `security_invoker`.
- Reports: `reports(id, building_id, report_type ∈ ops_monthly|cm_monthly|annual_inspection, report_period date (first of month), status ∈ draft|submitted|reviewed|approved|rejected, title, author_id)`, unique per (building, type, period). `compliance_scores(report_id, compliance_pct)`, `compliance_assessments(id, report_id)`, `compliance_critical_scores(assessment_id, critical_pct)`, `compliance_responses(assessment_id, response ∈ yes|no|na)`, `building_inspections(id, report_id)`, `inspection_responses(inspection_id, acceptable ∈ yes|no|na)`. Report-scoped section tables (all have `report_id`): `report_narratives(body)`, `report_checklist_items`, `expense_recoveries`, `utility_readings`, `utility_yields`, `ppm_services(months jsonb, overrides jsonb default '{}', plan_service_id)` — SEEDED on report create from the PPM plan (R3c), so a fresh ops draft always has rows with empty `months`/`overrides` —, `masterfile_items`, `building_turnover`, `tenant_turnover`, `category_turnover`, `footfall_counts`, `toilet_fund`, `vacancies`, `leasing_waitlist`, `tenant_movements`, `trading_hour_breaches`, `tenant_arrears`, `loadshedding_log`, `service_interruptions`, `tenant_compliance`, `security_incidents`, `capex_items`, `local_resources_contacts`; via a parent: `compliance_responses`/`hazard_log` (assessment_id), `inspection_responses` (inspection_id). `report_artifacts(source_id = report id, kind, status)`. `useReportSectionCounts` + `SECTION_SOURCE` in `src/lib/fortressReports.ts` is the client's list.
- Expiry sources: `building_documents(building_id, name, document_type, expiry_date)`, `tenant_documents(tenant_id → building_tenants.id, document_name, document_type, expiry_date)`, `building_tenants(building_id, name, shop_name)`, `contractor_documents(contractor_id, document_name, document_type, expiry_date)`, `contractors(company_name)`, `building_assets(building_id, name, category, next_service_date, warranty_expiry …)` — the purchase/warranty/lifespan columns exist on prod (and in `types.ts`) but in no vendored migration.
- `organizations(id, name, email, logo_url, primary_color, created_at, updated_at)`: 1 row, anon-readable (login branding) through a select policy that predates the vendored migrations (name unknown → dropped by catalog lookup); writes admin/manager. `useOrganization()` (`src/hooks/useOrganization.ts`) reads `organizations` with `select('*')` + a realtime channel; consumers: `DashboardLayout`, `Settings`, `FortressReportEditor`, `useOrganizationTheme`, `TemplateDialog`. `supabase/functions/_shared/email.ts` `loadBranding` reads with the service role.
- Client: `useBuildingScore(id)` (`src/hooks/useBuildingScore.ts`, test `useBuildingScore.test.ts` with a recorded-chain mock), `usePortfolioCompliance()` (`src/hooks/usePortfolioCompliance.ts`, no test; consumed by `useBuildingsScores` and the dashboard card), `BuildingScoreChips({ ohsPct, taskPct })` mounted at `src/pages/BuildingDetails.tsx:184` and `src/pages/Buildings.tsx:324`; `useIssues()` (`src/hooks/useIssues.ts`, useState-based, `Issue` interface duplicated in `src/components/issues/IssueDetailDialog.tsx:39`); issue cards in `src/pages/Issues.tsx:363-419`; `Settings.tsx` has tabs `organization` / `branding` (admin) and no `src/components/settings/` directory; `GlobalAlertsWidget` (`src/components/dashboard/GlobalAlertsWidget.tsx`, mounted for admin/manager on `Dashboard.tsx:263`) queries the two tables itself; `notify-expiring-alerts` queries them with the service role and writes `document_expiring`/`asset_service_due` rows once per entity per SAST day; `daily-digest` composes per person through the pure `supabase/functions/_shared/digest.ts` (`composeDigest`, tested in `src/lib/digest.test.ts`).
- PDF: `generateReportPdf(reportId, branding)` in `src/lib/fortressReportPdf.ts` fills `ReportData` and calls `buildReportDoc(report, data, opts)` in `src/lib/fortressReportDoc.ts`; sections are pushed in order with `section(title)`; the OPS branch starts at `if (data.compliancePct != null || …)` ("OHS Act Compliance") — the Trend section goes right after the Hazard Log block.
- Smokes: `scripts/rls-smoke.mjs` (personas admin/manager/userA/userB/norole via `createPersona`, `probeMatrix`, `canSelect/canInsert/canUpdate/canDelete`, `rpcCall`, LIFO `cleanup`, zztest sweep), `scripts/ppm-smoke.mjs` (`persona()`, `svcInsert/svcDelete/svcSelect/selectAs`, `rpc()`, `cleanup` unshift-children/push-parents, prod guard `PROJECT_WIDE_ALLOWED`), `scripts/notifications-smoke.mjs` (refuses prod; step 8 exercises `notify-expiring-alerts` when `EXPIRING_ALERTS_SECRET` is set). `npm run smoke` chain in `package.json:15`; `smoke:notifications`, `smoke:ppm` separate.
- Tests: vitest (`vitest.config.ts`, jsdom, `src/test/setup.ts` stubs the Supabase env), 1202 passing; `src/test/mobile.ts` has `mockViewport`. Chain-mock pattern for hooks: see `src/hooks/useBuildingScore.test.ts:1-45`.
- Cron names live on prod: `task-generation-daily 0 2`, `ppm-generation-daily 10 2`, `task-overdue-sweep 5 22`, `daily-digest 30 4`, `expiring-alerts-daily 0 6` (all UTC). `pg_cron` schedules SQL directly; edge functions are scheduled through `net.http_post` with a secret header (`2026-08-04_10`).

---

## Contracts (pinned; every task codes against these names — do not rename)

**Migration file:** `../GMI/sql/2026-09-14_01_r4_snapshots_sla.sql` → vendored as `supabase/schema/2026-09-14_01_r4_snapshots_sla.sql`.

**`public.building_metrics_daily`** (RLS: select via `can_access_building(building_id)`; no client writes)

| column | type | meaning |
|---|---|---|
| `building_id` | uuid → buildings, cascade | |
| `day` | date | SAST calendar day; PK `(building_id, day)` |
| `compliance_pct` | numeric | `compliance_scores.compliance_pct` of the latest **approved** `ops_monthly` report with `report_period ≤ month(day)` |
| `critical_pct` | numeric | `compliance_critical_scores.critical_pct` of that report's assessment |
| `inspection_pass_pct` | numeric | `100 × yes / (yes + no)` over that report's `inspection_responses` |
| `compliance_period` | date | `report_period` of that report (null when none) |
| `ohs_open_nc` | integer | count of `compliance_responses.response = 'no'` on that report |
| `ppm_done_pct` | numeric | `ppm_monthly_status` rows for `to_char(day,'YYYY-MM')`: done / all × 100 |
| `task_completion_30d_pct` | numeric | tasks due in `[day-29, day]`: done / (done + not done) × 100; done = completed with `completed_at::date ≤ day` |
| `tasks_overdue` | integer | not done, `due_date < day` (bounded to 365 days back) |
| `tasks_due_7d` | integer | not done, `due_date ∈ [day, day+6]` |
| `issues_open` | integer | `created_at < end_of_day` and not resolved by `end_of_day` |
| `issues_open_by_priority` | jsonb | `{"high": 2, "low": 1}` (only priorities present) |
| `issues_breached` | integer | open with `sla_breached_at < end_of_day` |
| `issues_resolved_30d` | integer | `resolved_at ∈ (end_of_day − 30 d, end_of_day]` |
| `docs_expiring_30` / `_60` / `_90` | integer | `expiring_items_at(day, 90)` kinds `building_document`, `tenant_document`, `asset_warranty` with `days_left` in `0..30` / `31..60` / `61..90` |
| `docs_expired` | integer | same kinds, `days_left < 0` |
| `assets_overdue` | integer | kind `asset_service`, `days_left < 0` |
| `report_state` | jsonb | `{"ops_monthly":{"period":"2026-09-01","status":"submitted"}, …}` for each type in `buildings.report_types`; status `missing` when no report; annual matches on year |
| `reconstructed` | boolean | true when the row was computed for a day earlier than today (backfill / re-run) |
| `computed_at` | timestamptz | `now()` at write |

**`public.snapshot_building_metrics(p_day date default null, p_building uuid default null) returns integer`** — definer, `search_path ''`; `p_day` null = today SAST, future days refused (`22023`); signed-in callers must be admin/manager (`42501`) and, when `p_building` is given, have access to it; service role/cron unrestricted. Upserts one row per building (all buildings, or the one given); returns rows written; when `p_building` is null also prunes rows older than 400 days. Grants: `authenticated, service_role`.

**`public.portfolio_metrics_daily`** view (`security_invoker = on`) — one row per `day`: `day, buildings, compliance_avg, critical_avg, inspection_pass_avg, ppm_done_avg, task_completion_avg, tasks_overdue, tasks_due_7d, issues_open, issues_breached, issues_resolved_30d, docs_expiring_30, docs_expiring_60, docs_expiring_90, docs_expired, assets_overdue, contractor_docs_expiring_30, contractor_docs_expiring_60, contractor_docs_expiring_90, contractor_docs_expired, reconstructed`. Averages are `round(avg(...), 1)` over the caller's accessible buildings; `contractor_docs_*` are computed directly from `contractor_documents` relative to **today** (org-level, point-in-time, not per day).

**`public.expiring_items_at(p_day date, p_days integer)`** and **`public.expiring_items(p_days integer)`** (= `expiring_items_at(today SAST, p_days)`) — `language sql stable`, **security invoker** (RLS of the five source tables applies to the caller; the service role sees everything). Returns rows with `expiry_date ≤ p_day + p_days` (expired rows included), ordered by `expiry_date, name`:

| column | type | values |
|---|---|---|
| `kind` | text | `building_document` · `tenant_document` · `contractor_document` · `asset_warranty` · `asset_service` |
| `entity_type` | text | `document` for the three document kinds, `asset` for the two asset kinds (matches `notifications.entity_type`) |
| `entity_id` | uuid | the document / asset id |
| `parent_id` | uuid | `tenant_id` / `contractor_id` for those kinds, else null |
| `building_id` | uuid | null for `contractor_document` |
| `building_name` | text | via `buildings` (null for contractor docs) |
| `name` | text | document name / asset name |
| `detail` | text | document type / shop name / contractor company / asset category |
| `expiry_date` | date | |
| `days_left` | integer | `expiry_date − p_day` (negative = expired) |

**`organizations.settings jsonb not null default '{}'`** (CHECK object). Keys and defaults (the client's `DEFAULT_ORG_SETTINGS` and the SQL `org_sla_hours()` fallbacks are the same numbers):

```json
{ "sla_hours": { "critical": 4, "high": 24, "medium": 72, "low": 168 },
  "features":  { "share_links": false, "report_schedules": false, "tenant_intake": false },
  "report_due_day": 7,
  "distribution_from": null }
```
`public.org_sla_hours(p_priority text) returns numeric` — definer; the org's `settings.sla_hours[p_priority]` when it is a JSON number, else the default above. **`public.organization_branding`** view `(id, name, logo_url, primary_color)` — NOT security_invoker; `grant select … to anon, authenticated`; the base table loses anon (`o_select_authenticated` = `auth.uid() is not null`).

**Client settings API** (`src/lib/orgSettings.ts`, `src/hooks/useOrgSettings.ts`):
```ts
export const FEATURE_NAMES = ['share_links', 'report_schedules', 'tenant_intake'] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];
export interface SlaHours { critical: number; high: number; medium: number; low: number }
export interface OrgSettings { sla_hours: SlaHours; features: Record<FeatureName, boolean>; report_due_day: number; distribution_from: string | null }
export const DEFAULT_ORG_SETTINGS: OrgSettings;
export function parseOrgSettings(raw: unknown): OrgSettings;            // defaults + coercion + clamping; never throws
export const ORG_SETTINGS_KEY = ['org-settings'] as const;
export function useOrgSettings(): { settings: OrgSettings; organizationId: string | null; isLoading: boolean; isError: boolean; save: (next: OrgSettings) => Promise<OrgSettings>; isSaving: boolean };
export function useFeature(name: FeatureName): boolean;                 // false while loading
```

**SLA:** trigger `trg_issues_sla_defaults` (before insert or update of priority; `issues_sla_defaults()`), trigger `trg_issue_activity_first_response` (after insert on `issue_activity`; `issue_activity_first_response()`), **`public.mark_sla_breaches() returns integer`** (definer; service role/cron or admin/manager; stamps `sla_breached_at = now()` on open issues past `created_at + sla_target_hours`, inserts one `notifications` row per recipient — the assignee plus every active admin/manager — with `kind 'issue_sla_breached'`, `entity_type 'issue'`, `entity_id = issue id`, `title 'SLA breached: <title>'`, `body 'Priority <p> · target <h> h'`, `url '/issues?open=<id>'` (the app's existing deep-link form; the spec's `?issue=` is not a route the app knows) — and returns the number of issues newly breached). Notification kind **`issue_sla_breached`**: in `NOTIFICATION_KINDS`, governed by `overdue_alerts`, in `DIGEST_ONLY` (no per-item email — the rows are written by SQL, `createNotifications` never sees them), not in `CLIENT_KINDS`, **not in `PUSH_KINDS` in R4a** (push needs the edge-function path; spec §5.4's "push: yes for the assignee" is deferred to R4b and recorded in the Status section). Existing issues are NOT backfilled with targets (that would breach them all at once); only issues created after the migration get a default.

```ts
// src/lib/slaState.ts
export interface SlaIssueFields { created_at: string; status: string; sla_target_hours?: number | string | null; sla_breached_at?: string | null; first_response_at?: string | null; resolved_at?: string | null }
export type SlaKind = 'none' | 'ok' | 'due_soon' | 'breached' | 'met' | 'missed';
export interface SlaState { kind: SlaKind; due: Date | null; remainingMs: number | null; breached: boolean; label: string }
export function slaState(issue: SlaIssueFields, now?: Date): SlaState;
export function formatDuration(ms: number): string;   // '45m' | '3h' | '2d'
```

**Coverage:** `buildings.report_types text[] not null default '{ops_monthly,cm_monthly}'` (CHECK `<@ {ops_monthly,cm_monthly,annual_inspection}`); **`public.delete_empty_report(p_report uuid) returns void`** — definer, admin only (`42501`), the report must be `draft`, must have no `report_artifacts` (`source_id = p_report`) and zero content rows across every section table (plan-seeded `ppm_services` rows with empty `months` and `overrides` and `report_narratives` with an empty body do not count); deletes those scaffold rows, the auto-created `compliance_assessments`/`building_inspections` parents and the report; raises with a plain message otherwise.

**Crons:** `metrics-snapshot-daily` `0 3 * * *` UTC (05:00 SAST) → `select public.snapshot_building_metrics()`; `sla-breach-sweep` `*/15 * * * *` → `select public.mark_sla_breaches()`.

**Query keys (TanStack v5):** `['org-settings']`, `['building-trend', buildingId, days]`, `['buildings-trends', days]`, `['portfolio-trend', days]`, `['expiring-items', days]`, `['building-score', buildingId]` (unchanged), `['portfolio-compliance']` (unchanged), `['fortress-reports', …]` (unchanged), `['buildings-for-reports']` (unchanged).

**Settings cards** (`src/components/settings/`): `SlaSettingsCard` (Task 4), `ReportDueDayCard` and `FeatureFlagsCard` (Task 2) are named exports with the same props `({ canEdit }: { canEdit: boolean })`; Task 2's `Settings.tsx` mounts all three on an "Operations" tab (visible to admin/manager, `canEdit={isAdmin}`). Task 2 commits `src/lib/orgSettings.ts` + `src/hooks/useOrgSettings.ts` FIRST (its Step 3); Task 4 polls for that commit before writing its card; Task 2 polls for Task 4's card before its final Settings commit.

**Routes / nav:** `/trends` (lazy `src/pages/Trends.tsx`, admin/manager, nav item "Trends" after "Building Reports"). No new notification URL prefixes (`/issues?open=` and `/buildings/` are already allowlisted).

---

### Task 1: Migration + local verification + `snapshot-smoke` + `rls-smoke` probes

**Files:**
- Create: `../GMI/sql/2026-09-14_01_r4_snapshots_sla.sql` (then `npm run schema:vendor` → `supabase/schema/2026-09-14_01_r4_snapshots_sla.sql` + `supabase/schema/.source`)
- Create: `scripts/snapshot-smoke.mjs`
- Modify: `scripts/rls-smoke.mjs` (header comment + a new R4a block before the `} catch (e) {` at line 700; teardown untouched)
- Modify: `package.json` (`"smoke:snapshot": "node scripts/snapshot-smoke.mjs"` after `smoke:ppm`, and `&& node scripts/snapshot-smoke.mjs` appended to the `smoke` chain after `ppm-smoke.mjs`)
- Scratch only (not committed): `<scratchpad>/r4a-local-stub.sql`, `<scratchpad>/r4a-local-verify.sql`

- [ ] **Step 1: Write the migration** at `../GMI/sql/2026-09-14_01_r4_snapshots_sla.sql`:

```sql
-- 2026-09-14_01_r4_snapshots_sla.sql — R4a "Snapshots & SLA" (spec 2026-09-10-r4-insight-design.md §5.1–5.6).
-- Additive, idempotent. Requires 2026-09-11_03 (is_active_user, can_access_building), 2026-09-11_01
-- (notifications, stamp_issue_resolved_at), 2026-09-13_03/_05 (ppm_monthly_status, building_ppm_services).
--
--   1) Fixes: is_admin / is_admin_or_manager use EXISTS (a user with several user_roles rows raised 21000);
--      app_role gains the deactivation gate and picks the most privileged role; building_assets purchase /
--      warranty / lifespan columns vendored (they exist on prod, in no migration); media_attachments admin-only.
--   2) organizations.settings (jsonb object) + organization_branding view for anon; base table loses anon.
--   3) building_metrics_daily + snapshot_building_metrics(p_day, p_building) + portfolio_metrics_daily +
--      90-day backfill + cron metrics-snapshot-daily (03:00 UTC = 05:00 SAST, after generation and the sweep).
--   4) SLA: org_sla_hours(), issues_sla_defaults trigger, first-response trigger on issue_activity,
--      mark_sla_breaches() + cron sla-breach-sweep every 15 min, notification kind issue_sla_breached.
--   5) buildings.report_types + delete_empty_report(p_report).
--   6) expiring_items_at(p_day, p_days) / expiring_items(p_days): one invoker function over the five expiry
--      sources, read by the snapshot (as owner), the dashboard widget and notify-expiring-alerts (service role).
begin;

-- ============================================================
-- 1) Fixes and reconciliation
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_active_user()
     and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
$$;

create or replace function public.is_admin_or_manager()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_active_user()
     and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('admin','manager'))
$$;

-- Most privileged role wins; a deactivated caller has no role at all.
create or replace function public.app_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select case when public.is_active_user() then
    (select ur.role from public.user_roles ur where ur.user_id = auth.uid()
      order by case ur.role when 'admin' then 0 when 'manager' then 1 else 2 end
      limit 1)
  end
$$;

alter table public.building_assets
  add column if not exists purchase_date date,
  add column if not exists purchase_price numeric,
  add column if not exists replacement_cost numeric,
  add column if not exists warranty_expiry date,
  add column if not exists warranty_provider text,
  add column if not exists expected_lifespan_years integer;

-- media_attachments: 0 rows, no client; data-ops only (D9 spirit). Was readable by any signed-in user.
drop policy if exists ma_select on public.media_attachments;
create policy ma_select on public.media_attachments for select using (public.is_admin());
drop policy if exists ma_insert on public.media_attachments;
create policy ma_insert on public.media_attachments for insert with check (public.is_admin());
drop policy if exists ma_update on public.media_attachments;
create policy ma_update on public.media_attachments for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists ma_delete on public.media_attachments;
create policy ma_delete on public.media_attachments for delete using (public.is_admin());
comment on table public.media_attachments is 'Data-ops only: no client reads or writes it (0 rows). Admin-only policies since 2026-09-14_01.';

-- ============================================================
-- 2) Org settings + anon-safe branding view
-- ============================================================
alter table public.organizations add column if not exists settings jsonb not null default '{}'::jsonb;
alter table public.organizations drop constraint if exists organizations_settings_object_check;
alter table public.organizations add constraint organizations_settings_object_check check (jsonb_typeof(settings) = 'object');

-- The anon select policy predates the vendored migrations (name unknown): drop every SELECT policy by catalog.
do $$
declare p record;
begin
  for p in select polname from pg_policy where polrelid = 'public.organizations'::regclass and polcmd = 'r' loop
    execute format('drop policy %I on public.organizations', p.polname);
  end loop;
end $$;
create policy o_select_authenticated on public.organizations for select using (auth.uid() is not null);
revoke all on public.organizations from anon;

-- Deliberately NOT security_invoker: anon has no privilege on the base table, and the view exposes exactly the
-- four branding columns the login screen needs. settings never leaves the table for anon.
create or replace view public.organization_branding as
  select o.id, o.name, o.logo_url, o.primary_color from public.organizations o;
revoke all on public.organization_branding from public;
grant select on public.organization_branding to anon, authenticated;

-- Default SLA hours per priority, overridable in organizations.settings.sla_hours. Only a JSON number counts;
-- anything else falls back, so a mistyped setting can never break issue inserts.
create or replace function public.org_sla_hours(p_priority text)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select case when jsonb_typeof(o.settings->'sla_hours'->p_priority) = 'number'
                 then (o.settings->'sla_hours'->>p_priority)::numeric end
       from public.organizations o order by o.created_at nulls last limit 1),
    case p_priority when 'critical' then 4 when 'high' then 24 when 'medium' then 72 when 'low' then 168 end)
$$;
revoke all on function public.org_sla_hours(text) from public;
revoke execute on function public.org_sla_hours(text) from anon;
grant execute on function public.org_sla_hours(text) to authenticated, service_role;

-- ============================================================
-- 6) Expiring items (defined before the snapshot, which reads it)
-- ============================================================
create or replace function public.expiring_items_at(p_day date, p_days integer)
returns table (
  kind text, entity_type text, entity_id uuid, parent_id uuid, building_id uuid, building_name text,
  name text, detail text, expiry_date date, days_left integer)
language sql stable
set search_path = ''
as $$
  with items as (
    select 'building_document'::text as kind, 'document'::text as entity_type, d.id as entity_id, null::uuid as parent_id,
           d.building_id, d.name, d.document_type as detail, d.expiry_date
      from public.building_documents d where d.expiry_date is not null
    union all
    select 'tenant_document', 'document', td.id, bt.id, bt.building_id, td.document_name,
           coalesce(bt.shop_name, bt.name), td.expiry_date
      from public.tenant_documents td join public.building_tenants bt on bt.id = td.tenant_id
     where td.expiry_date is not null
    union all
    select 'contractor_document', 'document', cd.id, c.id, null::uuid, cd.document_name, c.company_name, cd.expiry_date
      from public.contractor_documents cd join public.contractors c on c.id = cd.contractor_id
     where cd.expiry_date is not null
    union all
    select 'asset_warranty', 'asset', a.id, null::uuid, a.building_id, a.name, a.category, a.warranty_expiry
      from public.building_assets a where a.warranty_expiry is not null
    union all
    select 'asset_service', 'asset', a.id, null::uuid, a.building_id, a.name, a.category, a.next_service_date
      from public.building_assets a where a.next_service_date is not null
  )
  select i.kind, i.entity_type, i.entity_id, i.parent_id, i.building_id, b.name, i.name, i.detail, i.expiry_date,
         (i.expiry_date - p_day)::integer
    from items i
    left join public.buildings b on b.id = i.building_id
   where i.expiry_date <= p_day + greatest(coalesce(p_days, 0), 0)
   order by i.expiry_date, i.name
$$;
revoke all on function public.expiring_items_at(date, integer) from public;
revoke execute on function public.expiring_items_at(date, integer) from anon;
grant execute on function public.expiring_items_at(date, integer) to authenticated, service_role;

create or replace function public.expiring_items(p_days integer)
returns table (
  kind text, entity_type text, entity_id uuid, parent_id uuid, building_id uuid, building_name text,
  name text, detail text, expiry_date date, days_left integer)
language sql stable
set search_path = ''
as $$
  select * from public.expiring_items_at((now() at time zone 'Africa/Johannesburg')::date, p_days)
$$;
revoke all on function public.expiring_items(integer) from public;
revoke execute on function public.expiring_items(integer) from anon;
grant execute on function public.expiring_items(integer) to authenticated, service_role;

-- ============================================================
-- 5a) buildings.report_types (needed by the snapshot's report_state)
-- ============================================================
alter table public.buildings
  add column if not exists report_types text[] not null default array['ops_monthly','cm_monthly'];
alter table public.buildings drop constraint if exists buildings_report_types_check;
alter table public.buildings add constraint buildings_report_types_check
  check (report_types <@ array['ops_monthly','cm_monthly','annual_inspection']::text[]);

-- ============================================================
-- 3) Metric snapshots
-- ============================================================
create table if not exists public.building_metrics_daily (
  building_id             uuid not null references public.buildings(id) on delete cascade,
  day                     date not null,
  compliance_pct          numeric,
  critical_pct            numeric,
  inspection_pass_pct     numeric,
  compliance_period       date,
  ohs_open_nc             integer,
  ppm_done_pct            numeric,
  task_completion_30d_pct numeric,
  tasks_overdue           integer,
  tasks_due_7d            integer,
  issues_open             integer,
  issues_open_by_priority jsonb,
  issues_breached         integer,
  issues_resolved_30d     integer,
  docs_expiring_30        integer,
  docs_expiring_60        integer,
  docs_expiring_90        integer,
  docs_expired            integer,
  assets_overdue          integer,
  report_state            jsonb,
  reconstructed           boolean not null default false,
  computed_at             timestamptz not null default now(),
  primary key (building_id, day)
);
create index if not exists building_metrics_daily_day_idx on public.building_metrics_daily (day);
alter table public.building_metrics_daily enable row level security;
drop policy if exists bmd_select on public.building_metrics_daily;
create policy bmd_select on public.building_metrics_daily for select using (public.can_access_building(building_id));
revoke all on public.building_metrics_daily from anon;
revoke insert, update, delete, truncate, references, trigger on public.building_metrics_daily from authenticated;

-- One row per building for one SAST day. Report and expiry columns are point-in-time reads of the data as it
-- is now (a re-run for an earlier day is marked reconstructed); task and issue columns are computed from
-- completed_at / created_at / resolved_at so a backfilled day is historically honest where the data allows.
-- expiring_items_at is security INVOKER: called from here it runs as this function's owner, so RLS does not
-- narrow the counts for the cron; a signed-in caller must be admin/manager (checked below), who see everything.
create or replace function public.snapshot_building_metrics(p_day date default null, p_building uuid default null)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today  date := (now() at time zone 'Africa/Johannesburg')::date;
  v_day    date := coalesce(p_day, (now() at time zone 'Africa/Johannesburg')::date);
  v_period date;
  v_month  text;
  v_end    timestamptz;   -- first instant of the next SAST day
  v_count  integer := 0;
begin
  if v_day > v_today then
    raise exception 'snapshot_building_metrics: p_day % is in the future', v_day using errcode = '22023';
  end if;
  if auth.uid() is not null then
    if not public.is_admin_or_manager() then
      raise exception 'snapshot_building_metrics: admin or manager only' using errcode = '42501';
    end if;
    if p_building is not null and not public.can_access_building(p_building) then
      raise exception 'snapshot_building_metrics: no access to that building' using errcode = '42501';
    end if;
  end if;
  v_period := date_trunc('month', v_day)::date;
  v_month  := to_char(v_day, 'YYYY-MM');
  v_end    := ((v_day + 1)::timestamp at time zone 'Africa/Johannesburg');

  insert into public.building_metrics_daily as m (
    building_id, day,
    compliance_pct, critical_pct, inspection_pass_pct, compliance_period, ohs_open_nc,
    ppm_done_pct,
    task_completion_30d_pct, tasks_overdue, tasks_due_7d,
    issues_open, issues_open_by_priority, issues_breached, issues_resolved_30d,
    docs_expiring_30, docs_expiring_60, docs_expiring_90, docs_expired, assets_overdue,
    report_state, reconstructed, computed_at)
  select b.id, v_day,
         rep.compliance_pct, rep.critical_pct, rep.inspection_pass_pct, rep.report_period, rep.ohs_open_nc,
         ppm.done_pct,
         t.completion_pct, t.overdue, t.due_7d,
         i.open_count, i.by_priority, i.breached, i.resolved_30d,
         x.d30, x.d60, x.d90, x.expired, x.assets_overdue,
         rs.report_state, v_day < v_today, now()
    from public.buildings b
    left join lateral (
      select r.report_period,
             (select cs.compliance_pct from public.compliance_scores cs where cs.report_id = r.id limit 1) as compliance_pct,
             (select ccs.critical_pct
                from public.compliance_critical_scores ccs
                join public.compliance_assessments ca on ca.id = ccs.assessment_id
               where ca.report_id = r.id limit 1) as critical_pct,
             (select count(*)::int
                from public.compliance_responses cr
                join public.compliance_assessments ca on ca.id = cr.assessment_id
               where ca.report_id = r.id and cr.response = 'no') as ohs_open_nc,
             (select round(100.0 * count(*) filter (where ir.acceptable = 'yes')
                           / nullif(count(*) filter (where ir.acceptable in ('yes','no')), 0), 1)
                from public.inspection_responses ir
                join public.building_inspections bi on bi.id = ir.inspection_id
               where bi.report_id = r.id) as inspection_pass_pct
        from public.reports r
       where r.building_id = b.id and r.report_type = 'ops_monthly' and r.status = 'approved'
         and r.report_period <= v_period
       order by r.report_period desc
       limit 1) rep on true
    left join lateral (
      select round(100.0 * count(*) filter (where s.status = 'done') / nullif(count(*), 0), 1) as done_pct
        from public.ppm_monthly_status s
       where s.building_id = b.id and s.period_month = v_month) ppm on true
    left join lateral (
      with tk as (
        select ti.due_date,
               (ti.status = 'completed'
                and coalesce((ti.completed_at at time zone 'Africa/Johannesburg')::date, ti.due_date) <= v_day) as done
          from public.task_instances ti
         where ti.building_id = b.id
           and ti.status in ('pending','overdue','completed')
           and ti.due_date between v_day - 365 and v_day + 6)
      select round(100.0 * count(*) filter (where done and due_date between v_day - 29 and v_day)
                   / nullif(count(*) filter (where due_date between v_day - 29 and v_day), 0), 1) as completion_pct,
             count(*) filter (where not done and due_date < v_day)::int as overdue,
             count(*) filter (where not done and due_date between v_day and v_day + 6)::int as due_7d
        from tk) t on true
    left join lateral (
      with op as (
        select iss.priority, iss.sla_breached_at
          from public.issues iss
         where iss.building_id = b.id
           and iss.created_at < v_end
           and (iss.resolved_at is null or iss.resolved_at >= v_end)
           and not (iss.status = 'resolved' and iss.resolved_at is null))
      select (select count(*)::int from op) as open_count,
             (select coalesce(jsonb_object_agg(p.priority, p.n), '{}'::jsonb)
                from (select priority, count(*) as n from op group by priority) p) as by_priority,
             (select count(*)::int from op where sla_breached_at is not null and sla_breached_at < v_end) as breached,
             (select count(*)::int from public.issues iss
               where iss.building_id = b.id
                 and iss.resolved_at > v_end - interval '30 days' and iss.resolved_at <= v_end) as resolved_30d) i on true
    left join lateral (
      select count(*) filter (where e.kind in ('building_document','tenant_document','asset_warranty') and e.days_left between 0 and 30)::int as d30,
             count(*) filter (where e.kind in ('building_document','tenant_document','asset_warranty') and e.days_left between 31 and 60)::int as d60,
             count(*) filter (where e.kind in ('building_document','tenant_document','asset_warranty') and e.days_left between 61 and 90)::int as d90,
             count(*) filter (where e.kind in ('building_document','tenant_document','asset_warranty') and e.days_left < 0)::int as expired,
             count(*) filter (where e.kind = 'asset_service' and e.days_left < 0)::int as assets_overdue
        from public.expiring_items_at(v_day, 90) e
       where e.building_id = b.id) x on true
    left join lateral (
      select coalesce(jsonb_object_agg(t.rt, jsonb_build_object('period', v_period, 'status', coalesce(r.status, 'missing'))), '{}'::jsonb) as report_state
        from unnest(b.report_types) as t(rt)
        left join lateral (
          select rr.status from public.reports rr
           where rr.building_id = b.id and rr.report_type = t.rt
             and case when t.rt = 'annual_inspection'
                      then date_trunc('year', rr.report_period) = date_trunc('year', v_period)
                      else rr.report_period = v_period end
           order by rr.report_period desc limit 1) r on true) rs on true
   where p_building is null or b.id = p_building
  on conflict (building_id, day) do update set
    compliance_pct = excluded.compliance_pct, critical_pct = excluded.critical_pct,
    inspection_pass_pct = excluded.inspection_pass_pct, compliance_period = excluded.compliance_period,
    ohs_open_nc = excluded.ohs_open_nc, ppm_done_pct = excluded.ppm_done_pct,
    task_completion_30d_pct = excluded.task_completion_30d_pct, tasks_overdue = excluded.tasks_overdue,
    tasks_due_7d = excluded.tasks_due_7d, issues_open = excluded.issues_open,
    issues_open_by_priority = excluded.issues_open_by_priority, issues_breached = excluded.issues_breached,
    issues_resolved_30d = excluded.issues_resolved_30d, docs_expiring_30 = excluded.docs_expiring_30,
    docs_expiring_60 = excluded.docs_expiring_60, docs_expiring_90 = excluded.docs_expiring_90,
    docs_expired = excluded.docs_expired, assets_overdue = excluded.assets_overdue,
    report_state = excluded.report_state, reconstructed = excluded.reconstructed, computed_at = now();
  get diagnostics v_count = row_count;

  if p_building is null then
    delete from public.building_metrics_daily where day < v_today - 400;
  end if;
  return v_count;
end $$;
revoke all on function public.snapshot_building_metrics(date, uuid) from public;
revoke execute on function public.snapshot_building_metrics(date, uuid) from anon;
grant execute on function public.snapshot_building_metrics(date, uuid) to authenticated, service_role;

-- Portfolio roll-up: security_invoker, so the averages run over the caller's accessible buildings only.
-- contractor documents are org-level (no building) and are counted here, relative to today.
create or replace view public.portfolio_metrics_daily with (security_invoker = on) as
select m.day,
       count(*)::int                              as buildings,
       round(avg(m.compliance_pct), 1)            as compliance_avg,
       round(avg(m.critical_pct), 1)              as critical_avg,
       round(avg(m.inspection_pass_pct), 1)       as inspection_pass_avg,
       round(avg(m.ppm_done_pct), 1)              as ppm_done_avg,
       round(avg(m.task_completion_30d_pct), 1)   as task_completion_avg,
       sum(m.tasks_overdue)::int                  as tasks_overdue,
       sum(m.tasks_due_7d)::int                   as tasks_due_7d,
       sum(m.issues_open)::int                    as issues_open,
       sum(m.issues_breached)::int                as issues_breached,
       sum(m.issues_resolved_30d)::int            as issues_resolved_30d,
       sum(m.docs_expiring_30)::int               as docs_expiring_30,
       sum(m.docs_expiring_60)::int               as docs_expiring_60,
       sum(m.docs_expiring_90)::int               as docs_expiring_90,
       sum(m.docs_expired)::int                   as docs_expired,
       sum(m.assets_overdue)::int                 as assets_overdue,
       (select count(*)::int from public.contractor_documents cd
         where cd.expiry_date between (now() at time zone 'Africa/Johannesburg')::date
                                  and (now() at time zone 'Africa/Johannesburg')::date + 30) as contractor_docs_expiring_30,
       (select count(*)::int from public.contractor_documents cd
         where cd.expiry_date between (now() at time zone 'Africa/Johannesburg')::date + 31
                                  and (now() at time zone 'Africa/Johannesburg')::date + 60) as contractor_docs_expiring_60,
       (select count(*)::int from public.contractor_documents cd
         where cd.expiry_date between (now() at time zone 'Africa/Johannesburg')::date + 61
                                  and (now() at time zone 'Africa/Johannesburg')::date + 90) as contractor_docs_expiring_90,
       (select count(*)::int from public.contractor_documents cd
         where cd.expiry_date < (now() at time zone 'Africa/Johannesburg')::date) as contractor_docs_expired,
       bool_or(m.reconstructed)                   as reconstructed
  from public.building_metrics_daily m
 group by m.day;
revoke all on public.portfolio_metrics_daily from anon;
revoke insert, update, delete, truncate, references, trigger on public.portfolio_metrics_daily from authenticated;

-- Backfill 90 days once (rows for a day that already has any row are left alone, so a re-run is cheap).
-- 47 buildings × 91 days ≈ 4 300 per-building evaluations; if the Management API times out mid-transaction,
-- apply the file without this block and run the block on its own in three 30-day windows (the not-exists
-- guard makes every window idempotent).
do $$
declare
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  d date;
begin
  for d in select generate_series(v_today - 90, v_today, interval '1 day')::date loop
    if not exists (select 1 from public.building_metrics_daily where day = d) then
      perform public.snapshot_building_metrics(d, null);
    end if;
  end loop;
end $$;

do $$ begin perform cron.unschedule('metrics-snapshot-daily'); exception when others then null; end $$;
select cron.schedule('metrics-snapshot-daily', '0 3 * * *', 'select public.snapshot_building_metrics()');

-- ============================================================
-- 4) SLA
-- ============================================================
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'task_assigned','issue_assigned','issue_comment','issue_mention',
  'report_submitted','report_returned','report_approved',
  'form_submitted','form_reviewed','signoff_requested','signoff_complete','signoff_overdue',
  'document_expiring','asset_service_due','task_due_today','issue_sla_breached'));

-- Default target on insert; on a priority change of an open issue the target follows the new priority only
-- when the row still carries the old priority's default and the same statement did not set a target itself
-- (an explicit target is always kept).
create or replace function public.issues_sla_defaults()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.sla_target_hours := coalesce(new.sla_target_hours, public.org_sla_hours(new.priority));
  elsif new.priority is distinct from old.priority
        and new.sla_target_hours is not distinct from old.sla_target_hours   -- the statement did not set a target itself
        and new.status in ('open','in_progress','escalated')
        and (old.sla_target_hours is null or old.sla_target_hours = public.org_sla_hours(old.priority)) then
    new.sla_target_hours := public.org_sla_hours(new.priority);
  end if;
  return new;
end $$;
revoke all on function public.issues_sla_defaults() from public;
revoke execute on function public.issues_sla_defaults() from anon;
drop trigger if exists trg_issues_sla_defaults on public.issues;
create trigger trg_issues_sla_defaults
  before insert or update of priority on public.issues
  for each row execute function public.issues_sla_defaults();

-- First response = first activity by someone other than the reporter. The update touches no column that
-- trg_issues_activity_log or trg_issue_resolved_at watch, so it cannot re-enter.
create or replace function public.issue_activity_first_response()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.user_id is null
     or new.activity_type not in ('comment','status_change','assignment','contractor_assignment') then
    return null;
  end if;
  update public.issues i
     set first_response_at = new.created_at
   where i.id = new.issue_id
     and i.first_response_at is null
     and i.reported_by <> new.user_id;
  return null;
end $$;
revoke all on function public.issue_activity_first_response() from public;
revoke execute on function public.issue_activity_first_response() from anon;
drop trigger if exists trg_issue_activity_first_response on public.issue_activity;
create trigger trg_issue_activity_first_response
  after insert on public.issue_activity
  for each row execute function public.issue_activity_first_response();

-- Breach sweep. Resolving clears nothing: sla_breached_at is history. Inbox rows go to the assignee (if any)
-- and every active admin/manager; no email and no push from here (the rows never pass through
-- createNotifications), which is why issue_sla_breached is DIGEST_ONLY and not a PUSH_KIND in notifyRules.ts.
create or replace function public.mark_sla_breaches()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  r record;
begin
  if auth.uid() is not null and not public.is_admin_or_manager() then
    raise exception 'mark_sla_breaches: admin or manager only' using errcode = '42501';
  end if;
  for r in
    update public.issues i
       set sla_breached_at = now()
     where i.status in ('open','in_progress','escalated')
       and i.sla_breached_at is null
       and i.sla_target_hours is not null
       and i.created_at + (i.sla_target_hours * interval '1 hour') < now()
    returning i.id, i.title, i.building_id, i.assigned_to, i.priority, i.sla_target_hours
  loop
    v_count := v_count + 1;
    insert into public.notifications (recipient_id, actor_id, actor_name, kind, entity_type, entity_id, building_id, title, body, url)
    select u.id, null, null, 'issue_sla_breached', 'issue', r.id, r.building_id,
           left('SLA breached: ' || coalesce(r.title, 'Untitled issue'), 200),
           'Priority ' || r.priority || ' · target '
             || case when r.sla_target_hours = trunc(r.sla_target_hours) then trunc(r.sla_target_hours)::text else r.sla_target_hours::text end
             || ' h',
           '/issues?open=' || r.id
      from (
        select p.id
          from public.profiles p
         where not p.deactivated
           and (p.id = r.assigned_to
                or exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role in ('admin','manager')))
      ) u;
  end loop;
  return v_count;
end $$;
revoke all on function public.mark_sla_breaches() from public;
revoke execute on function public.mark_sla_breaches() from anon;
grant execute on function public.mark_sla_breaches() to authenticated, service_role;

do $$ begin perform cron.unschedule('sla-breach-sweep'); exception when others then null; end $$;
select cron.schedule('sla-breach-sweep', '*/15 * * * *', 'select public.mark_sla_breaches()');

-- ============================================================
-- 5b) Discard an empty draft
-- ============================================================
create or replace function public.delete_empty_report(p_report uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status text;
  v_rows   bigint;
begin
  if not public.is_admin() then
    raise exception 'delete_empty_report: admin only' using errcode = '42501';
  end if;
  select r.status into v_status from public.reports r where r.id = p_report;
  if not found then
    raise exception 'delete_empty_report: report not found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'delete_empty_report: only a draft can be discarded (this report is %)', v_status using errcode = '42501';
  end if;
  if exists (select 1 from public.report_artifacts a where a.source_id = p_report) then
    raise exception 'delete_empty_report: this draft has saved PDF versions; it cannot be discarded' using errcode = '42501';
  end if;
  select
      (select count(*) from public.report_narratives x where x.report_id = p_report and coalesce(x.body, '') <> '')
    + (select count(*) from public.report_checklist_items x where x.report_id = p_report)
    + (select count(*) from public.compliance_responses x join public.compliance_assessments a on a.id = x.assessment_id where a.report_id = p_report)
    + (select count(*) from public.hazard_log x join public.compliance_assessments a on a.id = x.assessment_id where a.report_id = p_report)
    + (select count(*) from public.inspection_responses x join public.building_inspections b on b.id = x.inspection_id where b.report_id = p_report)
    + (select count(*) from public.expense_recoveries x where x.report_id = p_report)
    + (select count(*) from public.utility_readings x where x.report_id = p_report)
    + (select count(*) from public.utility_yields x where x.report_id = p_report)
    + (select count(*) from public.ppm_services x where x.report_id = p_report
         and (coalesce(x.overrides, '{}'::jsonb) <> '{}'::jsonb or coalesce(x.months, '{}'::jsonb) <> '{}'::jsonb))
    + (select count(*) from public.masterfile_items x where x.report_id = p_report)
    + (select count(*) from public.building_turnover x where x.report_id = p_report)
    + (select count(*) from public.tenant_turnover x where x.report_id = p_report)
    + (select count(*) from public.category_turnover x where x.report_id = p_report)
    + (select count(*) from public.footfall_counts x where x.report_id = p_report)
    + (select count(*) from public.toilet_fund x where x.report_id = p_report)
    + (select count(*) from public.vacancies x where x.report_id = p_report)
    + (select count(*) from public.leasing_waitlist x where x.report_id = p_report)
    + (select count(*) from public.tenant_movements x where x.report_id = p_report)
    + (select count(*) from public.trading_hour_breaches x where x.report_id = p_report)
    + (select count(*) from public.tenant_arrears x where x.report_id = p_report)
    + (select count(*) from public.loadshedding_log x where x.report_id = p_report)
    + (select count(*) from public.service_interruptions x where x.report_id = p_report)
    + (select count(*) from public.tenant_compliance x where x.report_id = p_report)
    + (select count(*) from public.security_incidents x where x.report_id = p_report)
    + (select count(*) from public.capex_items x where x.report_id = p_report)
    + (select count(*) from public.local_resources_contacts x where x.report_id = p_report)
    into v_rows;
  if v_rows > 0 then
    raise exception 'delete_empty_report: this draft has % saved row(s); clear its sections before discarding it', v_rows using errcode = '42501';
  end if;
  -- Scaffold only from here on: plan-seeded PPM rows, empty narratives, auto-created parents.
  delete from public.ppm_services where report_id = p_report;
  delete from public.report_narratives where report_id = p_report;
  delete from public.compliance_assessments where report_id = p_report;
  delete from public.building_inspections where report_id = p_report;
  delete from public.reports where id = p_report;
end $$;
revoke all on function public.delete_empty_report(uuid) from public;
revoke execute on function public.delete_empty_report(uuid) from anon;
grant execute on function public.delete_empty_report(uuid) to authenticated, service_role;

commit;

-- Verify:
--   select proname, prosrc ~ 'exists' from pg_proc where proname in ('is_admin','is_admin_or_manager');        -- true, true
--   select prosrc ~ 'is_active_user' from pg_proc where proname = 'app_role';                                   -- true
--   select has_table_privilege('anon', 'public.organizations', 'select'),
--          has_table_privilege('anon', 'public.organization_branding', 'select');                               -- false, true
--   select polname from pg_policy where polrelid = 'public.organizations'::regclass order by 1;
--     -- o_delete, o_insert, o_select_authenticated, o_update
--   select polname from pg_policy where polrelid = 'public.media_attachments'::regclass order by 1;             -- ma_* (4), all is_admin()
--   select count(*), min(day), max(day), bool_or(reconstructed) from public.building_metrics_daily;             -- 91 × buildings, today-90, today, true
--   select has_table_privilege('anon', 'public.building_metrics_daily', 'select'),
--          has_table_privilege('anon', 'public.portfolio_metrics_daily', 'select');                             -- false, false
--   select jobname, schedule from cron.job where jobname in ('metrics-snapshot-daily','sla-breach-sweep');      -- 0 3 * * *, */15 * * * *
--   select public.org_sla_hours('critical'), public.org_sla_hours('low');                                       -- 4, 168
--   select tgname from pg_trigger where tgrelid = 'public.issues'::regclass and not tgisinternal;               -- includes trg_issues_sla_defaults
--   select tgname from pg_trigger where tgrelid = 'public.issue_activity'::regclass and not tgisinternal;       -- trg_issue_activity_first_response
--   select conname from pg_constraint where conname = 'buildings_report_types_check';                           -- 1 row
--   select proname, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace
--     and proname in ('snapshot_building_metrics','mark_sla_breaches','delete_empty_report','org_sla_hours',
--                     'issues_sla_defaults','issue_activity_first_response');                                   -- 6 rows, true, {search_path=}
--   select proname, prosecdef from pg_proc where proname in ('expiring_items','expiring_items_at');            -- 2 rows, false (invoker)
--   select has_function_privilege('anon', 'public.expiring_items(integer)', 'execute'),
--          has_function_privilege('anon', 'public.snapshot_building_metrics(date,uuid)', 'execute'),
--          has_function_privilege('anon', 'public.mark_sla_breaches()', 'execute'),
--          has_function_privilege('anon', 'public.delete_empty_report(uuid)', 'execute');                       -- false ×4
--   Then: npm run smoke:snapshot; node scripts/rls-smoke.mjs; npm run smoke:notifications (Task 5's assertions).
```

- [ ] **Step 2: Verify on a throwaway local Postgres 17.** Supabase's base tables are not in the vendored migrations, so stand up stubs with exactly the columns the migration touches, then apply the real file and assert. Write `<scratchpad>/r4a-local-stub.sql`:

```sql
-- Throwaway stub of the prod surface 2026-09-14_01 depends on. Never applied anywhere real.
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create schema if not exists cron;
create or replace function cron.schedule(text, text, text) returns bigint language sql as $$ select 1::bigint $$;
create or replace function cron.unschedule(text) returns boolean language sql as $$ select true $$;

create table public.profiles (id uuid primary key, full_name text, email text, deactivated boolean not null default false);
create table public.user_roles (user_id uuid not null, role text not null, building_id uuid, unique (user_id, building_id));
create table public.user_buildings (user_id uuid not null, building_id uuid not null);
create table public.organizations (id uuid primary key default gen_random_uuid(), name text, email text, logo_url text, primary_color text, created_at timestamptz default now(), updated_at timestamptz);
alter table public.organizations enable row level security;
create policy o_select_anon on public.organizations for select using (true);
create table public.buildings (id uuid primary key default gen_random_uuid(), name text not null, organization_id uuid);
create table public.media_attachments (id uuid primary key default gen_random_uuid(), record_type text, record_id uuid);
alter table public.media_attachments enable row level security;
create table public.reports (id uuid primary key default gen_random_uuid(), building_id uuid not null references public.buildings(id) on delete cascade, report_type text not null, report_period date not null, status text not null default 'draft', title text, author_id uuid, unique (building_id, report_type, report_period));
create table public.compliance_assessments (id uuid primary key default gen_random_uuid(), report_id uuid references public.reports(id) on delete cascade, building_id uuid);
create table public.compliance_responses (id uuid primary key default gen_random_uuid(), assessment_id uuid references public.compliance_assessments(id) on delete cascade, response text);
create table public.hazard_log (id uuid primary key default gen_random_uuid(), assessment_id uuid references public.compliance_assessments(id) on delete cascade);
create table public.compliance_scores (report_id uuid, assessment_id uuid, building_id uuid, compliance_pct numeric);
create table public.compliance_critical_scores (assessment_id uuid, building_id uuid, critical_pct numeric);
create table public.building_inspections (id uuid primary key default gen_random_uuid(), report_id uuid references public.reports(id) on delete cascade, building_id uuid);
create table public.inspection_responses (id uuid primary key default gen_random_uuid(), inspection_id uuid references public.building_inspections(id) on delete cascade, acceptable text);
create table public.ppm_monthly_status (building_id uuid, ppm_service_id uuid, service_name text, period_month text, status text, done_on date);
create table public.task_instances (id uuid primary key default gen_random_uuid(), building_id uuid not null, task_name text, status text not null default 'pending', due_date date not null, completed_at timestamptz);
create table public.issues (id uuid primary key default gen_random_uuid(), building_id uuid not null, title text, description text, priority text not null default 'medium', status text not null default 'open', reported_by uuid, assigned_to uuid, created_at timestamptz not null default now(), resolved_at timestamptz, sla_target_hours numeric, sla_breached_at timestamptz, first_response_at timestamptz);
create table public.issue_activity (id uuid primary key default gen_random_uuid(), issue_id uuid not null, user_id uuid, activity_type text not null, created_at timestamptz not null default now());
create table public.notifications (id uuid primary key default gen_random_uuid(), recipient_id uuid not null, actor_id uuid, actor_name text, kind text not null, entity_type text not null, entity_id uuid, building_id uuid, title text not null, body text, url text not null, read_at timestamptz, created_at timestamptz not null default now(),
  constraint notifications_kind_check check (kind in ('task_assigned','issue_assigned','issue_comment','issue_mention','report_submitted','report_returned','report_approved','form_submitted','form_reviewed','signoff_requested','signoff_complete','signoff_overdue','document_expiring','asset_service_due','task_due_today')),
  constraint notifications_entity_type_check check (entity_type in ('task','issue','report','form_submission','signoff_request','document','asset')));
create table public.building_documents (id uuid primary key default gen_random_uuid(), building_id uuid not null, name text not null, document_type text, expiry_date date);
create table public.building_tenants (id uuid primary key default gen_random_uuid(), building_id uuid not null, name text, shop_name text);
create table public.tenant_documents (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, document_name text not null, document_type text, expiry_date date);
create table public.contractors (id uuid primary key default gen_random_uuid(), company_name text not null);
create table public.contractor_documents (id uuid primary key default gen_random_uuid(), contractor_id uuid not null, document_name text not null, document_type text, expiry_date date);
create table public.building_assets (id uuid primary key default gen_random_uuid(), building_id uuid not null, name text not null, category text, next_service_date date);
create table public.report_artifacts (id uuid primary key default gen_random_uuid(), kind text, source_id uuid, status text default 'issued');
create table public.report_narratives (id uuid primary key default gen_random_uuid(), report_id uuid references public.reports(id) on delete cascade, body text);
create table public.ppm_services (id uuid primary key default gen_random_uuid(), report_id uuid references public.reports(id) on delete cascade, months jsonb default '{}'::jsonb, overrides jsonb not null default '{}'::jsonb);
do $$ declare t text; begin
  foreach t in array array['report_checklist_items','expense_recoveries','utility_readings','utility_yields','masterfile_items','building_turnover','tenant_turnover','category_turnover','footfall_counts','toilet_fund','vacancies','leasing_waitlist','tenant_movements','trading_hour_breaches','tenant_arrears','loadshedding_log','service_interruptions','tenant_compliance','security_incidents','capex_items','local_resources_contacts'] loop
    execute format('create table public.%I (id uuid primary key default gen_random_uuid(), report_id uuid references public.reports(id) on delete cascade)', t);
  end loop;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon, authenticated;
grant all on all tables in schema public to service_role;

-- The helpers the migration builds on (verbatim from 2026-09-11_03).
create or replace function public.is_active_user() returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not coalesce((select p.deactivated from public.profiles p where p.id = auth.uid()), false) $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_user() and coalesce((select role from public.user_roles where user_id = auth.uid()) = 'admin', false) $$;
create or replace function public.is_admin_or_manager() returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_user() and coalesce((select role from public.user_roles where user_id = auth.uid()) in ('admin','manager'), false) $$;
create or replace function public.can_access_building(b uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin_or_manager() or (public.is_active_user() and exists (select 1 from public.user_buildings ub where ub.user_id = auth.uid() and ub.building_id = b)) $$;
```

Then `<scratchpad>/r4a-local-verify.sql` (every block raises on a mismatch, so a clean run prints only NOTICEs):

```sql
-- Fixtures: one org, two buildings, an admin with TWO role rows, a site user on A. Dates are SAST like the
-- function's own day boundary (the container clock is UTC; between 22:00 and 24:00 UTC they differ).
create or replace function public.zz_today() returns date language sql stable as $$ select (now() at time zone 'Africa/Johannesburg')::date $$;
insert into public.organizations (id, name) values ('00000000-0000-0000-0000-00000000aa01', 'Stub Org');
insert into public.profiles (id, full_name) values ('00000000-0000-0000-0000-00000000ad01', 'Admin'), ('00000000-0000-0000-0000-00000000ad02', 'Site');
insert into public.buildings (id, name) values ('00000000-0000-0000-0000-00000000b001', 'A'), ('00000000-0000-0000-0000-00000000b002', 'B');
insert into public.user_roles (user_id, role, building_id) values
  ('00000000-0000-0000-0000-00000000ad01', 'admin', null),
  ('00000000-0000-0000-0000-00000000ad01', 'manager', '00000000-0000-0000-0000-00000000b001'),   -- second row: the 21000 case
  ('00000000-0000-0000-0000-00000000ad02', 'user', null);
insert into public.user_buildings values ('00000000-0000-0000-0000-00000000ad02', '00000000-0000-0000-0000-00000000b001');

-- 1) Two role rows no longer raise; most privileged wins.
set app.uid = '00000000-0000-0000-0000-00000000ad01';
do $$ begin
  if not public.is_admin_or_manager() then raise exception 'two-role admin denied'; end if;
  if public.app_role() <> 'admin' then raise exception 'app_role should be admin, got %', public.app_role(); end if;
end $$;

-- 2) Anon: view yes, table no.
reset app.uid;
set role anon;
do $$ begin
  perform * from public.organization_branding;
  begin
    perform * from public.organizations;
    raise exception 'anon could read organizations';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 3) Snapshot for a fixture day: one approved report with a score, tasks, issues, expiring docs.
insert into public.reports (id, building_id, report_type, report_period, status) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000b001', 'ops_monthly', date_trunc('month', public.zz_today())::date, 'approved');
insert into public.compliance_scores (report_id, compliance_pct) values ('00000000-0000-0000-0000-00000000e001', 87.5);
insert into public.task_instances (building_id, status, due_date, completed_at) values
  ('00000000-0000-0000-0000-00000000b001', 'completed', public.zz_today() - 1, now()),
  ('00000000-0000-0000-0000-00000000b001', 'pending',   public.zz_today()),
  ('00000000-0000-0000-0000-00000000b001', 'overdue',   public.zz_today() - 3);
insert into public.issues (building_id, title, priority, reported_by) values
  ('00000000-0000-0000-0000-00000000b001', 'Leak', 'high', '00000000-0000-0000-0000-00000000ad02');
insert into public.building_documents (building_id, name, expiry_date) values
  ('00000000-0000-0000-0000-00000000b001', 'Fire cert', public.zz_today() + 10),
  ('00000000-0000-0000-0000-00000000b001', 'Old cert', public.zz_today() - 5);
insert into public.building_assets (building_id, name, next_service_date, warranty_expiry) values
  ('00000000-0000-0000-0000-00000000b001', 'Chiller', public.zz_today() - 1, public.zz_today() + 80);
do $$ declare n int; r public.building_metrics_daily; begin
  n := public.snapshot_building_metrics(null, '00000000-0000-0000-0000-00000000b001');
  if n <> 1 then raise exception 'expected 1 row, got %', n; end if;
  select * into r from public.building_metrics_daily where building_id = '00000000-0000-0000-0000-00000000b001' and day = (now() at time zone 'Africa/Johannesburg')::date;
  if r.compliance_pct <> 87.5 then raise exception 'compliance_pct %', r.compliance_pct; end if;
  if r.task_completion_30d_pct <> 33.3 then raise exception 'task pct %', r.task_completion_30d_pct; end if;
  if r.tasks_overdue <> 1 or r.tasks_due_7d <> 1 then raise exception 'tasks % / %', r.tasks_overdue, r.tasks_due_7d; end if;
  if r.issues_open <> 1 or r.issues_open_by_priority <> '{"high": 1}'::jsonb then raise exception 'issues % %', r.issues_open, r.issues_open_by_priority; end if;
  if r.docs_expiring_30 <> 1 or r.docs_expiring_90 <> 1 or r.docs_expired <> 1 or r.assets_overdue <> 1 then raise exception 'docs % % % assets %', r.docs_expiring_30, r.docs_expiring_90, r.docs_expired, r.assets_overdue; end if;
  if (r.report_state->'ops_monthly'->>'status') <> 'approved' or (r.report_state->'cm_monthly'->>'status') <> 'missing' then raise exception 'report_state %', r.report_state; end if;
  if r.reconstructed then raise exception 'today must not be reconstructed'; end if;
  n := public.snapshot_building_metrics(null, '00000000-0000-0000-0000-00000000b001');   -- idempotent: same key, row replaced
  if (select count(*) from public.building_metrics_daily where building_id = '00000000-0000-0000-0000-00000000b001') <> 1 then
    raise exception 'expected exactly 1 row after two runs, got %', (select count(*) from public.building_metrics_daily where building_id = '00000000-0000-0000-0000-00000000b001');
  end if;
  -- The migration's 90-day backfill ran before these fixture buildings existed (0 buildings → 0 rows), so
  -- the reconstruction path is exercised explicitly: an earlier day is marked and the fixture issue (created
  -- today) is not open on it.
  n := public.snapshot_building_metrics(public.zz_today() - 7, '00000000-0000-0000-0000-00000000b001');
  if n <> 1 then raise exception 'reconstructed day: expected 1 row, got %', n; end if;
  if not exists (select 1 from public.building_metrics_daily where building_id = '00000000-0000-0000-0000-00000000b001' and day = public.zz_today() - 7 and reconstructed and issues_open = 0) then
    raise exception 'reconstructed row wrong: %', (select to_jsonb(m) from public.building_metrics_daily m where m.building_id = '00000000-0000-0000-0000-00000000b001' and m.day = public.zz_today() - 7);
  end if;
  raise notice 'snapshot ok: %', to_jsonb(r);
end $$;
do $$ begin
  begin perform public.snapshot_building_metrics(public.zz_today() + 1, null); raise exception 'future day accepted';
  exception when invalid_parameter_value then null; end;
end $$;
-- Site user: 42501.
set app.uid = '00000000-0000-0000-0000-00000000ad02';
do $$ begin
  begin perform public.snapshot_building_metrics(null, null); raise exception 'site user ran the snapshot';
  exception when insufficient_privilege then null; end;
end $$;
reset app.uid;

-- 4) SLA: default on insert, re-derive on priority change, first response, breach + notifications.
do $$ declare v_id uuid; v_hours numeric; n int; begin
  insert into public.issues (building_id, title, priority, reported_by, assigned_to) values
    ('00000000-0000-0000-0000-00000000b001', 'Lift', 'critical', '00000000-0000-0000-0000-00000000ad02', '00000000-0000-0000-0000-00000000ad02') returning id into v_id;
  select sla_target_hours into v_hours from public.issues where id = v_id;
  if v_hours <> 4 then raise exception 'critical default should be 4, got %', v_hours; end if;
  update public.issues set priority = 'low' where id = v_id;
  select sla_target_hours into v_hours from public.issues where id = v_id;
  if v_hours <> 168 then raise exception 'low re-derive should be 168, got %', v_hours; end if;
  update public.issues set sla_target_hours = 10, priority = 'high' where id = v_id;   -- explicit target is kept on the next change
  update public.issues set priority = 'critical' where id = v_id;
  select sla_target_hours into v_hours from public.issues where id = v_id;
  if v_hours <> 10 then raise exception 'explicit target overwritten: %', v_hours; end if;
  -- org override
  update public.organizations set settings = '{"sla_hours": {"critical": 2}}'::jsonb;
  if public.org_sla_hours('critical') <> 2 or public.org_sla_hours('high') <> 24 then raise exception 'org override not read'; end if;
  update public.organizations set settings = '{"sla_hours": {"critical": "oops"}}'::jsonb;
  if public.org_sla_hours('critical') <> 4 then raise exception 'non-number override should fall back'; end if;
  update public.organizations set settings = '{}'::jsonb;
  -- first response: the reporter's own comment does not count, someone else's does
  insert into public.issue_activity (issue_id, user_id, activity_type) values (v_id, '00000000-0000-0000-0000-00000000ad02', 'comment');
  if (select first_response_at from public.issues where id = v_id) is not null then raise exception 'reporter counted as first response'; end if;
  insert into public.issue_activity (issue_id, user_id, activity_type) values (v_id, '00000000-0000-0000-0000-00000000ad01', 'comment');
  if (select first_response_at from public.issues where id = v_id) is null then raise exception 'first response not stamped'; end if;
  -- breach: push created_at back past the target
  update public.issues set sla_target_hours = 1, created_at = now() - interval '2 hours' where id = v_id;
  n := public.mark_sla_breaches();
  if n <> 1 then raise exception 'expected 1 breach, got %', n; end if;
  if (select count(*) from public.notifications where kind = 'issue_sla_breached' and entity_id = v_id) <> 2 then   -- assignee (site) + admin
    raise exception 'expected 2 inbox rows, got %', (select count(*) from public.notifications where kind = 'issue_sla_breached' and entity_id = v_id);
  end if;
  if (select url from public.notifications where kind = 'issue_sla_breached' and entity_id = v_id limit 1) <> '/issues?open=' || v_id then raise exception 'bad url'; end if;
  n := public.mark_sla_breaches();
  if n <> 0 then raise exception 'second sweep must be a no-op, got %', n; end if;
  raise notice 'sla ok';
end $$;

-- 5) delete_empty_report: admin only, draft only, artifacts block, content blocks, scaffold rows go.
set app.uid = '00000000-0000-0000-0000-00000000ad01';
do $$ declare v_r uuid; begin
  insert into public.reports (building_id, report_type, report_period, status) values ('00000000-0000-0000-0000-00000000b002', 'ops_monthly', '2026-08-01', 'draft') returning id into v_r;
  insert into public.ppm_services (report_id) values (v_r);                    -- plan-seeded scaffold
  insert into public.report_narratives (report_id, body) values (v_r, '');    -- empty narrative
  insert into public.compliance_assessments (report_id) values (v_r);         -- auto-created parent
  perform public.delete_empty_report(v_r);
  if exists (select 1 from public.reports where id = v_r) then raise exception 'empty draft not deleted'; end if;
  insert into public.reports (building_id, report_type, report_period, status) values ('00000000-0000-0000-0000-00000000b002', 'ops_monthly', '2026-08-01', 'draft') returning id into v_r;
  insert into public.report_narratives (report_id, body) values (v_r, 'Some text');
  begin perform public.delete_empty_report(v_r); raise exception 'draft with content deleted';
  exception when insufficient_privilege then null; end;
  update public.reports set status = 'submitted' where id = v_r; delete from public.report_narratives where report_id = v_r;
  begin perform public.delete_empty_report(v_r); raise exception 'submitted report deleted';
  exception when insufficient_privilege then null; end;
  raise notice 'delete_empty_report ok';
end $$;
set app.uid = '00000000-0000-0000-0000-00000000ad02';
do $$ begin
  begin perform public.delete_empty_report('00000000-0000-0000-0000-00000000e001'); raise exception 'site user ran delete_empty_report';
  exception when insufficient_privilege then null; end;
end $$;
reset app.uid;

-- 6) expiring_items as the site user: RLS is the stub's grant-all here, so only shape + days_left are checked.
do $$ declare n int; begin
  select count(*) into n from public.expiring_items(90) e where e.building_id = '00000000-0000-0000-0000-00000000b001' and e.kind in ('building_document','asset_warranty','asset_service');
  if n <> 4 then raise exception 'expected 4 expiring items, got %', n; end if;
  if (select days_left from public.expiring_items(90) where name = 'Fire cert') <> 10 then raise exception 'days_left wrong'; end if;
  raise notice 'expiring_items ok';
end $$;
select 'ALL LOCAL CHECKS PASSED' as result;
```

Run:
```bash
docker run --rm -d --name r4a-pg -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:17
until docker exec r4a-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
PGPASSWORD=pg psql -h localhost -p 55432 -U postgres -v ON_ERROR_STOP=1 -f "<scratchpad>/r4a-local-stub.sql"
PGPASSWORD=pg psql -h localhost -p 55432 -U postgres -v ON_ERROR_STOP=1 -f "../GMI/sql/2026-09-14_01_r4_snapshots_sla.sql"
PGPASSWORD=pg psql -h localhost -p 55432 -U postgres -v ON_ERROR_STOP=1 -f "../GMI/sql/2026-09-14_01_r4_snapshots_sla.sql"   # idempotency: must apply twice
PGPASSWORD=pg psql -h localhost -p 55432 -U postgres -v ON_ERROR_STOP=1 -f "<scratchpad>/r4a-local-verify.sql"
docker rm -f r4a-pg
```
Expected: the last psql prints `NOTICE: snapshot ok…`, `sla ok`, `delete_empty_report ok`, `expiring_items ok` and `ALL LOCAL CHECKS PASSED`. If `psql` is not on PATH use `docker exec -i r4a-pg psql -U postgres -v ON_ERROR_STOP=1 < file`. Fix the migration until both applies and the verify pass.

- [ ] **Step 3: Commit the canonical SQL in GMI**, then vendor:

```bash
cd ../GMI && git add sql/2026-09-14_01_r4_snapshots_sla.sql && git commit -m "R4a: snapshots, SLA, coverage, expiring items (2026-09-14_01)" && cd -
npm run schema:vendor
git add supabase/schema/2026-09-14_01_r4_snapshots_sla.sql supabase/schema/.source
git commit -m "Vendor the R4a snapshots & SLA migration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
(`schema:vendor` deletes and re-copies every `.sql`; `git status` must show only the new file and `.source` as changed. If any other vendored file differs, GMI has drifted — stop and tell the controller.)

- [ ] **Step 4: Write `scripts/snapshot-smoke.mjs`** (model: `scripts/ppm-smoke.mjs` — same env handling, `persona`, `svcInsert/svcDelete/svcSelect/selectAs`, `rpc`, LIFO cleanup, exit codes; copy those helper definitions verbatim from `ppm-smoke.mjs:33-118` with `zztest-ppm-` → `zztest-snap-` and `Ppm-Smoke` → `Snap-Smoke`). Header comment names every step. The journey:

```js
// ── setup ──
// building A (ZZTEST-SNAP-A-<RUN>) + admin + site user on A + a second building B nobody but admin sees.
// ── step 1: fixtures on A ──
//   reports: one ops_monthly, report_period = first of this month (SAST), status 'approved'   (no assessment → compliance null is expected: the smoke asserts NULL, not a number; scoring needs a template)
//   task_instances: completed (due yesterday, completed_at now), pending (due today), overdue (due 3 days ago)
//   issues: 'ZZTEST-SNAP high' priority high, open; 'ZZTEST-SNAP resolved' status resolved (service role sets resolved_at = now() - 5 days)
//   building_documents: 'ZZTEST-SNAP cert' expiry today+10; 'ZZTEST-SNAP old' expiry today-5
//   building_tenants: one tenant + tenant_documents row expiry today+45
//   building_assets: 'ZZTEST-SNAP chiller' next_service_date today-1, warranty_expiry today+80
// ── step 2: snapshot_building_metrics(p_day: today, p_building: A) as admin → 1
//   select as admin from building_metrics_daily?building_id=eq.A&day=eq.today → exactly one row; assert:
//   compliance_pct null, compliance_period = this month, task_completion_30d_pct 33.3, tasks_overdue 1, tasks_due_7d 1,
//   issues_open 1, issues_open_by_priority {"high":1}, issues_breached 0, issues_resolved_30d 1,
//   docs_expiring_30 1, docs_expiring_60 1, docs_expiring_90 1, docs_expired 1, assets_overdue 1,
//   report_state.ops_monthly.status 'approved', report_state.cm_monthly.status 'missing', reconstructed false, computed_at within 60 s
// ── step 3: run it again → still 1 row for (A, today); computed_at strictly newer (idempotent)
// ── step 4: backfill window: as admin, count rows for A with day >= today-90 → 1 (only today: A is new; the migration's backfill ran before A existed)
//   then snapshot_building_metrics(today-7, A) → 1; the row for today-7 has reconstructed true and issues_open 0 (the fixture issue was created today)
// ── step 5: RLS: site user on A reads A's rows (≥1); site user cannot read B's row after snapshot(today, B) as admin (0 rows); anon GET building_metrics_daily → non-2xx;
//   anon GET portfolio_metrics_daily → non-2xx; admin GET portfolio_metrics_daily?day=eq.today → 1 row with buildings ≥ 2
// ── step 6: gates: snapshot as site user → 403; as anon → 401/403; p_day tomorrow as admin → 400 (22023)
// ── step 7: expiring_items(90) as site user → contains the 5 fixture items for A with kinds building_document ×2, tenant_document, asset_warranty, asset_service and the expected days_left (10, -5, 45, 80, -1);
//   as anon → 401/403
// ── step 8: SLA: insert issue (service role) priority 'critical' without sla_target_hours → row has 4; insert issue_activity comment as the site user (a different user from reported_by = admin) → first_response_at set;
//   service role sets sla_target_hours 0.01 and created_at = now() - 1 hour; mark_sla_breaches as admin → ≥ 1; notifications kind issue_sla_breached for the admin persona with entity_id = issue → exactly 1; second call → the issue's row count unchanged; as site user → 403; as anon → 401/403
// ── step 9 (project-wide, behind PROJECT_WIDE_ALLOWED): time snapshot_building_metrics(today, null) as admin; assert HTTP 200 and elapsed < 30000 ms; print the ms (the controller records it in APPLY_CHECKLIST)
// ── teardown: notifications where entity_id in (fixture issues) via svcDelete; issue_activity; issues; tenant_documents; building_tenants; building_documents; building_assets; task_instances; reports; building_metrics_daily rows for A/B (service role delete by building_id); buildings; personas; sweep zztest-snap-*
```

Concrete assertions use the same `assert(name, cond, detail)` helper; each step logs `PASS`/`FAIL`. The final lines mirror ppm-smoke: `console.log(\`\n${pass} passed, ${failures} failed\`)`, `process.exit(failures === 0 ? 0 : 1)`. Dates are computed with the `sastToday()` / `addDays()` helpers from ppm-smoke (copy them). For step 2 the numeric comparisons use `Number(row.task_completion_30d_pct) === 33.3` (PostgREST returns numerics as strings/numbers depending on precision; `Number()` both).

- [ ] **Step 5: `rls-smoke.mjs` probes.** Add to the header comment block (after the R3c lines):
```
 *   R4a "Snapshots"→ organizations: anon cannot read the table, can read organization_branding; settings
 *                    readable by any signed-in user, writable admin/manager; building_metrics_daily select by
 *                    access, no client writes; snapshot_building_metrics / mark_sla_breaches / delete_empty_report /
 *                    expiring_items never anon; delete_empty_report admin only; media_attachments admin only;
 *                    a user with two user_roles rows still passes is_admin_or_manager (21000 fix)
```
and this block immediately before `} catch (e) {` (currently line 700), reusing `A`, `B`, `personas`, `rows`, `cleanup`, `probeMatrix`, `canSelect/canInsert/canUpdate/canDelete`, `rpcCall`:

```js
  // ════ R4a: organizations, branding view, snapshots, SLA sweep, discard, media_attachments, two-role user ════
  {
    const anonOrg = await fetch(`${URL_BASE}/rest/v1/organizations?select=id&limit=1`, { headers: { apikey: ANON } });
    assert('organizations not readable by anon', !anonOrg.ok, `expected a non-2xx, got HTTP ${anonOrg.status}`);
    const anonBranding = await fetch(`${URL_BASE}/rest/v1/organization_branding?select=id,name,logo_url,primary_color&limit=1`, { headers: { apikey: ANON } });
    assert('organization_branding readable by anon', anonBranding.ok, `HTTP ${anonBranding.status}`);
    const brandingCols = Object.keys((await anonBranding.json())[0] ?? { id: 1, name: 1, logo_url: 1, primary_color: 1 }).sort();
    assert('organization_branding exposes only id/name/logo_url/primary_color', brandingCols.join(',') === 'id,logo_url,name,primary_color', brandingCols.join(','));
    await probeMatrix('organizations select (settings included)', anyAuth(), (jwt) => canSelectF(jwt, 'organizations', 'settings=not.is.null'));
    const orgId = (await (await fetch(`${URL_BASE}/rest/v1/organizations?select=id&limit=1`, { headers: SVC })).json())[0]?.id;
    if (orgId) {
      await probeMatrix('organizations.settings update', adminMgr(), (jwt) => canUpdate(jwt, 'organizations', orgId, { settings: {} }));
    } else {
      skip('organizations.settings update', 'no organizations row on this project');
    }
    for (const view of ['building_metrics_daily', 'portfolio_metrics_daily']) {
      const res = await fetch(`${URL_BASE}/rest/v1/${view}?limit=1`, { headers: { apikey: ANON } });
      assert(`${view} not readable by anon`, !res.ok, `expected a non-2xx, got HTTP ${res.status}`);
    }
    // One snapshot row per fixture building (service role runs the function as cron would).
    for (const bid of [A, B]) {
      const r = await fetch(`${URL_BASE}/rest/v1/rpc/snapshot_building_metrics`, { method: 'POST', headers: SVC, body: JSON.stringify({ p_building: bid }) });
      if (!r.ok) fail(`snapshot fixture for ${bid === A ? 'A' : 'B'}`, `HTTP ${r.status} ${await r.text()}`);
    }
    await probeMatrix('building_metrics_daily[A] select', byAccess('A'), (jwt) => canSelectF(jwt, 'building_metrics_daily', `building_id=eq.${A}`));
    await probeMatrix('building_metrics_daily[B] select', byAccess('B'), (jwt) => canSelectF(jwt, 'building_metrics_daily', `building_id=eq.${B}`));
    await probeMatrix('building_metrics_daily insert', nobody(), (jwt) => canInsert(jwt, 'building_metrics_daily', { building_id: A, day: '2030-01-01' }));
    await probeMatrix('building_metrics_daily update', nobody(), (jwt) => canUpdateF(jwt, 'building_metrics_daily', `building_id=eq.${A}`, { issues_open: 99 }));
    for (const fn of ['snapshot_building_metrics', 'mark_sla_breaches', 'delete_empty_report', 'expiring_items']) {
      const args = fn === 'delete_empty_report' ? { p_report: A } : fn === 'expiring_items' ? { p_days: 30 } : {};
      const anonR = await rpcCall(null, fn, args);
      assert(`${fn} not executable by anon`, anonR.status === 401 || anonR.status === 403, `expected HTTP 401/403 (revoked grant), got HTTP ${anonR.status}`);
    }
    assert('snapshot_building_metrics refused for a site user', (await rpcCall(personas.userA.jwt, 'snapshot_building_metrics', { p_building: A })).status === 403, 'site user ran the snapshot');
    assert('mark_sla_breaches refused for a site user', (await rpcCall(personas.userA.jwt, 'mark_sla_breaches', {})).status === 403, 'site user ran the sweep');
    assert('mark_sla_breaches runs for a manager', (await rpcCall(personas.manager.jwt, 'mark_sla_breaches', {})).status === 200, 'manager could not run the sweep');
    // expiring_items is invoker: the site user on A sees A's document, not B's.
    const docB = (await svcInsert('building_documents', { building_id: B, name: `ZZTEST-RLS-exp-B-${RUN}`, expiry_date: '2030-01-01' })).id;
    cleanup.push(['building_documents', docB]);
    {
      const r = await rpcCall(personas.userA.jwt, 'expiring_items', { p_days: 5000 });
      const names = r.rows.map((x) => x.name);
      assert('expiring_items as userA excludes building B', r.ok && !names.includes(`ZZTEST-RLS-exp-B-${RUN}`), JSON.stringify(names.filter((n) => String(n).startsWith('ZZTEST-RLS')))); 
    }
    // delete_empty_report: admin only; an empty draft goes, a draft with content stays.
    const emptyDraft = (await svcInsert('reports', { building_id: A, report_type: 'cm_monthly', report_period: '2029-01-01', status: 'draft', title: `ZZTEST-RLS-${RUN}` })).id;
    cleanup.push(['reports', emptyDraft]);
    assert('delete_empty_report refused for a manager', (await rpcCall(personas.manager.jwt, 'delete_empty_report', { p_report: emptyDraft })).status === 403, 'manager discarded a draft');
    assert('delete_empty_report refused for a site user', (await rpcCall(personas.userA.jwt, 'delete_empty_report', { p_report: emptyDraft })).status === 403, 'site user discarded a draft');
    const fullDraft = (await svcInsert('reports', { building_id: A, report_type: 'cm_monthly', report_period: '2029-02-01', status: 'draft', title: `ZZTEST-RLS-full-${RUN}` })).id;
    cleanup.push(['reports', fullDraft]);
    const narr = (await svcInsert('report_narratives', { report_id: fullDraft, section_key: 'building_overview', heading: 'x', body: 'ZZTEST-RLS content' })).id;
    cleanup.push(['report_narratives', narr]);
    assert('delete_empty_report refuses a draft with content', (await rpcCall(personas.admin.jwt, 'delete_empty_report', { p_report: fullDraft })).status === 403, 'admin discarded a draft that had rows');
    assert('delete_empty_report deletes an empty draft for admin', (await rpcCall(personas.admin.jwt, 'delete_empty_report', { p_report: emptyDraft })).status === 200, 'admin could not discard an empty draft');
    assert('empty draft is gone', (await (await fetch(`${URL_BASE}/rest/v1/reports?id=eq.${emptyDraft}&select=id`, { headers: SVC })).json()).length === 0, 'row still present');
    // media_attachments: admin only, every verb.
    await probeMatrix('media_attachments insert', adminOnly(), (jwt) => canInsert(jwt, 'media_attachments', { record_type: 'issue', record_id: A, file_url: `zztest-rls-${RUN}` }));
    // A second user_roles row (building-scoped manager) must not break the helpers (was 21000).
    await svcInsert('user_roles', { user_id: personas.manager.id, role: 'manager', building_id: A });
    assert('manager with two role rows still reads building B', await canSelect(personas.manager.jwt, 'buildings', B), 'two-role manager lost access (21000 regression)');
    await fetch(`${URL_BASE}/rest/v1/user_roles?user_id=eq.${personas.manager.id}&building_id=eq.${A}`, { method: 'DELETE', headers: SVC });
    console.log('  R4a (organizations, branding view, building_metrics_daily, SLA sweep, delete_empty_report, expiring_items, media_attachments, two-role user): done');
  }
```
Check `report_narratives`' required columns with `grep -n "report_narratives" -A12 src/integrations/supabase/fortress-types.ts | grep -v "| null"` before running and adjust the insert (only `report_id` and `body` are load-bearing for the probe). Check `media_attachments`' insert shape the same way (`types.ts`). The teardown already deletes `building_metrics_daily` rows through the `buildings` cascade.

- [ ] **Step 6: `package.json`** — add `"smoke:snapshot": "node scripts/snapshot-smoke.mjs"` after `smoke:ppm` and append `&& node scripts/snapshot-smoke.mjs` to the `smoke` chain right after `node scripts/ppm-smoke.mjs`.

- [ ] **Step 7: Gate.** `node --check scripts/snapshot-smoke.mjs && node --check scripts/rls-smoke.mjs`; `npm run test` (unchanged count; nothing in `src/` touched). The smokes themselves run only after the controller applies the migration on staging (Task 6) — say so in the handoff.

- [ ] **Step 8: Commit**
```bash
git add scripts/snapshot-smoke.mjs scripts/rls-smoke.mjs package.json
git commit -m "Add the R4a snapshot smoke and the rls-smoke probes for snapshots, SLA, discard and branding

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**Controller after Task 1:** apply on staging (Management API), then `npm run smoke:snapshot`, `node scripts/rls-smoke.mjs`; record the step-9 timing.

---

### Task 2: Org settings, feature flags, Settings cards, anon-safe branding, coverage grid, discard draft

**Files:**
- Create: `src/lib/orgSettings.ts`, `src/lib/orgSettings.test.ts`, `src/hooks/useOrgSettings.ts`, `src/hooks/useOrgSettings.test.ts`, `src/hooks/useOrganization.test.ts`, `src/components/settings/ReportDueDayCard.tsx`, `src/components/settings/FeatureFlagsCard.tsx`, `src/components/settings/ReportDueDayCard.test.tsx`, `src/components/settings/FeatureFlagsCard.test.tsx`, `src/lib/reportCoverage.ts`, `src/lib/reportCoverage.test.ts`, `src/components/reports/fortress/CoverageGrid.tsx`, `src/components/reports/fortress/CoverageGrid.test.tsx`
- Modify: `src/hooks/useOrganization.ts` (whole file), `src/pages/Settings.tsx` (imports, tabs list, new `TabsContent`), `src/pages/FortressReports.tsx` (default period, buildings query, coverage grid replaces the "missing" card), `src/hooks/useFortressReports.ts` (append `useDiscardDraft`, `useSetBuildingReportTypes`), `src/hooks/useFortressReports.test.ts` (mock gains `rpc`; new describe), `src/components/reports/fortress/FortressReportEditor.tsx:5,34,296-315` (Discard draft)
- Do NOT touch: `src/components/settings/SlaSettingsCard.tsx` (Task 4 creates it; you only import it)

- [ ] **Step 1: `src/lib/orgSettings.ts`**

```ts
/**
 * Organization-level settings (organizations.settings jsonb, R4a §5.2). One object, parsed with defaults so
 * a missing or malformed key never reaches a component: every consumer gets a complete OrgSettings.
 * The SLA defaults are the same numbers as public.org_sla_hours() in 2026-09-14_01 — change both together.
 */
export const FEATURE_NAMES = ['share_links', 'report_schedules', 'tenant_intake'] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

export const FEATURE_LABELS: Record<FeatureName, { label: string; description: string }> = {
  share_links: { label: 'Share links', description: 'Expiring links that let an external recipient open an issued report PDF.' },
  report_schedules: { label: 'Report schedules', description: 'Reminders before period close and emailed distribution of approved reports.' },
  tenant_intake: { label: 'Tenant intake', description: 'A per-building QR form tenants use to report a problem without a login.' },
};

export const SLA_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type SlaPriority = (typeof SLA_PRIORITIES)[number];
export type SlaHours = Record<SlaPriority, number>;

export interface OrgSettings {
  sla_hours: SlaHours;
  features: Record<FeatureName, boolean>;
  /** Day of the following month (1–28) by which a monthly report must be approved. */
  report_due_day: number;
  /** Display name for distribution emails (R4b); null = the organization name. */
  distribution_from: string | null;
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  sla_hours: { critical: 4, high: 24, medium: 72, low: 168 },
  features: { share_links: false, report_schedules: false, tenant_intake: false },
  report_due_day: 7,
  distribution_from: null,
};

/** Hours are whole numbers between 1 and one year; the SQL side accepts any positive numeric. */
export const SLA_HOURS_MIN = 1;
export const SLA_HOURS_MAX = 8760;

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Never throws: anything unreadable falls back to the default for that key. */
export function parseOrgSettings(raw: unknown): OrgSettings {
  const o = obj(raw);
  const sla = obj(o.sla_hours);
  const feats = obj(o.features);
  const d = DEFAULT_ORG_SETTINGS;
  return {
    sla_hours: {
      critical: num(sla.critical, d.sla_hours.critical, SLA_HOURS_MIN, SLA_HOURS_MAX),
      high: num(sla.high, d.sla_hours.high, SLA_HOURS_MIN, SLA_HOURS_MAX),
      medium: num(sla.medium, d.sla_hours.medium, SLA_HOURS_MIN, SLA_HOURS_MAX),
      low: num(sla.low, d.sla_hours.low, SLA_HOURS_MIN, SLA_HOURS_MAX),
    },
    features: {
      share_links: feats.share_links === true,
      report_schedules: feats.report_schedules === true,
      tenant_intake: feats.tenant_intake === true,
    },
    report_due_day: Math.round(num(o.report_due_day, d.report_due_day, 1, 28)),
    distribution_from:
      typeof o.distribution_from === 'string' && o.distribution_from.trim() ? o.distribution_from.trim().slice(0, 64) : null,
  };
}
```

`src/lib/orgSettings.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_ORG_SETTINGS, parseOrgSettings } from './orgSettings';

describe('parseOrgSettings', () => {
  it('returns the defaults for null, {}, arrays and garbage', () => {
    for (const raw of [null, undefined, {}, [], 'x', 42]) expect(parseOrgSettings(raw)).toEqual(DEFAULT_ORG_SETTINGS);
  });
  it('keeps valid overrides and fills the rest', () => {
    const s = parseOrgSettings({ sla_hours: { critical: 2 }, features: { share_links: true }, report_due_day: 10 });
    expect(s.sla_hours).toEqual({ critical: 2, high: 24, medium: 72, low: 168 });
    expect(s.features).toEqual({ share_links: true, report_schedules: false, tenant_intake: false });
    expect(s.report_due_day).toBe(10);
  });
  it('clamps and coerces', () => {
    const s = parseOrgSettings({ sla_hours: { critical: '0', low: 99999, medium: 'abc' }, report_due_day: 31.6, features: { tenant_intake: 'yes' } });
    expect(s.sla_hours.critical).toBe(1);
    expect(s.sla_hours.low).toBe(8760);
    expect(s.sla_hours.medium).toBe(72);
    expect(s.report_due_day).toBe(28);
    expect(s.features.tenant_intake).toBe(false);
  });
  it('trims distribution_from and nulls an empty one', () => {
    expect(parseOrgSettings({ distribution_from: '  Ops Team  ' }).distribution_from).toBe('Ops Team');
    expect(parseOrgSettings({ distribution_from: '   ' }).distribution_from).toBeNull();
  });
});
```

- [ ] **Step 2: `src/hooks/useOrgSettings.ts`**

```ts
/**
 * The organization's settings object (organizations.settings, R4a). One row per project, so the query has no
 * arguments. `save` writes the whole object: the editors are admin-only and rare, so last-write-wins is fine.
 * `useFeature` answers false while loading — a dark feature must never flash on.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { DEFAULT_ORG_SETTINGS, parseOrgSettings, type FeatureName, type OrgSettings } from '@/lib/orgSettings';

export const ORG_SETTINGS_KEY = ['org-settings'] as const;

interface OrgSettingsData { id: string | null; settings: OrgSettings }

export function useOrgSettings() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ORG_SETTINGS_KEY,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OrgSettingsData> => {
      const { data, error } = await supabase.from('organizations').select('*').limit(1).maybeSingle();
      if (error) throw error;
      // organizations.settings is not yet in the generated types; regenerate after the migration ships.
      const row = data as (typeof data & { settings?: unknown }) | null;
      return { id: row?.id ?? null, settings: parseOrgSettings(row?.settings) };
    },
  });

  const mutation = useMutation({
    mutationFn: async (next: OrgSettings): Promise<OrgSettings> => {
      const id = query.data?.id;
      if (!id) throw new Error('No organization row to save settings on.');
      // organizations.settings is not yet in the generated types; regenerate after the migration ships.
      const patch = { settings: next, updated_at: new Date().toISOString() } as unknown as TablesUpdate<'organizations'>;
      const { error } = await supabase.from('organizations').update(patch).eq('id', id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData<OrgSettingsData>(ORG_SETTINGS_KEY, (prev) => ({ id: prev?.id ?? null, settings: next }));
    },
  });

  return {
    settings: query.data?.settings ?? DEFAULT_ORG_SETTINGS,
    organizationId: query.data?.id ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    save: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}

export function useFeature(name: FeatureName): boolean {
  const { settings, isLoading } = useOrgSettings();
  return !isLoading && settings.features[name];
}
```

`src/hooks/useOrgSettings.test.ts` (chain-mock pattern from `useBuildingScore.test.ts`, methods `select, limit, maybeSingle, update, eq`):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: { message: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & { then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown };
const state = vi.hoisted(() => ({
  queries: [] as { table: string; calls: RecordedCall[] }[],
  result: (() => ({ data: null, error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string): Chain => {
      const own: RecordedCall[] = [];
      const chain = {} as Chain;
      for (const m of ['select', 'limit', 'maybeSingle', 'update', 'eq']) chain[m] = (...args: unknown[]) => { own.push({ table, method: m, args }); return chain; };
      chain.then = (resolve, reject) => { state.queries.push({ table, calls: own }); return Promise.resolve(state.result(table, own)).then(resolve, reject); };
      return chain;
    },
  },
}));

import { useOrgSettings, useFeature } from './useOrgSettings';
import { DEFAULT_ORG_SETTINGS } from '@/lib/orgSettings';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

beforeEach(() => { state.queries = []; state.result = () => ({ data: null, error: null }); });

describe('useOrgSettings', () => {
  it('parses the row with defaults and exposes the organization id', async () => {
    state.result = (_t, calls) => calls.some((c) => c.method === 'select')
      ? { data: { id: 'o1', name: 'Org', settings: { report_due_day: 12 } }, error: null } : { data: null, error: null };
    const { result } = renderHook(() => useOrgSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.organizationId).toBe('o1');
    expect(result.current.settings.report_due_day).toBe(12);
    expect(result.current.settings.sla_hours).toEqual(DEFAULT_ORG_SETTINGS.sla_hours);
  });
  it('save writes the whole object to the organization row and updates the cache', async () => {
    state.result = (_t, calls) => calls.some((c) => c.method === 'select')
      ? { data: { id: 'o1', settings: {} }, error: null } : { data: null, error: null };
    const { result } = renderHook(() => useOrgSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const next = { ...DEFAULT_ORG_SETTINGS, report_due_day: 3 };
    await act(async () => { await result.current.save(next); });
    const upd = state.queries.find((q) => q.calls.some((c) => c.method === 'update'))!;
    expect((upd.calls.find((c) => c.method === 'update')!.args[0] as { settings: unknown }).settings).toEqual(next);
    expect(upd.calls.find((c) => c.method === 'eq')!.args).toEqual(['id', 'o1']);
    expect(result.current.settings.report_due_day).toBe(3);
  });
  it('useFeature is false while loading and true once the flag is on', async () => {
    state.result = () => ({ data: { id: 'o1', settings: { features: { share_links: true } } }, error: null });
    const { result } = renderHook(() => useFeature('share_links'), { wrapper });
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });
});
```

- [ ] **Step 3: Run + commit the settings API first** (Task 4 depends on it):
```bash
npx vitest run src/lib/orgSettings.test.ts src/hooks/useOrgSettings.test.ts
git add src/lib/orgSettings.ts src/lib/orgSettings.test.ts src/hooks/useOrgSettings.ts src/hooks/useOrgSettings.test.ts
git commit -m "Add the org settings API: parsed defaults, useOrgSettings, useFeature

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: `src/hooks/useOrganization.ts`** — the base table is no longer anon-readable, so a signed-out reader (login screen branding) takes the view. Replace the file:

```ts
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Organization = Tables<'organizations'>;
// organization_branding (id, name, logo_url, primary_color) is a view for signed-out branding; it is not yet in
// the generated types — regenerate after the migration ships.
type BrandingRow = Pick<Organization, 'id' | 'name' | 'logo_url' | 'primary_color'>;
interface BrandingClient {
  select(cols: string): { limit(n: number): { maybeSingle(): Promise<{ data: BrandingRow | null; error: { message: string } | null }> } };
}

export function useOrganization() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrganization = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data, error } = await supabase.from('organizations').select('*').limit(1).maybeSingle();
          if (error) throw error;
          setOrganization(data);
        } else {
          const { data, error } = await (supabase.from('organization_branding' as 'organizations') as unknown as BrandingClient)
            .select('id,name,logo_url,primary_color').limit(1).maybeSingle();
          if (error) throw error;
          setOrganization(data ? ({ ...data, email: null, created_at: null, updated_at: null } as Organization) : null);
        }
      } catch (error) {
        if (import.meta.env.DEV) console.error('Error fetching organization:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchOrganization();

    // Signing in swaps the branding view for the full row (and its settings); signing out swaps back.
    const { data: auth } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') void fetchOrganization();
    });

    const channel = supabase
      .channel('organization-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'organizations' }, (payload) => {
        if (payload.new) setOrganization(payload.new as Organization);
      })
      .subscribe();

    return () => {
      auth.subscription.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, []);

  return { organization, loading };
}
```

`src/hooks/useOrganization.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ session: null as null | { user: { id: string } }, tables: [] as string[] }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: (table: string) => {
      state.tables.push(table);
      const row = table === 'organizations'
        ? { id: 'o1', name: 'Org', email: 'x@y.z', logo_url: null, primary_color: '#111111', created_at: null, updated_at: null }
        : { id: 'o1', name: 'Org', logo_url: null, primary_color: '#111111' };
      const chain = { select: () => chain, limit: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
      return chain;
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  },
}));

import { useOrganization } from './useOrganization';

beforeEach(() => { state.tables = []; state.session = null; });

describe('useOrganization', () => {
  it('reads organization_branding when signed out', async () => {
    const { result } = renderHook(() => useOrganization());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(state.tables).toEqual(['organization_branding']);
    expect(result.current.organization?.primary_color).toBe('#111111');
    expect(result.current.organization?.email).toBeNull();
  });
  it('reads organizations when signed in', async () => {
    state.session = { user: { id: 'u1' } };
    const { result } = renderHook(() => useOrganization());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(state.tables).toEqual(['organizations']);
    expect(result.current.organization?.email).toBe('x@y.z');
  });
});
```
Also run `grep -rn "useOrganization\b" src --include=*.tsx --include=*.ts -l` and confirm every consumer is inside the signed-in shell except none — if any renders on `/auth`, it now gets the four branding columns and `email: null`, which every consumer already tolerates (`organization?.name || 'Building Ops'`).

- [ ] **Step 5: Settings cards.** `src/components/settings/ReportDueDayCard.tsx`:

```tsx
/**
 * Settings → Operations: the day of the following month by which a monthly report must be approved.
 * Read by R4b's schedules and reminders; in R4a it only needs to be captured.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOrgSettings } from '@/hooks/useOrgSettings';

export function ReportDueDayCard({ canEdit }: { canEdit: boolean }) {
  const { settings, isLoading, save, isSaving } = useOrgSettings();
  const [day, setDay] = useState(String(settings.report_due_day));
  useEffect(() => { setDay(String(settings.report_due_day)); }, [settings.report_due_day]);

  const n = Number(day);
  const valid = Number.isInteger(n) && n >= 1 && n <= 28;

  const onSave = async () => {
    if (!valid) return;
    try {
      await save({ ...settings, report_due_day: n });
      toast.success('Report due day saved.');
    } catch (e) {
      if (import.meta.env.DEV) console.error('Save report due day failed:', e);
      toast.error('Could not save the report due day.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Report due day</CardTitle>
        <CardDescription>Monthly reports are due, approved, by this day of the following month.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs space-y-2">
          <Label htmlFor="report-due-day">Day of the following month (1–28)</Label>
          <Input id="report-due-day" type="number" inputMode="numeric" min={1} max={28} className="h-11" value={day}
            onChange={(e) => setDay(e.target.value)} disabled={!canEdit || isLoading} aria-invalid={!valid} />
          {!valid && <p className="text-xs text-destructive">Enter a whole number from 1 to 28.</p>}
        </div>
        <Hint>September's OPS and CM reports are due by this day in October. Reminders (a later release) count back from it.</Hint>
        {canEdit && (
          <Button className="min-h-11" onClick={onSave} disabled={!valid || isSaving || isLoading}>{isSaving ? 'Saving…' : 'Save'}</Button>
        )}
      </CardContent>
    </Card>
  );
}
```

`src/components/settings/FeatureFlagsCard.tsx`:
```tsx
/**
 * Settings → Operations: org-level feature flags (organizations.settings.features). Share links, report
 * schedules and tenant intake ship dark in R4b/R4c and stay off until an admin switches them on here.
 */
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useOrgSettings } from '@/hooks/useOrgSettings';
import { FEATURE_LABELS, FEATURE_NAMES, type FeatureName } from '@/lib/orgSettings';

export function FeatureFlagsCard({ canEdit }: { canEdit: boolean }) {
  const { settings, isLoading, save, isSaving } = useOrgSettings();

  const toggle = async (name: FeatureName, on: boolean) => {
    try {
      await save({ ...settings, features: { ...settings.features, [name]: on } });
      toast.success(`${FEATURE_LABELS[name].label} ${on ? 'enabled' : 'disabled'}.`);
    } catch (e) {
      if (import.meta.env.DEV) console.error('Save feature flag failed:', e);
      toast.error('Could not save that setting.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Features</CardTitle>
        <CardDescription>Switch on the features this organization uses.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {FEATURE_NAMES.map((name) => (
          <div key={name} className="flex min-h-11 items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor={`feature-${name}`} className="font-medium">{FEATURE_LABELS[name].label}</Label>
              <p className="text-xs text-muted-foreground">{FEATURE_LABELS[name].description}</p>
            </div>
            <Switch id={`feature-${name}`} checked={settings.features[name]} disabled={!canEdit || isLoading || isSaving}
              onCheckedChange={(on) => void toggle(name, on)} aria-label={FEATURE_LABELS[name].label} />
          </div>
        ))}
        <Hint>These features arrive in later releases; the switches are here now so they can be turned on the day they land.</Hint>
      </CardContent>
    </Card>
  );
}
```

Tests — `src/components/settings/FeatureFlagsCard.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DEFAULT_ORG_SETTINGS } from '@/lib/orgSettings';

const hook = vi.hoisted(() => ({ save: vi.fn(async (n: unknown) => n), settings: DEFAULT_ORG_SETTINGS, isLoading: false, isSaving: false }));
vi.mock('@/hooks/useOrgSettings', () => ({ useOrgSettings: () => ({ settings: hook.settings, isLoading: hook.isLoading, isSaving: hook.isSaving, save: hook.save, organizationId: 'o1', isError: false }) }));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: () => {} }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { FeatureFlagsCard } from './FeatureFlagsCard';

beforeEach(() => { hook.save.mockClear(); hook.settings = DEFAULT_ORG_SETTINGS; });

describe('FeatureFlagsCard', () => {
  it('renders one switch per feature, off by default', () => {
    render(<FeatureFlagsCard canEdit />);
    expect(screen.getAllByRole('switch')).toHaveLength(3);
    expect(screen.getByRole('switch', { name: 'Share links' })).toHaveAttribute('aria-checked', 'false');
  });
  it('saves the whole settings object with the toggled flag', async () => {
    render(<FeatureFlagsCard canEdit />);
    fireEvent.click(screen.getByRole('switch', { name: 'Tenant intake' }));
    await waitFor(() => expect(hook.save).toHaveBeenCalledTimes(1));
    expect(hook.save.mock.calls[0][0]).toEqual({ ...DEFAULT_ORG_SETTINGS, features: { ...DEFAULT_ORG_SETTINGS.features, tenant_intake: true } });
  });
  it('is read-only without canEdit', () => {
    render(<FeatureFlagsCard canEdit={false} />);
    for (const s of screen.getAllByRole('switch')) expect(s).toBeDisabled();
  });
});
```
`src/components/settings/ReportDueDayCard.test.tsx` (same mocks): renders the current day; typing `0` shows the validation line and disables Save; typing `12` and clicking Save calls `save` with `report_due_day: 12`; no Save button when `canEdit` is false.

- [ ] **Step 6: `src/pages/Settings.tsx`.** Imports: add `SlidersHorizontal` to the lucide import; add
```ts
import { SlaSettingsCard } from '@/components/settings/SlaSettingsCard';
import { ReportDueDayCard } from '@/components/settings/ReportDueDayCard';
import { FeatureFlagsCard } from '@/components/settings/FeatureFlagsCard';
```
In `<TabsList>` after the Branding trigger:
```tsx
          {isAdminOrManager && (
            <TabsTrigger value="operations">
              <SlidersHorizontal className="h-4 w-4 mr-2" />
              Operations
            </TabsTrigger>
          )}
```
After the Branding `TabsContent`:
```tsx
        {isAdminOrManager && (
          <TabsContent value="operations" className="space-y-6">
            <SlaSettingsCard canEdit={isAdmin} />
            <ReportDueDayCard canEdit={isAdmin} />
            <FeatureFlagsCard canEdit={isAdmin} />
          </TabsContent>
        )}
```
Do this step LAST (after Step 11), once `git log --oneline -- src/components/settings/SlaSettingsCard.tsx` shows Task 4's commit (poll: `until git log --oneline -- src/components/settings/SlaSettingsCard.tsx | grep -q .; do sleep 30; done`).

- [ ] **Step 7: `src/lib/reportCoverage.ts`** (pure)

```ts
/**
 * Coverage of the portfolio for one period: which report types each building owes, and what state each
 * is in. Pure so the grid derivation is unit-tested; the page feeds it the reports list and the buildings
 * (with their report_types) it already loads.
 */
import type { ReportType } from '@/integrations/supabase/fortress-db';
import { todayInOperatingTz } from '@/lib/myWork';

export const COVERAGE_TYPES: ReportType[] = ['ops_monthly', 'cm_monthly', 'annual_inspection'];
export const COVERAGE_TYPE_LABELS: Record<ReportType, string> = { ops_monthly: 'OPS', cm_monthly: 'CM', annual_inspection: 'Annual' };

/** `na` = the building does not owe this type (buildings.report_types). */
export type CoverageStatus = 'missing' | 'na' | 'draft' | 'submitted' | 'reviewed' | 'approved' | 'rejected';
/** Display order for the header counts; `na` is never counted. */
export const COVERAGE_STATUS_ORDER: CoverageStatus[] = ['approved', 'reviewed', 'submitted', 'rejected', 'draft', 'missing'];

export interface CoverageBuilding { id: string; name: string; report_types: string[] }
export interface CoverageReport { id: string; building_id: string; report_type: string; report_period: string; status: string }
export interface CoverageCell { status: CoverageStatus; reportId: string | null }
export interface CoverageRow { buildingId: string; name: string; cells: Record<ReportType, CoverageCell> }
export type CoverageSummary = Record<ReportType, Record<CoverageStatus, number>>;

/** First of the previous month, `YYYY-MM-01`, in the operating timezone. */
export function previousMonthPeriod(today: string = todayInOperatingTz()): string {
  const [y, m] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}

/** Annual reports cover a year: any period in the same calendar year counts. Monthly types match the month. */
export function periodMatches(type: string, reportPeriod: string, period: string): boolean {
  return type === 'annual_inspection' ? reportPeriod.slice(0, 4) === period.slice(0, 4) : reportPeriod.slice(0, 7) === period.slice(0, 7);
}

const RANK: Record<string, number> = { approved: 5, reviewed: 4, submitted: 3, rejected: 2, draft: 1 };

function emptySummary(): CoverageSummary {
  const zero = (): Record<CoverageStatus, number> => ({ missing: 0, na: 0, draft: 0, submitted: 0, reviewed: 0, approved: 0, rejected: 0 });
  return { ops_monthly: zero(), cm_monthly: zero(), annual_inspection: zero() };
}

export function buildCoverage(buildings: CoverageBuilding[], reports: CoverageReport[], period: string): { rows: CoverageRow[]; summary: CoverageSummary } {
  const summary = emptySummary();
  const rows = buildings.map((b): CoverageRow => {
    const cells = {} as Record<ReportType, CoverageCell>;
    for (const type of COVERAGE_TYPES) {
      if (!b.report_types.includes(type)) {
        cells[type] = { status: 'na', reportId: null };
        continue;
      }
      // The most advanced matching report wins (annual can have several in a year).
      const best = reports
        .filter((r) => r.building_id === b.id && r.report_type === type && periodMatches(type, r.report_period, period))
        .sort((a, c) => (RANK[c.status] ?? 0) - (RANK[a.status] ?? 0))[0];
      const status: CoverageStatus = best && best.status in RANK ? (best.status as CoverageStatus) : 'missing';
      cells[type] = { status, reportId: best?.id ?? null };
      summary[type][status] += 1;
    }
    return { buildingId: b.id, name: b.name, cells };
  });
  return { rows, summary };
}

/** "31 approved · 4 submitted · 12 missing" — zero counts and n/a omitted. */
export function summaryLine(counts: Record<CoverageStatus, number>): string {
  return COVERAGE_STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${s}`).join(' · ') || 'nothing due';
}
```

`src/lib/reportCoverage.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildCoverage, periodMatches, previousMonthPeriod, summaryLine } from './reportCoverage';

const b = (id: string, types = ['ops_monthly', 'cm_monthly']) => ({ id, name: id.toUpperCase(), report_types: types });
const r = (id: string, building_id: string, report_type: string, report_period: string, status: string) => ({ id, building_id, report_type, report_period, status });

describe('previousMonthPeriod', () => {
  it('steps back one month, across a year boundary', () => {
    expect(previousMonthPeriod('2026-09-10')).toBe('2026-08-01');
    expect(previousMonthPeriod('2026-01-15')).toBe('2025-12-01');
  });
});

describe('periodMatches', () => {
  it('matches monthly types on the month and annual on the year', () => {
    expect(periodMatches('ops_monthly', '2026-08-01', '2026-08-01')).toBe(true);
    expect(periodMatches('ops_monthly', '2026-07-01', '2026-08-01')).toBe(false);
    expect(periodMatches('annual_inspection', '2026-03-01', '2026-08-01')).toBe(true);
    expect(periodMatches('annual_inspection', '2025-12-01', '2026-08-01')).toBe(false);
  });
});

describe('buildCoverage', () => {
  it('marks missing, n/a and the most advanced report per cell, and counts per type', () => {
    const { rows, summary } = buildCoverage(
      [b('a'), b('b', ['ops_monthly', 'cm_monthly', 'annual_inspection']), b('c', ['ops_monthly'])],
      [
        r('r1', 'a', 'ops_monthly', '2026-08-01', 'approved'),
        r('r2', 'b', 'ops_monthly', '2026-08-01', 'draft'),
        r('r3', 'b', 'annual_inspection', '2026-02-01', 'submitted'),
        r('r4', 'b', 'annual_inspection', '2026-05-01', 'approved'),
        r('r5', 'c', 'ops_monthly', '2026-07-01', 'approved'),   // wrong month
      ],
      '2026-08-01',
    );
    expect(rows[0].cells.ops_monthly).toEqual({ status: 'approved', reportId: 'r1' });
    expect(rows[0].cells.cm_monthly).toEqual({ status: 'missing', reportId: null });
    expect(rows[0].cells.annual_inspection).toEqual({ status: 'na', reportId: null });
    expect(rows[1].cells.annual_inspection).toEqual({ status: 'approved', reportId: 'r4' });
    expect(rows[2].cells.ops_monthly.status).toBe('missing');
    expect(rows[2].cells.cm_monthly.status).toBe('na');
    expect(summary.ops_monthly).toMatchObject({ approved: 1, draft: 1, missing: 1 });
    expect(summary.cm_monthly).toMatchObject({ missing: 2, na: 0 });
    expect(summary.annual_inspection).toMatchObject({ approved: 1 });
  });
  it('summaryLine omits zeros and n/a', () => {
    expect(summaryLine({ missing: 12, na: 3, draft: 0, submitted: 4, reviewed: 0, approved: 31, rejected: 0 })).toBe('31 approved · 4 submitted · 12 missing');
    expect(summaryLine({ missing: 0, na: 0, draft: 0, submitted: 0, reviewed: 0, approved: 0, rejected: 0 })).toBe('nothing due');
  });
});
```

- [ ] **Step 8: `useDiscardDraft` + `useSetBuildingReportTypes`** — append to `src/hooks/useFortressReports.ts`:

```ts
/** Admin only: deletes a draft that holds no content (delete_empty_report, 2026-09-14_01). */
export function useDiscardDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reportId: string): Promise<string> => {
      // delete_empty_report is not yet in the generated types; regenerate after the migration ships.
      const { error } = await (fdb as unknown as {
        rpc(fn: string, args: Record<string, string>): Promise<{ error: { message: string } | null }>;
      }).rpc('delete_empty_report', { p_report: reportId });
      if (error) throw error;
      return reportId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: REPORTS_KEY });
      toast.success('Draft discarded.');
    },
    onError: (e: unknown) => {
      if (import.meta.env.DEV) console.error('Discard draft failed:', e);
      const msg = (e as { message?: string })?.message ?? '';
      toast.error(
        msg.includes('saved row') ? 'This draft has saved content. Clear its sections before discarding it.'
        : msg.includes('PDF versions') ? 'This draft has saved PDF versions and cannot be discarded.'
        : msg.includes('admin only') ? 'Only an admin can discard a draft.'
        : msg.includes('only a draft') ? 'Only a draft can be discarded.'
        : 'Could not discard the draft.',
      );
    },
  });
}

/** Which report types a building owes (buildings.report_types); drives "missing" on the coverage grid. */
export function useSetBuildingReportTypes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ buildingId, reportTypes }: { buildingId: string; reportTypes: ReportType[] }): Promise<void> => {
      // buildings.report_types is not yet in the generated types; regenerate after the migration ships.
      const { error } = await fdb.from('buildings').update({ report_types: reportTypes } as unknown as FUpdate<'buildings'>).eq('id', buildingId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['buildings-for-reports'] }); },
    onError: (e: unknown) => {
      if (import.meta.env.DEV) console.error('Set report types failed:', e);
      toast.error('Could not update the report types for that building.');
    },
  });
}
```
Add `FUpdate` to the existing `fortress-db` import on line 15. In `useFortressReports.test.ts`, extend the mock: add `rpc: vi.fn(async () => ({ error: null }))` to `state` (in the `vi.hoisted` object) and return `{ supabase: { from, rpc: (...a: unknown[]) => state.rpc(...a) } }`; then:
```ts
describe('useDiscardDraft', () => {
  it('calls delete_empty_report with the id and invalidates the list', async () => {
    const { useDiscardDraft } = await import('./useFortressReports');
    const { result } = renderHook(() => useDiscardDraft(), { wrapper });
    await act(async () => { await result.current.mutateAsync('rep1'); });
    expect(state.rpc).toHaveBeenCalledWith('delete_empty_report', { p_report: 'rep1' });
    expect(toastMock.success).toHaveBeenCalledWith('Draft discarded.');
  });
  it('maps the "saved rows" refusal to plain copy', async () => {
    state.rpc.mockResolvedValueOnce({ error: { message: 'delete_empty_report: this draft has 3 saved row(s); clear its sections before discarding it' } });
    const { useDiscardDraft } = await import('./useFortressReports');
    const { result } = renderHook(() => useDiscardDraft(), { wrapper });
    await act(async () => { await result.current.mutateAsync('rep1').catch(() => {}); });
    expect(toastMock.error).toHaveBeenCalledWith('This draft has saved content. Clear its sections before discarding it.');
  });
});
```
(`fdb` is the same client object re-typed, so mocking `supabase.rpc` covers `fdb.rpc`.)

- [ ] **Step 9: `CoverageGrid.tsx`**

```tsx
/**
 * Portfolio coverage for one period: rows = buildings, columns = report types, cell = status chip.
 * Admins can mark which types a building owes (so "missing" is honest) and discard an empty draft.
 */
import { MoreHorizontal, Trash2 } from 'lucide-react';
import type { ReportType } from '@/integrations/supabase/fortress-db';
import { REPORT_STATUS_VARIANT, formatPeriodLabel } from '@/lib/fortressReports';
import { formatBuildingName } from '@/lib/buildingName';
import { COVERAGE_TYPES, COVERAGE_TYPE_LABELS, summaryLine, type CoverageRow, type CoverageSummary } from '@/lib/reportCoverage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface CoverageGridProps {
  period: string;
  rows: CoverageRow[];
  summary: CoverageSummary;
  isAdmin: boolean;
  onOpenReport: (reportId: string) => void;
  onOpenBuilding: (buildingId: string) => void;
  onDiscardDraft: (reportId: string) => void;
  onSetReportTypes: (buildingId: string, types: ReportType[]) => void;
  discarding?: boolean;
}

export function CoverageGrid({ period, rows, summary, isAdmin, onOpenReport, onOpenBuilding, onDiscardDraft, onSetReportTypes, discarding }: CoverageGridProps) {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">Coverage — {formatPeriodLabel(period)}</CardTitle>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          {COVERAGE_TYPES.map((t) => (
            <span key={t} data-testid={`summary-${t}`}><span className="font-medium text-foreground">{COVERAGE_TYPE_LABELS[t]}:</span> {summaryLine(summary[t])}</span>
          ))}
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Building</TableHead>
              {COVERAGE_TYPES.map((t) => <TableHead key={t}>{COVERAGE_TYPE_LABELS[t]}</TableHead>)}
              {isAdmin && <TableHead className="w-12"><span className="sr-only">Report types</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const owed = COVERAGE_TYPES.filter((t) => row.cells[t].status !== 'na');
              return (
                <TableRow key={row.buildingId}>
                  <TableCell className="font-medium">{formatBuildingName(row.name)}</TableCell>
                  {COVERAGE_TYPES.map((t) => {
                    const cell = row.cells[t];
                    if (cell.status === 'na') {
                      return <TableCell key={t}><span className="text-muted-foreground" title="Not required for this building">—</span></TableCell>;
                    }
                    return (
                      <TableCell key={t}>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="inline-flex min-h-11 items-center rounded-md px-1 text-left"
                            aria-label={`${COVERAGE_TYPE_LABELS[t]} ${cell.status} for ${row.name}`}
                            onClick={() => (cell.reportId ? onOpenReport(cell.reportId) : onOpenBuilding(row.buildingId))}
                          >
                            <Badge variant={cell.status === 'missing' ? 'outline' : REPORT_STATUS_VARIANT[cell.status] ?? 'outline'}
                              className={cell.status === 'missing' ? 'border-dashed text-muted-foreground capitalize' : 'capitalize'}>
                              {cell.status}
                            </Badge>
                          </button>
                          {isAdmin && cell.status === 'draft' && cell.reportId && (
                            <Button variant="ghost" size="icon" className="h-11 w-11" title="Discard this empty draft"
                              aria-label={`Discard ${COVERAGE_TYPE_LABELS[t]} draft for ${row.name}`} disabled={discarding}
                              onClick={() => onDiscardDraft(cell.reportId!)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    );
                  })}
                  {isAdmin && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Report types for ${row.name}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>This building owes</DropdownMenuLabel>
                          {COVERAGE_TYPES.map((t) => (
                            <DropdownMenuCheckboxItem key={t} className="min-h-11" checked={owed.includes(t)}
                              onCheckedChange={(on) => onSetReportTypes(row.buildingId, on ? [...owed, t] : owed.filter((x) => x !== t))}>
                              {COVERAGE_TYPE_LABELS[t]}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

`CoverageGrid.test.tsx`: build `rows`/`summary` with `buildCoverage` from two buildings and two reports (one approved, one draft); assert the summary line text for OPS (`screen.getByTestId('summary-ops_monthly')` contains `1 approved · 1 draft`), clicking the `missing` chip calls `onOpenBuilding` with the building id, clicking the approved chip calls `onOpenReport` with `r1`, the Discard button exists only for the draft cell and only when `isAdmin`, and an `na` cell renders `—`. Radix dropdown is left untested (jsdom).

- [ ] **Step 10: `src/pages/FortressReports.tsx`.** Changes:
  1. Imports: `useAuth` from `@/contexts/AuthContext`; `CoverageGrid`; `buildCoverage, previousMonthPeriod` from `@/lib/reportCoverage`; `useDiscardDraft, useSetBuildingReportTypes` alongside `useFortressReports`; `type ReportType` already imported.
  2. Buildings query: `select('id, name, report_types')` — cast the builder call: `supabase.from('buildings').select('id, name, report_types' as 'id, name')` with the comment `// buildings.report_types is not yet in the generated types; regenerate after the migration ships.`, and type the result as `{ id: string; name: string; report_types?: string[] | null }[]`.
  3. `const [period, setPeriod] = useState<string>(previousMonthPeriod());` and `const periodOptions = useMemo(() => [...new Set([previousMonthPeriod(), ...periods])].sort().reverse(), [periods]);` used by the Select (so the default is offered even when no report exists for it).
  4. Replace the whole `missing` memo + card with:
```tsx
  const { isAdmin } = useAuth();
  const discard = useDiscardDraft();
  const setTypes = useSetBuildingReportTypes();
  const coverage = useMemo(() => {
    if (period === ALL || !buildings?.length) return null;
    return buildCoverage(
      buildings.map((b) => ({ id: b.id, name: b.name, report_types: b.report_types ?? ['ops_monthly', 'cm_monthly'] })),
      (reports ?? []).map((r) => ({ id: r.id, building_id: r.building_id, report_type: r.report_type, report_period: r.report_period, status: r.status })),
      period,
    );
  }, [buildings, reports, period]);
```
and, where the missing card was:
```tsx
      {coverage && (
        <CoverageGrid
          period={period}
          rows={coverage.rows}
          summary={coverage.summary}
          isAdmin={isAdmin}
          discarding={discard.isPending}
          onOpenReport={(id) => navigate(`/reports/fortress/${id}`)}
          onOpenBuilding={(id) => navigate(`/buildings/${id}?tab=reports`)}
          onDiscardDraft={(id) => { if (window.confirm('Discard this empty draft? Only a draft with no saved content can be discarded.')) discard.mutate(id); }}
          onSetReportTypes={(buildingId, reportTypes) => setTypes.mutate({ buildingId, reportTypes })}
        />
      )}
```
The page's subtitle gains one sentence in a `<Hint>`: "Pick a period to see which buildings still owe a report." (coaching — through `Hint`).

- [ ] **Step 11: Editor "Discard draft".** In `FortressReportEditor.tsx`: import `Trash2` (line 5), `useDiscardDraft` (line 21 import list), destructure `isAdmin` from `useAuth()` (line 34), `const discard = useDiscardDraft();` after `lifecycle`. In the header actions `div` (line 296, before the Export button):
```tsx
          {status === 'draft' && isAdmin && (
            <Button variant="ghost" size="sm" disabled={discard.isPending}
              onClick={() => {
                if (!window.confirm('Discard this empty draft? Only a draft with no saved content can be discarded.')) return;
                discard.mutate(report.id, { onSuccess: () => navigate(`/buildings/${report.building_id}?tab=reports`) });
              }}>
              <Trash2 className="mr-2 h-4 w-4" />
              Discard draft
            </Button>
          )}
```

- [ ] **Step 12: Gate**
```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'orgSettings|useOrgSettings|useOrganization|components/settings|reportCoverage|CoverageGrid|FortressReports|useFortressReports|FortressReportEditor|pages/Settings'
npm run test
```
The grep prints nothing; tests green (baseline 1202 + yours).

- [ ] **Step 13: Commit (two commits; the second waits for Task 4's card)**
```bash
git add src/hooks/useOrganization.ts src/hooks/useOrganization.test.ts src/components/settings/ReportDueDayCard.tsx src/components/settings/ReportDueDayCard.test.tsx src/components/settings/FeatureFlagsCard.tsx src/components/settings/FeatureFlagsCard.test.tsx src/lib/reportCoverage.ts src/lib/reportCoverage.test.ts src/components/reports/fortress/CoverageGrid.tsx src/components/reports/fortress/CoverageGrid.test.tsx src/pages/FortressReports.tsx src/hooks/useFortressReports.ts src/hooks/useFortressReports.test.ts src/components/reports/fortress/FortressReportEditor.tsx
git commit -m "Coverage grid with per-building report types and discard draft; anon-safe branding; settings cards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
until git log --oneline -- src/components/settings/SlaSettingsCard.tsx | grep -q .; do sleep 30; done
# now Step 6, re-run the gate, then:
git add src/pages/Settings.tsx
git commit -m "Mount the Operations settings tab (SLA hours, report due day, feature flags)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Snapshots client — Sparkline, trends, snapshot-first scores, `/trends`, OPS PDF Trend section

**Files:**
- Create: `src/lib/snapshotClient.ts` (the ONE place `building_metrics_daily` / `portfolio_metrics_daily` are cast), `src/lib/trendSeries.ts`, `src/lib/trendSeries.test.ts`, `src/components/ui/sparkline.tsx`, `src/components/ui/sparkline.test.tsx`, `src/hooks/useBuildingTrend.ts`, `src/hooks/useBuildingTrend.test.ts`, `src/hooks/usePortfolioTrend.ts`, `src/hooks/usePortfolioCompliance.test.ts`, `src/pages/Trends.tsx`, `src/pages/Trends.test.tsx`
- Modify: `src/hooks/usePortfolioCompliance.ts` (whole file), `src/hooks/useBuildingScore.ts` (whole file), `src/hooks/useBuildingScore.test.ts` (one new case), `src/components/building/BuildingScoreChips.tsx` (whole file), `src/pages/BuildingDetails.tsx:26,49,184`, `src/pages/Buildings.tsx:33,39,324-327`, `src/App.tsx` (lazy import + route after `/reports/fortress/:id`), `src/components/layout/DashboardLayout.tsx` (nav item after "Building Reports"), `src/lib/fortressReportDoc.ts` (`ReportData.trend`, Trend section after Hazard Log), `src/lib/fortressReportDoc.test.ts` (one new case), `src/lib/fortressReportPdf.ts` (ops branch fetch)

- [ ] **Step 1: `src/lib/snapshotClient.ts`**

```ts
/**
 * Typed access to the R4a snapshot table and its portfolio view. Both are absent from the generated types
 * until the controller regenerates them after the migration ships, so this is the one file that casts —
 * every hook and the PDF read through here and stay cast-free.
 */
import { supabase } from '@/integrations/supabase/client';
import { todayInOperatingTz } from '@/lib/myWork';

export interface SnapshotRow {
  building_id: string;
  day: string;
  compliance_pct: number | string | null;
  critical_pct: number | string | null;
  inspection_pass_pct: number | string | null;
  compliance_period: string | null;
  ohs_open_nc: number | null;
  ppm_done_pct: number | string | null;
  task_completion_30d_pct: number | string | null;
  tasks_overdue: number | null;
  tasks_due_7d: number | null;
  issues_open: number | null;
  issues_open_by_priority: Record<string, number> | null;
  issues_breached: number | null;
  issues_resolved_30d: number | null;
  docs_expiring_30: number | null;
  docs_expiring_60: number | null;
  docs_expiring_90: number | null;
  docs_expired: number | null;
  assets_overdue: number | null;
  report_state: Record<string, { period: string; status: string }> | null;
  reconstructed: boolean;
  computed_at: string;
}

export interface PortfolioRow {
  day: string;
  buildings: number;
  compliance_avg: number | string | null;
  critical_avg: number | string | null;
  inspection_pass_avg: number | string | null;
  ppm_done_avg: number | string | null;
  task_completion_avg: number | string | null;
  tasks_overdue: number | null;
  tasks_due_7d: number | null;
  issues_open: number | null;
  issues_breached: number | null;
  issues_resolved_30d: number | null;
  docs_expiring_30: number | null;
  docs_expiring_60: number | null;
  docs_expiring_90: number | null;
  docs_expired: number | null;
  assets_overdue: number | null;
  contractor_docs_expiring_30: number | null;
  contractor_docs_expiring_60: number | null;
  contractor_docs_expiring_90: number | null;
  contractor_docs_expired: number | null;
  reconstructed: boolean;
}

export interface PgErrLike { message: string; code?: string }
export interface RowBuilder<Row> extends PromiseLike<{ data: Row[] | null; error: PgErrLike | null }> {
  eq(column: string, value: string): RowBuilder<Row>;
  in(column: string, values: string[]): RowBuilder<Row>;
  gte(column: string, value: string): RowBuilder<Row>;
  lte(column: string, value: string): RowBuilder<Row>;
  order(column: string, opts?: { ascending: boolean }): RowBuilder<Row>;
  limit(n: number): RowBuilder<Row>;
  range(from: number, to: number): RowBuilder<Row>;
}
interface SnapshotClient {
  from(table: 'building_metrics_daily'): { select(columns: '*'): RowBuilder<SnapshotRow> };
  from(table: 'portfolio_metrics_daily'): { select(columns: '*'): RowBuilder<PortfolioRow> };
}
// building_metrics_daily and portfolio_metrics_daily are not yet in the generated types; regenerate after the
// migration ships and replace this cast with the typed client.
const client = supabase as unknown as SnapshotClient;

export function snapshots(): RowBuilder<SnapshotRow> { return client.from('building_metrics_daily').select('*'); }
export function portfolioSnapshots(): RowBuilder<PortfolioRow> { return client.from('portfolio_metrics_daily').select('*'); }

/** `YYYY-MM-DD` n days before today in the operating timezone. */
export function daysAgo(n: number, today: string = todayInOperatingTz()): string {
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/** The cron writes at 05:00 SAST; anything older than this many days means it has not run and live data wins. */
export const SNAPSHOT_FRESH_DAYS = 3;

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** "05:02, 10 Sep" in the operating timezone, for the "as of" caption. */
export function formatAsOf(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
}
```

- [ ] **Step 2: `src/lib/trendSeries.ts`** (pure)

```ts
/**
 * Pure shaping of snapshot rows into series, monthly points (PDF) and a change leaderboard (/trends).
 * Rows are the SnapshotRow shape, ordered by day ascending as the hooks return them.
 */
import { num, type SnapshotRow } from '@/lib/snapshotClient';

export type SeriesKey = 'compliance_pct' | 'task_completion_30d_pct' | 'issues_open' | 'tasks_overdue' | 'docs_expiring_30' | 'issues_breached';

export function series(rows: SnapshotRow[], key: SeriesKey): (number | null)[] {
  return rows.map((r) => num(r[key]));
}

export interface MonthlyPoint {
  /** `YYYY-MM` */
  month: string;
  compliancePct: number | null;
  taskPct: number | null;
  issuesOpen: number | null;
  tasksOverdue: number | null;
}

/** `YYYY-MM` for the month n months before the month of `period` (`YYYY-MM-DD`). */
export function monthShift(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
}

/** Last day of the month containing `period`, `YYYY-MM-DD`. */
export function monthEnd(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * The last snapshot row of each of the `months` months ending with the month of `endPeriod`. A month with no
 * row yields nulls (never a fabricated value), so the PDF says "blank" where the data starts.
 */
export function monthlyPoints(rows: SnapshotRow[], endPeriod: string, months = 12): MonthlyPoint[] {
  const last = new Map<string, SnapshotRow>();
  for (const r of rows) {
    const key = r.day.slice(0, 7);
    const prev = last.get(key);
    if (!prev || prev.day < r.day) last.set(key, r);
  }
  const out: MonthlyPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const month = monthShift(endPeriod, i);
    const r = last.get(month);
    out.push({
      month,
      compliancePct: r ? num(r.compliance_pct) : null,
      taskPct: r ? num(r.task_completion_30d_pct) : null,
      issuesOpen: r ? num(r.issues_open) : null,
      tasksOverdue: r ? num(r.tasks_overdue) : null,
    });
  }
  return out;
}

export interface DeltaRow { buildingId: string; first: number; last: number; delta: number }

/** Change in `key` from the first to the last non-null value per building; buildings with < 2 values are left out. */
export function deltaLeaderboard(byBuilding: Record<string, SnapshotRow[]>, key: SeriesKey): DeltaRow[] {
  const out: DeltaRow[] = [];
  for (const [buildingId, rows] of Object.entries(byBuilding)) {
    const vals = series(rows, key).filter((v): v is number => v !== null);
    if (vals.length < 2) continue;
    const first = vals[0];
    const last = vals[vals.length - 1];
    out.push({ buildingId, first, last, delta: Math.round((last - first) * 10) / 10 });
  }
  return out.sort((a, b) => b.delta - a.delta);
}

/** Index of the first non-reconstructed row, or -1 when every row is a reconstruction. */
export function reconstructionBoundary(rows: { reconstructed: boolean }[]): number {
  return rows.findIndex((r) => !r.reconstructed);
}
```

`src/lib/trendSeries.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { deltaLeaderboard, monthEnd, monthShift, monthlyPoints, reconstructionBoundary, series } from './trendSeries';
import type { SnapshotRow } from './snapshotClient';

const row = (day: string, over: Partial<SnapshotRow> = {}): SnapshotRow => ({
  building_id: 'b1', day, compliance_pct: null, critical_pct: null, inspection_pass_pct: null, compliance_period: null, ohs_open_nc: null,
  ppm_done_pct: null, task_completion_30d_pct: null, tasks_overdue: null, tasks_due_7d: null, issues_open: null, issues_open_by_priority: null,
  issues_breached: null, issues_resolved_30d: null, docs_expiring_30: null, docs_expiring_60: null, docs_expiring_90: null, docs_expired: null,
  assets_overdue: null, report_state: null, reconstructed: false, computed_at: '2026-09-10T03:00:00Z', ...over,
});

describe('trendSeries', () => {
  it('series reads numerics that PostgREST may return as strings', () => {
    expect(series([row('2026-09-01', { compliance_pct: '87.5' }), row('2026-09-02')], 'compliance_pct')).toEqual([87.5, null]);
  });
  it('monthShift and monthEnd', () => {
    expect(monthShift('2026-09-01', 0)).toBe('2026-09');
    expect(monthShift('2026-09-01', 11)).toBe('2025-10');
    expect(monthEnd('2026-02-01')).toBe('2026-02-28');
  });
  it('monthlyPoints takes the last row per month and fills missing months with nulls', () => {
    const pts = monthlyPoints([
      row('2026-08-03', { compliance_pct: 70 }), row('2026-08-30', { compliance_pct: 75, issues_open: 2 }), row('2026-09-10', { compliance_pct: 80 }),
    ], '2026-09-01', 3);
    expect(pts.map((p) => p.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(pts[0]).toMatchObject({ compliancePct: null, issuesOpen: null });
    expect(pts[1]).toMatchObject({ compliancePct: 75, issuesOpen: 2 });
    expect(pts[2].compliancePct).toBe(80);
  });
  it('deltaLeaderboard sorts by change and skips buildings with fewer than two values', () => {
    const board = deltaLeaderboard({
      up: [row('2026-08-01', { compliance_pct: 60 }), row('2026-09-01', { compliance_pct: 72.4 })],
      down: [row('2026-08-01', { compliance_pct: 90 }), row('2026-09-01', { compliance_pct: 85 })],
      one: [row('2026-09-01', { compliance_pct: 50 })],
    }, 'compliance_pct');
    expect(board.map((b) => b.buildingId)).toEqual(['up', 'down']);
    expect(board[0].delta).toBe(12.4);
  });
  it('reconstructionBoundary', () => {
    expect(reconstructionBoundary([{ reconstructed: true }, { reconstructed: true }, { reconstructed: false }])).toBe(2);
    expect(reconstructionBoundary([{ reconstructed: true }])).toBe(-1);
  });
});
```

- [ ] **Step 3: `src/components/ui/sparkline.tsx`**

```tsx
/**
 * Tiny inline SVG line for a header chip: no axes, no library. Null gaps are skipped (the line joins the
 * neighbouring points); fewer than two numeric points renders nothing rather than a dot pretending to be a trend.
 */
import { cn } from '@/lib/utils';

export interface SparklineProps {
  values: (number | null)[];
  width?: number;
  height?: number;
  /** Fixed scale (e.g. 0–100 for percentages); defaults to the data's own min/max. */
  min?: number;
  max?: number;
  className?: string;
  /** Accessible name, e.g. "OHS compliance, last 90 days". */
  label: string;
}

export function Sparkline({ values, width = 72, height = 20, min, max, className, label }: SparklineProps) {
  const pts = values.map((v, i) => (v === null ? null : { i, v })).filter((p): p is { i: number; v: number } => p !== null);
  if (pts.length < 2) return null;
  const lo = min ?? Math.min(...pts.map((p) => p.v));
  const hi = max ?? Math.max(...pts.map((p) => p.v));
  const span = hi - lo || 1;
  const n = values.length - 1 || 1;
  const x = (i: number) => (i / n) * (width - 2) + 1;
  const y = (v: number) => height - 1 - ((v - lo) / span) * (height - 2);
  const d = pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg role="img" aria-label={label} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn('shrink-0 overflow-visible', className)}>
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={1.8} fill="currentColor" />
    </svg>
  );
}
```
`sparkline.test.tsx`: renders an `img` role with the label for `[10, null, 30]`; renders nothing for `[5]` and `[null, null]`; with `min={0} max={100}` the polyline's last y for value 100 is `1.0`.

- [ ] **Step 4: `src/hooks/useBuildingTrend.ts`**

```ts
/**
 * Snapshot series for one building (header sparklines) and for every visible building at once (the
 * buildings grid, one query). Rows come back ascending by day; RLS scopes both to the caller's buildings.
 */
import { useQuery } from '@tanstack/react-query';
import { daysAgo, snapshots, type SnapshotRow } from '@/lib/snapshotClient';
import { series } from '@/lib/trendSeries';

export interface TrendSeries {
  compliance: (number | null)[];
  tasks: (number | null)[];
  issuesOpen: (number | null)[];
  tasksOverdue: (number | null)[];
  docsExpiring30: (number | null)[];
}

export function toSeries(rows: SnapshotRow[]): TrendSeries {
  return {
    compliance: series(rows, 'compliance_pct'),
    tasks: series(rows, 'task_completion_30d_pct'),
    issuesOpen: series(rows, 'issues_open'),
    tasksOverdue: series(rows, 'tasks_overdue'),
    docsExpiring30: series(rows, 'docs_expiring_30'),
  };
}

const EMPTY: TrendSeries = { compliance: [], tasks: [], issuesOpen: [], tasksOverdue: [], docsExpiring30: [] };

export function useBuildingTrend(buildingId: string | undefined, days = 90) {
  const query = useQuery({
    queryKey: ['building-trend', buildingId, days],
    enabled: !!buildingId,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<SnapshotRow[]> => {
      const res = await snapshots().eq('building_id', buildingId!).gte('day', daysAgo(days)).order('day', { ascending: true }).range(0, 999);
      if (res.error) throw res.error;
      return res.data ?? [];
    },
  });
  const rows = query.data ?? [];
  return { rows, series: rows.length ? toSeries(rows) : EMPTY, latest: rows[rows.length - 1] ?? null, isLoading: query.isLoading };
}

export function useBuildingsTrends(days = 30) {
  const query = useQuery({
    queryKey: ['buildings-trends', days],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Record<string, SnapshotRow[]>> => {
      // 47 buildings × 30 days ≈ 1 400 rows; the range keeps PostgREST's 1 000-row default from truncating.
      const res = await snapshots().gte('day', daysAgo(days)).order('day', { ascending: true }).range(0, 19999);
      if (res.error) throw res.error;
      const out: Record<string, SnapshotRow[]> = {};
      for (const r of res.data ?? []) (out[r.building_id] ??= []).push(r);
      return out;
    },
  });
  const byBuilding: Record<string, TrendSeries> = {};
  for (const [id, rows] of Object.entries(query.data ?? {})) byBuilding[id] = toSeries(rows);
  return { rows: query.data ?? {}, byBuilding, isLoading: query.isLoading };
}
```
`useBuildingTrend.test.ts` (chain mock recording table + methods, like `useBuildingScore.test.ts`; methods `select, eq, gte, lte, order, limit, range, in`): `useBuildingTrend('b1', 30)` queries `building_metrics_daily` with `eq('building_id','b1')`, `gte('day', …)`, `order('day', {ascending: true})`, and maps `compliance_pct` strings to numbers; `useBuildingsTrends(30)` groups rows by `building_id`.

- [ ] **Step 5: `src/hooks/useBuildingScore.ts`** — snapshot first, live only when no fresh row:

```ts
/**
 * Lightweight per-building score for the detail header. Since R4a the numbers come from the latest nightly
 * snapshot row (building_metrics_daily: compliance of the latest APPROVED ops report, task completion over
 * the last 30 days) — one read instead of three. When no snapshot is fresh (a building created after the
 * last run, or the cron has not run for SNAPSHOT_FRESH_DAYS), the original live queries answer instead,
 * so the header is never blank because of the cron. Read-through; nothing is written.
 */
import { useQuery } from '@tanstack/react-query';
import { fdb } from '@/integrations/supabase/fortress-db';
import { supabase } from '@/integrations/supabase/client';
import { taskCompletionPct } from '@/lib/buildingScore';
import { todayInOperatingTz } from '@/lib/myWork';
import { SNAPSHOT_FRESH_DAYS, daysAgo, num, snapshots } from '@/lib/snapshotClient';

const WINDOW_DAYS = 30;

export interface BuildingScoreData {
  ohsPct: number | null;
  ohsPeriod: string | null;
  taskPct: number | null;
  /** computed_at of the snapshot row, null on the live path. */
  asOf: string | null;
  source: 'snapshot' | 'live';
}

async function liveScore(bid: string): Promise<BuildingScoreData> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const [repRes, taskRes] = await Promise.all([
    fdb.from('reports').select('id,report_period')
      .eq('building_id', bid).eq('report_type', 'ops_monthly').eq('status', 'approved')
      .order('report_period', { ascending: false }).limit(1),
    supabase.from('task_instances').select('status').eq('building_id', bid)
      .gte('due_date', since).lte('due_date', todayInOperatingTz()),
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
  return { ohsPct, ohsPeriod, taskPct: taskCompletionPct(counts), asOf: null, source: 'live' };
}

export function useBuildingScore(buildingId: string | undefined) {
  const query = useQuery({
    queryKey: ['building-score', buildingId],
    enabled: !!buildingId,
    queryFn: async (): Promise<BuildingScoreData> => {
      const bid = buildingId!;
      const snap = await snapshots().eq('building_id', bid).gte('day', daysAgo(SNAPSHOT_FRESH_DAYS)).order('day', { ascending: false }).limit(1);
      const row = snap.data?.[0];
      if (row) {
        return { ohsPct: num(row.compliance_pct), ohsPeriod: row.compliance_period, taskPct: num(row.task_completion_30d_pct), asOf: row.computed_at, source: 'snapshot' };
      }
      return liveScore(bid);
    },
  });

  return {
    ohsPct: query.data?.ohsPct ?? null,
    ohsPeriod: query.data?.ohsPeriod ?? null,
    taskPct: query.data?.taskPct ?? null,
    asOf: query.data?.asOf ?? null,
    source: query.data?.source ?? null,
    isLoading: query.isLoading,
  };
}
```
`useBuildingScore.test.ts`: the mock's default result is `{ data: [] }`, so every existing case already exercises the live fallback unchanged (the `building_metrics_daily` query records first and returns empty). Add one case:
```ts
  it('reads the latest fresh snapshot row and skips the live queries', async () => {
    state.result = (table) => table === 'building_metrics_daily'
      ? { data: [{ building_id: 'b1', day: '2026-09-10', compliance_pct: '81.3', compliance_period: '2026-08-01', task_completion_30d_pct: 66.7, computed_at: '2026-09-10T03:00:00Z' }], error: null }
      : { data: [], error: null };
    const { result } = renderHook(() => useBuildingScore('b1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({ ohsPct: 81.3, ohsPeriod: '2026-08-01', taskPct: 66.7, source: 'snapshot', asOf: '2026-09-10T03:00:00Z' });
    expect(state.queries.map((q) => q.table)).toEqual(['building_metrics_daily']);
  });
```

- [ ] **Step 6: `src/hooks/usePortfolioCompliance.ts`** — three queries for the whole portfolio instead of 4N+1. Keep `PortfolioComplianceRow` / `PortfolioCompliance` and the `buildingRow()` live function exactly as they are (it becomes the per-building fallback); replace the header comment and `usePortfolioCompliance`:

```ts
/**
 * Portfolio OHS compliance rollup (audit finding H1, spec KPI O9).
 *
 * Since R4a the figures come from the nightly snapshot (building_metrics_daily, D10: compliance of the
 * latest APPROVED ops report) — one query for every building — plus one query for the latest FILED ops
 * report per building so the card can still say "submitted, awaiting approval" rather than "no report".
 * A building with no fresh snapshot row falls back to the original per-building live queries (buildingRow).
 *
 * Note the semantics: compliancePct is approved-only (it was "latest filed" before R4a); period/status are
 * still the latest filed report's. The dashboard card and sparklines therefore agree (spec §3).
 */
```
```ts
export interface PortfolioCompliance {
  rows: PortfolioComplianceRow[];
  portfolioAvg: number | null;
  reportedCount: number;
  scoredCount: number;
  total: number;
  /** Newest snapshot computed_at among the rows, null when every row came from live queries. */
  asOf: string | null;
}

export function usePortfolioCompliance() {
  const query = useQuery({
    queryKey: ['portfolio-compliance'],
    queryFn: async (): Promise<PortfolioCompliance> => {
      const bRes = await fdb.from('buildings').select('id,name').order('name');
      if (bRes.error) throw bRes.error;
      const buildings = (bRes.data ?? []) as { id: string; name: string | null }[];

      const [snapRes, repRes] = await Promise.all([
        snapshots().gte('day', daysAgo(SNAPSHOT_FRESH_DAYS)).order('day', { ascending: false }).range(0, 4999),
        fdb.from('reports').select('building_id,report_period,status')
          .eq('report_type', 'ops_monthly').in('status', ['submitted', 'reviewed', 'approved'])
          .order('report_period', { ascending: false }).range(0, 4999),
      ]);
      if (snapRes.error) throw snapRes.error;
      if (repRes.error) throw repRes.error;

      // Both lists are newest-first, so the first row seen per building is the latest.
      const latestSnap = new Map<string, SnapshotRow>();
      for (const r of snapRes.data ?? []) if (!latestSnap.has(r.building_id)) latestSnap.set(r.building_id, r);
      const latestFiled = new Map<string, { period: string; status: string }>();
      for (const r of repRes.data ?? []) if (!latestFiled.has(r.building_id)) latestFiled.set(r.building_id, { period: r.report_period, status: r.status });

      const rows = await Promise.all(buildings.map(async (b): Promise<PortfolioComplianceRow> => {
        const name = b.name ?? 'Unnamed building';
        const s = latestSnap.get(b.id);
        if (!s) return buildingRow(b.id, name);
        const filed = latestFiled.get(b.id);
        return {
          buildingId: b.id, name,
          compliancePct: num(s.compliance_pct),
          criticalPct: num(s.critical_pct),
          openNonCompliances: s.ohs_open_nc ?? null,
          period: filed?.period ?? s.compliance_period ?? null,
          status: filed?.status ?? null,
        };
      }));

      const scored = rows.map((r) => r.compliancePct).filter((v): v is number => v !== null);
      const portfolioAvg = scored.length ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10 : null;
      const asOf = [...latestSnap.values()].map((s) => s.computed_at).sort().pop() ?? null;
      return { rows, portfolioAvg, reportedCount: rows.filter((r) => r.period !== null).length, scoredCount: scored.length, total: rows.length, asOf };
    },
  });

  return {
    rows: query.data?.rows ?? [],
    portfolioAvg: query.data?.portfolioAvg ?? null,
    reportedCount: query.data?.reportedCount ?? 0,
    scoredCount: query.data?.scoredCount ?? 0,
    total: query.data?.total ?? 0,
    asOf: query.data?.asOf ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
```
Imports: `import { SNAPSHOT_FRESH_DAYS, daysAgo, num, snapshots, type SnapshotRow } from '@/lib/snapshotClient';` (drop the local `num`). `usePortfolioCompliance.test.ts` (chain mock over `supabase` AND `fdb`, methods `select, eq, in, gte, order, limit, range`): (1) two buildings, snapshot rows for `b1` only, a filed `submitted` report for `b1` → row b1 is `{ compliancePct: 81.3, status: 'submitted', period: '2026-08-01' }` and `b2` triggers the live path (a `reports` query with `eq('building_id','b2')` is recorded); (2) `portfolioAvg` averages the non-null scores; (3) `asOf` is the newest `computed_at`.

- [ ] **Step 7: `BuildingScoreChips.tsx`** — add sparklines and the caption:

```tsx
import { ShieldCheck, ShieldOff, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { classify, STATUS_CLASS, THRESHOLDS, type KpiThreshold } from '@/lib/fortressKpis';
import { Sparkline } from '@/components/ui/sparkline';
import { formatAsOf } from '@/lib/snapshotClient';

function Chip({ label, value, threshold, icon, noDataIcon, noDataTitle, trend, trendLabel }: {
  label: string; value: number | null; threshold: KpiThreshold; icon: React.ReactNode; noDataIcon: React.ReactNode; noDataTitle: string;
  trend?: (number | null)[]; trendLabel: string;
}) {
  const isNull = value === null;
  const c = STATUS_CLASS[classify(value, threshold)];
  return (
    <span title={isNull ? noDataTitle : undefined}
      className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums', isNull ? 'bg-muted text-muted-foreground' : c.badge)}>
      {isNull ? noDataIcon : icon}
      {label} {isNull ? '—' : `${value}%`}
      {trend && <Sparkline values={trend} min={0} max={100} width={56} height={16} label={trendLabel} className="opacity-80" />}
    </span>
  );
}

export interface BuildingScoreChipsProps {
  ohsPct: number | null;
  taskPct: number | null;
  ohsTrend?: (number | null)[];
  taskTrend?: (number | null)[];
  /** computed_at of the snapshot the numbers came from; shown as a caption. */
  asOf?: string | null;
}

export function BuildingScoreChips({ ohsPct, taskPct, ohsTrend, taskTrend, asOf }: BuildingScoreChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip label="OHS" value={ohsPct} threshold={THRESHOLDS.compliance} icon={<ShieldCheck className="h-3.5 w-3.5" />}
        noDataIcon={<ShieldOff className="h-3.5 w-3.5" />} noDataTitle="No approved OPS report" trend={ohsTrend} trendLabel="OHS compliance trend" />
      <Chip label="Tasks" value={taskPct} threshold={THRESHOLDS.taskCompletion} icon={<ListChecks className="h-3.5 w-3.5" />}
        noDataIcon={<ListChecks className="h-3.5 w-3.5" />} noDataTitle="No tasks in the last 30 days" trend={taskTrend} trendLabel="Task completion trend" />
      {asOf && <span className="text-[11px] text-muted-foreground" title="From the nightly snapshot">as of {formatAsOf(asOf)}</span>}
    </div>
  );
}
```
(Plain caption, not a `<Hint>`: it states data provenance, which must stay visible with hints off.)

- [ ] **Step 8: Mount.** `BuildingDetails.tsx`: import `useBuildingTrend`; `const { ohsPct, taskPct, asOf } = useBuildingScore(id); const trend = useBuildingTrend(id, 90);` and at line 184 `<BuildingScoreChips ohsPct={ohsPct} taskPct={taskPct} ohsTrend={trend.series.compliance} taskTrend={trend.series.tasks} asOf={asOf} />`. `Buildings.tsx`: import `useBuildingsTrends`; `const trends = useBuildingsTrends(30);` next to `useBuildingsScores()`; at line 324 add `ohsTrend={trends.byBuilding[building.id]?.compliance} taskTrend={trends.byBuilding[building.id]?.tasks}`. (`useBuildingsScores` itself is untouched: it already goes through `usePortfolioCompliance`, which is now snapshot-first.)

- [ ] **Step 9: `usePortfolioTrend.ts` + `/trends` page.**

```ts
// src/hooks/usePortfolioTrend.ts
import { useQuery } from '@tanstack/react-query';
import { daysAgo, portfolioSnapshots, type PortfolioRow } from '@/lib/snapshotClient';

export function usePortfolioTrend(days: number) {
  return useQuery({
    queryKey: ['portfolio-trend', days],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<PortfolioRow[]> => {
      const res = await portfolioSnapshots().gte('day', daysAgo(days)).order('day', { ascending: true }).range(0, 999);
      if (res.error) throw res.error;
      return res.data ?? [];
    },
  });
}
```

`src/pages/Trends.tsx`:
```tsx
/**
 * Portfolio trends from the nightly snapshots: four lines over 30/90/365 days and a leaderboard of the
 * buildings whose compliance moved most. The one recharts import outside the OHS tab; loaded lazily.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { usePortfolioTrend } from '@/hooks/usePortfolioTrend';
import { useBuildingsTrends } from '@/hooks/useBuildingTrend';
import { deltaLeaderboard, reconstructionBoundary } from '@/lib/trendSeries';
import { num, type PortfolioRow } from '@/lib/snapshotClient';
import { exportCsv } from '@/lib/exportCsv';
import { formatBuildingName } from '@/lib/buildingName';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const RANGES = [30, 90, 365] as const;
type Range = (typeof RANGES)[number];

interface ChartSpec { key: keyof PortfolioRow; title: string; pct?: boolean }
const CHARTS: ChartSpec[] = [
  { key: 'compliance_avg', title: 'OHS compliance (portfolio average)', pct: true },
  { key: 'issues_open', title: 'Open issues' },
  { key: 'tasks_overdue', title: 'Overdue tasks' },
  { key: 'docs_expiring_30', title: 'Documents expiring within 30 days' },
];

function TrendChart({ rows, spec, boundaryDay }: { rows: PortfolioRow[]; spec: ChartSpec; boundaryDay: string | null }) {
  const data = rows.map((r) => ({ day: r.day, label: r.day.slice(5), value: num(r[spec.key]) }));
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{spec.title}</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
            <YAxis domain={spec.pct ? [0, 100] : ['auto', 'auto']} tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip formatter={(v: number) => (spec.pct ? `${v}%` : v)} labelFormatter={(l, p) => (p?.[0]?.payload as { day?: string })?.day ?? String(l)} />
            {boundaryDay && <ReferenceLine x={boundaryDay.slice(5)} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
            <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export default function Trends() {
  const [range, setRange] = useState<Range>(90);
  const portfolio = usePortfolioTrend(range);
  const buildings = useBuildingsTrends(range);
  const { data: names } = useQuery({
    queryKey: ['buildings-for-reports'],
    queryFn: async () => {
      const { data, error } = await supabase.from('buildings').select('id, name').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
  const nameOf = useMemo(() => new Map((names ?? []).map((b) => [b.id, b.name])), [names]);

  const rows = portfolio.data ?? [];
  const boundary = reconstructionBoundary(rows);
  const boundaryDay = boundary > 0 ? rows[boundary].day : null;
  const board = useMemo(() => deltaLeaderboard(buildings.rows, 'compliance_pct'), [buildings.rows]);
  const up = board.filter((b) => b.delta > 0).slice(0, 5);
  const down = board.filter((b) => b.delta < 0).slice(-5).reverse();

  const onExport = () => exportCsv(rows, [
    { key: 'day', header: 'Day' }, { key: 'buildings', header: 'Buildings' }, { key: 'compliance_avg', header: 'Compliance avg %' },
    { key: 'critical_avg', header: 'Critical avg %' }, { key: 'task_completion_avg', header: 'Task completion avg %' },
    { key: 'tasks_overdue', header: 'Overdue tasks' }, { key: 'issues_open', header: 'Open issues' }, { key: 'issues_breached', header: 'SLA breached' },
    { key: 'docs_expiring_30', header: 'Docs expiring 30d' }, { key: 'docs_expiring_60', header: 'Docs expiring 60d' }, { key: 'docs_expiring_90', header: 'Docs expiring 90d' },
    { key: 'docs_expired', header: 'Docs expired' }, { key: 'assets_overdue', header: 'Assets overdue' },
  ], `portfolio-trend-${range}d.csv`);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Trends</h1>
          <p className="text-sm text-muted-foreground">Portfolio metrics from the nightly snapshot (05:00).</p>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <Button key={r} variant={r === range ? 'default' : 'outline'} className="h-11 min-w-16" onClick={() => setRange(r)} aria-pressed={r === range}>{r} d</Button>
          ))}
          <Button variant="outline" className="h-11" onClick={onExport} disabled={!rows.length}><Download className="mr-2 h-4 w-4" />CSV</Button>
        </div>
      </div>
      <Hint>Sparklines on each building header show the same series for that building; this page is the whole portfolio.</Hint>
      {boundaryDay && (
        <p className="text-xs text-muted-foreground">Days before {boundaryDay} were reconstructed from today's data when snapshots began; report and expiry figures for those days are not historical.</p>
      )}
      {portfolio.isError ? (
        <Card><CardContent className="p-6 text-sm text-destructive">Could not load the portfolio snapshots.</CardContent></Card>
      ) : !portfolio.isLoading && !rows.length ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No snapshots yet. The first one is written at 05:00 after the migration is applied.</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {CHARTS.map((spec) => <TrendChart key={spec.key} rows={rows} spec={spec} boundaryDay={boundaryDay} />)}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Biggest movers — OHS compliance over {range} days</CardTitle>
          <CardDescription>Change from the first to the latest snapshot in the range.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          {[{ title: 'Improved', list: up }, { title: 'Declined', list: down }].map(({ title, list }) => (
            <div key={title}>
              <p className="mb-2 text-sm font-medium">{title}</p>
              {list.length === 0 ? <p className="text-sm text-muted-foreground">Nothing moved.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Building</TableHead><TableHead className="text-right">From</TableHead><TableHead className="text-right">To</TableHead><TableHead className="text-right">Δ</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {list.map((b) => (
                      <TableRow key={b.buildingId}>
                        <TableCell><Link className="underline-offset-2 hover:underline" to={`/buildings/${b.buildingId}`}>{formatBuildingName(nameOf.get(b.buildingId) ?? '—')}</Link></TableCell>
                        <TableCell className="text-right tabular-nums">{b.first}%</TableCell>
                        <TableCell className="text-right tabular-nums">{b.last}%</TableCell>
                        <TableCell className={`text-right tabular-nums ${b.delta > 0 ? 'text-success' : 'text-destructive'}`}>{b.delta > 0 ? '+' : ''}{b.delta}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```
`Trends.test.tsx`: `vi.mock('recharts', …)` with stub components (`ResponsiveContainer`/`LineChart` render their children in a `div`, the rest return null), mock `usePortfolioTrend` (three rows, the first `reconstructed: true`), `useBuildingsTrends` (two buildings: one up 60→72.4, one down 90→85), the supabase `buildings` query (names), `useHints`; assert the four chart titles render, the reconstruction sentence names the boundary day, "Improved" lists the up building with `+12.4`, and clicking `365 d` re-queries (the mocked hook records its `days` argument).

`App.tsx`: `const Trends = lazy(() => import("./pages/Trends"));` and after the `/reports/fortress/:id` route:
```tsx
            <Route path="/trends" element={
              <ProtectedRoute allowedRoles={['admin', 'manager']}>
                <DashboardLayout><Trends /></DashboardLayout>
              </ProtectedRoute>
            } />
```
`DashboardLayout.tsx`: import `TrendingUp` from lucide; in `reportsNavItems` after the "Building Reports" entry:
```ts
  {
    title: 'Trends',
    href: '/trends',
    icon: <TrendingUp className="w-4 h-4" />,
    roles: ['admin', 'manager'],
  },
```

- [ ] **Step 10: OPS PDF Trend section.** `src/lib/fortressReportDoc.ts`: `import type { MonthlyPoint } from '@/lib/trendSeries';` and add to `ReportData`:
```ts
  /** Twelve month-end snapshot points ending with the report period (OPS only); months before the first snapshot are null. */
  trend?: MonthlyPoint[];
```
After the Hazard Log block (before `if (data.buildingInspection …`):
```ts
    if (data.trend && data.trend.some((p) => p.compliancePct != null || p.taskPct != null || p.issuesOpen != null)) {
      section('Trend (12 months)');
      note('Month-end values from the nightly snapshot. A blank cell means no snapshot existed for that month.');
      const cell = (v: number | null) => (v == null ? '—' : String(v));
      const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' });
      content.push(compactTable(['Month', 'Compliance %', 'Tasks done %', 'Open issues', 'Overdue tasks'],
        data.trend.map((p) => [monthLabel(p.month), cell(p.compliancePct), cell(p.taskPct), cell(p.issuesOpen), cell(p.tasksOverdue)]),
        ['*', 'auto', 'auto', 'auto', 'auto']));
      // Bar strip: one bar per month, height ∝ compliance %, plain canvas rects (no chart library in pdfmake).
      const BAR_W = 30, GAP = 12, BAR_H = 40;
      content.push({
        canvas: data.trend.map((p, i) => {
          const h = p.compliancePct == null ? 0 : Math.max(1, Math.round((BAR_H * Math.min(100, Math.max(0, p.compliancePct))) / 100));
          return { type: 'rect' as const, x: i * (BAR_W + GAP), y: BAR_H - h, w: BAR_W, h: h || 1, color: p.compliancePct == null ? '#e5e7eb' : color };
        }),
        margin: [0, 6, 0, 2],
      });
      content.push({ columns: data.trend.map((p) => ({ width: BAR_W + GAP, text: p.month.slice(5), fontSize: 7, color: '#6b7280' })), margin: [0, 0, 0, 6] });
    }
```
`fortressReportDoc.test.ts` — add:
```ts
  it('renders the Trend section as a table plus a 12-rect bar strip, blank for missing months', () => {
    const trend = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, compliancePct: i < 3 ? null : 50 + i, taskPct: null, issuesOpen: i, tasksOverdue: 0 }));
    const doc = buildReportDoc({ report_type: 'ops_monthly', title: 'T', report_period: '2026-12-01' }, { trend }, { color: '#2563eb', orgName: 'Org' });
    const text = JSON.stringify(doc.content);
    expect(text).toContain('Trend (12 months)');
    const canvas = (doc.content as { canvas?: unknown[] }[]).find((c) => Array.isArray(c.canvas) && c.canvas.length === 12);
    expect(canvas).toBeTruthy();
    expect((canvas!.canvas as { color: string }[]).filter((r) => r.color === '#e5e7eb')).toHaveLength(3);
  });
```
`src/lib/fortressReportPdf.ts`, inside the `ops_monthly` branch after the hazard-log fetch:
```ts
    // Trend: the last twelve month-end snapshot rows for this building (R4a). Read errors fail the export
    // like every other section; an empty table (before the first snapshot) just yields blank months.
    {
      const endPeriod = report.report_period.slice(0, 10);
      const snapRes = await snapshots().eq('building_id', report.building_id)
        .gte('day', `${monthShift(endPeriod, 11)}-01`).lte('day', monthEnd(endPeriod))
        .order('day', { ascending: true }).range(0, 999);
      if (snapRes.error) throw new Error(`Could not read the trend snapshots: ${snapRes.error.message}`);
      data.trend = monthlyPoints(snapRes.data ?? [], endPeriod, 12);
    }
```
with `import { snapshots } from '@/lib/snapshotClient';` and `import { monthEnd, monthShift, monthlyPoints } from '@/lib/trendSeries';`. The `filled`/`emptySections` map is untouched: Trend is not a captured section.

- [ ] **Step 11: Gate**
```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'snapshotClient|trendSeries|sparkline|useBuildingTrend|usePortfolioTrend|usePortfolioCompliance|useBuildingScore|BuildingScoreChips|BuildingDetails|pages/Buildings|pages/Trends|App.tsx|DashboardLayout|fortressReportDoc|fortressReportPdf'
npm run test
npm run build   # recharts chunk: confirm dist has a separate Trends-*.js and the index chunk did not grow by more than 5 kB
```

- [ ] **Step 12: Commit**
```bash
git add src/lib/snapshotClient.ts src/lib/trendSeries.ts src/lib/trendSeries.test.ts src/components/ui/sparkline.tsx src/components/ui/sparkline.test.tsx src/hooks/useBuildingTrend.ts src/hooks/useBuildingTrend.test.ts src/hooks/usePortfolioTrend.ts src/hooks/usePortfolioCompliance.ts src/hooks/usePortfolioCompliance.test.ts src/hooks/useBuildingScore.ts src/hooks/useBuildingScore.test.ts src/components/building/BuildingScoreChips.tsx src/pages/BuildingDetails.tsx src/pages/Buildings.tsx src/pages/Trends.tsx src/pages/Trends.test.tsx src/App.tsx src/components/layout/DashboardLayout.tsx src/lib/fortressReportDoc.ts src/lib/fortressReportDoc.test.ts src/lib/fortressReportPdf.ts
git commit -m "Read scores from the nightly snapshots: sparklines, /trends, PDF trend section, live fallback

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: SLA client — `slaState`, chips on cards and detail, Settings SLA card

**Files:**
- Create: `src/lib/slaState.ts`, `src/lib/slaState.test.ts`, `src/components/issues/SlaChip.tsx`, `src/components/issues/SlaChip.test.tsx`, `src/components/settings/SlaSettingsCard.tsx`, `src/components/settings/SlaSettingsCard.test.tsx`
- Modify: `src/hooks/useIssues.ts` (`Issue` interface + select + mapping), `src/pages/Issues.tsx` (imports; chip in the live card at lines 409-416), `src/components/issues/IssueDetailDialog.tsx` (`Issue` interface at 39-53; header at 272-278; an SLA line under the description)
- Wait for: Task 2's first commit (`until git log --oneline -- src/hooks/useOrgSettings.ts | grep -q .; do sleep 30; done`) before Step 5.

- [ ] **Step 1: `src/lib/slaState.ts`** (pure; the chip, the detail line and later the CSV export all read it)

```ts
/**
 * SLA clock for an issue (R4a §5.4). Pure: the DB stamps sla_target_hours (org default per priority),
 * first_response_at and sla_breached_at; this only derives what to show. Time zone does not matter here —
 * every value is an instant — except the wording, which is relative ("Due in 3h").
 */
export interface SlaIssueFields {
  created_at: string;
  status: string;
  sla_target_hours?: number | string | null;
  sla_breached_at?: string | null;
  first_response_at?: string | null;
  resolved_at?: string | null;
}

export type SlaKind = 'none' | 'ok' | 'due_soon' | 'breached' | 'met' | 'missed';

export interface SlaState {
  kind: SlaKind;
  due: Date | null;
  /** Milliseconds until `due` (negative once past); null when there is no target. */
  remainingMs: number | null;
  breached: boolean;
  /** Plain chip text: "Due in 3h", "Breached 2d ago", "Met", "Missed by 4h", "No SLA". */
  label: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** '45m' under an hour, '3h' under two days, else '2d'. */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < HOUR) return `${Math.max(1, Math.round(abs / 60_000))}m`;
  if (abs < 2 * DAY) return `${Math.round(abs / HOUR)}h`;
  return `${Math.round(abs / DAY)}d`;
}

/** "Due soon" once less than 20% of the target (or under 4 hours) remains. */
export const DUE_SOON_FRACTION = 0.2;
export const DUE_SOON_MIN_MS = 4 * HOUR;

export function slaState(issue: SlaIssueFields, now: Date = new Date()): SlaState {
  const hours = issue.sla_target_hours == null || issue.sla_target_hours === '' ? NaN : Number(issue.sla_target_hours);
  const created = new Date(issue.created_at).getTime();
  if (!Number.isFinite(hours) || hours <= 0 || Number.isNaN(created)) {
    return { kind: 'none', due: null, remainingMs: null, breached: false, label: 'No SLA' };
  }
  const due = new Date(created + hours * HOUR);
  const breachedAt = issue.sla_breached_at ? new Date(issue.sla_breached_at) : null;

  if (issue.status === 'resolved') {
    const resolvedAt = issue.resolved_at ? new Date(issue.resolved_at).getTime() : null;
    const missed = !!breachedAt || (resolvedAt !== null && resolvedAt > due.getTime());
    if (!missed) return { kind: 'met', due, remainingMs: 0, breached: false, label: 'Met' };
    const by = resolvedAt !== null ? resolvedAt - due.getTime() : (breachedAt ? breachedAt.getTime() - due.getTime() : 0);
    return { kind: 'missed', due, remainingMs: 0, breached: true, label: by > 0 ? `Missed by ${formatDuration(by)}` : 'Missed' };
  }

  const remainingMs = due.getTime() - now.getTime();
  if (breachedAt || remainingMs < 0) {
    return { kind: 'breached', due, remainingMs, breached: true, label: `Breached ${formatDuration(-remainingMs)} ago` };
  }
  const soon = remainingMs <= Math.max(DUE_SOON_MIN_MS, hours * HOUR * DUE_SOON_FRACTION);
  return { kind: soon ? 'due_soon' : 'ok', due, remainingMs, breached: false, label: `Due in ${formatDuration(remainingMs)}` };
}
```

`src/lib/slaState.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatDuration, slaState } from './slaState';

const NOW = new Date('2026-09-10T10:00:00Z');
const base = { created_at: '2026-09-10T00:00:00Z', status: 'open' };

describe('formatDuration', () => {
  it('picks minutes, hours or days', () => {
    expect(formatDuration(30 * 60_000)).toBe('30m');
    expect(formatDuration(3 * 3_600_000)).toBe('3h');
    expect(formatDuration(47 * 3_600_000)).toBe('47h');
    expect(formatDuration(3 * 86_400_000)).toBe('3d');
    expect(formatDuration(-2 * 86_400_000)).toBe('2d');
  });
});

describe('slaState', () => {
  it('has no SLA without a positive target', () => {
    expect(slaState(base, NOW).kind).toBe('none');
    expect(slaState({ ...base, sla_target_hours: 0 }, NOW).label).toBe('No SLA');
    expect(slaState({ ...base, sla_target_hours: 'abc' }, NOW).kind).toBe('none');
  });
  it('is ok with plenty of time and due_soon inside the last 20% (min 4h)', () => {
    expect(slaState({ ...base, sla_target_hours: 72 }, NOW)).toMatchObject({ kind: 'ok', label: 'Due in 2d' });
    expect(slaState({ ...base, sla_target_hours: 12 }, NOW)).toMatchObject({ kind: 'due_soon', label: 'Due in 2h' });
    expect(slaState({ ...base, sla_target_hours: 168 }, new Date('2026-09-16T08:00:00Z'))).toMatchObject({ kind: 'due_soon' });
  });
  it('accepts a numeric string target (PostgREST numeric)', () => {
    expect(slaState({ ...base, sla_target_hours: '24' }, NOW).due?.toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });
  it('is breached once past due or once the sweep stamped it', () => {
    expect(slaState({ ...base, sla_target_hours: 4 }, NOW)).toMatchObject({ kind: 'breached', breached: true, label: 'Breached 6h ago' });
    expect(slaState({ ...base, sla_target_hours: 72, sla_breached_at: '2026-09-10T09:00:00Z' }, NOW).kind).toBe('breached');
  });
  it('resolved issues read met or missed', () => {
    expect(slaState({ ...base, status: 'resolved', sla_target_hours: 24, resolved_at: '2026-09-10T05:00:00Z' }, NOW)).toMatchObject({ kind: 'met', label: 'Met' });
    expect(slaState({ ...base, status: 'resolved', sla_target_hours: 4, resolved_at: '2026-09-10T08:00:00Z' }, NOW)).toMatchObject({ kind: 'missed', label: 'Missed by 4h' });
    expect(slaState({ ...base, status: 'resolved', sla_target_hours: 4, sla_breached_at: '2026-09-10T04:30:00Z', resolved_at: null }, NOW).kind).toBe('missed');
  });
});
```

- [ ] **Step 2: `src/components/issues/SlaChip.tsx`**

```tsx
/**
 * The SLA state of an issue as a chip. A guardrail, not coaching: it stays visible with hints off.
 * `none` renders nothing — an issue without a target has no clock to show.
 */
import { Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { slaState, type SlaIssueFields, type SlaKind } from '@/lib/slaState';

const CLASS: Record<Exclude<SlaKind, 'none'>, string> = {
  ok: 'border-border text-muted-foreground',
  due_soon: 'bg-warning text-warning-foreground border-transparent',
  breached: 'bg-destructive text-destructive-foreground border-transparent',
  met: 'bg-success text-success-foreground border-transparent',
  missed: 'border-destructive text-destructive',
};

export function SlaChip({ issue, now, className }: { issue: SlaIssueFields; now?: Date; className?: string }) {
  const s = slaState(issue, now);
  if (s.kind === 'none') return null;
  return (
    <Badge variant="outline" data-sla={s.kind} title={s.due ? `SLA due ${s.due.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}` : undefined}
      className={cn('gap-1 whitespace-nowrap', CLASS[s.kind], className)}>
      <Timer className="h-3 w-3" aria-hidden="true" />
      {s.label}
    </Badge>
  );
}
```
`SlaChip.test.tsx`: renders nothing for an issue without a target; renders `Due in 2d` with `data-sla="ok"` for a 72 h target at `NOW`; renders `Breached 6h ago` with `data-sla="breached"` for a 4 h target.

- [ ] **Step 3: `src/hooks/useIssues.ts`.** Add to the `Issue` interface (after `task_instance_id`):
```ts
  sla_target_hours: number | null;
  sla_breached_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
```
add `sla_target_hours, sla_breached_at, first_response_at, resolved_at,` to the select string (before `buildings (name)`), and map them in `formattedIssues` (`sla_target_hours: issue.sla_target_hours, …`). Export the interface (`export interface Issue`) so the page can import it instead of re-declaring shapes. `createIssue`'s `Omit<Issue, …>` widens to include the four new keys — make them optional at the call boundary: `createIssue: (issue: Omit<Issue, 'id' | 'created_at' | 'building_name' | 'sla_target_hours' | 'sla_breached_at' | 'first_response_at' | 'resolved_at'>) => …` (the DB fills them; `NewIssue.tsx` keeps compiling untouched — confirm with the gate).

- [ ] **Step 4: Chips.** `src/pages/Issues.tsx`: `import { SlaChip } from '@/components/issues/SlaChip';` and in the live-issue card's right column (after the status Badge at line 415):
```tsx
                    <SlaChip issue={issue} />
```
`src/components/issues/IssueDetailDialog.tsx`: extend its local `Issue` interface with the same four fields as OPTIONAL (`sla_target_hours?: number | null; sla_breached_at?: string | null; first_response_at?: string | null; resolved_at?: string | null;`) so existing test fixtures still type-check; import `SlaChip` and `slaState`; in the header description (after the deadline span at line 277) add `<SlaChip issue={issue} />`; under the description paragraph (after line 282) add:
```tsx
          {issue.sla_target_hours != null && (
            <p className="text-xs text-muted-foreground">
              SLA target {issue.sla_target_hours} h
              {issue.first_response_at ? ` · first response ${format(new Date(issue.first_response_at), 'MMM d, h:mm a')}` : ' · no response yet'}
              {slaState(issue).due ? ` · due ${format(slaState(issue).due!, 'MMM d, h:mm a')}` : ''}
            </p>
          )}
```
Run `npx vitest run src/components/issues src/pages/Issues.test.tsx` — the existing tests must stay green (fixtures without the new fields render no chip).

- [ ] **Step 5: `src/components/settings/SlaSettingsCard.tsx`** (needs `useOrgSettings` from Task 2's first commit)

```tsx
/**
 * Settings → Operations: default SLA hours per issue priority (organizations.settings.sla_hours). The DB
 * trigger issues_sla_defaults reads these on insert; changing them here affects issues created afterwards.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOrgSettings } from '@/hooks/useOrgSettings';
import { SLA_HOURS_MAX, SLA_HOURS_MIN, SLA_PRIORITIES, type SlaHours, type SlaPriority } from '@/lib/orgSettings';
import { PRIORITY_LABELS } from '@/lib/constants';

type Draft = Record<SlaPriority, string>;
const toDraft = (h: SlaHours): Draft => ({ critical: String(h.critical), high: String(h.high), medium: String(h.medium), low: String(h.low) });

function parse(draft: Draft): SlaHours | null {
  const out = {} as SlaHours;
  for (const p of SLA_PRIORITIES) {
    const n = Number(draft[p]);
    if (!Number.isInteger(n) || n < SLA_HOURS_MIN || n > SLA_HOURS_MAX) return null;
    out[p] = n;
  }
  return out;
}

export function SlaSettingsCard({ canEdit }: { canEdit: boolean }) {
  const { settings, isLoading, save, isSaving } = useOrgSettings();
  const [draft, setDraft] = useState<Draft>(toDraft(settings.sla_hours));
  useEffect(() => { setDraft(toDraft(settings.sla_hours)); }, [settings.sla_hours]);
  const parsed = parse(draft);

  const onSave = async () => {
    if (!parsed) return;
    try {
      await save({ ...settings, sla_hours: parsed });
      toast.success('SLA hours saved. New issues use them from now on.');
    } catch (e) {
      if (import.meta.env.DEV) console.error('Save SLA hours failed:', e);
      toast.error('Could not save the SLA hours.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Issue SLA</CardTitle>
        <CardDescription>Hours to resolve an issue, by priority. The clock starts when the issue is reported.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {SLA_PRIORITIES.map((p) => (
            <div key={p} className="space-y-2">
              <Label htmlFor={`sla-${p}`}>{PRIORITY_LABELS[p]} (hours)</Label>
              <Input id={`sla-${p}`} type="number" inputMode="numeric" min={SLA_HOURS_MIN} max={SLA_HOURS_MAX} className="h-11"
                value={draft[p]} onChange={(e) => setDraft({ ...draft, [p]: e.target.value })} disabled={!canEdit || isLoading} />
            </div>
          ))}
        </div>
        {!parsed && <p className="text-xs text-destructive">Every value must be a whole number of hours from {SLA_HOURS_MIN} to {SLA_HOURS_MAX}.</p>}
        <Hint>Existing issues keep the target they were created with. A breached issue is flagged on its card and in the inbox of its assignee and every admin and manager, checked every 15 minutes.</Hint>
        {canEdit && (
          <Button className="min-h-11" onClick={onSave} disabled={!parsed || isSaving || isLoading}>{isSaving ? 'Saving…' : 'Save'}</Button>
        )}
      </CardContent>
    </Card>
  );
}
```
`SlaSettingsCard.test.tsx` (same mocks as `FeatureFlagsCard.test.tsx` in Task 2, written independently here — do not import that file): renders four inputs pre-filled with the defaults; entering `0` for Critical shows the validation line and disables Save; entering `2` and saving calls `save` with `sla_hours: { critical: 2, high: 24, medium: 72, low: 168 }`; no Save button and disabled inputs without `canEdit`.

- [ ] **Step 6: Gate**
```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'slaState|SlaChip|SlaSettingsCard|useIssues|pages/Issues|IssueDetailDialog|NewIssue'
npm run test
```

- [ ] **Step 7: Commit** (two commits so Task 2 can pick up the card as early as possible)
```bash
git add src/components/settings/SlaSettingsCard.tsx src/components/settings/SlaSettingsCard.test.tsx
git commit -m "Add the Issue SLA settings card

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git add src/lib/slaState.ts src/lib/slaState.test.ts src/components/issues/SlaChip.tsx src/components/issues/SlaChip.test.tsx src/hooks/useIssues.ts src/pages/Issues.tsx src/components/issues/IssueDetailDialog.tsx
git commit -m "Show the SLA clock on issue cards and the detail dialog

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Expiry alerts widened — `expiring_items` consumers, widget buckets, alert function, digest lines, notification kind, smoke

**Files:**
- Create: `src/lib/expiry.ts`, `src/lib/expiry.test.ts`, `src/hooks/useExpiringItems.ts`, `src/hooks/useExpiringItems.test.ts`, `src/components/dashboard/GlobalAlertsWidget.test.tsx`
- Modify: `src/components/dashboard/GlobalAlertsWidget.tsx` (whole file), `supabase/functions/notify-expiring-alerts/index.ts` (the fetch + item mapping; header comment), `supabase/functions/daily-digest/index.ts` (one `expiring_items` read + admin/manager roles; `composeDigest` input), `supabase/functions/_shared/digest.ts` (`DigestInput.expiring`, one section), `src/lib/digest.test.ts` (two cases), `supabase/functions/_shared/notifyRules.ts` (`NOTIFICATION_KINDS`, `governingFlag`, `DIGEST_ONLY`), `src/lib/notifyRules.test.ts` (`TABLE`), `src/lib/notify.ts` (`NotificationKind` union), `scripts/notifications-smoke.mjs` (header; step 8 fixtures + assertions; new step 9)

- [ ] **Step 1: `src/lib/expiry.ts`** (pure)

```ts
/** Shapes and buckets for the widened expiry alerts (expiring_items(), R4a §5.6). */
export type ExpiringKind = 'building_document' | 'tenant_document' | 'contractor_document' | 'asset_warranty' | 'asset_service';

export interface ExpiringItem {
  kind: ExpiringKind;
  entity_type: 'document' | 'asset';
  entity_id: string;
  parent_id: string | null;
  building_id: string | null;
  building_name: string | null;
  name: string;
  detail: string | null;
  expiry_date: string;
  days_left: number;
}

export type ExpiryBucket = 'expired' | 'd30' | 'd60' | 'd90';
export const BUCKETS: ExpiryBucket[] = ['expired', 'd30', 'd60', 'd90'];
export const BUCKET_LABELS: Record<ExpiryBucket, string> = { expired: 'Expired', d30: '≤ 30 days', d60: '31–60 days', d90: '61–90 days' };

export function bucketOf(daysLeft: number): ExpiryBucket | null {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 30) return 'd30';
  if (daysLeft <= 60) return 'd60';
  if (daysLeft <= 90) return 'd90';
  return null;
}

export type ExpiryCounts = Record<ExpiryBucket, number>;
export function countBuckets(items: { days_left: number }[]): ExpiryCounts {
  const c: ExpiryCounts = { expired: 0, d30: 0, d60: 0, d90: 0 };
  for (const i of items) { const b = bucketOf(i.days_left); if (b) c[b] += 1; }
  return c;
}

export const KIND_LABELS: Record<ExpiringKind, string> = {
  building_document: 'Building document', tenant_document: 'Tenant document', contractor_document: 'Contractor document',
  asset_warranty: 'Warranty', asset_service: 'Service due',
};

/** Where the row's arrow goes. Contractor documents have no building; the register opens on the contractor. */
export function itemUrl(item: Pick<ExpiringItem, 'kind' | 'building_id' | 'parent_id'>): string {
  switch (item.kind) {
    case 'building_document': return `/buildings/${item.building_id}?tab=documents`;
    case 'tenant_document': return `/buildings/${item.building_id}?tab=tenants`;
    case 'contractor_document': return item.parent_id ? `/contractors?open=${item.parent_id}` : '/contractors';
    case 'asset_warranty':
    case 'asset_service': return `/buildings/${item.building_id}?tab=assets`;
  }
}

/** "expires in 3 days", "expires today", "expired 5 days ago"; service rows say "due"/"overdue". */
export function expiryPhrase(item: Pick<ExpiringItem, 'kind' | 'days_left'>): string {
  const n = item.days_left;
  const days = (k: number) => `${k} day${k === 1 ? '' : 's'}`;
  if (item.kind === 'asset_service') return n < 0 ? `service overdue by ${days(-n)}` : n === 0 ? 'service due today' : `service due in ${days(n)}`;
  const what = item.kind === 'asset_warranty' ? 'warranty ' : '';
  return n < 0 ? `${what}expired ${days(-n)} ago` : n === 0 ? `${what}expires today` : `${what}expires in ${days(n)}`;
}
```
`expiry.test.ts`: `bucketOf` boundaries (−1, 0, 30, 31, 60, 61, 90, 91 → expired, d30, d30, d60, d60, d90, d90, null); `countBuckets`; `itemUrl` for all five kinds (contractor without parent falls back to `/contractors`); `expiryPhrase` for expired/today/future and both asset kinds. Every URL produced by `itemUrl` must satisfy `safeInAppUrl` from `@/lib/pushUrl` — assert it in the test (the alert function reuses these URLs in inbox rows).

- [ ] **Step 2: `src/hooks/useExpiringItems.ts`**

```ts
/**
 * Everything expiring within `days` (expired rows included) across building, tenant and contractor documents
 * and asset warranties / service dates, through the expiring_items() RPC (security invoker: RLS applies).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ExpiringItem } from '@/lib/expiry';

export function useExpiringItems(days = 90) {
  return useQuery({
    queryKey: ['expiring-items', days],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ExpiringItem[]> => {
      // expiring_items is not yet in the generated types; regenerate after the migration ships.
      const { data, error } = await (supabase as unknown as {
        rpc(fn: 'expiring_items', args: { p_days: number }): Promise<{ data: ExpiringItem[] | null; error: { message: string } | null }>;
      }).rpc('expiring_items', { p_days: days });
      if (error) throw error;
      return data ?? [];
    },
  });
}
```
`useExpiringItems.test.ts`: mock `supabase.rpc` (vi.fn) → asserts it is called with `('expiring_items', { p_days: 60 })` and returns the rows; an error rejects the query (`isError` true).

- [ ] **Step 3: `GlobalAlertsWidget.tsx`** — rewrite on the hook; same loading/error/empty behaviour and the same two tabs, plus bucket pills:

```tsx
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Building2, FileWarning, Loader2, Wrench } from 'lucide-react';
import { formatBuildingName } from '@/lib/buildingName';
import { useExpiringItems } from '@/hooks/useExpiringItems';
import { BUCKETS, BUCKET_LABELS, KIND_LABELS, bucketOf, countBuckets, expiryPhrase, itemUrl, type ExpiringItem, type ExpiryBucket } from '@/lib/expiry';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

const SHOW = 5;

function ExpiryBadge({ item }: { item: ExpiringItem }) {
  const n = item.days_left;
  if (n < 0) return <Badge variant="destructive">{item.kind === 'asset_service' ? `${-n}d overdue` : 'Expired'}</Badge>;
  if (n <= 7) return <Badge className="bg-destructive/80 text-destructive-foreground">{n}d</Badge>;
  if (n <= 30) return <Badge className="bg-warning text-warning-foreground">{n}d</Badge>;
  return <Badge variant="secondary">{n}d</Badge>;
}

function Row({ item }: { item: ExpiringItem }) {
  const Icon = item.entity_type === 'asset' ? Wrench : FileWarning;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', item.days_left < 0 ? 'text-destructive' : 'text-warning')} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {item.building_name && (<><Building2 className="h-3 w-3" /><span className="truncate">{formatBuildingName(item.building_name)}</span><span>•</span></>)}
            <span>{KIND_LABELS[item.kind]}{item.detail ? ` · ${item.detail}` : ''}</span>
            <span>•</span>
            <span>{expiryPhrase(item)}</span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ExpiryBadge item={item} />
        <Button variant="ghost" size="icon" className="h-11 w-11" asChild>
          <Link to={itemUrl(item)} aria-label={`Open ${item.name}`}><ArrowRight className="h-4 w-4" /></Link>
        </Button>
      </div>
    </div>
  );
}

function List({ items, empty }: { items: ExpiringItem[]; empty: string }) {
  if (!items.length) return <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <>
      {items.slice(0, SHOW).map((i) => <Row key={`${i.kind}-${i.entity_id}`} item={i} />)}
      {items.length > SHOW && <p className="pt-2 text-center text-xs text-muted-foreground">+{items.length - SHOW} more</p>}
    </>
  );
}

export default function GlobalAlertsWidget() {
  const query = useExpiringItems(90);
  const [bucket, setBucket] = useState<ExpiryBucket | 'all'>('all');
  const items = query.data ?? [];
  const counts = useMemo(() => countBuckets(items), [items]);
  const visible = useMemo(() => (bucket === 'all' ? items : items.filter((i) => bucketOf(i.days_left) === bucket)), [items, bucket]);
  const documents = visible.filter((i) => i.entity_type === 'document' || i.kind === 'asset_warranty');
  const maintenance = visible.filter((i) => i.kind === 'asset_service');

  if (query.isLoading) {
    return <Card><CardContent className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>;
  }
  if (query.isError) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div><CardTitle>Global Alerts</CardTitle><CardDescription>Alerts could not be checked</CardDescription></div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <p className="mb-1 text-sm font-medium">Failed to load global alerts</p>
            <p className="mb-4 max-w-sm text-xs text-muted-foreground">{(query.error as Error)?.message} Expiring documents and overdue maintenance across the portfolio are not visible right now.</p>
            <Button onClick={() => void query.refetch()} variant="outline" className="h-11">Try Again</Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (items.length === 0) return null;

  return (
    <Card className="border-warning/50 bg-warning/5">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <div>
            <CardTitle>Global Alerts</CardTitle>
            <CardDescription>{items.length} item{items.length === 1 ? '' : 's'} expiring within 90 days or already past</CardDescription>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Expiry window">
          <Button variant={bucket === 'all' ? 'default' : 'outline'} size="sm" className="h-11" aria-pressed={bucket === 'all'} onClick={() => setBucket('all')}>All ({items.length})</Button>
          {BUCKETS.map((b) => (
            <Button key={b} variant={bucket === b ? 'default' : 'outline'} size="sm" className="h-11" aria-pressed={bucket === b} onClick={() => setBucket(b)}>
              {BUCKET_LABELS[b]} ({counts[b]})
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="documents" className="w-full">
          <TabsList className="mb-4 grid w-full grid-cols-2">
            <TabsTrigger value="documents" className="h-11 gap-2"><FileWarning className="h-4 w-4" />Documents ({documents.length})</TabsTrigger>
            <TabsTrigger value="maintenance" className="h-11 gap-2"><Wrench className="h-4 w-4" />Maintenance ({maintenance.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="documents" className="space-y-3"><List items={documents} empty="No expiring documents or warranties in this window" /></TabsContent>
          <TabsContent value="maintenance" className="space-y-3"><List items={maintenance} empty="No service dates in this window" /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
```
`GlobalAlertsWidget.test.tsx` (mock `useExpiringItems`; wrap in `MemoryRouter`): five items across kinds and buckets → header says `5 items`, the `≤ 30 days (2)` pill filters the Documents list to two rows, a contractor row links to `/contractors?open=<parent_id>`, an `asset_service` row appears under Maintenance with `overdue`; empty data renders nothing; an error renders "Failed to load global alerts".

- [ ] **Step 4: `notify-expiring-alerts/index.ts`.** Replace the two table reads (from `const today = new Date();` down to the `alertSummary` assembly) with one RPC and a mapping; keep the auth, the idempotent inbox pass, the email pass and `generateAlertEmailHtml` as they are. New code:

```ts
    // One read for every expiry source (building/tenant/contractor documents, asset warranties, service
    // dates): expiring_items(30) is security invoker, and the service role sees every row. Rows with a
    // positive days_left for asset service dates are "due soon", not overdue — they are listed in the email
    // but do not get an inbox row (the inbox keeps its old meaning: overdue service).
    const { data: expiring, error: expErr } = await supabase.rpc("expiring_items", { p_days: 30 });
    if (expErr) {
      console.error("Error reading expiring items:", expErr);
      throw expErr;
    }
    type Item = {
      kind: "building_document" | "tenant_document" | "contractor_document" | "asset_warranty" | "asset_service";
      entity_type: "document" | "asset"; entity_id: string; parent_id: string | null; building_id: string | null;
      building_name: string | null; name: string; detail: string | null; expiry_date: string; days_left: number;
    };
    const items = (expiring ?? []) as Item[];
    console.log(`Found ${items.length} expiring items within 30 days (incl. expired)`);

    const expiringDocuments: ExpiringDocument[] = [];
    const expiredDocuments: ExpiringDocument[] = [];
    const overdueMaintenance: OverdueMaintenance[] = [];
    for (const it of items) {
      if (it.kind === "asset_service") {
        if (it.days_left < 0) {
          overdueMaintenance.push({ id: it.entity_id, name: it.name, category: it.detail ?? "", next_service_date: it.expiry_date,
            building_name: it.building_name ?? "", building_id: it.building_id ?? "", days_overdue: -it.days_left });
        }
        continue;
      }
      const doc: ExpiringDocument = {
        id: it.entity_id, name: it.kind === "asset_warranty" ? `Warranty: ${it.name}` : it.name,
        document_type: it.kind === "contractor_document" ? `Contractor document · ${it.detail ?? ""}` : it.kind === "tenant_document" ? `Tenant document · ${it.detail ?? ""}` : (it.detail ?? ""),
        expiry_date: it.expiry_date, building_name: it.building_name ?? (it.kind === "contractor_document" ? (it.detail ?? "Contractor") : ""),
        building_id: it.building_id ?? "", days_until_expiry: it.days_left, kind: it.kind, parent_id: it.parent_id,
      };
      (it.days_left < 0 ? expiredDocuments : expiringDocuments).push(doc);
    }
```
Extend `ExpiringDocument` with `kind: Item["kind"]; parent_id: string | null;` (declare `Item` above the interfaces instead of inline). In the inbox pass, the document item's `url` and `entityType` become:
```ts
            entityType: doc.kind === "asset_warranty" ? "asset" : "document",
            url: doc.kind === "tenant_document" ? `/buildings/${doc.building_id}?tab=tenants`
               : doc.kind === "contractor_document" ? (doc.parent_id ? `/contractors?open=${doc.parent_id}` : "/contractors")
               : doc.kind === "asset_warranty" ? `/buildings/${doc.building_id}?tab=assets`
               : `/buildings/${doc.building_id}?tab=documents`,
```
and `buildingId: doc.building_id || null` (contractor documents have none; `InboxItem.buildingId` becomes `string | null` — `buildInboxRows` already accepts null). The `InboxItem.entityType` union becomes `"document" | "asset"`. Update the header comment: the function now covers four tables through `expiring_items`. Check with `deno check supabase/functions/notify-expiring-alerts/index.ts` if Deno is installed; otherwise rely on the controller's deploy.

- [ ] **Step 5: Digest lines.** `supabase/functions/_shared/digest.ts`: add
```ts
export interface ExpiryBuckets { expired: number; d30: number; d60: number; d90: number }
```
and `expiring?: ExpiryBuckets | null;` to `DigestInput` (`/** Portfolio-wide expiry counts; only admins and managers get this section. */`). In `composeDigest`, after the issues section and before `unread`:
```ts
  const e = input.expiring;
  if (e && (e.expired || e.d30 || e.d60 || e.d90)) {
    const lines: string[] = [];
    if (e.expired) lines.push(`${e.expired} already expired`);
    if (e.d30) lines.push(`${e.d30} within 30 days`);
    if (e.d60) lines.push(`${e.d60} within 31–60 days`);
    if (e.d90) lines.push(`${e.d90} within 61–90 days`);
    const total = e.expired + e.d30 + e.d60 + e.d90;
    sections.push({ heading: `${total} expiring ${plural(total, 'document, warranty or service', 'documents, warranties and services')}`, lines });
  }
```
`src/lib/digest.test.ts` — two cases: `expiring: { expired: 1, d30: 3, d60: 0, d90: 2 }` yields the heading `6 expiring documents, warranties and services` with exactly three lines (no `31–60` line); all-zero buckets add no section. Extend the `empty` fixture with `expiring: null`.

`supabase/functions/daily-digest/index.ts`: after `nameFor` is defined, read once:
```ts
    // Portfolio expiry counts for admins and managers (site users see only their buildings, and the
    // per-person RLS view is not worth a query each; they get the widget in the app).
    const { data: adminRoleRows } = await supabase.from("user_roles").select("user_id").in("role", ["admin", "manager"]);
    const adminIds = new Set((adminRoleRows ?? []).map((r: { user_id: string }) => r.user_id));
    let expiring: ExpiryBuckets | null = null;
    try {
      const { data: expRows, error: expErr } = await supabase.rpc("expiring_items", { p_days: 90 });
      if (expErr) throw expErr;
      const b: ExpiryBuckets = { expired: 0, d30: 0, d60: 0, d90: 0 };
      for (const r of (expRows ?? []) as { days_left: number }[]) {
        if (r.days_left < 0) b.expired++; else if (r.days_left <= 30) b.d30++; else if (r.days_left <= 60) b.d60++; else if (r.days_left <= 90) b.d90++;
      }
      expiring = b;
    } catch (e) {
      // The digest still goes out without the expiry line; the widget and the alerts cron cover it.
      console.error("daily-digest: expiring_items failed", e);
    }
```
and pass `expiring: adminIds.has(p.id) ? expiring : null` into `composeDigest` in the email pass; import `ExpiryBuckets` from `../_shared/digest.ts`.

- [ ] **Step 6: The notification kind, everywhere it is enumerated.** `supabase/functions/_shared/notifyRules.ts`: append `'issue_sla_breached'` to `NOTIFICATION_KINDS`; in `governingFlag` add `case 'issue_sla_breached':` to the `overdue_alerts` group; `DIGEST_ONLY` becomes `new Set(['document_expiring', 'asset_service_due', 'task_due_today', 'issue_sla_breached'])` with the comment extended: `issue_sla_breached` rows are written by the SQL sweep (`mark_sla_breaches`) and never pass through `createNotifications`, so it neither emails nor pushes in R4a. Not in `CLIENT_KINDS`, not in `PUSH_KINDS`. `src/lib/notifyRules.test.ts`: add `issue_sla_breached: 'overdue_alerts'` to `TABLE` (the "covers every kind" assertion fails until you do). `src/lib/notify.ts`: add `| 'issue_sla_breached'` to the `NotificationKind` union with the same one-line note. Run `npx vitest run src/lib/notifyRules.test.ts src/lib/pushUrl.test.ts src/lib/digest.test.ts`.

- [ ] **Step 7: `scripts/notifications-smoke.mjs`.** Header: extend the `notify-expiring-alerts` paragraph — "also a tenant document expiring in 3 days → one `document_expiring` row deep-linking to `?tab=tenants`; an asset warranty expiring in 5 days → one `document_expiring` row with `entity_type asset` deep-linking to `?tab=assets`" — and add a step-9 paragraph: "`mark_sla_breaches` (SQL, cron-shaped): an issue past its target → `issue_sla_breached` rows for the assignee and every admin/manager; second call adds none. Inbox only; on a shared backend this also breaches any real overdue issue (inbox rows to real admins; no email)". In step 8, after the building document fixture:
```js
    const tenant = await svcInsert('building_tenants', { building_id: A, name: `ZZTEST-NOTIFY-TENANT-${RUN}`, shop_name: 'Shop 1' });
    cleanup.push(['building_tenants', tenant.id]);
    const tdoc = await svcInsert('tenant_documents', { tenant_id: tenant.id, document_name: `ZZTEST-NOTIFY-TDOC-${RUN}`, document_type: 'Lease', expiry_date: expiry });
    cleanup.unshift(['tenant_documents', tdoc.id]);
    const warrantyExpiry = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const asset = await svcInsert('building_assets', { building_id: A, name: `ZZTEST-NOTIFY-ASSET-${RUN}`, category: 'HVAC', warranty_expiry: warrantyExpiry });
    cleanup.push(['building_assets', asset.id]);
```
and after the existing three `rows` assertions:
```js
    await registerCleanup(tdoc.id);
    await registerCleanup(asset.id);
    const tRows = await svcSelectF('notifications', `kind=eq.document_expiring&entity_id=eq.${tdoc.id}&recipient_id=eq.${personas.admin.id}`);
    assert('expiring alerts: one row for the tenant document', tRows.length === 1, `found ${tRows.length} row(s)`);
    assert('expiring alerts: tenant document deep-links to the tenants tab', tRows[0]?.url === `/buildings/${A}?tab=tenants`, `url=${tRows[0]?.url}`);
    const wRows = await svcSelectF('notifications', `kind=eq.document_expiring&entity_id=eq.${asset.id}&recipient_id=eq.${personas.admin.id}`);
    assert('expiring alerts: one row for the asset warranty', wRows.length === 1, `found ${wRows.length} row(s)`);
    assert('expiring alerts: warranty row is entity_type asset and links to the assets tab', wRows[0]?.entity_type === 'asset' && wRows[0]?.url === `/buildings/${A}?tab=assets`, JSON.stringify(wRows[0]));
```
(`registerCleanup(entityId)` already deletes every recipient's rows for an entity — read its definition in the file and reuse it.) New step 9, after step 8:
```js
  // ════ 9: mark_sla_breaches writes issue_sla_breached rows for the assignee and every admin/manager ════
  await step('mark_sla_breaches: inbox rows', async () => {
    const issue = await svcInsert('issues', {
      building_id: A, title: `ZZTEST-NOTIFY-SLA-${RUN}`, description: 'sla smoke', priority: 'high',
      reported_by: personas.admin.id, assigned_to: personas.manager.id,
    });
    cleanup.push(['issues', issue.id]);
    // The trigger gave it the org default (24 h for high); push the target and the clock so it is past due.
    const patched = await fetch(`${URL_BASE}/rest/v1/issues?id=eq.${issue.id}`, {
      method: 'PATCH', headers: { ...SVC, Prefer: 'return=representation' },
      body: JSON.stringify({ sla_target_hours: 0.01, created_at: new Date(Date.now() - 3_600_000).toISOString() }),
    });
    assert('sla fixture: default target was 24 h before the patch', Number(issue.sla_target_hours) === 24, `sla_target_hours=${issue.sla_target_hours}`);
    assert('sla fixture: patched', patched.ok, `HTTP ${patched.status}`);
    const sweep = await rpcAs(personas.admin.jwt, 'mark_sla_breaches', {});
    assert('mark_sla_breaches as admin: HTTP 200', sweep.status === 200, `HTTP ${sweep.status}`);
    assert('mark_sla_breaches: at least one issue breached', Number(sweep.body) >= 1, `returned ${JSON.stringify(sweep.body)}`);
    await registerCleanup(issue.id);
    const forManager = await svcSelectF('notifications', `kind=eq.issue_sla_breached&entity_id=eq.${issue.id}&recipient_id=eq.${personas.manager.id}`);
    const forAdmin = await svcSelectF('notifications', `kind=eq.issue_sla_breached&entity_id=eq.${issue.id}&recipient_id=eq.${personas.admin.id}`);
    assert('sla breach: one row for the assignee (manager)', forManager.length === 1, `found ${forManager.length}`);
    assert('sla breach: one row for the admin', forAdmin.length === 1, `found ${forAdmin.length}`);
    assert('sla breach: row deep-links to the issue', forAdmin[0]?.url === `/issues?open=${issue.id}`, `url=${forAdmin[0]?.url}`);
    assert('sla breach: title names the issue', forAdmin[0]?.title === `SLA breached: ZZTEST-NOTIFY-SLA-${RUN}`, `title=${forAdmin[0]?.title}`);
    const beforeAgain = (await svcSelectF('notifications', `kind=eq.issue_sla_breached&entity_id=eq.${issue.id}`)).length;
    const again = await rpcAs(personas.admin.jwt, 'mark_sla_breaches', {});
    const afterAgain = (await svcSelectF('notifications', `kind=eq.issue_sla_breached&entity_id=eq.${issue.id}`)).length;
    assert('sla breach re-run: no new rows for the same issue', again.status === 200 && afterAgain === beforeAgain, `${beforeAgain} → ${afterAgain} rows`);
    const asUser = await rpcAs(personas.user.jwt, 'mark_sla_breaches', {});
    assert('mark_sla_breaches refused for a site user', asUser.status === 403, `HTTP ${asUser.status}`);
  });
```
Add these two helpers next to the existing service-role helpers (skip `authed` if the file already defines one — `grep -n "function authed" scripts/notifications-smoke.mjs`):
```js
function authed(jwt) { return { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }; }
/** Persona-scoped RPC: `{ status, body }` with the JSON body (or null when the response is not JSON). */
async function rpcAs(jwt, fn, args) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: authed(jwt), body: JSON.stringify(args) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
```

- [ ] **Step 8: Gate**
```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'expiry|useExpiringItems|GlobalAlertsWidget|notifyRules|notify.ts|digest'
npm run test
node --check scripts/notifications-smoke.mjs
```

- [ ] **Step 9: Commit**
```bash
git add src/lib/expiry.ts src/lib/expiry.test.ts src/hooks/useExpiringItems.ts src/hooks/useExpiringItems.test.ts src/components/dashboard/GlobalAlertsWidget.tsx src/components/dashboard/GlobalAlertsWidget.test.tsx supabase/functions/notify-expiring-alerts/index.ts supabase/functions/daily-digest/index.ts supabase/functions/_shared/digest.ts src/lib/digest.test.ts supabase/functions/_shared/notifyRules.ts src/lib/notifyRules.test.ts src/lib/notify.ts scripts/notifications-smoke.mjs
git commit -m "Widen expiry alerts to four tables with 30/60/90 buckets; add the issue_sla_breached kind

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6 (controller): apply, verify, deploy, regenerate, review, record

**Files:** `docs/plans/APPLY_CHECKLIST.md` (new `## R4a "Snapshots & SLA" (2026-09-10)` section in the R3c format), `src/integrations/supabase/types.ts` (regenerated), this plan (Status section), the casts listed below (dropped), the memory file `fortress-daily-ops-roadmap.md` (+ a new `fortress-r4a-snapshots-sla.md` if the roadmap note grows past its purpose).

- [ ] **Step 1: Staging apply.** With the scratch Management-API runner (`supa.mjs`, ref = staging): apply `../GMI/sql/2026-09-14_01_r4_snapshots_sla.sql` (expect 201), then run every `-- Verify:` query from the file's tail and paste the results into the apply record. `select jobname, schedule, command from cron.job where jobname in ('metrics-snapshot-daily','sla-breach-sweep')` → two rows. `select count(*), count(distinct building_id), min(day), max(day) from public.building_metrics_daily` → `91 × buildings`, today-90, today. Reload PostgREST (`notify pgrst, 'reload schema'`). If the apply times out inside the backfill (the whole file is one transaction and the Management API caps a query at roughly a minute), re-apply the file with the backfill `do $$ … $$` block removed, then run that block alone three times with `generate_series(v_today - 90, v_today - 61, …)`, `(v_today - 60, v_today - 31, …)`, `(v_today - 30, v_today, …)`; record which path was taken.

- [ ] **Step 2: Staging smokes.** `SUPABASE_URL=<staging> SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=… npm run smoke:snapshot` (record step-9 ms; must be < 30 000), `node scripts/rls-smoke.mjs` (expect 518 + the R4a probes, 0 failures), `npm run smoke:ppm`, `node scripts/fortress-smoke.mjs`, `node scripts/dashboard-smoke.mjs`. Deploy the two retrofitted functions to staging (`supabase functions deploy notify-expiring-alerts --project-ref <staging>`, `… daily-digest …`), then `EXPIRING_ALERTS_SECRET=… npm run smoke:notifications` (steps 8 and 9 must pass; the digest function is exercised by its own manual call: `curl -X POST …/functions/v1/daily-digest -H "x-digest-secret: …"` → JSON counts, no 500). Any failure returns to the owning task (phase 1 of the investigation protocol; never patch the patch).

- [ ] **Step 3: Prod apply.** Same file, ref `qdzgkttiosahdfqresvz`; same verify queries; `rls-smoke` on prod (the snapshot smoke's step 9 is project-wide and idempotent — run it too, with `SMOKE_ALLOW_PROD=1`, and record the ms). Deploy `notify-expiring-alerts` and `daily-digest` to prod. Confirm crons: `select jobname, schedule, active from cron.job order by 1` → includes `metrics-snapshot-daily 0 3 * * *` and `sla-breach-sweep */15 * * * *`. Next morning: `select max(day), max(computed_at), bool_or(reconstructed) from building_metrics_daily where day = current_date` → today's row, not reconstructed.

- [ ] **Step 4: Regenerate types and drop the casts.** `npx supabase gen types typescript --project-id qdzgkttiosahdfqresvz --schema public > src/integrations/supabase/types.ts` (the R3c apply record has the exact invocation used). Then remove every `not yet in the generated types` comment and its cast: `src/lib/snapshotClient.ts` (type the client directly; keep the module as the single access point), `src/hooks/useOrgSettings.ts` (`settings` column), `src/hooks/useOrganization.ts` (`organization_branding` view — add it to `fortress-types.ts`/`types.ts` Views if the generator lists it; else keep the cast and say so in Status), `src/hooks/useFortressReports.ts` (`delete_empty_report`, `report_types`), `src/pages/FortressReports.tsx` (`report_types`), `src/hooks/useExpiringItems.ts` (`expiring_items`). `grep -rn "not yet in the generated types" src` prints nothing (or only the view, with the reason recorded). Gate: `npm run test`, `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'` ≤ 51 on the clean tree, `npm run build`.

- [ ] **Step 5: Whole-slice review** (superpowers:requesting-code-review with the slice range `21449c7..HEAD`): reviewers read via `git show <sha>:<path>`; the checklist is the spec §5.1–5.6 + §6 line by line, the Contracts table, and the ground rules (search_path, revokes, RLS, Hint rule, 44 px, casts). Fix findings in-slice with explicit-pathspec commits; re-run the staging smokes for anything touching SQL (a `_02` review-fix migration if needed, applied staging → prod the same way).

- [ ] **Step 6: Status section** at the end of this plan (the R3c plan's "Status — shipped" block is the format): what shipped (migration + client, one paragraph each), decisions taken (approved-only portfolio compliance per D10; `issue_sla_breached` inbox-only in R4a, push deferred to R4b; `/issues?open=` not `?issue=`; contractor documents counted on the portfolio row only; existing issues not backfilled with SLA targets; `report_types` edited from the coverage grid, not the building form), numbers (smoke counts, snapshot timing staging + prod, vitest count, tsc count), follow-ups (R4b: push for SLA breaches through an edge path; R4b: `reportArtifacts.ts` typed client; owner: SLA hours + report due day in Settings, per-building report types).

- [ ] **Step 7: `docs/plans/APPLY_CHECKLIST.md`** — new section `## R4a "Snapshots & SLA" (2026-09-10)` with `### Migrations`, `### Staging — DONE`, `### Production — DONE`, `### Owner items` in the R3c layout, naming the GMI commit sha, the verify results, the smoke counts and the snapshot timing.

- [ ] **Step 8: Push and PR body.** `git push origin feat/reports-access-hardening`; append an "R4a Snapshots & SLA" section to PR #3's body (`gh pr edit 3 --body-file <scratchpad>/pr-body.md` after `gh pr view 3 --json body -q .body > <scratchpad>/pr-body.md` and appending): what changed, the two crons, the owner actions from spec §11 that apply to R4a (decide SLA hours and the report due day in Settings; per building, mark which report types apply; flags stay off), and the smoke evidence. CI must be green (typecheck ratchet ≤ 51, tests, build).

- [ ] **Step 9: Memory.** Update `fortress-daily-ops-roadmap.md` (status line: R4a closed at `<sha>`, crons on prod, the snapshot timing, the decisions above, next = R4b) and add any new process lesson to its "Process lessons" paragraph.

---

## Self-review (run by the plan author before commit)

- **Spec coverage.** §5.1 fixes → Task 1 §1 (is_admin/is_admin_or_manager EXISTS, app_role gate + order, building_assets columns, media_attachments admin-only); the `reportArtifacts.ts` client is R4b per the spec. §5.2 → Task 1 §2 (settings + CHECK, branding view, anon loses the table) + Task 2 (`useOrgSettings`, `useFeature`, `useOrganization` anon path, Settings cards). §5.3 → Task 1 §3 (table, function, view, backfill, cron, RLS, retention) + Task 3 (Sparkline, `useBuildingTrend`, header/list, `/trends`, snapshot-first hooks with live fallback, PDF Trend). §5.4 → Task 1 §4 (defaults trigger, first response, sweep + cron, kind) + Task 4 (types/select, `slaState`, chips, SLA card) + Task 5 (kind in `notifyRules`/`notify.ts`/tests/smoke). §5.5 → Task 1 §5 (`report_types`, `delete_empty_report`) + Task 2 (coverage grid, previous-month default, discard in editor + grid, report-types menu). §5.6 → Task 1 §6 (`expiring_items`) + Task 5 (widget buckets, alert function, digest lines, smoke). §6 smokes → Task 1 (`snapshot-smoke`, `rls-smoke` incl. the two-role probe) + Task 5 (`notifications-smoke`). §9 load (< 30 s) → snapshot-smoke step 9 + Task 6. §9 unit "snapshot column math mirrored in TS for the fixture" is NOT mirrored: the SQL is verified by the local Postgres harness (Task 1 Step 2) and the staging smoke instead — a TS mirror of a 20-column SQL aggregate would be a second implementation to keep in sync with no reader; recorded as a deliberate deviation. §10 risks: drift caption ("as of …") Task 3; reconstruction boundary Task 3 (`/trends` sentence, `reconstructed` column); multi-role fix first in the file + `rls-smoke` probe Task 1. §11 owner actions → Task 6 Step 8.
- **Placeholder scan.** No "TBD/TODO/similar to/add validation/fill in"; every code step carries code; every test step names its assertions; the one conditional ("skip `authed` if the file already defines one") is a grep, not a guess.
- **Type consistency.** `useOrgSettings()` → `{ settings, organizationId, isLoading, isError, save, isSaving }` in Contracts, Task 2 (hook + cards) and Task 4 (card). `slaState(issue, now?)`/`SlaIssueFields` in Contracts = Task 4 (`sla_target_hours?: number | string | null`). `expiring_items` columns in Contracts = Task 1 SQL = Task 5 `ExpiringItem` = snapshot-smoke step 7. `snapshots()`/`portfolioSnapshots()`/`RowBuilder` (with `lte`) in Task 3 = the PDF fetch. `SnapshotRow` field names = the SQL columns (`compliance_period`, `ohs_open_nc`, `reconstructed`). `useBuildingsTrends().rows` is `Record<string, SnapshotRow[]>` = `deltaLeaderboard`'s input. `CoverageGridProps` = the `FortressReports.tsx` mount. Card props `{ canEdit }` = the Settings mount. Notification URL `/issues?open=<id>` in SQL = smoke = existing allowlist.
