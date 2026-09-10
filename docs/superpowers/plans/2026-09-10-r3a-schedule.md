# R3a "Schedule" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Checklist templates carry real recurrence rules, the nightly generator fills a rolling horizon and assigns a person per building role, admins manage templates in the app, the reviewer role is gone, and expiring documents/assets reach the inbox.

**Architecture:** One additive migration: `checklist_templates.recurrence jsonb` (+ `archived_at`, `updated_at`, `version`) with a validator and a trigger that keeps the legacy `frequency` in sync for iOS; a pure `recurrence_occurrences()` SQL function mirrored by `src/lib/recurrence.ts` and pinned by a shared fixture; `building_role_assignments` mapping role labels to people; `generate_scheduled_tasks` gains `p_horizon_days` with per-unit caps and sets `assigned_to`; `reschedule_template` regenerates untouched future occurrences after a rule change. Client: a template dialog with a recurrence editor, a "Who does what here" panel on the Checklists tab, a next-30-days view, reviewer removed everywhere, and `notify-expiring-alerts` writing inbox rows.

**Tech Stack:** Postgres (plpgsql, pg_cron), Supabase JS, React 18 + TS, TanStack Query v5, shadcn/ui, vitest, Deno edge function (read-verified).

**Spec:** `docs/superpowers/specs/2026-09-10-r3-plan-design.md` §5.1–§5.4, §6.

**Ground rules for every agent:** never `git stash` / `checkout` / `switch` / `reset` / `worktree`; compare with `git show <sha>:<path>`; edit only the files your task names; commit with an explicit pathspec; retry after 5 s on `index.lock`; end commit messages with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; gate = `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E '<your files>'` prints nothing, `npm run test` green, global count ≤ `.github/typecheck-baseline.txt` (56) on a clean tree; the new column/table/RPC names are not in the generated types until the controller regenerates them after the prod apply, so cast at the boundary with the comment `// <name> is not yet in the generated types; regenerate after the migration ships.`; guardrail copy plain, coaching through `<Hint>`; mobile-first; every new function `revoke execute … from anon`.

**Facts every task relies on:** `checklist_templates` columns `id, name, description, frequency (text, five values), responsible_role, is_active, organization_id, applies_to_building_types text[]`; `template_items` `id, template_id, task_name, task_description, responsible_party (free text from a fixed list in TemplateItemDialog), requires_photo, requires_signature, display_order, category`; `task_instances` unique `(building_id, template_item_id, due_date)`; `generate_scheduled_tasks(p_building, p_template, p_frequency)` in `supabase/schema/2026-09-12_01_r2_field.sql` (signed-in callers must pass `p_building`; cron passes nothing); `scheduled_due_date`; `enforce_hs_template_scope` trigger; RLS `ct_*`/`tpl_*` = select any authenticated, write admin/manager; `useBuildingMembers(buildingId)` → `{ data: BuildingMember[], byId }`; `notify()` seam; `Checklists.tsx` owns template cards + item CRUD; `ChecklistsTab.tsx` owns per-building tasks, assignment (`assignTasks`), generate buttons, and a month grid per frequency; production has 0 reviewers, 0 `user`-role accounts, 11 templates / 68 items, 47 classified buildings.

---

### Task 1: Migration + fixture + smoke assertions

**Files:**
- Create: `../GMI/sql/2026-09-13_01_r3_schedule.sql` → vendor to `supabase/schema/`
- Create: `docs/fixtures/recurrence-occurrences.json`
- Modify: `scripts/checklist-smoke.mjs`, `scripts/rls-smoke.mjs`

- [x] **Step 1: Fixture** (the SQL and TS implementations must both reproduce every row; the controller checks SQL on staging):

