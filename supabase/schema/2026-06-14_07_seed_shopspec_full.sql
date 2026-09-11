-- 2026-06-14_07_seed_shopspec_full.sql
-- Backfill empty Tenant Shop Spec columns from source CM workbook (ABAQULUSI PLAZA, 'Shop Spec' sheet).
-- Source: 'Fortress spec docs/ABAQULUSI - CM Report Dec 2025 master copy.xlsx'
-- Match key: building_tenants.shop_number == source 'Shop No' (tenant_shop_spec.tenant_id -> building_tenants.id).
-- NULL-guarded: each SET only writes where the target column IS NULL (never clobbers existing data). Idempotent.
-- EXCLUDED shop 42: DB tenant 'ABAQULUSI MEDICAL CENTRE' != source tenant 'RAGE EDDITION' (identity conflict; not seeded).
-- 9 source rows have no DB shop_spec row (F/STANDING Cashbuild, GARAGE Astron, KIOSK 01/02, OFFICE 01, SIGNAGE PRIMEDIA, shops 9 & 10 Fastrak, 31 D Capitec ATM) -> skipped, reported.

BEGIN;

-- shop BUS TICKET OFFICE 01 / EMONDLO BUS SERVICE (db_id dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf, db_shopname EMONDLO BUS OFFICE)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '1 - Single Phase' WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP- Ducted Plant' WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '1x 4800btuDP- Ducted Plant' WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L- LED 29' WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'SD- Single door' WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'N/a' WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '2.3' WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'Dry Wall' WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'Painted' WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S - Sink 1' WHERE id = 'dc4d9f69-1529-584b-9ddb-bcc6e3fee1cf' AND plumbing_sink IS NULL;

-- shop BUS TICKET OFFICE 02 / NONDWENI BUS SERVICE (db_id 96409fa7-74e8-5721-bab0-a922be4c0794, db_shopname NONDWENI BUS OFFICE)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '1 - Single Phase' WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP- Ducted Plant' WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '1x 4800btuDP- Ducted Plant' WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L- LED 29' WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Single door' WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'N/a' WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '2.3' WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'Dry Wall' WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'Painted' WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S - Sink 0' WHERE id = '96409fa7-74e8-5721-bab0-a922be4c0794' AND plumbing_sink IS NULL;

-- shop BUS TICKET OFFICE 03 / THANDUYISE BUS SERVICE (db_id aad7785a-9383-5ff6-88c8-2cf13c2a63ec, db_shopname THANDUYISE BUS OFFICE)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '1 - Single Phase' WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP- Ducted Plant' WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '1x 4800btuDP- Ducted Plant' WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L- LED 29' WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Single door' WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'N/a' WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '2.3' WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'Dry Wall' WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'Painted' WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S - Sink 0' WHERE id = 'aad7785a-9383-5ff6-88c8-2cf13c2a63ec' AND plumbing_sink IS NULL;

-- shop 1 / BOXER (db_id 9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8, db_shopname BOXER)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 6 WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3-Three phase' WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = 'Multi- 200A Backery - 150A Bucthery 100A' WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = 'Multi- 200A Backery - 150A Bucthery 100A' WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'No' WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP- Ducted Plant' WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'DP- Ducted Plant' WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'LED' WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'n/a' WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'Galvanized' WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'Tiled' WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'Brick' WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'T - Tiled P - painted' WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S - Sink 6' WHERE id = '9f1d54d4-f73a-5f4f-adf7-02caeccd6ca8' AND plumbing_sink IS NULL;

-- shop 2 / ACKERMANS (db_id 9c24d198-4bf9-53cd-a6a0-382fe645df80, db_shopname ACKERMANS)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '160A' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '160A' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP- Ducted Plant' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '4x 7500 BtuDP- Ducted Plant' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '4x 7500 BtuDP- Ducted Plant' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L-LED 150; Downlights 6' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'Galvanized' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'Dry Wall' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'Painted' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S - Sink 1' WHERE id = '9c24d198-4bf9-53cd-a6a0-382fe645df80' AND plumbing_sink IS NULL;

-- shop 3 / RAGE (db_id ab8f5253-01a8-57ad-810f-935535f19b71, db_shopname RAGE)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '1 - Single Phase' WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP- Ducted Plant' WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '1x 4800btuDP- Ducted Plant' WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L- LED 29' WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door' WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'N/a' WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '2.3' WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'Dry Wall' WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'Painted' WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S - Sink 0' WHERE id = 'ab8f5253-01a8-57ad-810f-935535f19b71' AND plumbing_sink IS NULL;

-- shop 4 / POWER (db_id 98141f13-f14e-57ab-8b58-72d0cb5f4f52, db_shopname POWER)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '160A' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '160A' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '4x 6000btu 2x 4800BtuDP-Ducted Plant' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '4x 6000btu 2x 4800BtuDP-Ducted Plant' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L- LED 68' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'G - galvanized' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S - Sink 1' WHERE id = '98141f13-f14e-57ab-8b58-72d0cb5f4f52' AND plumbing_sink IS NULL;

