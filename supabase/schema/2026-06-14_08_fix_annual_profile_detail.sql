-- Wave 2 (battle-test 2026-06-14): the annual §3 "Building Location & Description
-- Profile" fields were mis-ingested into §1 (Disclaimer)'s detail jsonb. Move them onto
-- the §3 profile response (where the new field-set form renders them), verbatim keys
-- preserved, and strip them from §1. Idempotent (no-op once moved). Portable (deterministic ids).
DO $$
DECLARE
  v_insp uuid;
  v_src_id uuid;
  v_profile jsonb;
  v_tgt_item uuid := 'a14d1a46-920e-532d-9dc9-cddf970aa5b5'; -- section_no '3' profile
  v_keys text[] := ARRAY[
    'Open','Basement','Disabled','Motorbike','Taxi bays','Parking bays','Moms and tods',
    'Total GLA m²','Shaded parking','Covered parking','Property address','Number of tenants',
    'Current vacancy m²','Practical completion','List of anchor tenants','Quantity private shops',
    'Quantity national tenants','Further expansions: (if yes please provide dates)'];
BEGIN
  SELECT id INTO v_insp FROM public.building_inspections
   WHERE report_id = 'b42c47f6-f2fc-516a-a300-d9535d5fd96d';
  IF v_insp IS NULL THEN RAISE NOTICE 'no annual inspection — skipping'; RETURN; END IF;

  SELECT id INTO v_src_id FROM public.inspection_responses
   WHERE inspection_id = v_insp AND detail ? 'Total GLA m²' LIMIT 1;
  IF v_src_id IS NULL THEN RAISE NOTICE 'profile detail already moved — skipping'; RETURN; END IF;

  SELECT jsonb_object_agg(je.key, je.value) INTO v_profile
    FROM public.inspection_responses ir, jsonb_each(ir.detail) je
   WHERE ir.id = v_src_id AND je.key = ANY(v_keys);

  UPDATE public.inspection_responses
     SET detail = coalesce(detail, '{}'::jsonb) || coalesce(v_profile, '{}'::jsonb),
         applicable = true, updated_at = now()
   WHERE inspection_id = v_insp AND template_item_id = v_tgt_item;
  IF NOT FOUND THEN
    INSERT INTO public.inspection_responses (id, inspection_id, template_item_id, applicable, detail)
    VALUES (gen_random_uuid(), v_insp, v_tgt_item, true, coalesce(v_profile, '{}'::jsonb));
  END IF;

  UPDATE public.inspection_responses
     SET detail = detail - v_keys, updated_at = now()
   WHERE id = v_src_id;
END $$;
