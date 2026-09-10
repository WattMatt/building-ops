# R3 "Plan" — design

Date: 2026-09-10 · Parent: `2026-09-10-daily-ops-v2-roadmap-design.md` §5 R3 · Status: DRAFT (applies the roadmap and decisions D1–D11; R0–R2 are live on staging and prod)

Headline: **Next month's work is already scheduled, owned, and on a calendar.**

## 1. What R3 changes, in one paragraph

R2 made today's work reachable on a phone. R3 makes next month's work exist before anyone asks for it. Checklist templates get real recurrence rules instead of five fixed buckets, a per-building rule says which person owns each role, and the nightly generator fills a rolling horizon so planning views are never empty. Admins can create, edit and archive templates in the app. Every dated thing in the portfolio — tasks, asset services, document expiries, PPM services, issue deadlines, sign-off due dates — lands on one calendar, per building and across the portfolio, and each user and building gets a subscribable ICS feed. The contractor register that exists in the schema but not in the app becomes a module: documents with expiry, assignment to issues and service records, a rating on completion. PPM gets one model: a per-building plan generates execution tasks, and the report grid is derived from execution with a manual override that leaves a note. Costs that the schema already holds (issue estimated/actual, asset purchase/replacement/warranty, service cost) become visible, roll up per building per month, and export to CSV. The reviewer role, which no production user holds and no policy empowers, is removed.

## 2. Facts that shape the design (from the 2026-09-10 survey and live counts)

- Production: 15 users, all `admin` (4) or `manager` (11); no `reviewer`, no `user`. 47 buildings, all classified. 11 templates / 68 items (seeded, read-only in the UI). 698 `ppm_services` rows in real use. 0 assets, 0 form submissions, 0 costed issues, 1 contractor.
- `generate_scheduled_tasks` produces one occurrence per period from the five-value `frequency` enum; `responsible_role` is hardcoded `'user'`; `assigned_to` is never set. The enum is load-bearing for iOS (six-monthly obligations were folded into quarterly to avoid a new value).
- `task_instances_generated_uniq (building_id, template_item_id, due_date)` makes horizon generation safe to re-run and forbids two occurrences of one item on one date.
- `checklist_templates` has no write path in the app; `template_items` has full CRUD (`TemplateItemDialog`).
- `ppm_services` is report-scoped (`report_id`, carried forward each month); the `ppm_monthly_status` view over `task_instances` is dead. D6 says: plan in `ppm_services`, execution in `task_instances`, view derives.
- Contractors: `contractors`, `contractor_documents`, `issues.contractor_id`, `asset_service_history.contractor_id` all exist and are unreferenced by any code. `c_select` grants read to every authenticated user (org-level register, fine).
- `MaintenanceCalendarTab` renders assets only; no ICS anywhere. `notify-expiring-alerts` emails but never writes inbox rows, so `document_expiring` / `asset_service_due` have no live producer.
- Reviewer: no RLS policy names it; its only capability is a client-side branch in `FortressReportEditor` (`submitted → reviewed`).
- Form "templates" are two divergent hardcoded arrays keyed by `'1'…'14'` with label-keyed fields; `form_submissions.form_template_id` holds those strings.

## 3. Decisions applied and constraints

- D4 **remove the reviewer role** (zero holders, zero server-side power). D6 PPM: plan → execution → derived view. D1 person-first: generation assigns a person, not just a role.
- Additive schema only (iOS shares it): recurrence lives in a NEW jsonb column next to `frequency`; `frequency` keeps being written with the nearest legacy bucket so iOS and the reports keep working. Nothing iOS reads changes meaning.
- RLS remains the boundary; new tables get owner/building policies in the same migration; new RPCs revoke `anon` explicitly; definer functions check role + building for signed-in callers (R2a lesson).
- Timezone: still the org constant `Africa/Johannesburg`.
- Hint rule unchanged. Mobile-first for anything a site role touches (calendar week view on phones).
- Form template administration (`form_templates` table) is **deferred to R4**: zero submissions exist, the two hardcoded arrays are a code-quality problem rather than a user problem, and R3 is already three slices. R3 only de-duplicates the arrays into one module.

## 4. Three slices, each its own plan