```json
[
  { "rule": { "every": 1, "unit": "day" }, "from": "2026-09-10", "to": "2026-09-13", "expected": ["2026-09-10","2026-09-11","2026-09-12","2026-09-13"] },
  { "rule": { "every": 2, "unit": "day" }, "from": "2026-09-10", "to": "2026-09-15", "expected": ["2026-09-10","2026-09-12","2026-09-14"] },
  { "rule": { "every": 1, "unit": "week", "weekdays": [1,3,5] }, "from": "2026-09-10", "to": "2026-09-20", "expected": ["2026-09-11","2026-09-14","2026-09-16","2026-09-18"] },
  { "rule": { "every": 2, "unit": "week", "weekdays": [1] }, "from": "2026-09-07", "to": "2026-10-06", "expected": ["2026-09-07","2026-09-21","2026-10-05"] },
  { "rule": { "every": 1, "unit": "month", "monthDay": 1 }, "from": "2026-09-10", "to": "2026-12-31", "expected": ["2026-10-01","2026-11-01","2026-12-01"] },
  { "rule": { "every": 1, "unit": "month", "monthDay": "last" }, "from": "2026-01-15", "to": "2026-04-30", "expected": ["2026-01-31","2026-02-28","2026-03-31","2026-04-30"] },
  { "rule": { "every": 3, "unit": "month", "monthDay": 15 }, "from": "2026-09-10", "to": "2027-04-30", "expected": ["2026-09-15","2026-12-15","2027-03-15"] },
  { "rule": { "every": 6, "unit": "month", "monthDay": 1 }, "from": "2026-09-10", "to": "2027-12-31", "expected": ["2026-10-01","2027-04-01","2027-10-01"] },
  { "rule": { "every": 1, "unit": "year", "month": 1, "monthDay": 1 }, "from": "2026-09-10", "to": "2028-12-31", "expected": ["2027-01-01","2028-01-01"] },
  { "rule": { "every": 1, "unit": "month", "monthDay": 31 }, "from": "2026-01-15", "to": "2026-05-01", "expected": ["2026-01-31","2026-02-28","2026-03-31","2026-04-30"] }
]
```

Semantics: `from`/`to` inclusive. `day`: from `from`, every N days. `week`: weeks are Monday-start; week 0 is the week containing `from`; every N weeks the listed ISO weekdays (1 = Mon … 7 = Sun), dates < `from` dropped. `month`: starting from `from`'s month and scanning month by month, the anchor is the first candidate whose `monthDay` (clamped to the month's last day; `"last"` = last day) is ≥ `from`; then every N months from that anchor, `monthDay` clamped per occurrence month (so every 6 months on the 1st from 2026-09-10 → 2026-10-01, 2027-04-01, 2027-10-01). `year`: starting from `from`'s year and scanning year by year, the anchor is the first candidate whose `month`/`monthDay` (clamped) is ≥ `from`; then every N years from that anchor. `lead` (default 0) is NOT applied by `occurrences` (it shifts visibility, not the due date) — ignore in this task.

- [x] **Step 2: Migration**

