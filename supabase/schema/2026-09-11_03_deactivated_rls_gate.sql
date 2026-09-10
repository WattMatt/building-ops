-- 2026-09-11_03_deactivated_rls_gate.sql
-- Security fix. Idempotent. Apply order: staging -> smoke -> prod.
--
-- Since e5978b6 (2026-08-05) deactivation is reversible: set-user-status bans the
-- account, revokes refresh tokens and sessions, and KEEPS user_buildings so that a
-- reactivated user gets their portfolio back without an admin re-assigning it.
--
-- Gap: revoking sessions only stops the user obtaining a NEW access token. The
-- access token they already hold stays valid until it expires (default 1h), and
-- none of the RLS helpers consulted profiles.deactivated, so a deactivated user
-- kept reading (and writing) building data for up to an hour. The old code hid
-- this by wiping user_buildings; the admin-ops smoke still asserted that.
--
-- Fix: one helper, is_active_user(), and every role/building helper is gated on
-- it. A deactivated caller is treated as having no role and no buildings at once.
-- Nothing changes for active users; the extra cost is a primary-key lookup on
-- profiles inside SECURITY DEFINER functions that are already STABLE.

begin;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and not coalesce((select p.deactivated from public.profiles p where p.id = auth.uid()), false)
$$;
revoke all on function public.is_active_user() from public;
revoke execute on function public.is_active_user() from anon;
grant execute on function public.is_active_user() to authenticated, service_role;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_active_user()
     and coalesce((select role from public.user_roles where user_id = auth.uid()) = 'admin', false)
$$;

create or replace function public.is_admin_or_manager()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_active_user()
     and coalesce((select role from public.user_roles where user_id = auth.uid()) in ('admin','manager'), false)
$$;

create or replace function public.can_access_building(b uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_admin_or_manager()
      or ( public.is_active_user()
           and exists (
             select 1 from public.user_buildings ub
             where ub.user_id = auth.uid() and ub.building_id = b
           ) )
$$;

commit;

-- Verify:
--   select proname from pg_proc where pronamespace='public'::regnamespace
--     and prosrc ilike '%is_active_user%';   -- is_admin, is_admin_or_manager, can_access_building
-- Rollback: re-run the definitions in 2026-06-10_01_security_user_roles.sql and
--   2026-06-10_02_rls_redesign.sql, then drop function public.is_active_user().
