# R3c "Contractors, PPM, Costs" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The contractor register that exists only in the schema becomes a module (register, documents with expiry, assignment to issues and service records, a rating on completion); PPM gets one model (a per-building plan generates execution tasks and the report grid is derived from execution with a noted override); costs the schema already holds become visible, roll up per building per month, and export to CSV.

**Architecture:** One additive migration: `building_ppm_services` (the plan, D6), `task_instances.source_ppm_id` + a partial unique index, the `ppm_monthly_status` view rewritten to derive from PPM task instances, `ppm_services.overrides jsonb` for noted overrides, `contractor_ratings` with a trigger that keeps `contractors.rating` as the average, small contractor columns, the `building_month_costs` view, a one-shot idempotent migration of the 698 report-scoped `ppm_services` rows into plans, and `generate_scheduled_tasks` extended to generate PPM occurrences. Client: `/contractors` page + detail sheet, contractor pickers on issue / service history / PPM line / professional team, rating on resolve, Building Details → PPM tab (plan CRUD + derived grid + override), the Fortress PPM section reading the derived view, cost fields on issue/asset forms, a month-cost card, and one `exportCsv` util replacing the two XLSX writers.

**Tech Stack:** Postgres (plpgsql, views, triggers), Supabase JS, React 18 + TS, TanStack Query v5, shadcn/ui, vitest; `recurrence` rules from R3a.

**Spec:** `docs/superpowers/specs/2026-09-10-r3-plan-design.md` §5.6, §5.7, §8.

**Ground rules for every agent:** never `git stash` / `checkout` / `switch` / `reset` / `worktree`; compare with `git show <sha>:<path>`; edit only the files your task names; commit with an explicit pathspec; retry after 5 s on `index.lock`; end commit messages with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; gate = `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E '<your files>'` prints nothing, `npm run test` green, global count ≤ `.github/typecheck-baseline.txt` (53) on a clean tree; new tables/columns/RPCs are not in the generated types until the controller regenerates — cast at the boundary with `// <name> is not yet in the generated types; regenerate after the migration ships.`; guardrail copy plain, coaching through `<Hint>`; mobile-first; every new function `revoke execute … from anon`.

**Facts every task relies on:** `contractors(id, company_name, trade, contact_name, contact_email, contact_phone, rating numeric, notes, is_active, organization_id)` + `contractor_documents(id, contractor_id, document_name, document_type, file_url, expiry_date, is_verified, uploaded_at)`; RLS: select any authenticated, write admin/manager; storage `contractor-docs/` under `tenant-documents` is admin/manager-write, authenticated-read (`td read contractor docs` = admin/manager since 2026-08-04_07 — check the live policy: reads of contractor docs are admin/manager-only). `issues.contractor_id`, `issues.estimated_cost`, `issues.actual_cost` exist and are unused. `asset_service_history(id, asset_id, contractor_id, service_date, service_type, description, performed_by text, cost numeric, next_service_date, notes, created_by)`. `ppm_services(id, report_id, building_id, service_name, frequency text, comment, months jsonb {"YYYY-MM": {status,date?}}, sort_order)` unique `(report_id, service_name)`; `useReportPpm(reportId, buildingId)` upserts by client id; `PpmSection.tsx` renders the SA fiscal-year (July) 12-month grid with click-cycling; `src/lib/ppmStatus.ts` (`doneMonths`, `ppmCompletion` = K11 KPI); carry-forward in `useFortressReports.ts` clones section tables listed in `CARRY_FORWARD` (ppm_services is NOT in that list — check how PPM rows reach a new report today: grep `ppm_services` in `src/hooks/useFortressReports.ts` and `src/lib/fortressReports.ts`; if they are seeded elsewhere, keep that path and switch its source to the plan). `ppm_monthly_status` view (dead) derives from `task_instances` by `task_name`. `generate_scheduled_tasks(p_building, p_template, p_frequency, p_horizon_days)` and `recurrence_occurrences` (R3a). `building_assets` has `purchase_date, purchase_price, replacement_cost, expected_lifespan_years, warranty_expiry, warranty_provider`; `AssetsTab` edit dialog has no cost fields; `AssetServiceHistoryDialog` has a Cost input; `AssetsTab`/`TenantsTab` export via `XLSX.writeFile(..., { bookType: 'csv' })`. `ResolveIssueDialog` posts the note through the offline queue (`issue_resolve`). `ProfessionalTeamSection` keys are camelCase and pinned for iOS. `BUILDING_TYPES` in `src/lib/compliance.ts`. Prod: 698 `ppm_services` rows, 1 contractor, 0 assets, 0 costed issues, 15 admin/manager users.