```sql
-- 2026-09-13_01_r3_schedule.sql — R3a "Schedule" (spec §5.1–§5.4). Additive, idempotent.
-- Apply order: staging -> npm run smoke -> prod. iOS keeps reading `frequency`; it ignores the rest.
begin;

-- 1) Template columns. recurrence NULL = legacy five-bucket behaviour, unchanged.
alter table public.checklist_templates
  add column if not exists recurrence  jsonb,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists version     integer not null default 1;

create or replace function public.recurrence_is_valid(r jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select r is null or (
    jsonb_typeof(r) = 'object'
    and (r->>'unit') in ('day','week','month','year')
    and (r->>'every') ~ '^[0-9]+$' and (r->>'every')::int between 1 and 52
    and (r->'weekdays' is null or (jsonb_typeof(r->'weekdays') = 'array'
         and not exists (select 1 from jsonb_array_elements_text(r->'weekdays') d where d !~ '^[1-7]$')))
    and (r->'monthDay' is null or (r->>'monthDay') = 'last' or ((r->>'monthDay') ~ '^[0-9]+$' and (r->>'monthDay')::int between 1 and 31))
    and (r->'month' is null or ((r->>'month') ~ '^[0-9]+$' and (r->>'month')::int between 1 and 12))
    and (r->'lead' is null or ((r->>'lead') ~ '^[0-9]+$' and (r->>'lead')::int between 0 and 60))
    and ((r->>'unit') <> 'week' or r->'weekdays' is not null)
    and ((r->>'unit') <> 'year' or r->'month' is not null)
  )
$$;
alter table public.checklist_templates drop constraint if exists checklist_templates_recurrence_check;
alter table public.checklist_templates add constraint checklist_templates_recurrence_check check (public.recurrence_is_valid(recurrence));

-- Legacy bucket derived from the rule so iOS and the reports keep working (documented downgrades:
-- every-6-months -> quarterly; anything else with month unit -> monthly).
create or replace function public.legacy_frequency(r jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when r is null then null
    when r->>'unit' = 'day' then 'daily'
    when r->>'unit' = 'week' then 'weekly'
    when r->>'unit' = 'month' and (r->>'every')::int in (3,6) then 'quarterly'
    when r->>'unit' = 'month' then 'monthly'
    else 'annually' end
$$;
create or replace function public.sync_frequency_from_recurrence()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.recurrence is not null then new.frequency := public.legacy_frequency(new.recurrence); end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' and (new.recurrence is distinct from old.recurrence or new.name is distinct from old.name
      or new.responsible_role is distinct from old.responsible_role
      or new.applies_to_building_types is distinct from old.applies_to_building_types) then
    new.version := old.version + 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_checklist_templates_recurrence on public.checklist_templates;
create trigger trg_checklist_templates_recurrence before insert or update on public.checklist_templates
  for each row execute function public.sync_frequency_from_recurrence();

-- 2) Occurrences. Pure; bounded to 400 dates. Semantics pinned by docs/fixtures/recurrence-occurrences.json.
create or replace function public.recurrence_occurrences(r jsonb, p_from date, p_to date)
returns setof date language plpgsql immutable set search_path = '' as $$
declare
  v_unit text := r->>'unit'; v_every int := (r->>'every')::int; v_n int := 0;
  d date; wk_start date; i int; md text; y int; m int;
begin
  if r is null or p_to < p_from then return; end if;
  if v_unit = 'day' then
    d := p_from;
    while d <= p_to and v_n < 400 loop return next d; v_n := v_n + 1; d := d + v_every; end loop;
  elsif v_unit = 'week' then
    wk_start := date_trunc('week', p_from::timestamp)::date;   -- Monday
    while wk_start <= p_to and v_n < 400 loop
      for i in select (x)::int from jsonb_array_elements_text(r->'weekdays') x order by 1 loop
        d := wk_start + (i - 1);
        if d >= p_from and d <= p_to then return next d; v_n := v_n + 1; end if;
      end loop;
      wk_start := wk_start + (7 * v_every);
    end loop;
  elsif v_unit = 'month' then
    md := coalesce(r->>'monthDay', '1');
    d := date_trunc('month', p_from::timestamp)::date;
    while d <= p_to and v_n < 400 loop
      if md = 'last' then y := (d + interval '1 month' - interval '1 day')::date - d + 1; else y := least(md::int, ((d + interval '1 month' - interval '1 day')::date - d + 1)); end if;
      if d + (y - 1) >= p_from and d + (y - 1) <= p_to then return next d + (y - 1); v_n := v_n + 1; end if;
      d := (d + (v_every || ' months')::interval)::date;
    end loop;
  elsif v_unit = 'year' then
    m := (r->>'month')::int; md := coalesce(r->>'monthDay', '1');
    y := extract(year from p_from)::int;
    while make_date(y, 1, 1) <= p_to and v_n < 400 loop
      d := make_date(y, m, 1);
      if md = 'last' then d := (d + interval '1 month' - interval '1 day')::date; else d := d + (least(md::int, ((d + interval '1 month' - interval '1 day')::date - d + 1)) - 1); end if;
      if d >= p_from and d <= p_to then return next d; v_n := v_n + 1; end if;
      y := y + v_every;
    end loop;
  end if;
end $$;
revoke all on function public.recurrence_occurrences(jsonb, date, date) from public;
revoke execute on function public.recurrence_occurrences(jsonb, date, date) from anon;
grant execute on function public.recurrence_occurrences(jsonb, date, date) to authenticated, service_role;
revoke all on function public.recurrence_is_valid(jsonb) from public; revoke execute on function public.recurrence_is_valid(jsonb) from anon;
grant execute on function public.recurrence_is_valid(jsonb) to authenticated, service_role;
revoke all on function public.legacy_frequency(jsonb) from public; revoke execute on function public.legacy_frequency(jsonb) from anon;
grant execute on function public.legacy_frequency(jsonb) to authenticated, service_role;

-- 3) Who does what per building. role = a label used by template_items.responsible_party or
--    checklist_templates.responsible_role ('user','manager', 'HVAC Contractor', ...).
create table if not exists public.building_role_assignments (
  building_id uuid not null references public.buildings(id) on delete cascade,
  role        text not null,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  primary key (building_id, role)
);
alter table public.building_role_assignments enable row level security;
drop policy if exists bra_select on public.building_role_assignments;
create policy bra_select on public.building_role_assignments for select using (public.can_access_building(building_id));
drop policy if exists bra_write on public.building_role_assignments;
create policy bra_write on public.building_role_assignments for all
  using (public.is_admin_or_manager() and public.can_access_building(building_id))
  with check (public.is_admin_or_manager() and public.can_access_building(building_id));

-- 4) Generation v2: horizon + assignment. Per-unit caps keep the row count sane
--    (dailies 14 days ahead, weeklies 90, monthly+ 365), whatever p_horizon_days says.
create or replace function public.generate_scheduled_tasks(
  p_building uuid default null, p_template uuid default null, p_frequency text default null, p_horizon_days integer default 0)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Africa/Johannesburg')::date; v_count integer := 0;
begin
  if auth.uid() is not null then
    if not public.is_admin_or_manager() then raise exception 'generate_scheduled_tasks: admin or manager only' using errcode = '42501'; end if;
    if p_building is null then raise exception 'generate_scheduled_tasks: p_building is required for signed-in callers' using errcode = '42501'; end if;
    if not public.can_access_building(p_building) then raise exception 'generate_scheduled_tasks: no access to that building' using errcode = '42501'; end if;
  end if;

  insert into public.task_instances
    (building_id, template_item_id, task_name, task_description, frequency, responsible_role, status, due_date,
     requires_photo, requires_signature, assigned_to)
  select b.id, ti.id, ti.task_name, ti.task_description, ct.frequency,
         coalesce(ti.responsible_party, ct.responsible_role, 'user'), 'pending', occ.due,
         ti.requires_photo, ti.requires_signature,
         (select bra.user_id from public.building_role_assignments bra
           where bra.building_id = b.id and bra.role = coalesce(ti.responsible_party, ct.responsible_role, 'user') limit 1)
    from public.checklist_templates ct
    join public.template_items ti on ti.template_id = ct.id
    cross join public.buildings b
    cross join lateral (
      select d as due from (
        select case when ct.recurrence is null then public.scheduled_due_date(ct.frequency, v_today) end as d
        union all
        select public.recurrence_occurrences(ct.recurrence, v_today,
          v_today + least(greatest(p_horizon_days, 0),
            case ct.recurrence->>'unit' when 'day' then 14 when 'week' then 90 else 365 end))
        where ct.recurrence is not null
      ) x where d is not null
    ) occ
   where ct.is_active is distinct from false and ct.archived_at is null
     and ct.frequency in ('daily','weekly','monthly','quarterly','annually')
     and (p_building  is null or b.id = p_building)
     and (p_template  is null or ct.id = p_template)
     and (p_frequency is null or ct.frequency = p_frequency)
     and (ct.applies_to_building_types is null or b.building_type = any (ct.applies_to_building_types))
  on conflict (building_id, template_item_id, due_date) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.generate_scheduled_tasks(uuid, uuid, text, integer) from public;
revoke execute on function public.generate_scheduled_tasks(uuid, uuid, text, integer) from anon;
grant execute on function public.generate_scheduled_tasks(uuid, uuid, text, integer) to authenticated, service_role;
drop function if exists public.generate_scheduled_tasks(uuid, uuid, text);   -- old 3-arg signature

-- 5) After a rule change: drop untouched future occurrences of the template and regenerate.
--    Untouched = pending, due after today, no completion, and assigned_to equals what the rule
--    would give (or null) — anything a person edited by hand stays.
create or replace function public.reschedule_template(p_template uuid)
returns table (deleted integer, generated integer) language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Africa/Johannesburg')::date; v_del integer := 0; v_gen integer := 0; b record;
begin
  if auth.uid() is null or not public.is_admin_or_manager() then raise exception 'reschedule_template: admin or manager only' using errcode = '42501'; end if;
  delete from public.task_instances t
   using public.template_items ti
   where ti.id = t.template_item_id and ti.template_id = p_template
     and t.status = 'pending' and t.due_date > v_today
     and not exists (select 1 from public.task_completions tc where tc.task_instance_id = t.id)
     and (t.assigned_to is null or t.assigned_to = (select bra.user_id from public.building_role_assignments bra
            where bra.building_id = t.building_id and bra.role = t.responsible_role limit 1));
  get diagnostics v_del = row_count;
  for b in select id from public.buildings where public.can_access_building(id) loop
    v_gen := v_gen + public.generate_scheduled_tasks(b.id, p_template, null, 365);
  end loop;
  return query select v_del, v_gen;
end $$;
revoke all on function public.reschedule_template(uuid) from public;
revoke execute on function public.reschedule_template(uuid) from anon;
grant execute on function public.reschedule_template(uuid) to authenticated;

-- 6) Reviewer role removed (D4: zero holders, zero server-side power).
do $$ begin
  if exists (select 1 from public.user_roles where role = 'reviewer') then
    raise exception 'user_roles still holds reviewer rows; reassign them before applying R3a';
  end if;
end $$;
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check check (role in ('admin','manager','user'));
-- building_members precedence: reviewer line dropped (function re-created verbatim otherwise).
create or replace function public.building_members(b uuid)
returns table (id uuid, full_name text, avatar_url text, role text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.avatar_url,
         (select r.role from public.user_roles r where r.user_id = p.id
           order by case r.role when 'admin' then 0 when 'manager' then 1 else 3 end limit 1) as role
  from public.profiles p
  where public.can_access_building(b) and coalesce(p.deactivated, false) = false
    and exists (select 1 from public.user_roles r where r.user_id = p.id)
    and (exists (select 1 from public.user_roles r where r.user_id = p.id and r.role in ('admin','manager'))
      or exists (select 1 from public.user_buildings ub where ub.user_id = p.id and ub.building_id = b))
  order by p.full_name nulls last;
$$;
revoke all on function public.building_members(uuid) from public; revoke execute on function public.building_members(uuid) from anon;
grant execute on function public.building_members(uuid) to authenticated;

-- 7) Cron: 90-day horizon nightly.
do $$ begin perform cron.unschedule('task-generation-daily'); exception when others then null; end $$;
select cron.schedule('task-generation-daily', '0 2 * * *', 'select public.generate_scheduled_tasks(null, null, null, 90)');

commit;
-- Verify: select public.recurrence_occurrences('{"every":1,"unit":"month","monthDay":"last"}', date '2026-01-15', date '2026-04-30');
--         -> 2026-01-31, 2026-02-28, 2026-03-31, 2026-04-30
```

