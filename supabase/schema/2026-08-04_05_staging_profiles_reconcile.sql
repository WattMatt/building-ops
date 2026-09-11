-- 2026-08-04_05_staging_profiles_reconcile.sql
-- Audit remediation (2026-08-04). STAGING ONLY -- prod already has these columns.
--
-- A-07  profiles.must_set_password and profiles.deactivated exist on PROD but
--       were added outside the documented migration pipeline (CLAUDE.md: "SQL
--       files in sql/ ... applied to production via the Supabase Management
--       API"), so there is no migration file for them and staging never got
--       them.
--
--       That breaks the stated contract that staging is a schema mirror of
--       prod: any first-login-gate or deactivation test run against staging
--       exercises a schema the production app does not have. It also means a
--       clone built per CLONE_RUNBOOK by replaying sql/ would silently omit two
--       auth-critical columns.
--
-- Column definitions match prod exactly (verified 2026-08-04):
--   must_set_password  boolean  NOT NULL  DEFAULT false
--   deactivated        boolean  NOT NULL  DEFAULT false

begin;

alter table public.profiles
  add column if not exists must_set_password boolean not null default false,
  add column if not exists deactivated       boolean not null default false;

commit;

-- Verification (must return 2 rows on BOTH prod and staging after this):
--   select column_name, data_type, column_default, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'profiles'
--     and column_name in ('must_set_password', 'deactivated');
