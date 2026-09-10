-- 2026-09-12_01_r2_field.sql
-- R2 "Field" schema (spec docs/superpowers/specs/2026-09-10-r2-field-design.md §4). Additive,
-- idempotent. Apply order: staging -> npm run smoke -> prod. iOS never calls any of this.
begin;

-- 1) Due-date rule, shared by nightly generation and the manual "Generate" buttons. It is the
--    exact rule the client used (ChecklistsTab.getDueDateForFrequency): daily -> today,
--    weekly -> the Sunday of this ISO week, monthly -> first of next month, quarterly -> first
--    day of next quarter, annually -> 1 January next year. Pinned by docs/fixtures/frequency-due-dates.json.
create or replace function public.scheduled_due_date(p_frequency text, p_today date)
returns date
language sql immutable
set search_path = ''
as $$
  select case p_frequency
    when 'daily'     then p_today
    when 'weekly'    then date_trunc('week', p_today::timestamp)::date + 6
    when 'monthly'   then (date_trunc('month', p_today::timestamp) + interval '1 month')::date
    when 'quarterly' then (date_trunc('quarter', p_today::timestamp) + interval '3 months')::date
    when 'annually'  then (date_trunc('year', p_today::timestamp) + interval '1 year')::date
    else p_today
  end
$$;
-- Pure, but Supabase default privileges would still expose it to anon (R1 lesson): revoke explicitly.
revoke all on function public.scheduled_due_date(text, date) from public;
revoke execute on function public.scheduled_due_date(text, date) from anon;
grant execute on function public.scheduled_due_date(text, date) to authenticated, service_role;

-- 2) Server-side generation. Cron calls it with no arguments (auth.uid() is null); the app
--    calls it for one building / template / frequency as an admin or manager. Idempotent via
--    task_instances_generated_uniq (building_id, template_item_id, due_date). The building-type
--    scoping matches trg_task_instances_hs_scope, which still runs as a second guard.
create or replace function public.generate_scheduled_tasks(
  p_building uuid default null, p_template uuid default null, p_frequency text default null)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_count integer := 0;
begin
  if auth.uid() is not null then
    -- Only the nightly cron (postgres, null uid) may generate for every building at once.
    if p_building is null then
      raise exception 'generate_scheduled_tasks: p_building is required for signed-in callers' using errcode = '42501';
    end if;
    if not public.is_admin_or_manager() then
      raise exception 'generate_scheduled_tasks: admin or manager only' using errcode = '42501';
    end if;
    if p_building is not null and not public.can_access_building(p_building) then
      raise exception 'generate_scheduled_tasks: no access to that building' using errcode = '42501';
    end if;
  end if;

  insert into public.task_instances
    (building_id, template_item_id, task_name, task_description, frequency, responsible_role,
     status, due_date, requires_photo, requires_signature)
  select b.id, ti.id, ti.task_name, ti.task_description, ct.frequency, 'user', 'pending',
         public.scheduled_due_date(ct.frequency, v_today), ti.requires_photo, ti.requires_signature
    from public.checklist_templates ct
    join public.template_items ti on ti.template_id = ct.id
    cross join public.buildings b
   where ct.is_active is distinct from false
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
revoke all on function public.generate_scheduled_tasks(uuid, uuid, text) from public;
revoke execute on function public.generate_scheduled_tasks(uuid, uuid, text) from anon;
grant execute on function public.generate_scheduled_tasks(uuid, uuid, text) to authenticated, service_role;

-- 3) Overdue sweep. Nothing transitioned pending -> overdue before this (only the certificate
--    generator wrote 'overdue', at insert time).
create or replace function public.mark_overdue_tasks()
returns integer
language sql security definer
set search_path = ''
as $$
  with u as (
    update public.task_instances
       set status = 'overdue'
     where status = 'pending'
       and due_date < (now() at time zone 'Africa/Johannesburg')::date
    returning 1)
  select count(*)::int from u;
$$;
revoke all on function public.mark_overdue_tasks() from public;
revoke execute on function public.mark_overdue_tasks() from anon, authenticated;
grant execute on function public.mark_overdue_tasks() to service_role;

-- 4) Atomic, idempotent completion (security INVOKER: tc_insert / ti_update policies apply
--    exactly as they do to the two direct writes CompleteTaskDialog makes today).
create or replace function public.complete_task(
  p_completion_id uuid, p_task_instance_id uuid, p_notes text default null,
  p_signature_confirmed boolean default false, p_photo_urls jsonb default '[]'::jsonb)