-- shop 5 / RFO (db_id 422ad463-afbf-58ee-9f1d-1afbb05e6da0, db_shopname RFO)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = 'Single' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '100A' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '100A' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '4x 4800BtuDP-Ducted Plant' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '4x 4800BtuDP-Ducted Plant' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED 38' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'G Galvanized D-Decorative' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S - Sink 1' WHERE id = '422ad463-afbf-58ee-9f1d-1afbb05e6da0' AND plumbing_sink IS NULL;

-- shop 6 / PECARDI  REBEL (db_id 6ac04e4b-5405-58a0-bf33-4e6f8f291980, db_shopname PECARDI  REBEL)
UPDATE public.tenant_shop_spec SET db_phase = 'PECARDI REBEL' WHERE id = '6ac04e4b-5405-58a0-bf33-4e6f8f291980' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '160A' WHERE id = '6ac04e4b-5405-58a0-bf33-4e6f8f291980' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '160A' WHERE id = '6ac04e4b-5405-58a0-bf33-4e6f8f291980' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '6ac04e4b-5405-58a0-bf33-4e6f8f291980' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'CU Casset unit' WHERE id = '6ac04e4b-5405-58a0-bf33-4e6f8f291980' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'CU Casset unit' WHERE id = '6ac04e4b-5405-58a0-bf33-4e6f8f291980' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = 'CU Casset unit' WHERE id = '6ac04e4b-5405-58a0-bf33-4e6f8f291980' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED D - Down Lights' WHERE id = '6ac04e4b-5405-58a0-bf33-4e6f8f291980' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door' WHERE id = '6ac04e4b-5405-58a0-bf33-4e6f8f291980' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'Galvanized' WHERE id = '6ac04e4b-5405-58a0-bf33-4e6f8f291980' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'OV - Open Void' WHERE id = '6ac04e4b-5405-58a0-bf33-4e6f8f291980' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '6ac04e4b-5405-58a0-bf33-4e6f8f291980' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '6ac04e4b-5405-58a0-bf33-4e6f8f291980' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '6ac04e4b-5405-58a0-bf33-4e6f8f291980' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '6ac04e4b-5405-58a0-bf33-4e6f8f291980' AND wall_finish IS NULL;

-- shop 7 / CLICKS (db_id ca67782c-3a5f-592d-b882-7c41e7aefd2a, db_shopname CLICKS)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 2 WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '160A' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '160A' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant ; CU Casset unit (ac07e)' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '4x 7500Btu 2x 4800Btu bush cassetDP-Ducted Plant ; CU Casset unit (ac07e)' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = 'AC07A = 60KBTU AC07B = 60KBTU AC07C = 90KBTU AC07D = 60KBTU AC07E48KBTU' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'G - Galvanized' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S - Sink WHB Wash Hand Basin' WHERE id = 'ca67782c-3a5f-592d-b882-7c41e7aefd2a' AND plumbing_sink IS NULL;

-- shop 8 / REFINERY (db_id 279fb0eb-e883-52d8-b715-f7b627eb1bb8, db_shopname REFINERY)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '100A' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '100A' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '2x 4800 BtuDP-Ducted Plant' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = 'AC08A = 36KBTU AC08B = 36KBTU' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'N/a' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S - Sink 1' WHERE id = '279fb0eb-e883-52d8-b715-f7b627eb1bb8' AND plumbing_sink IS NULL;

-- shop 11 / DEBONAIRS (db_id 4902e0db-de97-5e47-8142-1179c4dfbe63, db_shopname DEBONAIRS)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '100A' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '100A' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'CU Casset unit' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '2X 4800BtuCU Casset unit' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = 'AC11 = 24KBTU' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'SFS- Sliding Folding Stacking' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'N/A' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S - Sink WHB Wash Hand Basin' WHERE id = '4902e0db-de97-5e47-8142-1179c4dfbe63' AND plumbing_sink IS NULL;

-- shop 12 / HUNGRY  LION (db_id 5aac1349-2e6e-5dae-aa13-8b7fef18a57b, db_shopname HUNGRY  LION)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '100aA' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '100aA' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '2X 4800BtuCU Casset unit' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '2X 4800BtuCU Casset unit' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'N/a' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S - Sink WHB - Wash hand Basin' WHERE id = '5aac1349-2e6e-5dae-aa13-8b7fef18a57b' AND plumbing_sink IS NULL;

-- shop 13 / RUSSEL (db_id 7ddb04e5-c5f7-51bd-a062-88c24ce6aa90, db_shopname RUSSELS)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '125A' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '125A' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '5X DUNHAM BUSHDP-Ducted Plant' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '6000 Btu' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'N/A' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S - Sink 1' WHERE id = '7ddb04e5-c5f7-51bd-a062-88c24ce6aa90' AND plumbing_sink IS NULL;

