-- 2026-08-04_04_enum_check_constraints.sql
-- Audit remediation (2026-08-04).
--
--   STATUS: APPLIED TO STAGING AND PRODUCTION (2026-08-05), after the
--   preconditions at the bottom of this file were discharged. See the
--   "PRECONDITIONS DISCHARGED" note there for the evidence.
--
-- A-06  The status/priority/frequency/role vocabularies that iOS hard-decodes
--       into Swift enums are enforced NOWHERE: no CHECK constraints, no
--       enforcement in the web app's generated types (its Enums block is
--       empty, so enum-keyed types resolve to `never`), and nothing in
--       specs/SCHEMA_CONTRACT.md.
--
--       Failure path: the web app (or a console edit) writes
--       issues.status = 'closed'. PostgREST accepts it. The iOS `IssueStatus`
--       decode throws, the whole page of issues fails to decode, and the field
--       user sees an EMPTY issues list -- not a partial list, not an error.
--       One out-of-vocabulary write silently blanks a core screen.
--
-- Data precondition verified on prod 2026-08-04 -- every existing value is
-- already in vocabulary, so the constraints would validate cleanly today:
--   task_instances.status     -> pending(123)
--   task_instances.frequency  -> daily(45), monthly(26), annually(22),
--                                weekly(16), quarterly(14)
--   user_roles.role           -> admin(5)
--   issues.*, form_submissions.* -> no rows yet

begin;

alter table public.issues
  drop constraint if exists issues_status_check,
  add constraint issues_status_check
    check (status in ('open','in_progress','escalated','resolved'));

alter table public.issues
  drop constraint if exists issues_priority_check,
  add constraint issues_priority_check
    check (priority in ('low','medium','high','critical'));

alter table public.task_instances
  drop constraint if exists task_instances_status_check,
  add constraint task_instances_status_check
    check (status in ('pending','completed','overdue','issue_logged'));

alter table public.task_instances
  drop constraint if exists task_instances_frequency_check,
  add constraint task_instances_frequency_check
    check (frequency in ('daily','weekly','monthly','quarterly','annually'));

alter table public.checklist_templates
  drop constraint if exists checklist_templates_frequency_check,
  add constraint checklist_templates_frequency_check
    check (frequency in ('daily','weekly','monthly','quarterly','annually'));

alter table public.form_submissions
  drop constraint if exists form_submissions_status_check,
  add constraint form_submissions_status_check
    check (status in ('submitted','reviewed','approved','rejected'));

alter table public.user_roles
  drop constraint if exists user_roles_role_check,
  add constraint user_roles_role_check
    check (role in ('admin','manager','user','reviewer'));

commit;

-- ---------------------------------------------------------------------------
-- PRECONDITIONS DISCHARGED (2026-08-05) -- applied to prod.
--
-- 1. Every web write path to all seven columns was enumerated (every .insert /
--    .update / .upsert reachable from .from('<table>') across src/,
--    supabase/functions/ and scripts/, plus dynamic .from(table) writes, .rpc
--    calls, raw rest/v1 fetches, and DB-side functions). Result: 13 write sites,
--    every literal in vocabulary. checklist_templates has NO web write path.
--    The out-of-vocabulary literals in the repo ('draft', 'declined', 'missed',
--    'invited', 'temp_password', ...) all belong to OTHER columns --
--    reports.status, form_signoff_requests.status,
--    form_submissions.signoff_status, task_instances.responsible_role -- or are
--    UI-only badge/filter values, or edge-function response bodies.
-- 2. Live violator scan on prod returned 0 for all seven columns, including
--    checklist_templates.frequency (annually 1, daily 3, monthly 4,
--    quarterly 1, weekly 2).
-- 3. Verified both directions on prod in rolled-back transactions:
--    status='closed' -> rejected by check_violation;
--    status='completed' -> accepted, 1 row.
--
-- NOTE: CHECK (x IN (...)) evaluates to NULL for a NULL input and therefore
-- PASSES, so nullable columns are unaffected (rls-smoke inserts a template with
-- no frequency).
--
-- KNOWN GAP this now backstops: invite-user/index.ts:82 does
-- `String(body.role ?? "user")` and upserts it with the service-role client with
-- NO allowlist -- the only genuinely unbounded write path to user_roles.role.
-- The constraint is what stops it. Adding an explicit allowlist there would turn
-- a Postgres 23514 into a legible 403.
--
-- ORIGINAL PRECONDITIONS (kept for the record)
--
-- This constrains a schema with TWO production writers (iOS + web), and the web
-- app has never been audited. A grep of the web source surfaces status-like
-- literals that are NOT in the iOS vocabulary -- 'missed', 'done', 'complete',
-- 'draft', 'declined', 'invited', 'temp_password', 'deactivated'. Most are
-- clearly UI-only (badge variants, filter values) or belong to OTHER tables
-- (reports.status, form_signoff_requests, user status), but that has not been
-- proven per-column.
--
-- Applying this to prod before proving it would convert a silent iOS-side
-- display bug into a hard write failure on the web pilot -- strictly worse,
-- since the pilot is currently web-only.
--
-- Required before prod:
--   1. Audit every web write path to these seven columns and confirm the value
--      sets match exactly (grep .from('issues').update / .insert etc.).
--   2. Run each constraint's predicate as a SELECT against prod first, e.g.
--        select distinct status from public.issues
--        where status not in ('open','in_progress','escalated','resolved');
--      Every one must return zero rows.
--   3. Apply to staging (done), exercise the web smoke suite against staging,
--      and confirm no write regressions.
--
-- COMPLEMENTARY iOS-SIDE FIX (recommended regardless): make the iOS decoders
-- lenient for these columns -- decode to String and map to the enum with a
-- fallback -- so an unknown server value degrades one row instead of blanking
-- the entire list. Belt and braces: the constraint keeps bad data out, lenient
-- decoding keeps the app usable if any ever gets in.
--
-- ROLLBACK: alter table <t> drop constraint if exists <name>;  (per constraint)
