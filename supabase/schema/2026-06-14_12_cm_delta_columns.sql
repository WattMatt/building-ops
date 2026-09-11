-- 2026-06-14_12_cm_delta_columns.sql
-- CM structured-schema delta: the two genuinely-missing columns the CM source
-- workbook carries but the report schema did not model.
--
-- Source: "ABAQULUSI - CM Report Dec 2025 master copy.xlsx"
--   Page 2 "3. HEAD COUNTS"        -> footfall ticksheet reconciliation triad
--                                     (G33/H33/I33 labels; G34/H34/I34 values)
--   Page 2 "4. TOILET FUND INFO"   -> toilet-roll bale variance (I36)
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS); applied staging -> prod.
-- Free-text Borehole/Generator status (Page 3) is NOT a column here — it is
-- stored generically in report_narratives (section_key borehole_status /
-- generator_status), handled by the web form + a separate narrative seed.

-- ---------------------------------------------------------------------------
-- 1. Schema (additive)
-- ---------------------------------------------------------------------------

-- Footcount System vs Ticksheet reconciliation (building-level; carried on the
-- centre footfall row). system_count = turnstile/system reading (G34),
-- ticksheet_count = manual ticksheet (H34), recon_variance = source variance (I34).
ALTER TABLE public.footfall_counts
  ADD COLUMN IF NOT EXISTS system_count    numeric,
  ADD COLUMN IF NOT EXISTS ticksheet_count numeric,
  ADD COLUMN IF NOT EXISTS recon_variance  numeric;

COMMENT ON COLUMN public.footfall_counts.system_count    IS 'Footcount System reading (CM source Page 2 G34) — reconciliation vs ticksheet.';
COMMENT ON COLUMN public.footfall_counts.ticksheet_count IS 'Manual ticksheet count (CM source Page 2 H34).';
COMMENT ON COLUMN public.footfall_counts.recon_variance  IS 'System-vs-ticksheet reconciliation variance (CM source Page 2 I34).';

-- Toilet-roll bale variance (issued bales - stock on hand bales), distinct from
-- the existing cash `variance` column.
ALTER TABLE public.toilet_fund
  ADD COLUMN IF NOT EXISTS bale_variance numeric;

COMMENT ON COLUMN public.toilet_fund.bale_variance IS 'Toilet-roll bale variance — issued minus stock on hand (CM source Page 2 I36).';

-- ---------------------------------------------------------------------------
-- 2. Ingest AbaQulusi Plaza CM (Dec 2025) source values (NULL-guarded)
--    report_id d4debf2d-f380-5dc8-b4dd-4429e99fa016
--    building  63345a91-6706-5cf3-b26e-80174c36b2b5
-- ---------------------------------------------------------------------------

-- Footfall reconciliation lands on the centre entrance row only.
UPDATE public.footfall_counts
   SET system_count    = COALESCE(system_count, 97654),
       ticksheet_count = COALESCE(ticksheet_count, 26192),
       recon_variance  = COALESCE(recon_variance, 2.728390348197923)
 WHERE report_id = 'd4debf2d-f380-5dc8-b4dd-4429e99fa016'
   AND entrance ILIKE 'Public Toilets: Centre';

-- Bale variance lands on the single toilet_fund row for this report.
UPDATE public.toilet_fund
   SET bale_variance = COALESCE(bale_variance, 38)
 WHERE report_id = 'd4debf2d-f380-5dc8-b4dd-4429e99fa016';

-- ---------------------------------------------------------------------------
-- 3. Borehole / Generator status free-text (Page 3) -> report_narratives
--    Generic narrative rows (section_key + heading + body). Idempotent on
--    (report_id, section_key) so re-running does not duplicate.
--      Page 3 A26 borehole status: 'Fully operational supplying about 50% water needs'
--      Page 3 A33    generator status: 'N/A'
-- ---------------------------------------------------------------------------
INSERT INTO public.report_narratives (report_id, building_id, section_key, heading, body, sort_order)
SELECT 'd4debf2d-f380-5dc8-b4dd-4429e99fa016',
       '63345a91-6706-5cf3-b26e-80174c36b2b5',
       v.section_key, v.heading, v.body, v.sort_order
  FROM (VALUES
    ('borehole_status',  'Borehole Status',  'Fully operational supplying about 50% water needs', 0),
    ('generator_status', 'Generator Status', 'N/A',                                                1)
  ) AS v(section_key, heading, body, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.report_narratives n
    WHERE n.report_id = 'd4debf2d-f380-5dc8-b4dd-4429e99fa016'
      AND n.section_key = v.section_key
 );
