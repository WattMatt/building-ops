-- 2026-08-04_01_security_hardening.sql
-- Audit remediation (2026-08-04 end-to-end audit). Idempotent; safe to re-run.
-- Apply order: staging -> verify -> prod.
--
-- A-01  compliance_scores lost security_invoker -> live unauthenticated RLS bypass.
-- A-02  generate_certificate_renewal_tasks() is an ungated SECURITY DEFINER writer
--       executable by anon via /rest/v1/rpc/.
-- A-03  handle_new_user() is SECURITY DEFINER with no pinned search_path.

begin;

-- ---------------------------------------------------------------------------
-- A-01: restore security_invoker on compliance_scores
--
-- sql/2026-06-13_08 created this view WITH (security_invoker = on) per decision
-- R-01. sql/2026-06-19_02 replaced it with a bare CREATE OR REPLACE VIEW, which
-- resets reloptions -- so the view reverted to running with owner (postgres)
-- privileges and stopped honouring RLS on compliance_assessments /
-- compliance_responses / reports.
--
-- Verified live on prod 2026-08-04: an unauthenticated GET with the anon key
-- baked into the shipped iOS binary returned per-building compliance
-- percentages, while every sibling view and base table correctly returned [].
--
-- RULE going forward: CREATE OR REPLACE VIEW resets reloptions. Every view
-- replacement must restate `WITH (security_invoker = on)`.
alter view public.compliance_scores set (security_invoker = on);

-- Belt-and-braces: anon has no business reading any Fortress scoring view, and
-- none of them are updatable, so the write grants are inert noise. Revoke both.
-- (authenticated retains SELECT; the web Fortress dashboards depend on it and
-- are now correctly filtered by the base tables' RLS.)
revoke all on public.compliance_scores          from anon;
revoke all on public.compliance_section_scores  from anon;
revoke all on public.compliance_critical_scores from anon;
revoke all on public.ppm_monthly_status         from anon;
revoke all on public.v_building_turnover        from anon;

revoke insert, update, delete, truncate, references, trigger
  on public.compliance_scores, public.compliance_section_scores,
     public.compliance_critical_scores, public.ppm_monthly_status,
     public.v_building_turnover
  from authenticated;

-- ---------------------------------------------------------------------------
-- A-02: close the ungated server-side writer
--
-- generate_certificate_renewal_tasks() inserts into task_instances and contains
-- no auth.uid()/role check (unlike building_insight_linker and
-- report_electrical_compliance, which both gate on can_access_building, and
-- delete_own_account, which rejects a null auth.uid()). PUBLIC holds EXECUTE,
-- so any holder of the public anon key can drive server-side writes.
--
-- No client calls this: it appears only in the web app's generated
-- fortress-types.ts. Its real caller is pg_cron jobid 1
-- ("certificate-renewal-tasks", 0 4 * * *), which runs as postgres and keeps
-- EXECUTE via ownership.
revoke execute on function public.generate_certificate_renewal_tasks() from public;
revoke execute on function public.generate_certificate_renewal_tasks() from anon;
revoke execute on function public.generate_certificate_renewal_tasks() from authenticated;

-- ---------------------------------------------------------------------------
-- A-03: pin search_path on the last unpinned SECURITY DEFINER function
--
-- Every other SECURITY DEFINER function already sets search_path ('' or
-- 'public'). handle_new_user() -- which runs on every auth signup and writes
-- profiles + user_roles -- did not. Its body is already fully schema-qualified
-- (public.profiles, public.user_roles), so '' is safe and matches the
-- convention used by is_admin / is_admin_or_manager / can_access_building /
-- app_role / delete_own_account.
alter function public.handle_new_user() set search_path = '';

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK (all three are trivially reversible):
--   alter view public.compliance_scores set (security_invoker = off);
--   grant all on public.compliance_scores to anon;
--   grant execute on function public.generate_certificate_renewal_tasks() to public;
--   alter function public.handle_new_user() reset search_path;
