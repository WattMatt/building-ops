-- 2026-09-13_01_r3_schedule.sql
-- R3a "Schedule" schema (spec docs/superpowers/specs/2026-09-10-r3-plan-design.md §5.1–§5.4).
-- Additive, idempotent. Apply order: staging -> npm run smoke -> prod.
-- iOS keeps reading checklist_templates.frequency; it ignores everything else here.
begin;

-- ============================================================
-- 1) Template columns. recurrence NULL = legacy five-bucket behaviour, unchanged.
-- ============================================================
alter table public.checklist_templates
  add column if not exists recurrence  jsonb,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists version     integer not null default 1;

-- Shape (mirrored by src/lib/recurrence.ts):
--   { every: 1..52, unit: day|week|month|year, weekdays?: [1..7] (week: required, ISO 1=Mon),
--     monthDay?: 1..31 | 'last', month?: 1..12 (year: required), lead?: 0..60 }
-- The whole predicate is wrapped in coalesce(..., false): a missing key makes its clause NULL,
-- and a NULL CHECK result would otherwise let e.g. {"unit":"day"} (no `every`) through.
-- Postgres does not promise AND short-circuits, so every array-only call (jsonb_array_length,
-- jsonb_array_elements_text) is itself guarded by jsonb_typeof(...) = 'array': a non-array
-- `weekdays` must yield false (23514 at the CHECK), never raise 22023.
create or replace function public.recurrence_is_valid(r jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select r is null or coalesce((
    jsonb_typeof(r) = 'object'
    and (r->>'unit') in ('day','week','month','year')
    and (r->>'every') ~ '^[0-9]+$' and (r->>'every')::int between 1 and 52
    and (r->'weekdays' is null or (jsonb_typeof(r->'weekdays') = 'array'
         and not exists (select 1
                           from jsonb_array_elements_text(case when jsonb_typeof(r->'weekdays') = 'array'
                                                                then r->'weekdays' else '[]'::jsonb end) d
                          where d !~ '^[1-7]$')))
    and (r->'monthDay' is null or (r->>'monthDay') = 'last'
         or ((r->>'monthDay') ~ '^[0-9]+$' and (r->>'monthDay')::int between 1 and 31))
    and (r->'month' is null or ((r->>'month') ~ '^[0-9]+$' and (r->>'month')::int between 1 and 12))
    and (r->'lead' is null or ((r->>'lead') ~ '^[0-9]+$' and (r->>'lead')::int between 0 and 60))
    and ((r->>'unit') <> 'week' or (jsonb_typeof(r->'weekdays') = 'array' and jsonb_array_length(r->'weekdays') > 0))
    and ((r->>'unit') <> 'year' or r->'month' is not null)
  ), false)
$$;
alter table public.checklist_templates drop constraint if exists checklist_templates_recurrence_check;
alter table public.checklist_templates
  add constraint checklist_templates_recurrence_check check (public.recurrence_is_valid(recurrence));

-- Legacy bucket derived from the rule so iOS and the reports keep working. Documented
-- downgrades: month every 3 or 6 -> quarterly; any other month rule -> monthly.
create or replace function public.legacy_frequency(r jsonb)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when r is null then null
    when r->>'unit' = 'day' then 'daily'
    when r->>'unit' = 'week' then 'weekly'
    when r->>'unit' = 'month' and (r->>'every')::int in (3, 6) then 'quarterly'
    when r->>'unit' = 'month' then 'monthly'
    else 'annually'
  end
$$;

create or replace function public.sync_frequency_from_recurrence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- legacy_frequency casts `every`; only derive from a rule the CHECK will accept, so a
  -- malformed rule fails at the constraint (23514) rather than here (22P02).
  if new.recurrence is not null and public.recurrence_is_valid(new.recurrence) then
    new.frequency := public.legacy_frequency(new.recurrence);
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' and (
       new.recurrence is distinct from old.recurrence
    or new.name is distinct from old.name
    or new.responsible_role is distinct from old.responsible_role
    or new.applies_to_building_types is distinct from old.applies_to_building_types) then
    new.version := old.version + 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_checklist_templates_recurrence on public.checklist_templates;
create trigger trg_checklist_templates_recurrence
  before insert or update on public.checklist_templates
  for each row execute function public.sync_frequency_from_recurrence();