-- shop 14 / KFC UNDER CONSTRUCTION (db_id cb4b5b60-6135-50d8-abad-bf86231d7b39, db_shopname KFC UNDER CONSTRUCTION)
UPDATE public.tenant_shop_spec SET db_phase = 'SPEC UPDATE STILL IN PROGRESS' WHERE id = 'cb4b5b60-6135-50d8-abad-bf86231d7b39' AND db_phase IS NULL;

-- shop 15 / CHICKEN  LICKEN (db_id d0522040-dee7-5a0a-b79e-0fc5da0cca4f, db_shopname CHICKEN  LICKEN)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '80A' WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '80A' WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '2x dunham Bush cassett' WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'SFS- Sliding Folding Stacking' WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'G - Galvanized' WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = 'd0522040-dee7-5a0a-b79e-0fc5da0cca4f' AND plumbing_sink IS NULL;

-- shop 16 / SHWARMA TAKEAWAY (db_id 770f6ab0-9804-5e04-831b-d7dd8bec1396, db_shopname SHWARMA TAKEAWAY)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '80A' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '80A' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '0' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = 'n/a' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'G- Galvanized' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '770f6ab0-9804-5e04-831b-d7dd8bec1396' AND plumbing_sink IS NULL;

-- shop 17 / MK FOODS (db_id 32ba96ed-a112-5c74-be89-0a16de5455f5, db_shopname MK FOODS)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '0' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = 'n/a' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'G- Galvanized' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '32ba96ed-a112-5c74-be89-0a16de5455f5' AND plumbing_sink IS NULL;

-- shop 18 / BEAUTY ZONE (db_id 3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a, db_shopname BEAUTY ZONE)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '5x Dunham bushDP-Ducted Plant' WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '6000BTU' WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'N/A' WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'G- Galvanized' WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '3d2a31f2-6df2-5ccf-8f23-04d0736c2e2a' AND wall_finish IS NULL;

-- shop 19 / SKIPPER BAR (db_id 7fd401f4-0d00-559b-900d-0145f1e29097, db_shopname SKIPPER BAR)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '2x DP-Ducted Plant' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = 'AC 19A =48K BTU ; AC19B= 36K BTU' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'N/a' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '7fd401f4-0d00-559b-900d-0145f1e29097' AND plumbing_sink IS NULL;

-- shop 20 / Sanlam (db_id 762671f9-b697-57b3-8b62-d602bbbfcaca, db_shopname Sanlam)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '2x DP-Ducted Plant' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = 'AC 20A = 48KBTU ; AC20B = 36K BTU' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'N/a' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '762671f9-b697-57b3-8b62-d602bbbfcaca' AND plumbing_sink IS NULL;

-- shop 21 / CAPITEC (db_id 3810c20e-5de4-585c-bd51-ddbfa2201088, db_shopname CAPITEC)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '100A' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '100A' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'DP-Ducted Plant' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = 'AC 21A = 60KBTU ; AC21B = 60K BTU' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'N/a' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'D- Decorative' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '3810c20e-5de4-585c-bd51-ddbfa2201088' AND plumbing_sink IS NULL;

-- shop 22 / WEDIT (db_id 3b78c36b-cb9b-50a0-8a89-76bc66d3321d, db_shopname WEDIT)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 2 WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '125A' WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '125A' WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'DP-Ducted Plant' WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'N/a' WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'D- Decorative' WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'OV - Open Void' WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'CON - Q' WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '3b78c36b-cb9b-50a0-8a89-76bc66d3321d' AND plumbing_sink IS NULL;

-- shop 23 / JET (db_id 57fa5c96-040f-50a3-9a96-998c5eb64a6a, db_shopname JET)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 2 WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '160A' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '160A' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'CU Casset unit' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '3x DP-Ducted Plant' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '60000Btu' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'SFS- Sliding Folding Stacking' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'D- Decorative' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'OV - Open Void' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '57fa5c96-040f-50a3-9a96-998c5eb64a6a' AND plumbing_sink IS NULL;

-- shop 24 / SHOPRITE LIQUE (db_id 70efc265-203e-5f29-92f5-4bf5d056b4ea, db_shopname SHOPRITE LIQUOR SHOP)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '100A' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '100A' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'No' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'MWS - Mid Wall Split' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'MWS - Mid Wall Split' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '4800 Btu' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door (2)' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'D- Decorative' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '70efc265-203e-5f29-92f5-4bf5d056b4ea' AND plumbing_sink IS NULL;

