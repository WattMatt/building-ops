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
--
-- Also (S3 §6, OHS comment): the client now saves a compliance_responses row with response = null when the
-- inspector types a comment before picking an answer. The three score views counted every joined response
-- row in their denominators — compliance_scores (2026-06-19_02:10-32) and compliance_section_scores /
-- compliance_critical_scores (2026-06-13_08:63-71, :75-83) all divide `count(*) filter (where response in
-- ('yes','na'))` by a count with no null filter — so a comment-only item scored as a FAIL until answered.
-- Each view is re-created below with `and r.response is not null`, so an unanswered item is simply not yet
-- part of the score (the same way an unscored item is not). Every column, its order and type, and the
-- Yarona `reports.meta->>'ohs_stated_pct'` override in compliance_scores are preserved verbatim.
-- `create or replace view` REPLACES the view's storage options with whatever the statement names, so each
-- one restates `with (security_invoker = on)` — omitting it is how compliance_scores lost the option in
-- 2026-06-19_02 (the A-01 RLS bypass fixed in 2026-08-04_01). Grants are untouched by a replace.
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

-- ------------------------------------------------------------------------------------------
-- Score views: an unanswered (response is null) row is neither a pass nor a fail.
-- ------------------------------------------------------------------------------------------
-- compliance_scores: 2026-06-19_02 definition + the null filter. Column list unchanged:
-- (assessment_id, report_id, building_id, compliance_pct).
create or replace view public.compliance_scores
  with (security_invoker = on) as
 WITH per_group AS (
         SELECT a.id AS assessment_id,
            a.report_id,
            a.building_id,
            i.group_code,
            max(i.group_weight) AS group_weight,
            count(*) FILTER (WHERE r.response = ANY (ARRAY['yes'::text, 'na'::text]))::numeric / NULLIF(count(*), 0)::numeric AS ratio
           FROM public.compliance_assessments a
             JOIN public.compliance_responses r ON r.assessment_id = a.id
             JOIN public.compliance_template_items i ON i.id = r.template_item_id
          WHERE i.is_scored
            AND r.response IS NOT NULL
          GROUP BY a.id, a.report_id, a.building_id, i.group_code
        )
 SELECT assessment_id,
    report_id,
    building_id,
    COALESCE(
      round((SELECT (rep.meta->>'ohs_stated_pct')::numeric FROM public.reports rep WHERE rep.id = per_group.report_id), 2),
      round(sum(group_weight * ratio) / NULLIF(sum(group_weight), 0::numeric) * 100::numeric, 1)
    ) AS compliance_pct
   FROM per_group
  GROUP BY assessment_id, report_id, building_id;

-- compliance_section_scores: 2026-06-13_08 definition + the null filter. Column list unchanged:
-- (assessment_id, building_id, section_no, section_title, section_pct).
create or replace view public.compliance_section_scores
  with (security_invoker = on) as
select a.id as assessment_id, a.building_id, i.section_no, i.section_title,
       round(100.0 * count(*) filter (where r.response in ('yes','na') and i.is_scored)
             / nullif(count(*) filter (where i.is_scored),0), 1) as section_pct
from public.compliance_assessments a
join public.compliance_responses r       on r.assessment_id = a.id
join public.compliance_template_items i  on i.id = r.template_item_id
where r.response is not null
group by a.id, a.building_id, i.section_no, i.section_title;

-- compliance_critical_scores: 2026-06-13_08 definition + the null filter. Column list unchanged:
-- (assessment_id, building_id, critical_pct).
create or replace view public.compliance_critical_scores
  with (security_invoker = on) as
select a.id as assessment_id, a.building_id,
       round(100.0 * count(*) filter (where r.response in ('yes','na') and i.is_scored)
             / nullif(count(*) filter (where i.is_scored),0), 1) as critical_pct
from public.compliance_assessments a
join public.compliance_responses r       on r.assessment_id = a.id
join public.compliance_template_items i  on i.id = r.template_item_id and i.is_critical
where r.response is not null
group by a.id, a.building_id;

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
--   select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname in ('compliance_scores','compliance_section_scores','compliance_critical_scores')
--    order by 1;                                                       -- each {security_invoker=on}
--   select pg_get_viewdef('public.compliance_scores'::regclass) ~* 'response is not null';           -- true
--   select pg_get_viewdef('public.compliance_section_scores'::regclass) ~* 'response is not null';   -- true
--   select pg_get_viewdef('public.compliance_critical_scores'::regclass) ~* 'response is not null';  -- true
--   Then: node scripts/rls-smoke.mjs; node scripts/fortress-smoke.mjs.