-- ============================================================
-- 2) Occurrences. Pure; bounded to 400 dates. Semantics pinned by
--    docs/fixtures/recurrence-occurrences.json (FORTRESS-OPPS), which the TS mirror also runs:
--    * from/to inclusive.
--    * day:   from `from`, every N days.
--    * week:  Monday-start weeks; week 0 is the week containing `from`; every N weeks the
--             listed ISO weekdays; dates before `from` dropped.
--    * month: monthDay clamped to the month's last day ('last' = last day). The anchor is the
--             first month, starting at `from`'s month, whose date lands on/after `from`; then
--             every N months from that anchor (fixture: every 6, monthDay 1, from 2026-09-10 ->
--             2026-10-01, 2027-04-01, 2027-10-01).
--    * year:  same anchoring on `month`/`monthDay`, then every N years.
--    * lead shifts visibility only; it never moves a due date, so it is ignored here.
-- ============================================================
create or replace function public.recurrence_occurrences(r jsonb, p_from date, p_to date)
returns setof date
language plpgsql immutable
set search_path = ''
as $$
declare
  v_unit  text := r->>'unit';
  v_every int  := (r->>'every')::int;
  v_n     int  := 0;
  v_md    text := coalesce(r->>'monthDay', '1');
  d        date;
  wk_start date;
  v_last   date;
  occ      date;
  i        int;
  y        int;
  m        int;
begin
  if r is null or p_from is null or p_to is null or p_to < p_from or coalesce(v_every, 0) < 1 then
    return;
  end if;

  if v_unit = 'day' then
    d := p_from;
    while d <= p_to and v_n < 400 loop
      return next d; v_n := v_n + 1;
      d := d + v_every;
    end loop;

  elsif v_unit = 'week' then
    wk_start := date_trunc('week', p_from::timestamp)::date;   -- Monday of from's week
    while wk_start <= p_to and v_n < 400 loop
      for i in select value::int from jsonb_array_elements_text(r->'weekdays') order by 1 loop
        d := wk_start + (i - 1);
        if d >= p_from and d <= p_to and v_n < 400 then
          return next d; v_n := v_n + 1;
        end if;
      end loop;
      wk_start := wk_start + (7 * v_every);
    end loop;

  elsif v_unit = 'month' then
    d := date_trunc('month', p_from::timestamp)::date;          -- first of from's month
    while d <= p_to and v_n < 400 loop
      v_last := (d + interval '1 month' - interval '1 day')::date;
      occ := case when v_md = 'last' then v_last else least(d + (v_md::int - 1), v_last) end;
      if occ < p_from then
        d := (d + interval '1 month')::date;                     -- not anchored yet: next month
      else
        if occ <= p_to then return next occ; v_n := v_n + 1; end if;
        d := (d + make_interval(months => v_every))::date;
      end if;
    end loop;

  elsif v_unit = 'year' then
    m := (r->>'month')::int;
    y := extract(year from p_from)::int;
    while make_date(y, m, 1) <= p_to and v_n < 400 loop
      d := make_date(y, m, 1);
      v_last := (d + interval '1 month' - interval '1 day')::date;
      occ := case when v_md = 'last' then v_last else least(d + (v_md::int - 1), v_last) end;
      if occ < p_from then
        y := y + 1;                                              -- not anchored yet: next year
      else
        if occ <= p_to then return next occ; v_n := v_n + 1; end if;
        y := y + v_every;
      end if;
    end loop;
  end if;
end $$;

-- Pure, but Supabase default privileges would still expose them to anon (R1 lesson): revoke explicitly.
revoke all on function public.recurrence_occurrences(jsonb, date, date) from public;
revoke execute on function public.recurrence_occurrences(jsonb, date, date) from anon;
grant execute on function public.recurrence_occurrences(jsonb, date, date) to authenticated, service_role;
revoke all on function public.recurrence_is_valid(jsonb) from public;
revoke execute on function public.recurrence_is_valid(jsonb) from anon;
grant execute on function public.recurrence_is_valid(jsonb) to authenticated, service_role;
revoke all on function public.legacy_frequency(jsonb) from public;
revoke execute on function public.legacy_frequency(jsonb) from anon;
grant execute on function public.legacy_frequency(jsonb) to authenticated, service_role;
revoke all on function public.sync_frequency_from_recurrence() from public;
revoke execute on function public.sync_frequency_from_recurrence() from anon;

-- ============================================================
-- 3) Who does what per building. role = a label used by template_items.responsible_party
--    or checklist_templates.responsible_role ('user', 'manager', 'HVAC Contractor', ...).
-- ============================================================
create table if not exists public.building_role_assignments (
  building_id uuid not null references public.buildings(id) on delete cascade,
  role        text not null,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  primary key (building_id, role)
);
alter table public.building_role_assignments enable row level security;
drop policy if exists bra_select on public.building_role_assignments;
create policy bra_select on public.building_role_assignments
  for select using (public.can_access_building(building_id));