-- shop 25 / SHOPRITE (db_id a2f854ac-906e-539d-a7f2-24b687b46b56, db_shopname SHOPRITE)
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = 'a2f854ac-906e-539d-a7f2-24b687b46b56' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '800A' WHERE id = 'a2f854ac-906e-539d-a7f2-24b687b46b56' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '800A' WHERE id = 'a2f854ac-906e-539d-a7f2-24b687b46b56' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'No' WHERE id = 'a2f854ac-906e-539d-a7f2-24b687b46b56' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'MWS - Mid Wall Split' WHERE id = 'a2f854ac-906e-539d-a7f2-24b687b46b56' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'MWS - Mid Wall Split' WHERE id = 'a2f854ac-906e-539d-a7f2-24b687b46b56' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '48000Btu' WHERE id = 'a2f854ac-906e-539d-a7f2-24b687b46b56' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED + D - Downlights' WHERE id = 'a2f854ac-906e-539d-a7f2-24b687b46b56' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door' WHERE id = 'a2f854ac-906e-539d-a7f2-24b687b46b56' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'D- Decorative' WHERE id = 'a2f854ac-906e-539d-a7f2-24b687b46b56' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'OV - Open Void' WHERE id = 'a2f854ac-906e-539d-a7f2-24b687b46b56' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = 'a2f854ac-906e-539d-a7f2-24b687b46b56' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = 'a2f854ac-906e-539d-a7f2-24b687b46b56' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = 'a2f854ac-906e-539d-a7f2-24b687b46b56' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = 'a2f854ac-906e-539d-a7f2-24b687b46b56' AND plumbing_sink IS NULL;

-- shop 26 / MAKHAM (db_id 006c20c1-54e6-5b8c-864b-c8f4710351f4, db_shopname MAKHAM)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '125A' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '125A' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '2x DP-Ducted Plant' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '48000Btu' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED (24) + D -downlights (10) LED' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'N/a' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'D- Decorative' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '006c20c1-54e6-5b8c-864b-c8f4710351f4' AND plumbing_sink IS NULL;

-- shop 27 / SPORTSCENE (db_id 9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0, db_shopname SPORTSCENE)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '125A' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '125A' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '3 x DP-Ducted Plant' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '4800 Btu' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED (44) + S - Sport lights (41)' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'N/a' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'D- Decorative' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '9dcde58f-77ec-5e84-9fbe-426b3f2cd8a0' AND plumbing_sink IS NULL;

-- shop 28 / PEPCELL (db_id 9da5d484-688c-51e3-b812-8eb921d5f2ca, db_shopname PEPCELL)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '9da5d484-688c-51e3-b812-8eb921d5f2ca' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '9da5d484-688c-51e3-b812-8eb921d5f2ca' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = '9da5d484-688c-51e3-b812-8eb921d5f2ca' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = '9da5d484-688c-51e3-b812-8eb921d5f2ca' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '9da5d484-688c-51e3-b812-8eb921d5f2ca' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '9da5d484-688c-51e3-b812-8eb921d5f2ca' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'DP-Ducted Plant' WHERE id = '9da5d484-688c-51e3-b812-8eb921d5f2ca' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L- LED' WHERE id = '9da5d484-688c-51e3-b812-8eb921d5f2ca' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double Door' WHERE id = '9da5d484-688c-51e3-b812-8eb921d5f2ca' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '9da5d484-688c-51e3-b812-8eb921d5f2ca' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '9da5d484-688c-51e3-b812-8eb921d5f2ca' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '9da5d484-688c-51e3-b812-8eb921d5f2ca' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '9da5d484-688c-51e3-b812-8eb921d5f2ca' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '9da5d484-688c-51e3-b812-8eb921d5f2ca' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '9da5d484-688c-51e3-b812-8eb921d5f2ca' AND plumbing_sink IS NULL;

-- shop 29 /30 / COSMIX (db_id 1f8a0673-f32a-5f32-9cd0-49194ad61623, db_shopname COSMIX BEAUTY)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'Duram Bush DP-Ducted Plant' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '48000Btu' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD- Double door' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'G- Galvanized' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '1f8a0673-f32a-5f32-9cd0-49194ad61623' AND plumbing_sink IS NULL;

-- shop 31 A / ATMS (db_id 3334e1b3-d95e-5595-b557-062efc928dd9, db_shopname ATMS)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '3334e1b3-d95e-5595-b557-062efc928dd9' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '3334e1b3-d95e-5595-b557-062efc928dd9' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = '3334e1b3-d95e-5595-b557-062efc928dd9' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = '3334e1b3-d95e-5595-b557-062efc928dd9' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '3334e1b3-d95e-5595-b557-062efc928dd9' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '3334e1b3-d95e-5595-b557-062efc928dd9' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'duram bush DP-Ducted Plant' WHERE id = '3334e1b3-d95e-5595-b557-062efc928dd9' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '48000Btu' WHERE id = '3334e1b3-d95e-5595-b557-062efc928dd9' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '3334e1b3-d95e-5595-b557-062efc928dd9' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '3334e1b3-d95e-5595-b557-062efc928dd9' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '3334e1b3-d95e-5595-b557-062efc928dd9' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '3334e1b3-d95e-5595-b557-062efc928dd9' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '3334e1b3-d95e-5595-b557-062efc928dd9' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '3334e1b3-d95e-5595-b557-062efc928dd9' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '3334e1b3-d95e-5595-b557-062efc928dd9' AND plumbing_sink IS NULL;