---

### Task 1: Migration + smokes

**Files:** Create `../GMI/sql/2026-09-13_03_r3_contractors_ppm.sql` → vendor; modify `scripts/rls-smoke.mjs`; create `scripts/ppm-smoke.mjs`; modify `package.json` (`smoke:ppm`, and add it to the `smoke` chain after `fortress-smoke`)

```sql
-- 2026-09-13_03_r3_contractors_ppm.sql — R3c (spec §5.6, §5.7). Additive, idempotent.
begin;

-- 1) PPM plan (portfolio-level, per building). D6: plan here, execution in task_instances, grid derived.
create table if not exists public.building_ppm_services (
  id            uuid primary key default gen_random_uuid(),
  building_id   uuid not null references public.buildings(id) on delete cascade,
  service_name  text not null,
  contractor_id uuid references public.contractors(id) on delete set null,
  recurrence    jsonb not null check (public.recurrence_is_valid(recurrence) and (recurrence->>'unit') in ('month','year')),
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (building_id, service_name)
);
alter table public.building_ppm_services enable row level security;
drop policy if exists bps_select on public.building_ppm_services;
create policy bps_select on public.building_ppm_services for select using (public.can_access_building(building_id));
drop policy if exists bps_write on public.building_ppm_services;
create policy bps_write on public.building_ppm_services for all
  using (public.is_admin_or_manager() and public.can_access_building(building_id))
  with check (public.is_admin_or_manager() and public.can_access_building(building_id));

alter table public.task_instances add column if not exists source_ppm_id uuid references public.building_ppm_services(id) on delete set null;
create unique index if not exists task_instances_ppm_uniq on public.task_instances (building_id, source_ppm_id, due_date) where source_ppm_id is not null;
create index if not exists task_instances_source_ppm_idx on public.task_instances (source_ppm_id) where source_ppm_id is not null;

-- 2) PPM occurrences ride the nightly generator. Same caps and idempotency; responsible_role 'contractor';
--    assigned_to from the building's 'contractor' role rule when set.
create or replace function public.generate_ppm_tasks(p_building uuid default null, p_horizon_days integer default 0)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Africa/Johannesburg')::date; v_count integer := 0;
begin
  if auth.uid() is not null then
    if not public.is_admin_or_manager() then raise exception 'generate_ppm_tasks: admin or manager only' using errcode = '42501'; end if;
    if p_building is null then raise exception 'generate_ppm_tasks: p_building is required for signed-in callers' using errcode = '42501'; end if;
    if not public.can_access_building(p_building) then raise exception 'generate_ppm_tasks: no access to that building' using errcode = '42501'; end if;
  end if;
  insert into public.task_instances
    (building_id, source_ppm_id, task_name, task_description, frequency, responsible_role, status, due_date, requires_photo, requires_signature, assigned_to)
  select s.building_id, s.id, s.service_name, s.notes, public.legacy_frequency(s.recurrence), 'contractor', 'pending', occ.due, false, false,
         (select bra.user_id from public.building_role_assignments bra where bra.building_id = s.building_id and bra.role = 'contractor' limit 1)
    from public.building_ppm_services s
    cross join lateral (select o as due from public.recurrence_occurrences(s.recurrence, v_today, v_today + least(greatest(coalesce(p_horizon_days,0),0), 365)) o) occ
   where s.is_active and (p_building is null or s.building_id = p_building)
  on conflict (building_id, source_ppm_id, due_date) where source_ppm_id is not null do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.generate_ppm_tasks(uuid, integer) from public;
revoke execute on function public.generate_ppm_tasks(uuid, integer) from anon;
grant execute on function public.generate_ppm_tasks(uuid, integer) to authenticated, service_role;
do $$ begin perform cron.unschedule('ppm-generation-daily'); exception when others then null; end $$;
select cron.schedule('ppm-generation-daily', '10 2 * * *', 'select public.generate_ppm_tasks(null, 365)');

-- 3) Derived grid. One row per (plan line, month) that has an occurrence; status from execution.
create or replace view public.ppm_monthly_status with (security_invoker = on) as
select ti.building_id,
       ti.source_ppm_id                            as ppm_service_id,
       s.service_name,
       to_char(ti.due_date, 'YYYY-MM')             as period_month,
       case when tc.id is not null or ti.status = 'completed' then 'done'
            when ti.status = 'issue_logged' then 'missed'
            when ti.due_date < (now() at time zone 'Africa/Johannesburg')::date then 'missed'
            else 'due' end                          as status,
       max(coalesce(tc.created_at, ti.completed_at))::date as done_on
from public.task_instances ti
join public.building_ppm_services s on s.id = ti.source_ppm_id
left join public.task_completions tc on tc.task_instance_id = ti.id
where ti.source_ppm_id is not null
group by ti.building_id, ti.source_ppm_id, s.service_name, to_char(ti.due_date, 'YYYY-MM'), ti.status, tc.id, ti.due_date;

-- 4) Overrides on the report-scoped grid: {"YYYY-MM": {"status": "...", "note": "...", "by": uuid, "at": iso}}.
alter table public.ppm_services add column if not exists plan_service_id uuid references public.building_ppm_services(id) on delete set null;
alter table public.ppm_services add column if not exists overrides jsonb not null default '{}'::jsonb;

-- 5) Contractors: small columns, ratings, average trigger.
alter table public.contractors
  add column if not exists address text,
  add column if not exists vat_number text,
  add column if not exists default_trade_role text;   -- the responsible_party label this contractor serves
alter table public.contractor_documents add column if not exists notes text;
create table if not exists public.contractor_ratings (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors(id) on delete cascade,
  issue_id      uuid unique references public.issues(id) on delete cascade,
  rating        integer not null check (rating between 1 and 5),
  comment       text,
  rated_by      uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.contractor_ratings enable row level security;
drop policy if exists cr_select on public.contractor_ratings;
create policy cr_select on public.contractor_ratings for select using (auth.uid() is not null);
drop policy if exists cr_insert on public.contractor_ratings;
create policy cr_insert on public.contractor_ratings for insert
  with check (rated_by = auth.uid() and exists (select 1 from public.issues i where i.id = issue_id and public.can_access_building(i.building_id)));
create or replace function public.refresh_contractor_rating()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(new.contractor_id, old.contractor_id);
begin
  update public.contractors set rating = (select round(avg(rating)::numeric, 2) from public.contractor_ratings where contractor_id = v_id) where id = v_id;
  return null;
end $$;
revoke all on function public.refresh_contractor_rating() from public; revoke execute on function public.refresh_contractor_rating() from anon;
drop trigger if exists trg_contractor_ratings_avg on public.contractor_ratings;
create trigger trg_contractor_ratings_avg after insert or update or delete on public.contractor_ratings for each row execute function public.refresh_contractor_rating();

-- 6) Cost rollup (security invoker → RLS of the base tables applies).
create or replace view public.building_month_costs with (security_invoker = on) as
select building_id, month,
       sum(issues_actual)  as issues_actual,
       sum(services_cost)  as services_cost,
       sum(issues_actual) + sum(services_cost) as total
from (
  select i.building_id, to_char(coalesce(i.resolved_at, i.created_at), 'YYYY-MM') as month, coalesce(i.actual_cost, 0) as issues_actual, 0::numeric as services_cost
    from public.issues i where i.actual_cost is not null
  union all
  select a.building_id, to_char(h.service_date, 'YYYY-MM'), 0, coalesce(h.cost, 0)
    from public.asset_service_history h join public.building_assets a on a.id = h.asset_id where h.cost is not null
) x group by building_id, month;

-- 7) One-shot: seed plans from the existing report-scoped rows (distinct building + service).
--    Cadence from the free-text `frequency`; unknown → monthly and flagged inactive for review.
insert into public.building_ppm_services (building_id, service_name, recurrence, sort_order, is_active, notes)
select d.building_id, d.service_name,
       case
         when d.f ~* '^(monthly|every month|1 ?m)' then '{"every":1,"unit":"month","monthDay":1}'::jsonb
         when d.f ~* '(quarter|3 ?month|3m)'       then '{"every":3,"unit":"month","monthDay":1}'::jsonb
         when d.f ~* '(6 ?month|bi-?annual|half)'  then '{"every":6,"unit":"month","monthDay":1}'::jsonb
         when d.f ~* '(annual|year|12 ?month)'     then '{"every":1,"unit":"year","month":7,"monthDay":1}'::jsonb
         else '{"every":1,"unit":"month","monthDay":1}'::jsonb end,
       d.sort_order,
       d.f ~* '^(monthly|every month|1 ?m)|(quarter|3 ?month|3m)|(6 ?month|bi-?annual|half)|(annual|year|12 ?month)',
       case when d.f ~* '^(monthly|every month|1 ?m)|(quarter|3 ?month|3m)|(6 ?month|bi-?annual|half)|(annual|year|12 ?month)' then null
            else 'Migrated 2026-09-13: cadence "' || coalesce(d.f, '') || '" not recognised — set the rule and activate' end
from (
  select distinct on (building_id, service_name) building_id, service_name, coalesce(frequency, '') as f, coalesce(sort_order, 0) as sort_order
    from public.ppm_services order by building_id, service_name, created_at desc
) d
on conflict (building_id, service_name) do nothing;
update public.ppm_services p set plan_service_id = s.id
  from public.building_ppm_services s where s.building_id = p.building_id and s.service_name = p.service_name and p.plan_service_id is null;

commit;
-- Verify: select is_active, count(*) from building_ppm_services group by 1;  -- the false rows need a cadence
--         select count(*) from ppm_services where plan_service_id is null;   -- should be 0
```

