-- 2026-09-13_03_r3_contractors_ppm.sql
-- R3c "Contractors, PPM, Costs" schema (spec docs/superpowers/specs/2026-09-10-r3-plan-design.md §5.6, §5.7).
-- Additive, idempotent. Apply order: staging -> npm run smoke -> prod.
-- Requires 2026-09-13_01_r3_schedule.sql (recurrence_is_valid, legacy_frequency,
-- recurrence_occurrences, building_role_assignments) and 2026-09-11_03 (access helpers).
--
--   1) building_ppm_services — the per-building PPM plan (D6). Execution stays in
--      task_instances (new source_ppm_id), the report grid is derived from execution.
--   2) generate_ppm_tasks — PPM occurrences ride a nightly cron, same shape as
--      generate_scheduled_tasks; idempotent via the partial unique index.
--   3) ppm_monthly_status — rewritten to derive from PPM task instances. The column list
--      changes (the old view keyed on task_name), so it is dropped and re-created, and the
--      anon revoke from 2026-08-04_01 is restated because a dropped view loses its grants.
--   4) ppm_services.plan_service_id / overrides — the report grid's noted-override layer.
--   5) contractors: small columns; contractor_ratings with a trigger keeping contractors.rating
--      as the average.
--   6) building_month_costs — cost rollup, security invoker.
--   7) One-shot seed of plans from the existing report-scoped ppm_services rows.
begin;

-- ============================================================
-- 1) PPM plan (portfolio-level, per building). D6: plan here, execution in task_instances, grid derived.
-- ============================================================
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

-- ============================================================
-- 2) PPM occurrences ride the nightly generator. Same caps and idempotency; responsible_role 'contractor';
--    assigned_to from the building's 'contractor' role rule when set.
-- ============================================================
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

-- ============================================================
-- 3) Derived grid. One row per (plan line, month) that has an occurrence; status from execution.
--    The old view (2026-06-13_07) exposed (building_id, service_name, period_month date, status)
--    keyed on task_name; the new column list differs in position and type, which
--    `create or replace view` refuses, so drop first. Dropping discards the view's grants and
--    Supabase default privileges would hand SELECT back to anon: restate the 2026-08-04_01 revoke.
-- ============================================================
drop view if exists public.ppm_monthly_status;
create view public.ppm_monthly_status with (security_invoker = on) as
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
revoke all on public.ppm_monthly_status from anon;
revoke insert, update, delete, truncate, references, trigger on public.ppm_monthly_status from authenticated;

-- ============================================================
-- 4) Overrides on the report-scoped grid: {"YYYY-MM": {"status": "...", "note": "...", "by": uuid, "at": iso}}.
-- ============================================================
alter table public.ppm_services add column if not exists plan_service_id uuid references public.building_ppm_services(id) on delete set null;
alter table public.ppm_services add column if not exists overrides jsonb not null default '{}'::jsonb;

-- ============================================================
-- 5) Contractors: small columns, ratings, average trigger.
-- ============================================================
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
-- On DELETE `new` is null and on INSERT `old` is null (a null record's field reads as null, PG 11+),
-- so coalesce picks whichever side exists.
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

-- ============================================================
-- 6) Cost rollup (security invoker → RLS of the base tables applies). Same anon revoke as every
--    other Fortress view (2026-08-04_01); default privileges would otherwise grant it.
-- ============================================================
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
revoke all on public.building_month_costs from anon;
revoke insert, update, delete, truncate, references, trigger on public.building_month_costs from authenticated;

-- ============================================================
-- 7) One-shot: seed plans from the existing report-scoped rows (distinct building + service).
--    Cadence from the free-text `frequency`; unknown → monthly and flagged inactive for review.
-- ============================================================
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

-- Verify:
--   select is_active, count(*) from public.building_ppm_services group by 1;   -- the false rows need a cadence
--   select count(*) from public.ppm_services where plan_service_id is null;    -- should be 0
--   select proname, pg_get_function_identity_arguments(oid) from pg_proc
--    where pronamespace = 'public'::regnamespace and proname in ('generate_ppm_tasks','refresh_contractor_rating');
--   select command from cron.job where jobname = 'ppm-generation-daily';        -- select public.generate_ppm_tasks(null, 365)
--   select column_name, data_type from information_schema.columns
--    where table_name = 'ppm_monthly_status' order by ordinal_position;         -- building_id, ppm_service_id, service_name, period_month, status, done_on
--   select has_table_privilege('anon', 'public.ppm_monthly_status', 'select'),
--          has_table_privilege('anon', 'public.building_month_costs', 'select'); -- false, false
--   select indexname from pg_indexes where tablename = 'task_instances' and indexname like '%ppm%';
