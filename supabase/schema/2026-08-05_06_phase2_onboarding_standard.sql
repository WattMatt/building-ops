-- 2026-08-05_06_phase2_onboarding_standard.sql
-- Phase 2 of the WM Onboarding Standard (ONBOARDING-STANDARD/STANDARD.md) for
-- gmi-operations. Idempotent; safe to re-run. Apply order: staging -> verify -> prod.
--
-- P2-01 (C5 gate hardening): profiles UPDATE RLS is `id = auth.uid() OR is_admin()`,
--        so a gated user could self-clear must_set_password (or un-deactivate
--        themselves by flipping deactivated) with a plain PostgREST PATCH on
--        their own row. The forced-change flag must be server-controlled.
-- P2-02 (D1/C9 first-run gate): the app gains a redirect-style onboarding
--        wizard keyed on a DB flag; profiles needs onboarding_completed plus a
--        backfill so existing users are not funnelled through the wizard.
--
-- Companion app changes (gmi-operations): clearMustSetPassword now routes
-- through the new clear-password-gate edge function (service role) because
-- P2-01 blocks the client-side write it used to do. DEPLOY THIS FILE AND THAT
-- FUNCTION TOGETHER, and BEFORE the web deploy — the old client writes the
-- flag directly and would break once P2-01 is live, while the new client
-- breaks invite acceptance if the function is missing.

begin;

-- ---------------------------------------------------------------------------
-- P2-02: onboarding_completed flag + backfill (STANDARD C9)
--
-- Backfill mirrors IL's approach in intent (existing users skip the wizard);
-- the simplest correct predicate here is the first-login gate itself: anyone
-- who is past set-password (must_set_password = false) is an existing,
-- functioning user. Users still inside the gate (must_set_password = true)
-- have never onboarded and SHOULD see the wizard after setting a password.
alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

update public.profiles
   set onboarding_completed = true
 where must_set_password = false
   and onboarding_completed = false;

-- ---------------------------------------------------------------------------
-- P2-01: server-only control of must_set_password / deactivated (STANDARD C5)
--
-- BEFORE UPDATE trigger rejecting any change to the two auth-gate flags unless
-- the request carries the service_role JWT (i.e. came from an edge function's
-- admin client). Requests with NO jwt claims at all (direct SQL: migrations,
-- dashboard editor, psql as postgres) are allowed — triggers fire even for
-- table owners, and blocking them would break this very file's backfill and
-- future admin surgery. PostgREST always sets request.jwt.claims (role
-- 'anon'/'authenticated'/'service_role'), so every API-originated write is
-- covered. Pattern follows the pinned-search_path style of the existing
-- SECURITY DEFINER helpers in this schema (see 2026-08-04_01).
create or replace function public.enforce_profile_flag_protection()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  jwt_role text;
begin
  if (new.must_set_password is distinct from old.must_set_password)
     or (new.deactivated is distinct from old.deactivated) then
    jwt_role := coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    );
    -- '' = no JWT context (direct SQL / migration session) -> allow.
    if jwt_role <> '' and jwt_role <> 'service_role' then
      raise exception 'must_set_password and deactivated may only be changed by the server'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_profiles_protect_flags on public.profiles;
create trigger trg_profiles_protect_flags
  before update on public.profiles
  for each row
  execute function public.enforce_profile_flag_protection();

commit;

-- ---------------------------------------------------------------------------
-- Verification
--
-- 1) Column + backfill (expect: onboarding_completed exists, NOT NULL,
--    default false; count of onboarded rows == count of ungated rows):
--      select column_name, data_type, column_default, is_nullable
--        from information_schema.columns
--       where table_schema = 'public' and table_name = 'profiles'
--         and column_name = 'onboarding_completed';
--      select count(*) filter (where onboarding_completed),
--             count(*) filter (where not must_set_password)
--        from public.profiles;
--
-- 2) Trigger present (expect 1 row):
--      select tgname from pg_trigger
--       where tgrelid = 'public.profiles'::regclass
--         and tgname = 'trg_profiles_protect_flags';
--
-- 3) Behavioural probe (as an AUTHENTICATED user via PostgREST, e.g. the
--    rls-smoke pattern): PATCH own profile with {"must_set_password": false}
--    while it is true -> expect 42501; PATCH {"full_name": "x"} -> expect 200.
--    Via an edge function's service-role client -> expect the flag write to
--    succeed (clear-password-gate depends on this).