Smokes: `rls-smoke` — `building_ppm_services` matrix (select by access, write admin/manager), `contractor_ratings` (insert own on an accessible issue → true; foreign `rated_by` → false; select any authenticated), anon cannot execute `generate_ppm_tasks`, site user 403; `ppm-smoke.mjs` — building + plan line (monthly on the 1st) → `generate_ppm_tasks(p_building, 120)` as admin → N occurrences with `source_ppm_id`, `responsible_role = 'contractor'`; complete one via `complete_task` → `ppm_monthly_status` shows `done` for that month and `due`/`missed` for the others; re-run generation → 0 new; rating: create issue with `contractor_id`, insert a rating → `contractors.rating` updated; `building_month_costs` sums an issue's `actual_cost` and a service `cost` for the month; cleanup.

**Controller after Task 1:** apply on staging, review the `is_active = false` migrated rows (print counts), run the smokes.

---

### Task 2: `/contractors` module

**Files:** Create `src/pages/Contractors.tsx` (+ test), `src/hooks/useContractors.ts` (+ test), `src/components/contractors/ContractorDialog.tsx`, `src/components/contractors/ContractorSheet.tsx`, `src/components/contractors/ContractorDocuments.tsx`, `src/components/contractors/ContractorPicker.tsx` (+ test); modify `src/App.tsx` (lazy route `/contractors`, admin/manager), `src/components/layout/DashboardLayout.tsx` (nav item under Admin, roles admin/manager), `supabase/functions/_shared/notifyRules.ts` + `src/lib/pushUrl.ts` (+ tests) (`/contractors` allowlisted)

