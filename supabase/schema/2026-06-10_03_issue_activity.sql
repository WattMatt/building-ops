-- Migration: issue_activity table (issue lifecycle timeline) + idempotent task completions
-- Context: SPEC.md Issues acceptance criteria — activity timeline of status changes,
-- assignments, and comments. Also a unique index on task_completions so offline
-- queue replays cannot duplicate a completion (paired with
-- Prefer: resolution=ignore-duplicates + on_conflict=task_instance_id in the app).
-- Applied: 2026-06-10 via Supabase Management API.

begin;

create table if not exists public.issue_activity (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  activity_type text not null check (activity_type in ('created','comment','status_change','assignment','contractor_assignment')),
  old_value text,
  new_value text,
  comment text,
  photo_urls jsonb,
  created_at timestamptz not null default now()
);

create index if not exists issue_activity_issue_idx
  on public.issue_activity (issue_id, created_at);

alter table public.issue_activity enable row level security;
grant select, insert, delete on public.issue_activity to authenticated;
revoke all on public.issue_activity from anon;

create policy ia_select on public.issue_activity for select using (
  exists (select 1 from public.issues i where i.id = issue_id and public.can_access_building(i.building_id))
);
create policy ia_insert on public.issue_activity for insert with check (
  exists (select 1 from public.issues i where i.id = issue_id and public.can_access_building(i.building_id))
);
create policy ia_delete on public.issue_activity for delete using (public.is_admin());

-- One completion per task instance: makes offline replays idempotent.
-- Dedupe any existing duplicates first (keep the earliest row).
delete from public.task_completions a
  using public.task_completions b
  where a.task_instance_id = b.task_instance_id
    and a.ctid > b.ctid;

create unique index if not exists task_completions_instance_uniq
  on public.task_completions (task_instance_id);

commit;
