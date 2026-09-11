-- Wave 3 (battle-test 2026-06-14): attach the AbaQulusi annual "Building Location &
-- Description Profile" (§2.1 in source / section_no '3' in template) orientation photos,
-- which the original ingestion dropped. The 8 image files are uploaded to storage
-- (tenant-documents/documents/<building>/annual-2025/2.1/2.1.N.jpg) by the companion
-- harness step before this runs. Idempotent: upsert by (inspection_id, template_item_id).
-- Portable across staging/prod (deterministic seed IDs identical on both).
DO $$
DECLARE
  v_insp uuid;
  v_item uuid := 'a14d1a46-920e-532d-9dc9-cddf970aa5b5'; -- section_no '3' Building Location & Description Profile
  v_photos jsonb := '[
    {"ref":"2.1.1","path":"documents/63345a91-6706-5cf3-b26e-80174c36b2b5/annual-2025/2.1/2.1.1.jpg","caption":"Front view"},
    {"ref":"2.1.2","path":"documents/63345a91-6706-5cf3-b26e-80174c36b2b5/annual-2025/2.1/2.1.2.jpg","caption":"Left side view"},
    {"ref":"2.1.3","path":"documents/63345a91-6706-5cf3-b26e-80174c36b2b5/annual-2025/2.1/2.1.3.jpg","caption":"Right side view"},
    {"ref":"2.1.4","path":"documents/63345a91-6706-5cf3-b26e-80174c36b2b5/annual-2025/2.1/2.1.4.jpg","caption":"Back view"},
    {"ref":"2.1.5","path":"documents/63345a91-6706-5cf3-b26e-80174c36b2b5/annual-2025/2.1/2.1.5.jpg","caption":"Building exterior view 5"},
    {"ref":"2.1.6","path":"documents/63345a91-6706-5cf3-b26e-80174c36b2b5/annual-2025/2.1/2.1.6.jpg","caption":"Building exterior view 6"},
    {"ref":"2.1.7","path":"documents/63345a91-6706-5cf3-b26e-80174c36b2b5/annual-2025/2.1/2.1.7.jpg","caption":"Building exterior view 7"},
    {"ref":"2.1.8","path":"documents/63345a91-6706-5cf3-b26e-80174c36b2b5/annual-2025/2.1/2.1.8.jpg","caption":"Building exterior view 8"}
  ]'::jsonb;
BEGIN
  SELECT id INTO v_insp FROM public.building_inspections
   WHERE report_id = 'b42c47f6-f2fc-516a-a300-d9535d5fd96d';
  IF v_insp IS NULL THEN RAISE NOTICE 'annual inspection not found — skipping'; RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.inspection_responses WHERE inspection_id = v_insp AND template_item_id = v_item) THEN
    UPDATE public.inspection_responses
       SET photo_urls = v_photos, applicable = true, updated_at = now()
     WHERE inspection_id = v_insp AND template_item_id = v_item;
  ELSE
    INSERT INTO public.inspection_responses (id, inspection_id, template_item_id, applicable, photo_urls)
    VALUES (gen_random_uuid(), v_insp, v_item, true, v_photos);
  END IF;
END $$;
