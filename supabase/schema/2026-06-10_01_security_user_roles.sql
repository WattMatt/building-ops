-- Migration: Close privilege-escalation hole + create missing user_buildings + delete-account RPC
-- Context: AUDIT_REPORT_2026-06-10.md priority 1 & 3.
--   Before this migration every table had a blanket policy
--   `auth_all FOR ALL USING (auth.role() = 'authenticated')`, which let any
--   signed-up user UPDATE user_roles and grant themselves admin.
-- Applied: 2026-06-10 via Supabase Management API.

begin;

-- ============================================================
-- 1. Role helper functions
--    SECURITY DEFINER so policies on user_roles itself don't recurse.
-- ============================================================

create or replace function public.app_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select role from public.user_roles where user_id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select role from public.user_roles where user_id = auth.uid()) = 'admin', false)
$$;

create or replace function public.is_admin_or_manager()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select role from public.user_roles where user_id = auth.uid()) in ('admin','manager'), false)
$$;

-- ============================================================
-- 2. Lock down user_roles
--    Users may read their own role; admins/managers may read all.
--    Only admins may write. handle_new_user() (SECURITY DEFINER, owner
--    postgres) still inserts the default 'user' role on signup.
-- ============================================================

drop policy if exists auth_all on public.user_roles;

create policy ur_select on public.user_roles
  for select using (user_id = auth.uid() or public.is_admin_or_manager());

create policy ur_insert_admin on public.user_roles
  for insert with check (public.is_admin());

create policy ur_update_admin on public.user_roles
  for update using (public.is_admin()) with check (public.is_admin());

create policy ur_delete_admin on public.user_roles
  for delete using (public.is_admin());

-- ============================================================
-- 3. Create the missing user_buildings table
--    AuthService.loadBuildingAssignments() reads this table (404 until now,
--    so every site-restricted user had zero assigned buildings).
--    Shape matches the Swift UserBuilding model: id, user_id, building_id, created_at.
-- ============================================================

create table if not exists public.user_buildings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, building_id)
);

alter table public.user_buildings enable row level security;

grant select, insert, update, delete on public.user_buildings to authenticated;
revoke all on public.user_buildings from anon;

create policy ub_select on public.user_buildings
  for select using (user_id = auth.uid() or public.is_admin_or_manager());

create policy ub_insert_admin on public.user_buildings
  for insert with check (public.is_admin());

create policy ub_update_admin on public.user_buildings
  for update using (public.is_admin()) with check (public.is_admin());

create policy ub_delete_admin on public.user_buildings
  for delete using (public.is_admin());

-- ============================================================
-- 4. Self-service account deletion (App Store requirement).
--    All FKs from auth.users cascade (profiles, user_roles, user_buildings,
--    auth.* internals), verified before writing this migration.
-- ============================================================

create or replace function public.delete_own_account()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

commit;