Check the `building_members` body against the committed version in `supabase/schema/2026-09-11_01_r1_mine.sql` before re-creating it — copy it verbatim except the precedence CASE. Confirm the `user_roles` check constraint name in `supabase/schema/2026-08-04_04_enum_check_constraints.sql:63` (adjust `drop constraint` accordingly).

- [x] **Step 3: Smokes.** `checklist-smoke.mjs`: create a template with `recurrence: { every: 1, unit: 'week', weekdays: [1,3] }` + one item via the service role, insert a `building_role_assignments` row `(building, 'Maintenance', userId)` with the item's `responsible_party = 'Maintenance'`, call `generate_scheduled_tasks` as the admin persona with `{ p_building, p_template, p_horizon_days: 28 }` → assert exactly 8 rows (4 weeks × 2 days, counting only dates ≥ today), all `assigned_to = userId` and `responsible_role = 'Maintenance'`; update the template's recurrence to `weekdays: [1]` and call `reschedule_template` → `deleted` = the pending future rows not completed (7 or 8 depending on today), `generated` = 4-ish; assert the template's `frequency` is `'weekly'` and `version` bumped to 2; cleanup rows. `rls-smoke.mjs`: `building_role_assignments` matrix (select by access: `byAccess('A')`; insert as userA → false, as manager → true); anon cannot execute `recurrence_occurrences`/`reschedule_template`; `user_roles` insert with `'reviewer'` via service role → rejected (assert the error), and the old 3-arg `generate_scheduled_tasks` no longer exists (call with 3 args → 404 or a signature error, assert `!== 200`... careful: PostgREST resolves defaults, so calling with 3 named args still hits the 4-arg function — instead assert the 4-arg call with `p_horizon_days` works for admin).