-- shop 31 B / ABSA ATMS (db_id e4251c24-cc86-5463-98e0-9ffc5d1be0dc, db_shopname ABSA ATMS)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = 'e4251c24-cc86-5463-98e0-9ffc5d1be0dc' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = 'e4251c24-cc86-5463-98e0-9ffc5d1be0dc' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = 'e4251c24-cc86-5463-98e0-9ffc5d1be0dc' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = 'e4251c24-cc86-5463-98e0-9ffc5d1be0dc' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = 'e4251c24-cc86-5463-98e0-9ffc5d1be0dc' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = 'e4251c24-cc86-5463-98e0-9ffc5d1be0dc' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'duram bush DP-Ducted Plant' WHERE id = 'e4251c24-cc86-5463-98e0-9ffc5d1be0dc' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '48000Btu' WHERE id = 'e4251c24-cc86-5463-98e0-9ffc5d1be0dc' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = 'e4251c24-cc86-5463-98e0-9ffc5d1be0dc' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = 'e4251c24-cc86-5463-98e0-9ffc5d1be0dc' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = 'e4251c24-cc86-5463-98e0-9ffc5d1be0dc' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = 'e4251c24-cc86-5463-98e0-9ffc5d1be0dc' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = 'e4251c24-cc86-5463-98e0-9ffc5d1be0dc' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = 'e4251c24-cc86-5463-98e0-9ffc5d1be0dc' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = 'e4251c24-cc86-5463-98e0-9ffc5d1be0dc' AND plumbing_sink IS NULL;

-- shop 31C / STANDARD BANK ATM (db_id 4fef3eff-3e43-52e0-9130-71986e9c11fc, db_shopname STANDARD BANK ATM)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '4fef3eff-3e43-52e0-9130-71986e9c11fc' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '4fef3eff-3e43-52e0-9130-71986e9c11fc' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = '4fef3eff-3e43-52e0-9130-71986e9c11fc' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = '4fef3eff-3e43-52e0-9130-71986e9c11fc' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '4fef3eff-3e43-52e0-9130-71986e9c11fc' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '4fef3eff-3e43-52e0-9130-71986e9c11fc' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'duram bush DP-Ducted Plant' WHERE id = '4fef3eff-3e43-52e0-9130-71986e9c11fc' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '48000Btu' WHERE id = '4fef3eff-3e43-52e0-9130-71986e9c11fc' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '4fef3eff-3e43-52e0-9130-71986e9c11fc' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '4fef3eff-3e43-52e0-9130-71986e9c11fc' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '4fef3eff-3e43-52e0-9130-71986e9c11fc' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '4fef3eff-3e43-52e0-9130-71986e9c11fc' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '4fef3eff-3e43-52e0-9130-71986e9c11fc' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '4fef3eff-3e43-52e0-9130-71986e9c11fc' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '4fef3eff-3e43-52e0-9130-71986e9c11fc' AND plumbing_sink IS NULL;

-- shop 31 E / FNB ATM (db_id 8571ee48-9adb-5409-8488-aa5c2e038248, db_shopname FNB ATM)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '8571ee48-9adb-5409-8488-aa5c2e038248' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '8571ee48-9adb-5409-8488-aa5c2e038248' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = '8571ee48-9adb-5409-8488-aa5c2e038248' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = '8571ee48-9adb-5409-8488-aa5c2e038248' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '8571ee48-9adb-5409-8488-aa5c2e038248' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '8571ee48-9adb-5409-8488-aa5c2e038248' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'duram bush DP-Ducted Plant' WHERE id = '8571ee48-9adb-5409-8488-aa5c2e038248' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '48000Btu' WHERE id = '8571ee48-9adb-5409-8488-aa5c2e038248' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '8571ee48-9adb-5409-8488-aa5c2e038248' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '8571ee48-9adb-5409-8488-aa5c2e038248' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '8571ee48-9adb-5409-8488-aa5c2e038248' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '8571ee48-9adb-5409-8488-aa5c2e038248' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '8571ee48-9adb-5409-8488-aa5c2e038248' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '8571ee48-9adb-5409-8488-aa5c2e038248' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '8571ee48-9adb-5409-8488-aa5c2e038248' AND plumbing_sink IS NULL;

