-- 2026-06-18_02_abaqulusi_shop_spec.sql
-- AbaQulusi gap-fill STEP 2 — shop-spec completion (GAP_REGISTER S2, S3; S1/shop42 DEFERRED).
-- 1) Insert tenant_shop_spec rows for 9 tenants that have none (joined by shop_number, NOT EXISTS guard, idempotent).
-- 2) Null shop 14 fabricated generator_connection ('no' with blank source).
-- generator_connection is constrained to lowercase yes/no/na (tenant_shop_spec_genconn_chk); source 'Yes' normalized to 'yes'.
-- NOTE shop 32 plumbing_toilets source='ATMS' is non-numeric for an integer column -> left NULL (cannot store; flagged).
-- NOTE shop 42 (RAGE EDDITION vs DB 'ABAQULUSI MEDICAL CENTRE') identity conflict -> trailing fields NOT backfilled here.
BEGIN;

-- Strip stray backtick from shop '`31 D' (GAP_REGISTER X2; Step 1's rename missed it). No-op once fixed.
UPDATE public.building_tenants SET shop_number='31 D'
WHERE building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND shop_number='`31 D';

INSERT INTO public.tenant_shop_spec (id, building_id, tenant_id, is_current, db_phase, actual_amps, lease_amps, generator_connection, hvac_units, hvac_btu, hvac_gas, lighting_type, shopfront_type, roller_shutter_type, ceiling_structure, ceiling_height, floor_finish, walls, wall_finish, plumbing_toilets, plumbing_sink)
SELECT gen_random_uuid(), bt.building_id, bt.id, true, '3 - Three phase', '160A', '160A', 'yes','DP- Ducted Plant', '4x 7500 BtuDP- Ducted Plant', '4x 7500 BtuDP- Ducted Plant', 'L-LED 150; Downlights 6', 'DD- Double door', 'Galvanized', 'S - Suspended', '3m', 'T - Tiled', 'Dry Wall', 'Painted', 1, 'S - Sink  5'
FROM public.building_tenants bt WHERE bt.building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND bt.shop_number='F/STANDING'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_shop_spec s WHERE s.tenant_id=bt.id AND s.is_current);

INSERT INTO public.tenant_shop_spec (id, building_id, tenant_id, is_current, db_phase, actual_amps, lease_amps, generator_connection, hvac_units, hvac_btu, hvac_gas, lighting_type, shopfront_type, roller_shutter_type, ceiling_structure, ceiling_height, floor_finish, walls, wall_finish, plumbing_toilets, plumbing_sink)
SELECT gen_random_uuid(), bt.building_id, bt.id, true, '3 - Three phase', '160A', '160A', 'yes','DP- Ducted Plant', '4x 7500 BtuDP- Ducted Plant', '4x 7500 BtuDP- Ducted Plant', 'L-LED 150; Downlights 6', 'DD- Double door', 'Galvanized', 'S - Suspended', '3m', 'T - Tiled', 'Dry Wall', 'Painted', 1, 'S - Sink 3'
FROM public.building_tenants bt WHERE bt.building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND bt.shop_number='GARAGE'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_shop_spec s WHERE s.tenant_id=bt.id AND s.is_current);

INSERT INTO public.tenant_shop_spec (id, building_id, tenant_id, is_current, db_phase, actual_amps, lease_amps, generator_connection, hvac_units, hvac_btu, hvac_gas, lighting_type, shopfront_type, roller_shutter_type, ceiling_structure, ceiling_height, floor_finish, walls, wall_finish, plumbing_toilets, plumbing_sink)
SELECT gen_random_uuid(), bt.building_id, bt.id, true, '1 - Single Phase', '60A', '60A', 'yes','N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/a', 'N/A', '2.3', 'T - Tiled', 'Dry Wall', 'Painted', 0, 'S - Sink 0'
FROM public.building_tenants bt WHERE bt.building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND bt.shop_number='KIOSK 01'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_shop_spec s WHERE s.tenant_id=bt.id AND s.is_current);

INSERT INTO public.tenant_shop_spec (id, building_id, tenant_id, is_current, db_phase, actual_amps, lease_amps, generator_connection, hvac_units, hvac_btu, hvac_gas, lighting_type, shopfront_type, roller_shutter_type, ceiling_structure, ceiling_height, floor_finish, walls, wall_finish, plumbing_toilets, plumbing_sink)
SELECT gen_random_uuid(), bt.building_id, bt.id, true, '1 - Single Phase', '60A', '60A', 'yes','N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/a', 'N/A', '2.3', 'T - Tiled', 'N/A', 'N/A', 0, 'S - Sink 0'
FROM public.building_tenants bt WHERE bt.building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND bt.shop_number='KIOSK 02'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_shop_spec s WHERE s.tenant_id=bt.id AND s.is_current);

