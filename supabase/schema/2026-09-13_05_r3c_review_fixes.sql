-- 2026-09-13_05_r3c_review_fixes.sql
-- Review fixes for R3c (2026-09-13_03_r3_contractors_ppm.sql). Additive, idempotent; safe on a
-- project that already has _03 applied (staging) and on one that gets _03 then _05 back to
-- back (prod). Requires _03 (building_ppm_services, contractor_ratings, generate_ppm_tasks,
-- ppm_services.overrides) and 2026-09-11_03 (is_admin, is_admin_or_manager, can_access_building).
--
--   1) contractor_ratings cr_insert tightened: the issue must name that contractor and be
--      resolved (the offline handler inserts the rating right after flipping the issue to
--      'resolved', src/lib/offline/handlers.ts; the status literal is from the
--      issues_status_check of 2026-08-04_04).
--   2) contractor_ratings cr_delete: admin only. Still no update policy.
--   3) issues.contractor_id and asset_service_history.contractor_id were bare uuid columns:
--      orphans nulled, FK to contractors (on delete set null) and an index on each. PostgREST
--      embeds (`contractors(company_name)`) need the FK.
--   4) building_month_costs: months bucketed in SAST; only resolved issues count.
--   5) ppm_monthly_status: done_on in SAST; the redundant group by / max is gone (one row per
--      task instance already). Same column list, order and types → create or replace.
--   6) building_ppm_services.updated_at touch trigger (fortress_touch_updated_at, as every
--      other Fortress table).
--   7) generate_ppm_tasks: a plan line's notes (migration audit text, contractor remarks) no
--      longer become the task description.
--   8) reschedule_ppm_line(p_line) + an after-update trigger on is_active / recurrence: a plan
--      line's future untouched occurrences are dropped and, if the line is active, regenerated
--      over the cron's 365-day horizon.
--   9) ppm_services.overrides may only be changed by an admin or manager (before-update guard;
--      the table's own update policy lets any building member edit the report row).
begin;

-- ============================================================
-- 1) + 2) contractor_ratings policies.
-- ============================================================
drop policy if exists cr_insert on public.contractor_ratings;
create policy cr_insert on public.contractor_ratings for insert
  with check (
    rated_by = auth.uid()
    and exists (select 1
                  from public.issues i
                 where i.id = issue_id
                   and i.contractor_id = contractor_ratings.contractor_id
                   and i.status = 'resolved'
                   and public.can_access_building(i.building_id)));
drop policy if exists cr_delete on public.contractor_ratings;
create policy cr_delete on public.contractor_ratings for delete using (public.is_admin());

-- ============================================================
-- 3) Missing foreign keys. Orphans (a contractor deleted while the column had no FK) are
--    nulled first so the constraint validates; on delete set null keeps that behaviour.
--    Index guard is by column, not by name: any index leading on contractor_id counts.
-- ============================================================
update public.issues
   set contractor_id = null
 where contractor_id is not null
   and not exists (select 1 from public.contractors c where c.id = issues.contractor_id);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'issues_contractor_id_fkey') then
    alter table public.issues
      add constraint issues_contractor_id_fkey
      foreign key (contractor_id) references public.contractors(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_index x
      join pg_attribute a on a.attrelid = x.indrelid and a.attnum = x.indkey[0]
     where x.indrelid = 'public.issues'::regclass and a.attname = 'contractor_id') then
    create index idx_issues_contractor on public.issues (contractor_id);
  end if;
end $$;

update public.asset_service_history
   set contractor_id = null
 where contractor_id is not null
   and not exists (select 1 from public.contractors c where c.id = asset_service_history.contractor_id);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'asset_service_history_contractor_id_fkey') then
    alter table public.asset_service_history
      add constraint asset_service_history_contractor_id_fkey
      foreign key (contractor_id) references public.contractors(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_index x
      join pg_attribute a on a.attrelid = x.indrelid and a.attnum = x.indkey[0]
     where x.indrelid = 'public.asset_service_history'::regclass and a.attname = 'contractor_id') then
    create index idx_asset_service_history_contractor on public.asset_service_history (contractor_id);
  end if;
end $$;

-- ============================================================
-- 4) Cost rollup in SAST months, resolved issues only. resolved_at is stamped by
--    trg_issue_resolved_at on UPDATE only (2026-09-11_01), so a row inserted already resolved
--    can carry a null resolved_at: created_at is the fallback bucket rather than a null month.
--    Same columns as _03 → create or replace; grants restated because default privileges would
--    otherwise hand SELECT back to anon.
-- ============================================================
create or replace view public.building_month_costs with (security_invoker = on) as
select building_id, month,
       sum(issues_actual)  as issues_actual,
       sum(services_cost)  as services_cost,
       sum(issues_actual) + sum(services_cost) as total