-- shop 32 / OLD MUTUAL (db_id 6a3016f2-96e9-5cc5-b6a4-110b573cda92, db_shopname OLD MUTUAL)
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '6a3016f2-96e9-5cc5-b6a4-110b573cda92' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '80A' WHERE id = '6a3016f2-96e9-5cc5-b6a4-110b573cda92' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = '6a3016f2-96e9-5cc5-b6a4-110b573cda92' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '6a3016f2-96e9-5cc5-b6a4-110b573cda92' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '6a3016f2-96e9-5cc5-b6a4-110b573cda92' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '2 x DP-Ducted Plant' WHERE id = '6a3016f2-96e9-5cc5-b6a4-110b573cda92' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '6a3016f2-96e9-5cc5-b6a4-110b573cda92' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'Galvanized' WHERE id = '6a3016f2-96e9-5cc5-b6a4-110b573cda92' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '6a3016f2-96e9-5cc5-b6a4-110b573cda92' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '6a3016f2-96e9-5cc5-b6a4-110b573cda92' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '6a3016f2-96e9-5cc5-b6a4-110b573cda92' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '6a3016f2-96e9-5cc5-b6a4-110b573cda92' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '6a3016f2-96e9-5cc5-b6a4-110b573cda92' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '6a3016f2-96e9-5cc5-b6a4-110b573cda92' AND plumbing_sink IS NULL;

-- shop 33 / STANDARD BANK (db_id 327c28e5-6632-58cb-978e-9c0075c2d15d, db_shopname STANDARDBANK)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '1x DP-Ducted Plant' WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '60000 Btu' WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD-Double Door' WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '327c28e5-6632-58cb-978e-9c0075c2d15d' AND plumbing_sink IS NULL;

-- shop 36 / HOME SYNCH (db_id 7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa, db_shopname HOMESYNC ESSENTIALS)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60a' WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60a' WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '1 x DP-Ducted Plant' WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '48000Btu' WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD -Double Door' WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '7f15d62e-72a0-55ce-9ff3-40e10d9b3aaa' AND plumbing_sink IS NULL;

-- shop 37 / ULTIMATE HAIR (db_id bcefb6e7-6088-516e-b122-eb590db6025e, db_shopname ULTIMATE HAIR)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'DP-Ducted Plant' WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '48000Btu' WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD_ Double Door' WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = 'bcefb6e7-6088-516e-b122-eb590db6025e' AND plumbing_sink IS NULL;

-- shop 38 / SPEEDY LOAN (db_id c4211767-f7a0-5e98-b121-1d42aec62dd3, db_shopname SPEEDY LOANS)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'DP-Ducted Plant' WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '48000Btu' WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD_ Double Door' WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = 'c4211767-f7a0-5e98-b121-1d42aec62dd3' AND plumbing_sink IS NULL;

-- shop 39 / FASHION WORLD (db_id 8c9ede92-0f1d-57f0-b00f-f9853e507d55, db_shopname FASHION WORLD)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = '8c9ede92-0f1d-57f0-b00f-f9853e507d55' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '8c9ede92-0f1d-57f0-b00f-f9853e507d55' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '125A' WHERE id = '8c9ede92-0f1d-57f0-b00f-f9853e507d55' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '125A' WHERE id = '8c9ede92-0f1d-57f0-b00f-f9853e507d55' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '8c9ede92-0f1d-57f0-b00f-f9853e507d55' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '3 X CASSETE' WHERE id = '8c9ede92-0f1d-57f0-b00f-f9853e507d55' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '48000 btu' WHERE id = '8c9ede92-0f1d-57f0-b00f-f9853e507d55' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED LIGHTING' WHERE id = '8c9ede92-0f1d-57f0-b00f-f9853e507d55' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD -Double Door' WHERE id = '8c9ede92-0f1d-57f0-b00f-f9853e507d55' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '8c9ede92-0f1d-57f0-b00f-f9853e507d55' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '8c9ede92-0f1d-57f0-b00f-f9853e507d55' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'CONCRETE FLOORS' WHERE id = '8c9ede92-0f1d-57f0-b00f-f9853e507d55' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '8c9ede92-0f1d-57f0-b00f-f9853e507d55' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '8c9ede92-0f1d-57f0-b00f-f9853e507d55' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '8c9ede92-0f1d-57f0-b00f-f9853e507d55' AND plumbing_sink IS NULL;