- [x] **Step 4:** `node --check` both; commit GMI `git add sql/2026-09-13_01_r3_schedule.sql && git commit -m "R3a schedule schema: recurrence, horizon generation with assignment, reschedule, reviewer removed"`; vendor; FORTRESS `git add supabase/schema/2026-09-13_01_r3_schedule.sql supabase/schema/.source docs/fixtures/recurrence-occurrences.json scripts/checklist-smoke.mjs scripts/rls-smoke.mjs && git commit -m "R3a: migration (vendored), recurrence fixture, smoke assertions"`.

**Controller after Task 1:** apply on staging, run the fixture rows through `recurrence_occurrences` with `supa.mjs query`, run checklist + rls smokes.

---

### Task 2: `src/lib/recurrence.ts`

**Files:** Create `src/lib/recurrence.ts`, `src/lib/recurrence.test.ts`

- [x] Types: `RecurrenceRule = { every: number; unit: 'day'|'week'|'month'|'year'; weekdays?: number[]; monthDay?: number | 'last'; month?: number; lead?: number }`. Exports: `occurrences(rule, fromIso, toIso): string[]` (same semantics as the SQL; date-only UTC arithmetic like `taskSchedule.ts`; cap 400), `isValidRule(rule): boolean` (mirror of `recurrence_is_valid`), `legacyFrequency(rule): TaskFrequency` (mirror of `legacy_frequency`), `describeRule(rule): string` ("Every day", "Every 2 weeks on Mon, Wed", "Monthly on the 1st", "Every 3 months on the 15th", "Every 6 months on the last day", "Yearly on 1 Jan"), `ruleFromFrequency(freq): RecurrenceRule` (daily→{1,day}; weekly→{1,week,[1]}; monthly→{1,month,1}; quarterly→{3,month,1}; annually→{1,year,1,1}) for editing legacy templates, `nextOccurrences(rule, n, fromIso)` (first n after or on from, scanning up to 3 years).
- [x] Tests: every fixture row; `isValidRule` accept/reject cases mirroring the SQL predicate; `legacyFrequency` for the six mappings; `describeRule` strings; `ruleFromFrequency` round-trips through `legacyFrequency`; `nextOccurrences` returns exactly n.
- [x] Commit: `git add src/lib/recurrence.ts src/lib/recurrence.test.ts && git commit -m "Recurrence rules: occurrences, validation, legacy bucket, labels (pinned to the SQL fixture)"`