| Slice | Theme | Depends on |
|---|---|---|
| R3a Schedule | recurrence rules + rolling horizon + assignment rules in generation, template administration (create/edit/archive), reviewer role removal, inbox producers for expiring documents/assets | R2 live |
| R3b Calendar | unified calendar (portfolio + building), drag-to-reschedule tasks, ICS feeds with signed tokens, calendar surfaces on My Day and Building Details | R3a horizon |
| R3c Contractors, PPM, Costs | contractor register UI + documents + assignment + rating; PPM plan → execution → derived grid with override; cost capture, month rollup, CSV | R3a generation (PPM tasks), R3b calendar (PPM on it) |

## 5. Schema (R3a migration `2026-09-13_01_r3_schedule.sql`; R3b `_02_r3_calendar.sql`; R3c `_03_r3_contractors_ppm.sql`)

### 5.1 Recurrence (R3a)

```sql
alter table public.checklist_templates
  add column if not exists recurrence jsonb,          -- null = derive from frequency (legacy)
  add column if not exists archived_at timestamptz,   -- archive instead of delete
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists version integer not null default 1;
```

`recurrence` shape (validated by a CHECK using `jsonb_typeof` and a small pure validator mirrored in TS):

```json
{ "every": 1, "unit": "day" | "week" | "month" | "year",
  "weekdays": [1,2,3,4,5],          // week unit only; ISO 1=Mon … 7=Sun
  "monthDay": 1 | "last",           // month/year units; day of month or last day
  "month": 7,                       // year unit only: 1–12
  "lead": 0 }                       // days before the anchor the task appears (due_date stays the anchor)
```

`frequency` (legacy) is set by trigger from `recurrence` on write: day→`daily`, week→`weekly`, month with every 1→`monthly`, month with every 3→`quarterly`, month every 6→`quarterly` (documented downgrade), year→`annually`. Templates with `recurrence is null` keep behaving exactly as today.

Pure function `public.recurrence_occurrences(p_recurrence jsonb, p_from date, p_to date) returns setof date` (immutable, plpgsql, bounded to 400 dates) mirrored by `src/lib/recurrence.ts` `occurrences(rule, from, to)`; both pinned by `docs/fixtures/recurrence-occurrences.json`.

### 5.2 Rolling horizon + assignment (R3a)

```sql
create table if not exists public.building_role_assignments (
  building_id uuid not null references public.buildings(id) on delete cascade,
  role        text not null,                          -- 'user' | 'manager' | free role label from template_items.responsible_party
  user_id     uuid not null references public.profiles(id) on delete cascade,
  primary key (building_id, role)
);
-- RLS: select can_access_building; write is_admin_or_manager
```

`generate_scheduled_tasks(p_building, p_template, p_frequency, p_horizon_days integer default 0)`: for each template × building, due dates = `recurrence is null ? scheduled_due_date(frequency, today) : recurrence_occurrences(recurrence, today, today + horizon)`; inserts with `responsible_role = coalesce(ct.responsible_role, 'user')` and `assigned_to = (select user_id from building_role_assignments where building_id = b.id and role = coalesce(ti.responsible_party, ct.responsible_role, 'user'))`. Cron: `task-generation-daily` passes `p_horizon_days => 90`. Existing unique index makes re-runs idempotent. A change to a template's recurrence deletes future **pending, unassigned-by-hand** occurrences (`status = 'pending' and due_date > today and template_item_id in (…)` where no completion exists) and regenerates — done inside the RPC `reschedule_template(p_template)`, admin/manager only.

### 5.3 Reviewer removal (R3a)

`user_roles` check → `('admin','manager','user')`; `role_precedence` CASE drops reviewer; `invite-user` / `set-user-role` allowlists; client unions; `FortressReportEditor` branch removed (managers already move `submitted → reviewed/approved`). A guard `do $$ … if exists (select 1 from user_roles where role='reviewer') then raise …` protects an environment that still has one.

### 5.4 Inbox producers (R3a)

`notify-expiring-alerts` writes `document_expiring` / `asset_service_due` inbox rows through `createNotifications` (recipients: admins + managers; no email — `DIGEST_ONLY`), idempotent per entity per day (`entity_id` + `created_at >= today`).

### 5.5 Calendar tokens (R3b)

```sql
create table if not exists public.calendar_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  building_id uuid references public.buildings(id) on delete cascade,   -- null = "my" feed
  token text not null unique,          -- 32 random bytes, base64url; only its hash is compared? No: stored plain, RLS owner-only, rotate on demand
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
-- RLS owner-only; the edge function reads with the service role by token.
```