-- shop 40 / EXACT (db_id e8564b9f-e643-591b-930e-9aad0f9d1e03, db_shopname EXACT)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = 'e8564b9f-e643-591b-930e-9aad0f9d1e03' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = 'e8564b9f-e643-591b-930e-9aad0f9d1e03' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '125A' WHERE id = 'e8564b9f-e643-591b-930e-9aad0f9d1e03' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '125A' WHERE id = 'e8564b9f-e643-591b-930e-9aad0f9d1e03' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = 'e8564b9f-e643-591b-930e-9aad0f9d1e03' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '4 X CASSETE' WHERE id = 'e8564b9f-e643-591b-930e-9aad0f9d1e03' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '60000Btu' WHERE id = 'e8564b9f-e643-591b-930e-9aad0f9d1e03' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = 'e8564b9f-e643-591b-930e-9aad0f9d1e03' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'D- Decorative' WHERE id = 'e8564b9f-e643-591b-930e-9aad0f9d1e03' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = 'e8564b9f-e643-591b-930e-9aad0f9d1e03' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = 'e8564b9f-e643-591b-930e-9aad0f9d1e03' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = 'e8564b9f-e643-591b-930e-9aad0f9d1e03' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = 'e8564b9f-e643-591b-930e-9aad0f9d1e03' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = 'e8564b9f-e643-591b-930e-9aad0f9d1e03' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = 'e8564b9f-e643-591b-930e-9aad0f9d1e03' AND plumbing_sink IS NULL;

-- shop 41 / THE HUB (db_id 85322d07-4ce8-5acc-a577-22bc6465cc6e, db_shopname THE HUB)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '125A' WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '125A' WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '4x Dunham Bush -Ducted Plant' WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = 'AC41A = 48KBTU ;AC41B = 48KBTU; AC41C = 60KBTU; AC41D = 60KBTU' WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD -Double Door' WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '85322d07-4ce8-5acc-a577-22bc6465cc6e' AND plumbing_sink IS NULL;

-- shop 43 / TOTAL SPORT (db_id c28240e4-303b-5241-8f69-8e4c7172640e, db_shopname TOTAL SPORTS)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '100A' WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '100A' WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '2x DP-Ducted Plant' WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '36000Btu' WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'D- Decorative' WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = 'c28240e4-303b-5241-8f69-8e4c7172640e' AND plumbing_sink IS NULL;

-- shop 44 / SHOE ZONE (db_id c8538826-856a-5ed7-92c7-cb87e5065668, db_shopname SHOE ZONE)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = 'c8538826-856a-5ed7-92c7-cb87e5065668' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = 'c8538826-856a-5ed7-92c7-cb87e5065668' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '60A' WHERE id = 'c8538826-856a-5ed7-92c7-cb87e5065668' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '60A' WHERE id = 'c8538826-856a-5ed7-92c7-cb87e5065668' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = 'c8538826-856a-5ed7-92c7-cb87e5065668' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = 'c8538826-856a-5ed7-92c7-cb87e5065668' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '2x DP-Ducted Plant' WHERE id = 'c8538826-856a-5ed7-92c7-cb87e5065668' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = 'c8538826-856a-5ed7-92c7-cb87e5065668' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD -Double Door' WHERE id = 'c8538826-856a-5ed7-92c7-cb87e5065668' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = 'c8538826-856a-5ed7-92c7-cb87e5065668' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = 'c8538826-856a-5ed7-92c7-cb87e5065668' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = 'c8538826-856a-5ed7-92c7-cb87e5065668' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = 'c8538826-856a-5ed7-92c7-cb87e5065668' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = 'c8538826-856a-5ed7-92c7-cb87e5065668' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = 'c8538826-856a-5ed7-92c7-cb87e5065668' AND plumbing_sink IS NULL;

-- shop 45 / CELLTECH (db_id ea73f062-1aef-56aa-a933-e44fbf775f5f, db_shopname CELLTECH)
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = 'ea73f062-1aef-56aa-a933-e44fbf775f5f' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = 'ea73f062-1aef-56aa-a933-e44fbf775f5f' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '1x cassete' WHERE id = 'ea73f062-1aef-56aa-a933-e44fbf775f5f' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '36000Btu' WHERE id = 'ea73f062-1aef-56aa-a933-e44fbf775f5f' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = 'ea73f062-1aef-56aa-a933-e44fbf775f5f' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = 'ea73f062-1aef-56aa-a933-e44fbf775f5f' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = 'ea73f062-1aef-56aa-a933-e44fbf775f5f' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = 'ea73f062-1aef-56aa-a933-e44fbf775f5f' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = 'ea73f062-1aef-56aa-a933-e44fbf775f5f' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = 'ea73f062-1aef-56aa-a933-e44fbf775f5f' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = 'ea73f062-1aef-56aa-a933-e44fbf775f5f' AND plumbing_sink IS NULL;

-- shop 46 / THE FIX (db_id 6a2b7339-b675-5eb6-9680-c6bf54c30439, db_shopname THE FIX)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '100A' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '100A' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '3x DP-Ducted Plant' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '48000Btu' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD -Double Door' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET roller_shutter_type = 'D- Decorative' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND roller_shutter_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '6a2b7339-b675-5eb6-9680-c6bf54c30439' AND plumbing_sink IS NULL;