from (
  select i.building_id,
         to_char(coalesce(i.resolved_at, i.created_at) at time zone 'Africa/Johannesburg', 'YYYY-MM') as month,
         coalesce(i.actual_cost, 0) as issues_actual,
         0::numeric as services_cost
    from public.issues i
   where i.status = 'resolved' and i.actual_cost is not null
  union all
  select a.building_id, to_char(h.service_date, 'YYYY-MM'), 0, coalesce(h.cost, 0)
    from public.asset_service_history h join public.building_assets a on a.id = h.asset_id where h.cost is not null
) x group by building_id, month;
revoke all on public.building_month_costs from anon;
revoke insert, update, delete, truncate, references, trigger on public.building_month_costs from authenticated;

-- ============================================================
-- 5) Derived grid: one row per PPM task instance (the completion is unique per instance, so the
--    _03 group by / max never merged anything); done_on read in SAST so a completion logged
--    after 22:00 UTC lands on the SAST calendar day it was done. Columns unchanged
--    (building_id, ppm_service_id, service_name, period_month, status, done_on) → create or
--    replace keeps the view's grants; restated anyway so a re-run after a drop is still right.
-- ============================================================
create or replace view public.ppm_monthly_status with (security_invoker = on) as
select ti.building_id,
       ti.source_ppm_id                            as ppm_service_id,
       s.service_name,
       to_char(ti.due_date, 'YYYY-MM')             as period_month,
       case when tc.id is not null or ti.status = 'completed' then 'done'
            when ti.status = 'issue_logged' then 'missed'
            when ti.due_date < (now() at time zone 'Africa/Johannesburg')::date then 'missed'
            else 'due' end                          as status,
       (coalesce(tc.created_at, ti.completed_at) at time zone 'Africa/Johannesburg')::date as done_on
from public.task_instances ti
join public.building_ppm_services s on s.id = ti.source_ppm_id
left join public.task_completions tc on tc.task_instance_id = ti.id
where ti.source_ppm_id is not null;
revoke all on public.ppm_monthly_status from anon;
revoke insert, update, delete, truncate, references, trigger on public.ppm_monthly_status from authenticated;

-- ============================================================
-- 6) updated_at touch (same trigger every Fortress table has, 2026-06-13_01).
-- ============================================================
drop trigger if exists trg_building_ppm_services_touch on public.building_ppm_services;
create trigger trg_building_ppm_services_touch
  before update on public.building_ppm_services
  for each row execute function public.fortress_touch_updated_at();

-- ============================================================
-- 7) generate_ppm_tasks: body as in _03 except task_description is null (was s.notes).
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
  select s.building_id, s.id, s.service_name, null, public.legacy_frequency(s.recurrence), 'contractor', 'pending', occ.due, false, false,
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

-- ============================================================
-- 8) Reschedule one plan line. Untouched = pending, due after today (SAST), no completion row.
--    Regenerates over the cron's 365-day horizon (2026-09-13_03 §2) so a rescheduled line never
--    carries more future rows than an untouched one; task_instances_ppm_uniq arbitrates the
--    occurrences that survived the delete (completed / already-touched rows), so regenerating
--    over them cannot violate the partial unique index. Same caller gate as generate_ppm_tasks:
--    signed-in callers must be admin/manager with access to the line's building; the trigger
--    below runs it for the service role / cron too (auth.uid() null → no gate).
--    Returns the number of occurrences generated (0 for an inactive or unknown line).
-- ============================================================
create or replace function public.reschedule_ppm_line(p_line uuid)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today    date := (now() at time zone 'Africa/Johannesburg')::date;
  v_building uuid;
  v_active   boolean;
begin
  if auth.uid() is not null and not public.is_admin_or_manager() then
    raise exception 'reschedule_ppm_line: admin or manager only' using errcode = '42501';
  end if;
  select s.building_id, s.is_active into v_building, v_active
    from public.building_ppm_services s where s.id = p_line;
  if not found then
    return 0;
  end if;
  if auth.uid() is not null and not public.can_access_building(v_building) then
    raise exception 'reschedule_ppm_line: no access to that building' using errcode = '42501';
  end if;
  delete from public.task_instances t
   where t.source_ppm_id = p_line
     and t.status = 'pending'
     and t.due_date > v_today
     and not exists (select 1 from public.task_completions c where c.task_instance_id = t.id);
  if v_active then
    return public.generate_ppm_tasks(v_building, 365);
  end if;
  return 0;
