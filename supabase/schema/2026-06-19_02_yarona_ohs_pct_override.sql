-- 2026-06-19_02_yarona_ohs_pct_override.sql
-- Honour a per-report OHS compliance % override (reports.meta->>'ohs_stated_pct') in the
-- compliance_scores view, and set Yarona's to the centre's exact source value (84.0625%).
--
-- Background: the centre's OHS sheet computes the headline % from hand-picked per-block COUNTIF
-- ranges (core 26/32 x85% + spec 7/7 x10% + forum 2/2 x5% = 0.840625) over 41 of the 57 scored
-- items. The generic doc-11 view counts all 57 consistently (-> 90.1%). Per owner decision
-- (2026-06-19) Yarona must reflect the centre's official 84.06%. The override is additive:
-- reports WITHOUT the meta key are unchanged (still computed). Reversible.
CREATE OR REPLACE VIEW public.compliance_scores AS
 WITH per_group AS (
         SELECT a.id AS assessment_id,
            a.report_id,
            a.building_id,
            i.group_code,
            max(i.group_weight) AS group_weight,
            count(*) FILTER (WHERE r.response = ANY (ARRAY['yes'::text, 'na'::text]))::numeric / NULLIF(count(*), 0)::numeric AS ratio
           FROM compliance_assessments a
             JOIN compliance_responses r ON r.assessment_id = a.id
             JOIN compliance_template_items i ON i.id = r.template_item_id
          WHERE i.is_scored
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

-- Set Yarona's official OHS % (derived from the centre's exact COUNTIF ranges).
UPDATE public.reports
SET meta = COALESCE(meta, '{}'::jsonb) || '{"ohs_stated_pct": 84.0625}'::jsonb
WHERE building_id = (SELECT id FROM public.buildings WHERE il_site_id = 'ade5256f-419e-4860-bfd4-2f38dc3cb21a')
  AND report_type = 'ops_monthly' AND report_period = '2026-05-01';
