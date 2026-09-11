-- 2026-06-18_06_abaqulusi_annual_repairs_a.sql
-- AbaQulusi gap-fill STEP 5a — Annual data-loss repairs (GAP_REGISTER A1,A2,A3). Value/detail fixes.
-- Matched by template name + section_no + building (no hardcoded response ids). Idempotent.
BEGIN;

-- A1 §12.3 Parking Area: was overwritten with §12.4 equipment data. Restore surface-condition (field_set already 'condition').
UPDATE public.inspection_template_items SET field_keys='["Current status: (Good, Fair, Poor)", "General comment", "Inspection checklist: Daily/weekly/monthly", "Photo (s) reference number:"]'::jsonb
WHERE template_id IN (SELECT id FROM public.inspection_templates WHERE name='Annual Building Inspection') AND section_no='12.3';
UPDATE public.inspection_responses ir SET detail='{"Current status: (Good, Fair, Poor)": "Good", "General comment": "All parking lines are visible surface in good condition, Oil to be cleaned.", "Inspection checklist: Daily/weekly/monthly": "Weekly", "Photo (s) reference number:": "4"}'::jsonb, condition_rating='good'
FROM public.inspection_template_items it, public.building_inspections bi
WHERE ir.template_item_id=it.id AND ir.inspection_id=bi.id AND bi.building_id='63345a91-6706-5cf3-b26e-80174c36b2b5'
  AND it.template_id IN (SELECT id FROM public.inspection_templates WHERE name='Annual Building Inspection') AND it.section_no='12.3';

-- A2 §6.1 High tension: restore the 5 HT-service-block fields (were overwritten by the scan sub-block). Scan fields untouched.
UPDATE public.inspection_responses ir SET detail = ir.detail || '{"Last date serviced": "09/09/2025", "Next service due": "09/09/2026", "Service fee cost": "To be obtained", "Service provider / contractor / installed by": "Tilana Meintjies T/A HJ Electric", "Cost Recovery: Tenant specific / part of ops cost": "Part of OPS Cost"}'::jsonb
FROM public.inspection_template_items it, public.building_inspections bi
WHERE ir.template_item_id=it.id AND ir.inspection_id=bi.id AND bi.building_id='63345a91-6706-5cf3-b26e-80174c36b2b5'
  AND it.template_id IN (SELECT id FROM public.inspection_templates WHERE name='Annual Building Inspection') AND it.section_no='6.1';

-- A3 §6.2 Low tension: source has NO standalone Low-tension block; current detail is a fabricated clone of §6.1's scan sub-block. Empty it.
UPDATE public.inspection_responses ir SET detail='{}'::jsonb
FROM public.inspection_template_items it, public.building_inspections bi
WHERE ir.template_item_id=it.id AND ir.inspection_id=bi.id AND bi.building_id='63345a91-6706-5cf3-b26e-80174c36b2b5'
  AND it.template_id IN (SELECT id FROM public.inspection_templates WHERE name='Annual Building Inspection') AND it.section_no='6.2';

COMMIT;
