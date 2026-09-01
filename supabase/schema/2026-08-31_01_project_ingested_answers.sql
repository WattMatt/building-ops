-- Project the ingested June-2026 answers into the app's native inspection and
-- compliance models.
--
-- WHY
-- The June ingest wrote every Building Inspection and OHS Act answer into
-- `report_checklist_items`, because that is the table whose shape matched the source
-- workbook. But the app does not read that table for those two sections: the Building
-- Inspection tab reads `inspection_responses` (keyed to `inspection_template_items`) and
-- the OHS Act Compliance tab reads `compliance_responses` (keyed to
-- `compliance_template_items`). So 6,392 answers sat in the database, correct and
-- reconciled, while both tabs rendered an empty template — and `compliance_scores`, the
-- building KPIs and the portfolio compliance card had nothing to compute from.
--
-- The two vocabularies turn out to line up almost exactly:
--   * inspection: the ingest stored "SECTION / Item label", which matches
--     inspection_template_items(section_title, item_label) for 144 of 146 template items.
--   * OHS: the ingest stored the clause number as the source sheet writes it, with
--     COMMAS ("2,6,2"); the template numbers the same clauses with DOTS ("2.6.2").
--
-- This is additive and idempotent: report_checklist_items is left untouched as the record
-- of what was ingested, and re-running updates in place rather than duplicating.
--
-- MEASURED BEFORE APPLYING (identical on staging and prod):
--   building inspection : 4,532 of 4,634 answers map, across all 32 reports
--   OHS compliance      : 1,566 of 1,758 answers map, across all 32 reports
-- The unmapped remainder are items the centre wrote that are not in the template
-- (e.g. "Generators", "Electric fences", 5 clause codes) — they stay in
-- report_checklist_items and still print in the PDF. Nothing is lost either way.

begin;

-- 1) One monthly inspection per ops report that has inspection answers.
insert into public.building_inspections (id, report_id, building_id, template_id, inspection_date)
select gen_random_uuid(), r.id, r.building_id, t.id, r.inspection_date
from public.reports r
cross join lateral (
  select id from public.inspection_templates
  where cadence = 'monthly' and active order by version desc limit 1
) t
where r.report_type = 'ops_monthly'
  and r.report_period = '2026-06-01'
  and exists (
    select 1 from public.report_checklist_items c
    where c.report_id = r.id and c.section_key = 'building_inspection' and c.response is not null
  )
  and not exists (
    select 1 from public.building_inspections bi
    where bi.report_id = r.id and bi.template_id = t.id
  );

-- 2) The inspection answers themselves.
--    action_required is matched on the exact phrases the extractor wrote. Note the order
--    is irrelevant here because the comparisons are exact, not prefix — "no immediate
--    action required" must never be read as "immediate".
insert into public.inspection_responses
  (id, inspection_id, template_item_id, acceptable, action_required, comment, photo_urls, applicable, detail)
select
  gen_random_uuid(),
  bi.id,
  ti.id,
  c.response,
  case lower(btrim(coalesce(c.value_text, '')))
    when 'no immediate action required'    then 'none'
    when 'action required within 3 months' then 'within_3_months'
    when 'immediate action required'       then 'immediate'
    else null
  end,
  c.comment,
  '[]'::jsonb,
  true,
  '{}'::jsonb
from public.report_checklist_items c
join public.reports r
  on r.id = c.report_id and r.report_type = 'ops_monthly' and r.report_period = '2026-06-01'
join public.building_inspections bi on bi.report_id = r.id
join public.inspection_template_items ti
  on ti.template_id = bi.template_id
 and upper(btrim(ti.section_title)) || ' / ' || upper(btrim(ti.item_label)) = upper(btrim(c.item_key))
where c.section_key = 'building_inspection'
  and c.response is not null
on conflict (inspection_id, template_item_id) do update
  set acceptable      = excluded.acceptable,
      action_required = excluded.action_required,
      comment         = excluded.comment,
      updated_at      = now();

-- 3) One OHS assessment per ops report that has OHS answers.
insert into public.compliance_assessments (id, report_id, building_id, template_id)
select gen_random_uuid(), r.id, r.building_id, t.id
from public.reports r
cross join lateral (
  select id from public.compliance_templates
  where active order by version desc limit 1
) t
where r.report_type = 'ops_monthly'
  and r.report_period = '2026-06-01'
  and exists (
    select 1 from public.report_checklist_items c
    where c.report_id = r.id and c.section_key = 'ohs' and c.response is not null
  )
on conflict (report_id) do nothing;

-- 4) The OHS answers, matched on the clause number with the separator normalised.
insert into public.compliance_responses
  (id, assessment_id, template_item_id, response, comment)
select gen_random_uuid(), a.id, ti.id, c.response, c.comment
from public.report_checklist_items c
join public.reports r
  on r.id = c.report_id and r.report_type = 'ops_monthly' and r.report_period = '2026-06-01'
join public.compliance_assessments a on a.report_id = r.id
join public.compliance_template_items ti
  on ti.template_id = a.template_id
 and ti.item_no = replace(btrim(c.item_key), ',', '.')
where c.section_key = 'ohs'
  and c.response is not null
on conflict (assessment_id, template_item_id) do update
  set response   = excluded.response,
      comment    = excluded.comment,
      updated_at = now();

commit;