drop policy if exists bra_write on public.building_role_assignments;
create policy bra_write on public.building_role_assignments
  for all
  using (public.is_admin_or_manager() and public.can_access_building(building_id))
  with check (public.is_admin_or_manager() and public.can_access_building(building_id));

-- ============================================================
-- 4) Generation v2: horizon + assignment. The role label is derived in one way everywhere in
--    this file: item responsible_party, else template responsible_role, else 'user' — with a
--    blank (empty or whitespace-only, hence btrim) value treated as absent, so a blank form
--    field never yields a '' or ' ' label that no building_role_assignments row can match. Templates with a recurrence rule get every
--    occurrence in [today, today + horizon]; per-unit caps keep the row count sane
--    (dailies 14 days ahead, weeklies 90, monthly and yearly 365) whatever p_horizon_days
--    says. Legacy templates (recurrence null) keep the single scheduled_due_date row.
--    Cron calls it with no building (auth.uid() is null); the app calls it for one
--    building as an admin or manager. Idempotent via task_instances_generated_uniq
--    (building_id, template_item_id, due_date).
-- ============================================================
create or replace function public.generate_scheduled_tasks(
  p_building uuid default null, p_template uuid default null, p_frequency text default null,
  p_horizon_days integer default 0)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_count integer := 0;
begin
  if auth.uid() is not null then
    if not public.is_admin_or_manager() then
      raise exception 'generate_scheduled_tasks: admin or manager only' using errcode = '42501';
    end if;
    -- Only the nightly cron (postgres, null uid) may generate for every building at once.
    if p_building is null then
      raise exception 'generate_scheduled_tasks: p_building is required for signed-in callers' using errcode = '42501';
    end if;
    if not public.can_access_building(p_building) then
      raise exception 'generate_scheduled_tasks: no access to that building' using errcode = '42501';
    end if;
  end if;

  insert into public.task_instances
    (building_id, template_item_id, task_name, task_description, frequency, responsible_role,
     status, due_date, requires_photo, requires_signature, assigned_to)
  select b.id, ti.id, ti.task_name, ti.task_description, ct.frequency,
         coalesce(nullif(btrim(ti.responsible_party), ''), nullif(btrim(ct.responsible_role), ''), 'user'), 'pending', occ.due,
         ti.requires_photo, ti.requires_signature,
         (select bra.user_id
            from public.building_role_assignments bra
           where bra.building_id = b.id
             and bra.role = coalesce(nullif(btrim(ti.responsible_party), ''), nullif(btrim(ct.responsible_role), ''), 'user')
           limit 1)
    from public.checklist_templates ct
    join public.template_items ti on ti.template_id = ct.id
    cross join public.buildings b
    cross join lateral (
      select public.scheduled_due_date(ct.frequency, v_today) as due
       where ct.recurrence is null
      union all
      select o as due
        from public.recurrence_occurrences(
               ct.recurrence, v_today,
               v_today + least(greatest(coalesce(p_horizon_days, 0), 0),
                               case ct.recurrence->>'unit' when 'day' then 14 when 'week' then 90 else 365 end)) o
       where ct.recurrence is not null
    ) occ
   where ct.is_active is distinct from false
     and ct.archived_at is null
     and ct.frequency in ('daily','weekly','monthly','quarterly','annually')
     and (p_building  is null or b.id = p_building)
     and (p_template  is null or ct.id = p_template)
     and (p_frequency is null or ct.frequency = p_frequency)
     and (ct.applies_to_building_types is null
          or b.building_type = any (ct.applies_to_building_types))
  on conflict (building_id, template_item_id, due_date) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.generate_scheduled_tasks(uuid, uuid, text, integer) from public;
revoke execute on function public.generate_scheduled_tasks(uuid, uuid, text, integer) from anon;
grant execute on function public.generate_scheduled_tasks(uuid, uuid, text, integer) to authenticated, service_role;
-- The old 3-arg signature goes only AFTER the 4-arg one exists, so a caller passing three
-- named args (PostgREST fills the default) never hits "function does not exist".
drop function if exists public.generate_scheduled_tasks(uuid, uuid, text);

-- ============================================================
-- 5) After a rule change: drop the template's untouched future occurrences and regenerate.
--    Untouched = pending, due after today, no completion, and assigned_to is null or equals
--    what the building's role assignment would give — anything a person edited by hand stays.
--    Regenerates with the same 90-day horizon the nightly cron uses (section 7), so a
--    rescheduled template never carries more future rows than an untouched one.
-- ============================================================
create or replace function public.reschedule_template(p_template uuid)
returns table (deleted integer, generated integer)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_del integer := 0;
  v_gen integer := 0;
  b record;
