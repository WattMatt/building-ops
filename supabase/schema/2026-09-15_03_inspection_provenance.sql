-- 2026-09-15_03_inspection_provenance.sql — S3 "Report data integrity" (spec 2026-09-12-field-readiness-design.md §6).
-- Additive, idempotent, one transaction. Requires 2026-06-13_02 (compliance_assessments), 2026-06-13_03
-- (building_inspections) and 2026-08-04_09 (both FKs to profiles are already ON DELETE SET NULL, so a
-- populated inspected_by / assessed_by never blocks account deletion).
--
-- Why: the app creates a building_inspections row the first time the inspection tab of a report is opened
-- (useInspectionSection) and a compliance_assessments row the first time the OHS tab is opened
-- (useComplianceSection). Neither insert names inspected_by, inspection_date or assessed_by, and no other
-- code path writes them, so every inspection and assessment on staging and prod has no author and no date.
-- Column defaults record provenance at insert time for every client (web and iOS) without a client change:
-- auth.uid() is the signed-in user behind the PostgREST request (null for the service role, which is fine —
-- the columns stay nullable). The backfill attributes existing rows to the report's author and to the
-- report's creation day in SAST — the best evidence on file. Seeded reports with no author keep a null
-- inspector / assessor; their inspection_date is still filled from created_at.
begin;

alter table public.building_inspections
  alter column inspected_by    set default auth.uid(),
  alter column inspection_date set default (now() at time zone 'Africa/Johannesburg')::date;

alter table public.compliance_assessments
  alter column assessed_by set default auth.uid();

update public.building_inspections bi
   set inspected_by = r.author_id
  from public.reports r
 where r.id = bi.report_id
   and bi.inspected_by is null
   and r.author_id is not null;

update public.building_inspections bi
   set inspection_date = (r.created_at at time zone 'Africa/Johannesburg')::date
  from public.reports r
 where r.id = bi.report_id
   and bi.inspection_date is null;

update public.compliance_assessments ca
   set assessed_by = r.author_id
  from public.reports r
 where r.id = ca.report_id
   and ca.assessed_by is null
   and r.author_id is not null;

commit;

-- Verify (run after applying, staging then prod):
--   select column_name, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'building_inspections'
--      and column_name in ('inspected_by', 'inspection_date') order by 1;
--     -- inspected_by     | auth.uid()
--     -- inspection_date  | ((now() AT TIME ZONE 'Africa/Johannesburg'::text))::date
--     --                    (Postgres 17 rendering; older servers print the same default as
--     --                     (timezone('Africa/Johannesburg'::text, now()))::date)
--   select column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'compliance_assessments' and column_name = 'assessed_by';
--     -- auth.uid()
--   select count(*) filter (where bi.inspected_by is null)    as no_inspector,
--          count(*) filter (where bi.inspection_date is null) as no_date,
--          count(*)                                           as rows_with_author
--     from public.building_inspections bi join public.reports r on r.id = bi.report_id
--    where r.author_id is not null;                                   -- 0 | 0 | n
--   select count(*) filter (where bi.inspection_date is null) as no_date_any
--     from public.building_inspections bi where bi.report_id is not null;   -- 0
--   select count(*) filter (where ca.assessed_by is null) as no_assessor, count(*) as rows_with_author
--     from public.compliance_assessments ca join public.reports r on r.id = ca.report_id
--    where r.author_id is not null;                                   -- 0 | n
--   Then: node scripts/rls-smoke.mjs; node scripts/fortress-smoke.mjs.