---

### Task 3: Template administration

**Files:**
- Create: `src/components/checklists/RecurrenceEditor.tsx` (+ test), `src/components/checklists/TemplateDialog.tsx` (+ test)
- Modify: `src/pages/Checklists.tsx`

- [x] `RecurrenceEditor({ value, onChange })`: "Every [N] [day|week|month|year]"; week → weekday chips (Mon…Sun, ≥ 1 required); month/year → "on day [N] / last day" select; year → month select; "Show [N] days before" (lead); a live preview "Next: …" listing `nextOccurrences(rule, 6, today)` via `describeRule`. Invalid state disables Save with a plain-text reason.
- [x] `TemplateDialog({ open, template | null, onSaved })` (`ResponsiveDialog`): name, description, recurrence (seeded from `ruleFromFrequency(template.frequency)` when the template has none), responsible role (select: `user`, `manager`, plus the `responsibleParties` list exported from `TemplateItemDialog` — export it), building types (multi-select over `BUILDING_TYPES`, empty = all). Insert/update `checklist_templates` (boundary cast comment for `recurrence`); on update where the rule changed: confirm "Regenerate future tasks? N pending tasks that nobody has touched will be replaced." then `rpc('reschedule_template', { p_template })` and toast the counts. Archive/Restore actions (`archived_at`), never delete.
- [x] `Checklists.tsx`: "New template" button (admin/manager) beside "Add Task"; card menu gains Edit, Archive/Restore; an "Archived" toggle shows archived cards dimmed; the frequency badge shows `describeRule(recurrence)` when present, else the legacy label; select `recurrence, archived_at, version` (cast comment). Tests: dialog validation + save payload; page shows the New template button and archived toggle (mock supabase like `MyDay.test.tsx` mocks its hooks).
- [x] Commit: `git add src/components/checklists/RecurrenceEditor.tsx src/components/checklists/RecurrenceEditor.test.tsx src/components/checklists/TemplateDialog.tsx src/components/checklists/TemplateDialog.test.tsx src/components/checklists/TemplateItemDialog.tsx src/pages/Checklists.tsx && git commit -m "Templates: create, edit with a recurrence editor, archive; reschedule after a rule change"`

---

### Task 4: "Who does what here" + horizon view on the Checklists tab

**Files:**
- Create: `src/hooks/useBuildingRoleAssignments.ts` (+ test), `src/components/building/RoleAssignmentsPanel.tsx` (+ test), `src/components/building/UpcomingTasks.tsx` (+ test)
- Modify: `src/components/building/ChecklistsTab.tsx`

