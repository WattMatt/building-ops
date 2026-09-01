-- 2026-06-18_05_abaqulusi_shop42.sql
-- AbaQulusi gap-fill STEP 2b — shop 42 identity conflict resolved: SOURCE WINS (owner decision 2026-06-18).
-- Source (Dec-2025 CM) row 57 = 'RAGE EDDITION'. DB had 'ABAQULUSI MEDICAL CENTRE' (partial spec).
-- 1) Rename tenant 42 to RAGE EDDITION. 2) Backfill the 8 NULL trailing shop-spec fields from source row 57.
-- Idempotent (COALESCE preserves any existing non-null).
BEGIN;

UPDATE public.building_tenants
SET shop_name='RAGE EDDITION', name='RAGE EDDITION'
WHERE building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND shop_number='42';

UPDATE public.tenant_shop_spec s SET
  hvac_gas          = COALESCE(s.hvac_gas,          'AC42 = 48KBTU'),
  ceiling_structure = COALESCE(s.ceiling_structure, 'S - Suspended'),
  ceiling_height    = COALESCE(s.ceiling_height,    '3m'),
  floor_finish      = COALESCE(s.floor_finish,      'T - Tiled'),
  walls             = COALESCE(s.walls,             'B -Brick                D - Dry wall'),
  wall_finish       = COALESCE(s.wall_finish,       'P - Painted'),
  plumbing_toilets  = COALESCE(s.plumbing_toilets,  0),
  plumbing_sink     = COALESCE(s.plumbing_sink,     'S-SINK WHB')
FROM public.building_tenants bt
WHERE s.tenant_id=bt.id AND bt.building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND bt.shop_number='42' AND s.is_current;

COMMIT;