end $$;
revoke all on function public.reschedule_ppm_line(uuid) from public;
revoke execute on function public.reschedule_ppm_line(uuid) from anon;
grant execute on function public.reschedule_ppm_line(uuid) to authenticated, service_role;

-- The trigger fires AFTER the row is updated so generate_ppm_tasks reads the new rule. It only
-- ever writes task_instances (never building_ppm_services), and nothing downstream of
-- task_instances writes back to the plan, so it cannot re-enter itself; the WHEN clause also
-- keeps a no-op update (same is_active, same recurrence) from doing any work.
create or replace function public.building_ppm_services_reschedule()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.reschedule_ppm_line(new.id);
  return null;
end $$;
revoke all on function public.building_ppm_services_reschedule() from public;
revoke execute on function public.building_ppm_services_reschedule() from anon;
drop trigger if exists trg_building_ppm_services_reschedule on public.building_ppm_services;
create trigger trg_building_ppm_services_reschedule
  after update of is_active, recurrence on public.building_ppm_services
  for each row
  when (old.is_active is distinct from new.is_active or old.recurrence is distinct from new.recurrence)
  execute function public.building_ppm_services_reschedule();

-- ============================================================
-- 9) ppm_services.overrides: admin/manager only. ppm_services_upd (2026-06-14_05) admits any
--    building member, which is right for the report row itself but not for the noted-override
--    layer. The service role / cron (auth.uid() null) is not gated.
-- ============================================================
create or replace function public.ppm_services_guard_overrides()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and new.overrides is distinct from old.overrides
     and not public.is_admin_or_manager() then
    raise exception 'ppm_services.overrides: admin or manager only' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.ppm_services_guard_overrides() from public;
revoke execute on function public.ppm_services_guard_overrides() from anon;
drop trigger if exists trg_ppm_services_overrides_guard on public.ppm_services;
create trigger trg_ppm_services_overrides_guard
  before update of overrides on public.ppm_services
  for each row execute function public.ppm_services_guard_overrides();

commit;

-- Verify:
--   select polname, polcmd from pg_policy where polrelid = 'public.contractor_ratings'::regclass order by 1;
--     -- cr_delete d, cr_insert a, cr_select r (no update policy)
--   select conname, conrelid::regclass from pg_constraint
--    where conname in ('issues_contractor_id_fkey','asset_service_history_contractor_id_fkey');   -- 2 rows
--   select count(*) from public.issues i where i.contractor_id is not null
--      and not exists (select 1 from public.contractors c where c.id = i.contractor_id);             -- 0
--   select indexname from pg_indexes where indexname in ('idx_issues_contractor','idx_asset_service_history_contractor');
--   select column_name, data_type from information_schema.columns
--    where table_name = 'ppm_monthly_status' order by ordinal_position;
--     -- building_id, ppm_service_id, service_name, period_month, status, done_on (unchanged)
--   select pg_get_viewdef('public.ppm_monthly_status'::regclass) !~* 'group by',
--          pg_get_viewdef('public.building_month_costs'::regclass) ~ 'Africa/Johannesburg';         -- true, true
--   select has_table_privilege('anon', 'public.ppm_monthly_status', 'select'),
--          has_table_privilege('anon', 'public.building_month_costs', 'select');                    -- false, false
--   select tgname from pg_trigger where tgrelid = 'public.building_ppm_services'::regclass and not tgisinternal;
--     -- trg_building_ppm_services_reschedule, trg_building_ppm_services_touch
--   select tgname from pg_trigger where tgrelid = 'public.ppm_services'::regclass and not tgisinternal;
--     -- trg_ppm_services_overrides_guard, trg_ppm_services_touch
--   select prosrc !~ 's\.notes' from pg_proc where proname = 'generate_ppm_tasks';                   -- true
--   select proname, prosecdef, proconfig from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('reschedule_ppm_line','building_ppm_services_reschedule','ppm_services_guard_overrides');
--     -- 3 rows, prosecdef true, proconfig {search_path=}
--   select has_function_privilege('anon', 'public.reschedule_ppm_line(uuid)', 'execute'),
--          has_function_privilege('authenticated', 'public.reschedule_ppm_line(uuid)', 'execute');  -- false, true
--   Then: npm run smoke (rls-smoke R3c probes + ppm-smoke reschedule / missed / assigned_to steps).
