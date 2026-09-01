-- ============================================================================
-- Fortress Reporting — 08: scoring-model correction + annual-form columns
-- Source of truth: fortress/11_MARKING_AND_PERCENTAGES.md (formula-verified
-- against the source workbook's cells) and fortress/13_ANNUAL_INSPECTION_FORM.md §6.
-- The F02 model (per-item weights, N/A excluded) does NOT match the source:
--   * items belong to three weighted buckets — core 85 / specialised 10 / forum 5
--   * N/A is a PASS (counts as compliant), not an exclusion
--   * only is_scored items feed the ratio (count/date/info rows don't score)
--   building_pct = Σ_g weight(g)·(compliant_g/scored_g) ÷ Σ_g weight(g)
-- Additive: new columns + view rewrites only. Idempotent.
-- ============================================================================

-- ---- compliance_template_items: bucket model (doc 11 §2) --------------------
alter table public.compliance_template_items
  add column if not exists group_code text not null default 'core'
    check (group_code in ('core','specialised','forum','unscored')),
  add column if not exists group_weight numeric not null default 85,
  add column if not exists is_scored bool not null default true;

-- weight (per-item) is legacy of the superseded model: unused by scoring views.

-- ---- per-item score trigger: now a compliant indicator ----------------------
-- score = 1 when a scored item is compliant (yes OR na), 0 when non-compliant,
-- null for unscored items. Views do NOT read score; it exists for row-level
-- display/debug only.
create or replace function public.compute_compliance_score()
returns trigger language plpgsql as $$
declare scored bool;
begin
    select is_scored into scored from public.compliance_template_items
        where id = new.template_item_id;
    new.score := case
        when scored is distinct from true   then null
        when new.response in ('yes','na')   then 1
        when new.response = 'no'            then 0
        else null end;
    return new;
end $$;

-- ---- headline view: group-weighted, na=pass (doc 11 §2) ---------------------
-- drop+create: the column set changes (earned/possible removed).
drop view if exists public.compliance_scores;
create view public.compliance_scores
  with (security_invoker = on) as
with per_group as (
  select a.id as assessment_id, a.report_id, a.building_id,
         i.group_code, max(i.group_weight) as group_weight,
         count(*) filter (where r.response in ('yes','na'))::numeric
           / nullif(count(*),0) as ratio                       -- compliant / scored_total
  from public.compliance_assessments a
  join public.compliance_responses r       on r.assessment_id = a.id
  join public.compliance_template_items i  on i.id = r.template_item_id
  where i.is_scored
  group by a.id, a.report_id, a.building_id, i.group_code
)
select assessment_id, report_id, building_id,
       round( sum(group_weight * ratio) / nullif(sum(group_weight),0) * 100, 1) as compliance_pct
from per_group
group by assessment_id, report_id, building_id;

-- ---- section view: simple compliant ratio per section, na=pass --------------
drop view if exists public.compliance_section_scores;
create view public.compliance_section_scores
  with (security_invoker = on) as
select a.id as assessment_id, a.building_id, i.section_no, i.section_title,
       round(100.0 * count(*) filter (where r.response in ('yes','na') and i.is_scored)
             / nullif(count(*) filter (where i.is_scored),0), 1) as section_pct
from public.compliance_assessments a
join public.compliance_responses r       on r.assessment_id = a.id
join public.compliance_template_items i  on i.id = r.template_item_id
group by a.id, a.building_id, i.section_no, i.section_title;

-- ---- critical-equipment view (O2: is_critical items, na=pass) ---------------
drop view if exists public.compliance_critical_scores;
create view public.compliance_critical_scores
  with (security_invoker = on) as
select a.id as assessment_id, a.building_id,
       round(100.0 * count(*) filter (where r.response in ('yes','na') and i.is_scored)
             / nullif(count(*) filter (where i.is_scored),0), 1) as critical_pct
from public.compliance_assessments a
join public.compliance_responses r       on r.assessment_id = a.id
join public.compliance_template_items i  on i.id = r.template_item_id and i.is_critical
group by a.id, a.building_id;

-- ---- annual inspection form columns (doc 13 §6) ------------------------------
alter table public.inspection_template_items
  add column if not exists field_set text not null default 'condition'
    check (field_set in ('equip','condition','process','profile','narrative','register')),
  add column if not exists allow_na bool not null default true;

alter table public.inspection_responses
  add column if not exists applicable bool not null default true,
  add column if not exists next_service_due date,          -- surfaced for dashboard alerts
  add column if not exists detail jsonb not null default '{}'::jsonb;  -- camelCase keys (contract §2.1)