- [x] Hook: `useBuildingRoleAssignments(buildingId)` → `{ rules: Map<role,userId>, roles: string[] (distinct labels from the building's applicable templates: responsible_party ∪ responsible_role ∪ ['user','manager']), setRule(role, userId|null), applyToPending(): Promise<number> }` — `setRule` upserts/deletes `building_role_assignments` (cast comment); `applyToPending` updates `task_instances set assigned_to` for pending tasks of the building whose `responsible_role` matches and `assigned_to is null`, then one `notify('task_assigned')` per person (title "N tasks assigned to you at <building>", url `/buildings/<id>?tab=checklists`). Query keys `['building-roles', buildingId]`.
- [x] `RoleAssignmentsPanel` (admin/manager only): a card "Who does what here" with one row per role label → member picker (`useBuildingMembers`, reuse `AssigneePicker` if it exists — grep `AssigneePicker`), "Apply to existing pending tasks" button with a count. Coaching line via `<Hint>`: "New tasks are assigned automatically from these rules every night."
- [x] `UpcomingTasks`: next 30 days grouped by week (Mon–Sun), each row = task name, due date, assignee chip, Complete button (reuses the existing row action from `TasksList` where possible); mobile-first (single column). In `ChecklistsTab`, render `UpcomingTasks` above the frequency tabs on `< sm` and as the first tab "Next 30 days" on desktop; the generate buttons pass `p_horizon_days: 90`.
- [x] Commit: `git add src/hooks/useBuildingRoleAssignments.ts src/hooks/useBuildingRoleAssignments.test.ts src/components/building/RoleAssignmentsPanel.tsx src/components/building/RoleAssignmentsPanel.test.tsx src/components/building/UpcomingTasks.tsx src/components/building/UpcomingTasks.test.tsx src/components/building/ChecklistsTab.tsx && git commit -m "Who does what here: per-building role assignments feed generation; next-30-days view"`

---

### Task 5: Reviewer removal (client + edge functions)

**Files:** `src/lib/constants.ts`, `src/contexts/AuthContext.tsx`, `src/components/layout/DashboardLayout.tsx`, `src/pages/UserManagement.tsx`, `src/pages/Onboarding.tsx`, `src/components/reports/fortress/FortressReportEditor.tsx`, `supabase/functions/invite-user/index.ts`, `supabase/functions/set-user-role/index.ts`, `docs/superpowers/specs/2026-09-10-r1-mine-design.md` (one-line note), any test asserting the role list.

- [x] Remove `'reviewer'` from `AppRole`, `ROLE_PRECEDENCE`, labels/colours/options (`constants.ts:12,16,97,105,138`), `AuthContext.tsx:14`, `DashboardLayout.tsx:68`, `UserManagement.tsx:91,98,507,696`, `Onboarding.tsx:33`; `FortressReportEditor.tsx:35,245-247`: drop `isReviewer` (the `submitted → reviewed` action stays for admin/manager); both edge functions' `VALID_ROLES`. Grep `reviewer` across `src/` and `supabase/functions/` afterwards — only the word in the sentence at `FortressReportEditor.tsx:326` ("Ask the reviewer…" = the person who reviewed) may remain. Tests: update any snapshot/list; add a type-level test that `AppRole` has exactly three members.
- [x] Commit: `git add <files> && git commit -m "Remove the reviewer role: no holders, no server-side power"`

---

### Task 6: `notify-expiring-alerts` writes inbox rows

**Files:** `supabase/functions/notify-expiring-alerts/index.ts`, `scripts/notifications-smoke.mjs`

- [x] After computing `expiringDocuments`, `expiredDocuments`, `overdueMaintenance`, and BEFORE the email: for each document → `createNotifications(supabase, { recipients: adminAndManagerIds, actorId: null, actorName: null, kind: 'document_expiring', entityType: 'document', entityId: doc.id, buildingId: doc.building_id, title: `${doc.name} expires ${dateLabel}` (or "expired N days ago"), body: doc.document_type, url: `/buildings/${doc.building_id}?tab=documents` })`; for each asset → kind `asset_service_due`, entityType `asset`, url `…?tab=assets`. Idempotent per entity per day: skip when a `notifications` row with that `kind`+`entity_id` exists with `created_at >= today 00:00 +02:00`. Import `createNotifications`, `adminAndManagerIds` from `../_shared/notify.ts` (they exist). Both kinds are `DIGEST_ONLY` so `createNotifications` sends no email; the function's own summary email stays. Return counts `{ …, inboxRows }`. Keep `dryRun` semantics (no inbox rows on dry run).
- [x] Smoke: `notifications-smoke.mjs` gains a step guarded by `process.env.EXPIRING_ALERTS_SECRET` (skip with a `SKIP` line when unset): insert a `building_documents` row expiring in 3 days for a ZZTEST building, POST the function with `x-alerts-secret`, assert one `document_expiring` inbox row for the admin persona with the right `entity_id`, call again → still one row; cleanup.
- [x] Commit: `git add supabase/functions/notify-expiring-alerts/index.ts scripts/notifications-smoke.mjs && git commit -m "Expiring documents and overdue asset services land in the inbox"`