`ics-feed` edge function (`verify_jwt = false`): `GET /ics-feed?t=<token>` → `text/calendar` with VEVENTs (tasks due, issue deadlines, document expiries, asset next-service, PPM due months, sign-off due) for the token's scope, respecting `can_access_building` as of the token's owner (the function evaluates access with a service-role query on `user_buildings`/roles — same rule as `can_access_building`). Revoked/unknown token → 404. Feed is read-only, no PII beyond titles.

### 5.6 PPM plan (R3c)

```sql
create table if not exists public.building_ppm_services (      -- the portfolio-level plan (D6)
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  service_name text not null,
  contractor_id uuid references public.contractors(id) on delete set null,
  recurrence jsonb not null,                                     -- §5.1 shape, month/year units
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (building_id, service_name)
);
alter table public.task_instances add column if not exists source_ppm_id uuid references public.building_ppm_services(id) on delete set null;
create unique index if not exists task_instances_ppm_uniq on public.task_instances (building_id, source_ppm_id, due_date) where source_ppm_id is not null;
```

Generation creates one `task_instances` row per PPM occurrence (name `service_name`, `responsible_role 'contractor'`, `assigned_to` from the building's contractor rule when set). `ppm_monthly_status` view is rewritten to derive `(building_id, service_name, period_month, status)` from those instances: `done` when a completion exists, `missed` when overdue, `due` otherwise. `ppm_services.months` stays as the **override layer**: the report section renders derived status and, when a cell differs from the derived value, stores `{status, note, by, at}` and shows it as an override chip. Report carry-forward stops copying `ppm_services` rows and instead seeds them from `building_ppm_services` for the building. Existing 698 rows are migrated once into `building_ppm_services` (distinct `building_id, service_name` with a `recurrence` guessed from `frequency` text — `'monthly'|'quarterly'|'annually'|'6 monthly'` map; unknown → month every 1 flagged for review).

### 5.7 Contractors + costs (R3c)

`contractors` gains `address text`, `vat_number text`, `default_trade_role text` (the `responsible_party` label it serves, so assignment rules can point a role at a contractor); `contractor_documents` gains `notes text`; `issues` already has `contractor_id`, `estimated_cost`, `actual_cost`; `asset_service_history` has `contractor_id`, `cost`; new `contractor_ratings (contractor_id, issue_id unique, rating 1–5, comment, rated_by, created_at)` with `contractors.rating` recomputed by trigger as the average. Cost rollup view `building_month_costs (building_id, month, issues_actual, services_cost, total)` security invoker.

## 6. R3a — Schedule

- **Template administration** (`/checklists` → Templates): create/edit/archive dialog for `checklist_templates` (name, description, recurrence editor, responsible role, building types); archived templates hidden by default, restorable; every save bumps `version` and `updated_at`; `reschedule_template` runs after a recurrence change with a confirmation that says how many future pending tasks will be regenerated.
- **Recurrence editor**: "Every N day/week/month/year", weekday chips for weeks, "on day N / last day" for months, month + day for years, "show N days before". Preview lists the next 6 occurrences via `occurrences()` (pure TS, same fixture as SQL).
- **Assignment rules**: Building Details → Checklists tab gains "Who does what here": rows per role label used by the building's templates (`responsible_party` values + `user`/`manager`), each a member picker (`useBuildingMembers`); saved to `building_role_assignments`; "Apply to existing pending tasks" bulk-sets `assigned_to` and sends one `task_assigned` notification per person.
- **Horizon**: Checklists tab shows the next 30 days grouped by week (replaces the single-frequency month grid on phones; desktop keeps the grid). `generate_scheduled_tasks(…, 90)` nightly; the manual buttons pass the horizon too.
- **Reviewer removal** per §5.3; `UserManagement` no longer offers it.
- **Inbox producers** per §5.4; the digest email lists expiring documents already — unchanged.

## 7. R3b — Calendar

- `/calendar` (portfolio, admin/manager) and Building Details → Calendar (replaces `MaintenanceCalendarTab`): month and week views (`react-big-calendar` is NOT added; a small in-house grid built on date-fns like the two existing grids, extracted to `components/calendar/`), event sources through one `useCalendarEvents(scope, range)` hook that fans out to six queries with `PERSIST_DEFAULTS` for the user's buildings, colour by source, filter chips per source, tap → the existing dialog for the entity (task complete, issue detail, document, asset, PPM line, sign-off).
- Drag-to-reschedule for tasks (`update task_instances set due_date` as admin/manager; a 23505 on the unique index → "That task already has an occurrence on that day"); other sources are read-only on the calendar.
- ICS: Profile → "Calendar subscription" (my feed URL, copy, regenerate); Building Details → Calendar → "Subscribe" (building feed, admin/manager). Tokens per §5.5; the feed function renders 90 days back / 180 forward, `X-WR-CALNAME`, stable `UID`s (`<kind>-<id>@buildingops.app`), `DTSTART;VALUE=DATE` for all-day items.
- My Day gains a "This week" strip (7 day columns, counts) linking into the calendar.

## 8. R3c — Contractors, PPM, Costs

- `/contractors` (admin/manager): register list with trade filter, create/edit, active toggle, rating shown; detail sheet with documents (upload to `contractor-docs/` — admin/manager only per storage policy — expiry date; expiring docs feed `notify-expiring-alerts` with a new `contractor_document_expiring`? No: reuse `document_expiring` with `entity_type 'document'` and the contractor name in the title), assigned issues and service history.
- Assignment: issue detail "Contractor" picker (writes `issues.contractor_id`, `issue_assigned`-style notification is not sent — contractors have no login), asset service history dialog contractor picker (writes `contractor_id`), PPM plan line contractor. Building form professional team: picker over the register with free-text fallback (keeps the camelCase jsonb contract for iOS).
- Rating: when an issue with a contractor is resolved, the resolve dialog offers a 1–5 rating + comment → `contractor_ratings`.
- PPM per §5.6: Building Details → PPM tab (plan lines CRUD with recurrence + contractor), derived grid, override with note; the Fortress PPM report section reads the derived view for the fiscal window and shows override chips; carry-forward seeds from the plan.
- Costs: `NewIssue`/`IssueDetailDialog` estimated/actual cost fields (admin/manager), `AssetsTab` edit form exposes purchase/replacement/warranty; Building Details overview card "This month's costs" (from `building_month_costs`), CSV export through one `exportCsv(rows, columns, filename)` util (replaces the two ad-hoc XLSX writers) — issues, assets, service history, PPM plan, cost rollup.

## 9. Testing

- Unit: `recurrence.ts` against the shared fixture (SQL pinned by the same file via the controller's staging query); recurrence editor state; horizon grouping; assignment-rule resolution (pure); reviewer removal type-level (union) + UserManagement options; calendar event merging/colouring/range windows; ICS rendering (pure `renderIcs(events)` with folding and escaping, unit-tested); PPM derivation (pure mirror of the view for the fixture); override diffing; cost rollup formatting; CSV escaping.
- Smokes: `checklist-smoke` gains horizon generation (count of occurrences over 90 days for a weekly rule), assignment rule → `assigned_to` set, `reschedule_template` regenerating; `rls-smoke` gains `building_role_assignments`, `calendar_tokens` (owner-only; anon cannot read), `building_ppm_services`, `contractor_ratings` matrices and the reviewer value being rejected by the check; new `calendar-smoke` (ICS feed 200 with a valid token, 404 revoked, no cross-building leakage); new `ppm-smoke` (plan line → generated tasks → derived grid → override); `notifications-smoke` asserts `document_expiring` inbox rows from `notify-expiring-alerts`.

## 10. Risks and mitigations

- **iOS reads `frequency`.** Kept and derived; never removed. iOS ignores `recurrence`.
- **Horizon backfill volume.** 47 buildings × 68 items × 90 days of dailies ≈ 300k rows if every item were daily. Dailies are generated only 14 days ahead; weeklies 90; monthly+ 365. Bounded per unit in the generator and documented.
- **Regenerating on rule change** must never touch completed or manually edited tasks: only `pending`, future, with no completion and `assigned_to` unchanged from the rule's value (or null) are deleted.
- **ICS tokens are bearer secrets.** Owner-only rows, rotate button, revoked tokens 404, feed contains titles only; documented in Profile copy.
- **PPM migration of 698 rows.** One-shot, idempotent (`unique (building_id, service_name)` + `on conflict do nothing`), unknown cadence flagged `is_active = false` with a note for review; the old `ppm_services` rows are untouched until R3c's report section ships.
- **Contractor documents in `contractor-docs/` are admin/manager-write.** Site roles never upload there (matches the storage policy from 2026-08-04).

## 11. Owner actions this release needs

Apply three migrations staging → prod (the PPM migration prints the flagged rows to review), deploy `ics-feed` and the retrofitted `notify-expiring-alerts`, confirm the PPM cadence mapping for the flagged lines, decide contractor trades/roles labels, and try the ICS feed in Outlook/Google once.