- [ ] `useContractors()` (query `['contractors']`, `staleTime` 5 min; `create/update/setActive`), `useContractorDocuments(contractorId)` (upload to `tenant-documents/contractor-docs/<contractorId>/<uuid>.<ext>` through `supabase.storage` — admin/manager only per policy; insert row; expiry date; `is_verified` toggle), `useContractorHistory(contractorId)` (issues with `contractor_id`, `asset_service_history` rows, ratings). Page: list (search, trade filter, active toggle), rating stars (read-only average), New → `ContractorDialog` (company, trade, default trade role select from `responsibleParties` ∪ `contractor`, contact, address, VAT, notes, active), row → `ContractorSheet` (`ResponsiveDialog`: details, Documents section with upload + expiry chips (expiring ≤ 30 days amber, expired red), History tabs: Issues / Services / Ratings). `ContractorPicker({ value, onChange, trade? })`: `Select` of active contractors (+ "None"), used by later tasks. Tests for hook call shapes, picker, page gating.

---

### Task 3: Assignment points + rating on resolve

**Files:** Modify `src/components/issues/IssueDetailDialog.tsx` (Contractor row under Assignee, admin/manager), `src/components/building/AssetServiceHistoryDialog.tsx` (Contractor picker beside Performed by; writes `contractor_id`), `src/components/issues/ResolveIssueDialog.tsx` + `src/lib/offline/types.ts` + `src/lib/offline/handlers.ts` (+ tests) (when the issue has a `contractor_id`, the resolve dialog offers a 1–5 star rating + comment; the `issue_resolve` payload gains `rating?: { contractorId, rating, comment }` and the handler inserts `contractor_ratings` after the status flip, tolerating a duplicate `issue_id`), `src/components/building/ProfessionalTeamSection.tsx` + `src/pages/BuildingForm.tsx` (each professional field gets a "Pick from register" button that fills name/company/phone/email from a contractor — the jsonb keys stay camelCase; free text remains editable)