-- shop 47 / WEBBERS (db_id 275d3456-6db4-55f3-ad09-5219ee38b52c, db_shopname WEBBERS)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '100A' WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '100A' WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = '4x DP-Ducted Plant' WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET hvac_gas = '48000Btu' WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND hvac_gas IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD -Double Door' WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = '275d3456-6db4-55f3-ad09-5219ee38b52c' AND plumbing_sink IS NULL;

-- shop 48 / STUDIO 88 (db_id b6ed7202-ed09-5e4f-825d-28e5987aa912, db_shopname STUDIO 88)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 0 WHERE id = 'b6ed7202-ed09-5e4f-825d-28e5987aa912' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = 'b6ed7202-ed09-5e4f-825d-28e5987aa912' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '125A' WHERE id = 'b6ed7202-ed09-5e4f-825d-28e5987aa912' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '125A' WHERE id = 'b6ed7202-ed09-5e4f-825d-28e5987aa912' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = 'b6ed7202-ed09-5e4f-825d-28e5987aa912' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = 'b6ed7202-ed09-5e4f-825d-28e5987aa912' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'DP-Ducted Plant' WHERE id = 'b6ed7202-ed09-5e4f-825d-28e5987aa912' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = 'b6ed7202-ed09-5e4f-825d-28e5987aa912' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD -Double Door' WHERE id = 'b6ed7202-ed09-5e4f-825d-28e5987aa912' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = 'b6ed7202-ed09-5e4f-825d-28e5987aa912' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = 'b6ed7202-ed09-5e4f-825d-28e5987aa912' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = 'b6ed7202-ed09-5e4f-825d-28e5987aa912' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = 'b6ed7202-ed09-5e4f-825d-28e5987aa912' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Paadsinted' WHERE id = 'b6ed7202-ed09-5e4f-825d-28e5987aa912' AND wall_finish IS NULL;
UPDATE public.tenant_shop_spec SET plumbing_sink = 'S-SINK WHB' WHERE id = 'b6ed7202-ed09-5e4f-825d-28e5987aa912' AND plumbing_sink IS NULL;

-- shop 49 / PEP (db_id b371d755-a404-528b-a916-7d64c7d72b16, db_shopname PEP)
UPDATE public.tenant_shop_spec SET plumbing_toilets = 1 WHERE id = 'b371d755-a404-528b-a916-7d64c7d72b16' AND plumbing_toilets IS NULL;
UPDATE public.tenant_shop_spec SET db_phase = '3 - Three phase' WHERE id = 'b371d755-a404-528b-a916-7d64c7d72b16' AND db_phase IS NULL;
UPDATE public.tenant_shop_spec SET actual_amps = '80A' WHERE id = 'b371d755-a404-528b-a916-7d64c7d72b16' AND actual_amps IS NULL;
UPDATE public.tenant_shop_spec SET lease_amps = '80A' WHERE id = 'b371d755-a404-528b-a916-7d64c7d72b16' AND lease_amps IS NULL;
UPDATE public.tenant_shop_spec SET generator_connection = 'Yes' WHERE id = 'b371d755-a404-528b-a916-7d64c7d72b16' AND generator_connection IS NULL;
UPDATE public.tenant_shop_spec SET hvac_units = 'DP-Ducted Plant' WHERE id = 'b371d755-a404-528b-a916-7d64c7d72b16' AND hvac_units IS NULL;
UPDATE public.tenant_shop_spec SET hvac_btu = 'DP-Ducted Plant' WHERE id = 'b371d755-a404-528b-a916-7d64c7d72b16' AND hvac_btu IS NULL;
UPDATE public.tenant_shop_spec SET lighting_type = 'L - LED' WHERE id = 'b371d755-a404-528b-a916-7d64c7d72b16' AND lighting_type IS NULL;
UPDATE public.tenant_shop_spec SET shopfront_type = 'DD -Double Door' WHERE id = 'b371d755-a404-528b-a916-7d64c7d72b16' AND shopfront_type IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_structure = 'S - Suspended' WHERE id = 'b371d755-a404-528b-a916-7d64c7d72b16' AND ceiling_structure IS NULL;
UPDATE public.tenant_shop_spec SET ceiling_height = '3m' WHERE id = 'b371d755-a404-528b-a916-7d64c7d72b16' AND ceiling_height IS NULL;
UPDATE public.tenant_shop_spec SET floor_finish = 'T - Tiled' WHERE id = 'b371d755-a404-528b-a916-7d64c7d72b16' AND floor_finish IS NULL;
UPDATE public.tenant_shop_spec SET walls = 'B -Brick D - Dry wall' WHERE id = 'b371d755-a404-528b-a916-7d64c7d72b16' AND walls IS NULL;
UPDATE public.tenant_shop_spec SET wall_finish = 'P - Painted' WHERE id = 'b371d755-a404-528b-a916-7d64c7d72b16' AND wall_finish IS NULL;

COMMIT;