returns table (completion_id uuid, already_completed boolean)
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'complete_task: sign in required' using errcode = '42501';
  end if;
  insert into public.task_completions (id, task_instance_id, completed_by, notes, signature_confirmed, photo_urls)
  values (coalesce(p_completion_id, gen_random_uuid()), p_task_instance_id, auth.uid(),
          p_notes, coalesce(p_signature_confirmed, false), coalesce(p_photo_urls, '[]'::jsonb))
  on conflict (task_instance_id) do nothing
  returning id into v_id;
  if v_id is not null then
    update public.task_instances
       set status = 'completed', completed_at = now(), completed_by = auth.uid()
     where id = p_task_instance_id;
    return query select v_id, false;
  else
    select tc.id into v_id from public.task_completions tc where tc.task_instance_id = p_task_instance_id;
    return query select v_id, true;
  end if;
end $$;
revoke all on function public.complete_task(uuid, uuid, text, boolean, jsonb) from public;
revoke execute on function public.complete_task(uuid, uuid, text, boolean, jsonb) from anon;
grant execute on function public.complete_task(uuid, uuid, text, boolean, jsonb) to authenticated;

-- 5) Global search (security INVOKER so each table's RLS applies). Two-character minimum.
--    Returns up to lim (capped at 50) per kind, kinds in the order building, issue, tenant, document, so one
--    kind with many matches cannot starve the others.
create or replace function public.search_entities(q text, lim integer default 20)
returns table (kind text, id uuid, building_id uuid, title text, subtitle text)
language sql stable security invoker
set search_path = ''
as $$
  with needle as (
    select '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as p
     where length(btrim(coalesce(q, ''))) >= 2
  )
  (select 'building'::text, b.id, b.id, b.name::text, b.address::text
     from public.buildings b, needle where b.name ilike needle.p or b.address ilike needle.p
    order by b.name limit least(coalesce(lim, 20), 50))
  union all
  (select 'issue', i.id, i.building_id, i.title, left(i.description, 80)
     from public.issues i, needle where i.title ilike needle.p or i.description ilike needle.p
    order by i.created_at desc limit least(coalesce(lim, 20), 50))
  union all
  (select 'tenant', t.id, t.building_id, coalesce(t.shop_name, t.name, 'Tenant'),
          coalesce(t.unit_number, t.shop_number)
     from public.building_tenants t, needle
    where t.name ilike needle.p or t.shop_name ilike needle.p or t.unit_number ilike needle.p
    order by 4 limit least(coalesce(lim, 20), 50))
  union all
  (select 'document', d.id, d.building_id, d.name, d.document_type
     from public.building_documents d, needle where d.name ilike needle.p
    order by d.name limit least(coalesce(lim, 20), 50))
$$;
revoke all on function public.search_entities(text, integer) from public;
revoke execute on function public.search_entities(text, integer) from anon;
grant execute on function public.search_entities(text, integer) to authenticated;

-- 6) Push subscriptions (used by R2c; owner-only).
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  failed_at    timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists ps_select_own on public.push_subscriptions;
create policy ps_select_own on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists ps_insert_own on public.push_subscriptions;
create policy ps_insert_own on public.push_subscriptions for insert with check (user_id = auth.uid());
drop policy if exists ps_update_own on public.push_subscriptions;
create policy ps_update_own on public.push_subscriptions for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists ps_delete_own on public.push_subscriptions;
create policy ps_delete_own on public.push_subscriptions for delete using (user_id = auth.uid());

-- 7) Photo geotag opt-in (POPIA: off by default).
alter table public.profiles add column if not exists geotag_photos boolean not null default false;

-- 8) Notification kind written only by the daily digest (server).
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'task_assigned','issue_assigned','issue_comment','issue_mention',
  'report_submitted','report_returned','report_approved',
  'form_submitted','form_reviewed','signoff_requested','signoff_complete','signoff_overdue',
  'document_expiring','asset_service_due','task_due_today'));

-- 9) Crons. 02:00 UTC = 04:00 SAST generation; 22:05 UTC = 00:05 SAST overdue sweep.
do $$ begin perform cron.unschedule('task-generation-daily'); exception when others then null; end $$;
select cron.schedule('task-generation-daily', '0 2 * * *', 'select public.generate_scheduled_tasks()');
do $$ begin perform cron.unschedule('task-overdue-sweep'); exception when others then null; end $$;
select cron.schedule('task-overdue-sweep', '5 22 * * *', 'select public.mark_overdue_tasks()');

commit;

-- Verify:
--   select proname from pg_proc where pronamespace='public'::regnamespace and proname in
--     ('scheduled_due_date','generate_scheduled_tasks','mark_overdue_tasks','complete_task','search_entities');
--   select jobname, schedule from cron.job where jobname like 'task-%';
--   select public.scheduled_due_date('weekly', date '2026-09-10');  -- 2026-09-13 (Sunday)
-- Before the first prod apply, know the backlog the sweep will flip:
--   select count(*) from task_instances where status='pending' and due_date < current_date;