- [ ] Tests: IssueDetailDialog contractor change writes `contractor_id`; service history insert includes `contractor_id`; resolve payload carries the rating and the handler inserts it; professional team pick fills the fields.

---

### Task 4: PPM plan tab + derived grid + report section

**Files:** Create `src/hooks/useBuildingPpm.ts` (+ test), `src/components/building/PpmTab.tsx` (+ test), `src/lib/ppmGrid.ts` (+ test: pure merge of derived rows + overrides into the 12-month grid; `ppmCompletion` reused); modify `src/pages/BuildingDetails.tsx` (new tab `ppm` "PPM" after Assets), `src/hooks/useReportPpm.ts` (+ `PpmSection.tsx`) (the report section reads `ppm_monthly_status` for the building + fiscal window, merges `ppm_services.overrides`, renders derived cells with an override chip; clicking a cell opens a small popover: keep derived / set override status + required note; writes `overrides` — `months` stays untouched for old reports), `src/lib/ppmStatus.ts` (K11 `ppmCompletion` accepts the merged grid), `src/hooks/useFortressReports.ts` or wherever PPM rows are seeded for a new report (seed from `building_ppm_services` for the building: one `ppm_services` row per active plan line with `plan_service_id`)

- [ ] `useBuildingPpm(buildingId)`: plan lines CRUD (`building_ppm_services`), `generateNow()` → `generate_ppm_tasks(p_building, 365)`, derived grid query on the view for a fiscal window. `PpmTab`: plan lines table (service, cadence via `describeRule`, contractor picker, active), "Add service" (`RecurrenceEditor` restricted to month/year units), the derived 12-month grid (read-only here; status colours as today), "Generate now". Report `PpmSection`: derived + overrides as described; legacy reports (no `plan_service_id`) keep the old click-cycling on `months`.
- [ ] Tests: merge logic (derived wins unless an override exists; override chip; K11 from merged), tab CRUD call shapes, section override write.

---

### Task 5: Costs + CSV

**Files:** Create `src/lib/exportCsv.ts` (+ test), `src/components/building/MonthCostsCard.tsx` (+ test); modify `src/pages/NewIssue.tsx` + `src/components/issues/IssueDetailDialog.tsx` (estimated/actual cost inputs, admin/manager; `actual_cost` editable on resolved issues), `src/components/building/AssetsTab.tsx` (edit dialog gains purchase date/price, replacement cost, warranty expiry/provider, expected lifespan; export via `exportCsv`), `src/components/building/TenantsTab.tsx` (export via `exportCsv`), `src/components/building/OverviewWidgets.tsx` (mount `MonthCostsCard` after the two R2a widgets), `src/components/building/PpmTab.tsx` (export plan CSV)

