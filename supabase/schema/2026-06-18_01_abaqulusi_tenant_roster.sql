-- 2026-06-18_01_abaqulusi_tenant_roster.sql
-- AbaQulusi gap-fill STEP 1 — tenant roster (see fortress/build/ABAQULUSI_GAP_REGISTER_2026-06-18.md X1, X2).
-- Building 63345a91-6706-5cf3-b26e-80174c36b2b5 (AbaQulusi Plaza, Vryheid).
--
-- Does:
--   1) Backfill building_tenants.name (52 rows currently NULL) from the curated shop_name.
--      (We intentionally do NOT import source spelling variants over curated DB names, e.g. DB 'RUSSELS' > src 'RUSSEL'.)
--   2) Repair the orphan shop '9.1' -> '9' (shop_name already 'FASTRAK').
--   3) Insert the 7 still-missing source tenants (F/STANDING, GARAGE, KIOSK 01/02, OFFICE 01, SIGNAGE PRIMEDIA, '10' FASTRAK).
-- Idempotent + additive. PK is (id) only; building_tenants has NO unique constraint on (building_id, shop_number),
--   so inserts are guarded by NOT EXISTS and the rename is naturally a no-op on re-run.
-- DEFERRED / FLAGGED: shop 42 identity conflict (DB 'ABAQULUSI MEDICAL CENTRE' vs source 'RAGE EDDITION') — left untouched.

BEGIN;

-- (1) Backfill name from curated shop_name (covers all 52 incl. the soon-to-be-renamed '9.1')
UPDATE public.building_tenants
SET name = shop_name
WHERE building_id = '63345a91-6706-5cf3-b26e-80174c36b2b5'
  AND name IS NULL;

-- (2) Repair orphan '9.1' -> '9' (FASTRAK). No-op if already renamed.
UPDATE public.building_tenants
SET shop_number = '9'
WHERE building_id = '63345a91-6706-5cf3-b26e-80174c36b2b5'
  AND shop_number = '9.1';

-- (3) Insert the 7 missing source tenants (guarded; sets both shop_name and name to the source tenant name)
INSERT INTO public.building_tenants (id, building_id, shop_number, shop_name, name, is_active)
SELECT gen_random_uuid(), '63345a91-6706-5cf3-b26e-80174c36b2b5', v.sn, v.nm, v.nm, true
FROM (VALUES
  ('F/STANDING',       'CASHBUILD'),
  ('GARAGE',           'ASTRON'),
  ('KIOSK 01',         'NR CELL CLINIX'),
  ('KIOSK 02',         'PROFUMO'),
  ('OFFICE 01',        'VRYHEID TAXI ASSOCIATION'),
  ('SIGNAGE PRIMEDIA', 'PRIMEDIA OUTDOOR'),
  ('10',               'FASTRAK')
) AS v(sn, nm)
WHERE NOT EXISTS (
  SELECT 1 FROM public.building_tenants bt
  WHERE bt.building_id = '63345a91-6706-5cf3-b26e-80174c36b2b5'
    AND bt.shop_number = v.sn
);

COMMIT;