INSERT INTO public.tenant_shop_spec (id, building_id, tenant_id, is_current, db_phase, actual_amps, lease_amps, generator_connection, hvac_units, hvac_btu, hvac_gas, lighting_type, shopfront_type, roller_shutter_type, ceiling_structure, ceiling_height, floor_finish, walls, wall_finish, plumbing_toilets, plumbing_sink)
SELECT gen_random_uuid(), bt.building_id, bt.id, true, '3 - Three phase', '160A', '160A', 'yes','DP- Ducted Plant', '3x 7500 BtuDP- Ducted Plant', '4x 7500 BtuDP- Ducted Plant', 'L-LED 150; Downlights 6', 'DD- Double door', 'Galvanized', 'S - FLUSH PLASTERED', '3m', 'T - Tiled', 'Dry Wall', 'Painted', 1, 'S - Sink 9'
FROM public.building_tenants bt WHERE bt.building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND bt.shop_number='OFFICE 01'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_shop_spec s WHERE s.tenant_id=bt.id AND s.is_current);

INSERT INTO public.tenant_shop_spec (id, building_id, tenant_id, is_current, db_phase, actual_amps, lease_amps, generator_connection, hvac_units, hvac_btu, hvac_gas, lighting_type, shopfront_type, roller_shutter_type, ceiling_structure, ceiling_height, floor_finish, walls, wall_finish, plumbing_toilets, plumbing_sink)
SELECT gen_random_uuid(), bt.building_id, bt.id, true, '1 - Single Phase', '60A', '60A', 'yes','N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/a', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 0, 'S - Sink 0'
FROM public.building_tenants bt WHERE bt.building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND bt.shop_number='SIGNAGE PRIMEDIA'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_shop_spec s WHERE s.tenant_id=bt.id AND s.is_current);

INSERT INTO public.tenant_shop_spec (id, building_id, tenant_id, is_current, db_phase, actual_amps, lease_amps, generator_connection, hvac_units, hvac_btu, hvac_gas, lighting_type, shopfront_type, roller_shutter_type, ceiling_structure, ceiling_height, floor_finish, walls, wall_finish, plumbing_toilets, plumbing_sink)
SELECT gen_random_uuid(), bt.building_id, bt.id, true, '3 - Three phase', '100A', '100A', 'yes','DP-Ducted Plant', '2x 4800Btu DP-Ducted Plant', 'AC09A = 36KBTU', 'L - LED', 'DD- Double door', 'N/a', 'S - Suspended', '3m', 'T - Tiled', 'B -Brick                D - Dry wall', 'P - Painted', 0, 'S - Sink 1'
FROM public.building_tenants bt WHERE bt.building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND bt.shop_number='9'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_shop_spec s WHERE s.tenant_id=bt.id AND s.is_current);

INSERT INTO public.tenant_shop_spec (id, building_id, tenant_id, is_current, db_phase, actual_amps, lease_amps, generator_connection, hvac_units, hvac_btu, hvac_gas, lighting_type, shopfront_type, roller_shutter_type, ceiling_structure, ceiling_height, floor_finish, walls, wall_finish, plumbing_toilets, plumbing_sink)
SELECT gen_random_uuid(), bt.building_id, bt.id, true, '3 - Three phase', '100A', '100A', 'yes','DP-Ducted Plant', '2x 4800Btu DP-Ducted Plant', 'AC09B = 36KBTU', 'L - LED', 'DD- Double door', 'N/a', 'S - Suspended', '3m', 'T - Tiled', 'B -Brick                D - Dry wall', 'P - Painted', 1, 'S - Sink 1'
FROM public.building_tenants bt WHERE bt.building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND bt.shop_number='10'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_shop_spec s WHERE s.tenant_id=bt.id AND s.is_current);

INSERT INTO public.tenant_shop_spec (id, building_id, tenant_id, is_current, db_phase, actual_amps, lease_amps, generator_connection, hvac_units, hvac_btu, hvac_gas, lighting_type, shopfront_type, roller_shutter_type, ceiling_structure, ceiling_height, floor_finish, walls, wall_finish, plumbing_toilets, plumbing_sink)
SELECT gen_random_uuid(), bt.building_id, bt.id, true, '3 - Three phase', '60A', '60A', 'yes','DP-Ducted Plant', 'duram bush DP-Ducted Plant', '48000Btu', 'L - LED', NULL, NULL, 'S - Suspended', '3m', 'T - Tiled', 'B -Brick                D - Dry wall', 'P - Painted', 1, 'S-SINK WHB'
FROM public.building_tenants bt WHERE bt.building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND bt.shop_number='31 D'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_shop_spec s WHERE s.tenant_id=bt.id AND s.is_current);

-- shop 14 fabricated generator_connection -> NULL
UPDATE public.tenant_shop_spec s SET generator_connection = NULL
FROM public.building_tenants bt
WHERE s.tenant_id=bt.id AND bt.building_id='63345a91-6706-5cf3-b26e-80174c36b2b5' AND bt.shop_number='14' AND s.generator_connection='no';

COMMIT;
