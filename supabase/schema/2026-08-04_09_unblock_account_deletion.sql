-- 2026-08-04_09_unblock_account_deletion.sql
-- Audit remediation (2026-08-04). Idempotent.
--
-- A-10  Account deletion is broken for most real users. Seven foreign keys
--       reference public.profiles(id) / auth.users(id) with NO ACTION, so
--       deleting anyone who has ever authored a Fortress report, reviewed one,
--       run a compliance assessment, performed an inspection, signed a form, or
--       been assigned a sign-off aborts the auth cascade with an FK violation.
--       delete-user / delete-account then return a generic 500.
--
--       (The storage-ordering fix in the same wave means evidence photos now
--       survive that failure, but the feature itself still does not work.)
--
-- Resolution per column, chosen by what the row MEANS once its person is gone:
--
--   Historical records -> SET NULL. The report, assessment or inspection is a
--   business artifact that must outlive the user; only the attribution is lost.
--
--   form_signatures.signer_id -> SET NULL, and the column is made nullable to
--   allow it. A signature is a compliance audit artifact: destroying it to
--   erase a person would be worse than anonymising it, and CASCADE would do
--   exactly that. Table is empty (0 rows), so this costs nothing today.
--
--   form_signoff_requests.assigned_to -> CASCADE. Unlike the above this is not
--   history, it is live actionable state; a pending request assigned to a
--   deleted user is meaningless. Its child form_signatures rows already cascade
--   from request_id, so the cleanup is complete. Table is empty (0 rows).
--
-- Row counts verified on prod before applying: reports 5, compliance_assessments 2,
-- building_inspections 4, form_signatures 0, form_signoff_requests 0.

begin;

-- ---- historical attribution: keep the row, drop the link -------------------
alter table public.reports
  drop constraint if exists reports_author_id_fkey,
  add  constraint reports_author_id_fkey
       foreign key (author_id) references public.profiles(id) on delete set null;

alter table public.reports
  drop constraint if exists reports_reviewed_by_fkey,
  add  constraint reports_reviewed_by_fkey
       foreign key (reviewed_by) references public.profiles(id) on delete set null;

alter table public.compliance_assessments
  drop constraint if exists compliance_assessments_assessed_by_fkey,
  add  constraint compliance_assessments_assessed_by_fkey
       foreign key (assessed_by) references public.profiles(id) on delete set null;

alter table public.building_inspections
  drop constraint if exists building_inspections_inspected_by_fkey,
  add  constraint building_inspections_inspected_by_fkey
       foreign key (inspected_by) references public.profiles(id) on delete set null;

alter table public.form_signoff_requests
  drop constraint if exists form_signoff_requests_assigned_by_fkey,
  add  constraint form_signoff_requests_assigned_by_fkey
       foreign key (assigned_by) references public.profiles(id) on delete set null;

-- ---- audit artifact: anonymise rather than destroy -------------------------
alter table public.form_signatures alter column signer_id drop not null;

alter table public.form_signatures
  drop constraint if exists form_signatures_signer_id_fkey,
  add  constraint form_signatures_signer_id_fkey
       foreign key (signer_id) references public.profiles(id) on delete set null;

-- ---- live actionable state: remove it --------------------------------------
alter table public.form_signoff_requests
  drop constraint if exists form_signoff_requests_assigned_to_fkey,
  add  constraint form_signoff_requests_assigned_to_fkey
       foreign key (assigned_to) references public.profiles(id) on delete cascade;

commit;

-- Verification (must return 0 rows):
--   select c.conrelid::regclass::text, a.attname
--   from pg_constraint c
--   join lateral unnest(c.conkey) k(attnum) on true
--   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
--   where c.contype = 'f' and c.connamespace = 'public'::regnamespace
--     and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
--     and c.confdeltype in ('a','r');
--
-- ROLLBACK: re-create each constraint without the ON DELETE clause, and
--   alter table public.form_signatures alter column signer_id set not null;