begin
  if auth.uid() is null or not public.is_admin_or_manager() then
    raise exception 'reschedule_template: admin or manager only' using errcode = '42501';
  end if;
  delete from public.task_instances t
   using public.template_items ti
   join public.checklist_templates ct on ct.id = ti.template_id
   where ti.id = t.template_item_id
     and ti.template_id = p_template
     and t.status = 'pending'
     and t.due_date > v_today
     and not exists (select 1 from public.task_completions tc where tc.task_instance_id = t.id)
     and (t.assigned_to is null
          or t.assigned_to = (select bra.user_id
                                from public.building_role_assignments bra
                               where bra.building_id = t.building_id
                                 -- the same label generate_scheduled_tasks derives (blank = absent)
                                 and bra.role = coalesce(nullif(btrim(ti.responsible_party), ''), nullif(btrim(ct.responsible_role), ''), 'user')
                               limit 1));
  get diagnostics v_del = row_count;
  for b in select id from public.buildings where public.can_access_building(id) loop
    v_gen := v_gen + public.generate_scheduled_tasks(b.id, p_template, null, 90);
  end loop;
  return query select v_del, v_gen;
end $$;
revoke all on function public.reschedule_template(uuid) from public;
revoke execute on function public.reschedule_template(uuid) from anon;
grant execute on function public.reschedule_template(uuid) to authenticated;

-- ============================================================
-- 6) Reviewer role removed (D4: zero holders, zero server-side power). The guard keeps an
--    environment that still has a reviewer from applying this; reassign them first.
-- ============================================================
do $$
begin
  if exists (select 1 from public.user_roles where role = 'reviewer') then
    raise exception 'user_roles still holds reviewer rows; reassign them before applying R3a';
  end if;
end $$;
-- Constraint name from 2026-08-04_04_enum_check_constraints.sql.
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles
  add constraint user_roles_role_check check (role in ('admin','manager','user'));

-- building_members precedence: the reviewer line dropped; body otherwise as in
-- 2026-09-11_01_r1_mine.sql (every reference already schema-qualified, so search_path = '').
create or replace function public.building_members(b uuid)
returns table (id uuid, full_name text, avatar_url text, role text)
language sql stable security definer
set search_path = ''
as $$
  select p.id,
         p.full_name,
         p.avatar_url,
         (select r.role
            from public.user_roles r
           where r.user_id = p.id
           order by case r.role
                      when 'admin'    then 0
                      when 'manager'  then 1
                      else 3
                    end
           limit 1) as role
  from public.profiles p
  where public.can_access_building(b)
    and coalesce(p.deactivated, false) = false
    and exists (select 1 from public.user_roles r where r.user_id = p.id)
    and (
      exists (select 1 from public.user_roles r where r.user_id = p.id and r.role in ('admin','manager'))
      or exists (select 1 from public.user_buildings ub where ub.user_id = p.id and ub.building_id = b)
    )
  order by p.full_name nulls last;
$$;
revoke all on function public.building_members(uuid) from public;
revoke execute on function public.building_members(uuid) from anon;
grant execute on function public.building_members(uuid) to authenticated;

-- ============================================================
-- 7) Cron: 90-day horizon nightly (02:00 UTC = 04:00 SAST, as before).
-- ============================================================
do $$ begin perform cron.unschedule('task-generation-daily'); exception when others then null; end $$;
select cron.schedule('task-generation-daily', '0 2 * * *', 'select public.generate_scheduled_tasks(null, null, null, 90)');

commit;

-- Verify:
--   select * from public.recurrence_occurrences('{"every":1,"unit":"month","monthDay":"last"}', date '2026-01-15', date '2026-04-30');
--     -> 2026-01-31, 2026-02-28, 2026-03-31, 2026-04-30
--   select * from public.recurrence_occurrences('{"every":6,"unit":"month","monthDay":1}', date '2026-09-10', date '2027-12-31');
--     -> 2026-10-01, 2027-04-01, 2027-10-01
--   select proname, pg_get_function_identity_arguments(oid) from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'generate_scheduled_tasks';   -- one row, 4 args
--   select command from cron.job where jobname = 'task-generation-daily';                     -- ..., 90)
--   select conname from pg_constraint where conname in ('user_roles_role_check','checklist_templates_recurrence_check');