- [ ] `exportCsv(rows, columns: { key, header, format? }[], filename)`: RFC 4180 quoting, BOM for Excel, `\r\n`, `text/csv` blob download (`URL.createObjectURL` + anchor; in the PWA sandbox this is the same path the XLSX writers used). Replace both `XLSX.writeFile(..., { bookType: 'csv' })` CSV branches; keep the XLSX branch for `.xlsx`. `MonthCostsCard`: current month from `building_month_costs` (`['building-month-costs', buildingId, month]`), "R 12 345 this month · issues R x · services R y", tap → a 6-month list; export CSV. Tests: quoting/BOM/newlines; card renders sums.

---

### Task 6 (controller): apply, verify, regenerate, record

- [ ] Staging apply + migrated-row review + `npm run smoke` (incl. `smoke:ppm`) + notifications/offline/calendar; prod apply (print the flagged cadence rows for the owner), `rls-smoke`; regenerate types; drop casts; whole-slice review; Status; `APPLY_CHECKLIST.md` R3c; push; PR body; memory.

---

## Status — shipped 2026-09-10 (range 4ed70ac..HEAD)

**Shipped.** `2026-09-13_03` (plan table, PPM generator + cron 04:10 SAST, derived `ppm_monthly_status`, overrides
column, contractor columns + ratings + average trigger, `building_month_costs`, one-shot seed of 698 report rows →
664 plan lines), `_04` (cadence re-derivation: 145 active / 519 inactive on staging and prod, each inactive line
carrying a note saying why), `_05` (review fixes: rating policy tied to the issue's contractor and resolved status,
admin delete, FKs on `issues.contractor_id` / `asset_service_history.contractor_id`, SAST month buckets,
resolved-only costs, touch trigger, `reschedule_ppm_line` + trigger on `is_active`/`recurrence`, overrides guard).
Client: `/contractors` module (register, documents with expiry chips, history, picker), contractor on issues /
service records / PPM lines / professional team, rating on resolve through the offline queue, Building → PPM tab
(plan CRUD, derived grid, Generate now, CSV), report PPM section reading derived + overrides (legacy rows keep
click-cycling; plan-backed rows seeded on create and carry-forward, "Sync with the PPM plan" for later lines),
cost fields on issue/asset forms, `MonthCostsCard`, one `exportCsv`, `money.ts`, `pgErrors.ts`, `ppmGridFetch.ts`,
`network.ts`. Types regenerated from prod; casts dropped. Smokes on staging: ppm 33/0, rls 518/0, calendar 21/0,
notifications 34/0, offline 21/0, checklist 34/0, fortress all pass; prod rls 518/0. Vitest 1193, tsc 51 = baseline.

**Decisions taken.** Plan lines are never hard-deleted (deactivate; the DB trigger removes untouched future
occurrences and history is kept). Overrides live in `ppm_services.overrides` (not inside `months`, as spec §5.6
first said) and are admin/manager-only via a guard trigger (42501). The calendar shows plan occurrences as task
events only; plan-backed report rows contribute override cells alone (in-app and ICS). The merged grid ranks
missed > done > due when a month has several occurrences. The cadence migration never infers from a single
captured month; explicit non-month strings (Weekly, Adhoc, N/A) stay inactive for a human. Rating is best-effort
after the status flip: a server rejection completes the op and the dialog says so; a transport failure re-queues
the whole op. Ratings survive as one per issue (duplicate → "earlier rating kept").

**Follow-ups.** Owner: review the 519 inactive plan lines per building (Building → PPM) and switch them on.
`reschedule_ppm_line` is trigger-driven only; the client never calls it. Report PPM "Delete" is hidden for
plan-backed rows. `RecurrenceEditor` still offers day/week; PpmTab rejects them after the fact. Five
`TaskFrequency` unions and the `CalendarView` page split remain from R3a/R3b.
