-- 2026-09-11_01_r1_mine.sql
-- R1 "Mine": tasks get a human owner, comments carry mentions, resolved_at is stamped by
-- the database, building membership is queryable without widening profiles RLS, and the
-- in-app inbox table exists (written by the notify edge function in R1b).
-- Additive and idempotent. Apply order: staging (vkrihpmjajjcxmzgjqdr) -> smoke -> prod
-- (qdzgkttiosahdfqresvz) -> smoke. iOS ignores unknown columns.
begin;

-- 1) Tasks get a human owner. responsible_role stays as the default-assignment input (R3).
alter table public.task_instances
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
create index if not exists task_instances_assigned_to_due_idx
  on public.task_instances (assigned_to, due_date)
  where status in ('pending','overdue');

-- 2) Mentions on a comment. issue_activity already carries comment + photo_urls.
alter table public.issue_activity
  add column if not exists mentions uuid[] not null default '{}';

-- 3) resolved_at is set by the database so cycle time is trustworthy.
create or replace function public.stamp_issue_resolved_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'resolved' then
    if old.status is distinct from 'resolved' then new.resolved_at := now(); end if;
  else
    new.resolved_at := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_issue_resolved_at on public.issues;
create trigger trg_issue_resolved_at
  before update of status on public.issues
  for each row execute function public.stamp_issue_resolved_at();

-- 4) Who can be assigned or mentioned on a building: admins/managers plus users with an
--    explicit user_buildings row. SECURITY DEFINER because profiles are not readable across
--    users (p_select is own-row-or-manager); returns display fields only, and only to
--    callers who can access the building themselves.
--    user_roles holds one row PER USER PER BUILDING (see src/contexts/AuthContext.tsx),
--    so a plain join would return a person once per role row. Instead the membership test
--    is an EXISTS and the returned role is the most privileged one, ordered to match
--    ROLE_PRECEDENCE in src/lib/constants.ts (admin > manager > reviewer > user).
--    The bare EXISTS on user_roles preserves the original inner-join semantics: a profile
--    with no role row at all is not a member and is never returned.
create or replace function public.building_members(b uuid)
returns table (id uuid, full_name text, avatar_url text, role text)
language sql security definer set search_path = public stable as $$
  select p.id,
         p.full_name,
         p.avatar_url,
         (select r.role
            from public.user_roles r
           where r.user_id = p.id
           order by case r.role
                      when 'admin'    then 0
                      when 'manager'  then 1
                      when 'reviewer' then 2
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
-- Supabase default privileges also grant EXECUTE to anon explicitly; "from public" alone leaves it.
revoke execute on function public.building_members(uuid) from anon;
grant execute on function public.building_members(uuid) to authenticated;

-- 5) The inbox. No client insert policy: rows are written by the notify edge function.
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  actor_id      uuid references public.profiles(id) on delete set null,
  actor_name    text,
  kind          text not null,
  entity_type   text not null,
  entity_id     uuid,
  building_id   uuid references public.buildings(id) on delete cascade,
  title         text not null,
  body          text,
  url           text not null,
  read_at       timestamptz,
  created_at    timestamptz not null default now(),
  constraint notifications_kind_check check (kind in (
    'task_assigned','issue_assigned','issue_comment','issue_mention',
    'report_submitted','report_returned','report_approved',
    'form_submitted','form_reviewed','signoff_requested','signoff_complete','signoff_overdue',
    'document_expiring','asset_service_due')),
  constraint notifications_entity_type_check check (entity_type in (
    'task','issue','report','form_submission','signoff_request','document','asset'))
);
create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_id, created_at desc) where read_at is null;
create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists n_select_own on public.notifications;
create policy n_select_own on public.notifications for select using (recipient_id = auth.uid());
drop policy if exists n_update_own on public.notifications;
create policy n_update_own on public.notifications for update
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

commit;