---

### Task 7 (controller): apply, verify, regenerate, record

- [x] Staging: apply, fixture check via SQL, set `EXPIRING_ALERTS_SECRET` on staging (it is missing) and register nothing new (the cron exists on prod only — leave as is), deploy `notify-expiring-alerts`, run `npm run smoke` + `smoke:notifications` (with the secret in env) + `smoke:offline`.
- [x] Prod: apply (the reviewer guard passes: 0 rows), deploy the function, `rls-smoke`; regenerate types; drop the casts; tsc ≤ baseline; Status section; `APPLY_CHECKLIST.md` R3a; push; PR body.

---

## Status (2026-09-10)

**DONE and LIVE on staging and prod.** Commits `143cb2d..bfc1780` on `feat/reports-access-hardening` (PR #3);
canonical SQL GMI `3936792`, `8cd0ee8`, `baff1ad`. Gates: typecheck 55 (= baseline, ratcheted from 56), 809 tests,
build green; staging full battery green; prod `rls-smoke` 463/0. Apply record: `docs/plans/APPLY_CHECKLIST.md` → R3a.

Task → commit: 1 migration + smokes `33fad14` (+ `04c7d50`, `89c384b`); 2 recurrence library `d23cc7c`
(+ `0873469`, `2e053a0`, `04c7d50`); 3 template admin `8bd804b` (+ `4f889d9`); 4 role assignments + horizon `5debb42`
(+ `4f889d9`); 5 reviewer removal `143cb2d` (+ `b3cbcc0`); 6 alerts inbox rows `ca7e3ed` (+ `6b4fa86`, `b3cbcc0`);
CI fix `a681863`; types regen + casts `bfc1780`.

Deviations worth knowing:
- Month/year rules anchor on the first occurrence on or after the start date, then step every N (a 6-monthly rule made
  on 10 Sep → 1 Oct, 1 Apr, 1 Oct), not on the start month; the fixture, SQL and TS all pin this.
- `generate_scheduled_tasks` takes `(p_building, p_template, p_frequency, p_horizon_days)`; the role label is
  `coalesce(nullif(btrim(item.responsible_party),''), nullif(btrim(template.responsible_role),''), 'user')` in SQL and
  the hook alike (trimmed, so a whitespace-only field is absent). `reschedule_template` regenerates with the cron's
  90-day horizon.
- KPIs (`useBuildingScore`, `useBuildingsScores`, `useDashboardStats`) are bounded to `due_date <= today`: with a 90-day
  generation horizon a future pending task is not "not done". Saving an untouched legacy template keeps it legacy (no
  `recurrence` written, no regenerate prompt) until someone deliberately edits the rule. `lead` ("Show N days before")
  ships hidden behind `RecurrenceEditor`'s `showLead` until a consumer exists, and a lead-only diff never prompts.
- The reschedule confirm counts the pending future tasks it will replace and opens after the sheet has closed on phones.
- Archived templates cannot be applied or generated and drop out of "Who does what here".
- `templateAppliesToBuilding([])` is false (matches SQL `= any('{}')`).
- `notify-expiring-alerts` constructs the Resend client lazily (staging has no key) and writes inbox rows regardless of
  `notifyAdmins`, skipping only on `dryRun`.
- CI: Supabase env stubbed in `src/test/setup.ts`; Node 22; the `File`-through-IndexedDB test is skipped where Node's
  structured clone drops the name (Node 20/22).

Follow-ups: `useIssues`-style pages still don't use the horizon; the digest email lists expiring documents AND the
inbox now carries them (fine, no double email); `reschedule_template` re-ids replaced rows (notification `entity_id`s
may dangle); a global `pointerCapture` shim in `src/test/setup.ts` would dedupe four tests; `TaskFrequency` is still
declared in five places (`constants.ts`, `TasksList.tsx`, `Checklists.tsx`, `TemplateItemDialog.tsx`, `ApplyTemplateDialog.tsx`).
