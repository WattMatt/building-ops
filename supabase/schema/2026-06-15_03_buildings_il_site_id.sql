-- 2026-06-15_03: link GMI buildings to the insight-linker portfolio.
-- Fortress already captures its whole portfolio (shops, breaker sizes, meter
-- serials, CT ratios, COC status + inspection photos) in the insight-linker app
-- ("WM Compliance" Supabase project, ref oltzgidkjxwsukvkomof, us-east-1). This
-- column is the join key so Fortress operational reports can read that data LIVE
-- (postgres_fdw, see _05) instead of re-capturing it by hand:
--     public.buildings.il_site_id  ==  insight-linker public.sites.id
--
-- Additive + idempotent. Backfills the AbaQulusi anchor mapping. Applied staging -> prod.

ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS il_site_id uuid;

COMMENT ON COLUMN public.buildings.il_site_id IS
  'insight-linker (WM Compliance, ref oltzgidkjxwsukvkomof) public.sites.id — join key for the live cross-DB read of shop / breaker / meter / CT data + inspection photos. NULL for non-Fortress buildings.';

-- One GMI building per insight-linker site. Partial unique index so the many NULLs
-- (every non-Fortress building) do not collide, and so _04's ON CONFLICT can infer it.
CREATE UNIQUE INDEX IF NOT EXISTS buildings_il_site_id_key
  ON public.buildings (il_site_id)
  WHERE il_site_id IS NOT NULL;

-- Anchor backfill: AbaQulusi Plaza (already in GMI) -> its insight-linker site.
UPDATE public.buildings
   SET il_site_id = '16729bf2-d71b-40d1-b8c6-b57d1cadd46a'
 WHERE id = '63345a91-6706-5cf3-b26e-80174c36b2b5'
   AND il_site_id IS DISTINCT FROM '16729bf2-d71b-40d1-b8c6-b57d1cadd46a';
