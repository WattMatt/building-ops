-- 2026-08-04_08_revoke_user_sessions.sql
-- Audit remediation (2026-08-04). Idempotent.
--
-- A-09  Deactivating a user did not actually cut off access.
--       `auth.admin.updateUserById({ ban_duration })` blocks new sign-ins and
--       refreshes, but an access token already issued stays valid for the rest
--       of its lifetime (jwt_exp = 3600 on prod), so a user deactivated mid-
--       session keeps full RLS-scoped read/write for up to an hour.
--
--       The obvious client-side remedy does not work: the edge function called
--       `auth.admin.signOut(userId, 'global')`, but GoTrue's admin signOut takes
--       a **JWT**, not a user id -- it sends the argument as
--       `Authorization: Bearer <jwt>`, so passing a UUID 401s every time. The
--       error was swallowed and the function still reported success, which is
--       worse than no fix: it asserts a revocation that never happened.
--
--       Revoking server-side is the reliable route.

create or replace function public.revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sessions integer := 0;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions       where user_id = p_user_id;
  get diagnostics v_sessions = row_count;

  return v_sessions;
end;
$$;

-- service_role only: this is called from an edge function that has already
-- verified the caller is an admin. No client should ever reach it directly.
revoke execute on function public.revoke_user_sessions(uuid) from public;
revoke execute on function public.revoke_user_sessions(uuid) from anon;
revoke execute on function public.revoke_user_sessions(uuid) from authenticated;
grant  execute on function public.revoke_user_sessions(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   drop function if exists public.revoke_user_sessions(uuid);
