-- 2026-08-12_01_lephalale_crossing_buildings.sql
-- Creates the five Lephalale Crossing buildings ahead of the June-2026 report ingest.
-- Idempotent (guarded on name); safe to re-run.
--
-- WHY: the client supplied June 2026 CM reports for five buildings that do not
-- exist in `buildings`. Each workbook carries the precinct in its title cell:
--
--   BOXER CENTRE           LEPHALALE CROSSING: JUNE 2026
--   FASHION CORNER         LEPHALALE CROSSING: JUNE 2026
--   RELEBOGILE CENTRE      LEPHALALE CROSSING: JUNE 2026
--   SHOPRITE CENTRE        LEPHALALE CROSSING: JUNE 2026
--   STANDARD BANK BUILDING LEPHALALE CROSSING: JUNE 2026
--
-- These are five DISTINCT buildings, not one site. "Shoprite Centre" here is the
-- Lephalale store and is NOT the existing `Shoprite Kokstad`, which has its own
-- CM and Ops reports in the same drop.
--
-- WHAT IS AND IS NOT SET
--   name             - verbatim from the workbook title
--   organization_id  - the single org every other building uses
--   building_type    - 'retail'; all 40 existing buildings are retail, and this
--                      column gates H&S template scoping via enforce_hs_template_scope,
--                      so leaving it NULL would silently generate no H&S tasks
--   address          - 'Lephalale Crossing' (verbatim from the source header)
--   city             - 'Lephalale' (corroborated by tenant "Meat Boys Lephalale")
--
-- Deliberately NOT set: street address, latitude/longitude, contacts, tariffs.
-- The workbooks contain no street address anywhere -- a full-text scan of all
-- ~400 distinct strings per workbook returned only dates and phone numbers. These
-- must be completed by the client rather than invented; a fabricated address in a
-- compliance record is worse than an absent one.

begin;

insert into public.buildings (organization_id, name, address, city, building_type)
select o.organization_id, v.name, 'Lephalale Crossing', 'Lephalale', 'retail'
from (select distinct organization_id from public.buildings where organization_id is not null limit 1) o
cross join (values
  ('Boxer Centre'),
  ('Fashion Corner'),
  ('Relebogile Centre'),
  ('Shoprite Centre'),
  ('Standard Bank Building')
) as v(name)
where not exists (
  select 1 from public.buildings b where lower(b.name) = lower(v.name)
);

commit;

-- Verification:
--   select name, address, city, building_type from public.buildings
--   where address = 'Lephalale Crossing' order by name;   -- expect 5 rows
--
-- ROLLBACK (only safe before any report references them):
--   delete from public.buildings
--   where address = 'Lephalale Crossing'
--     and not exists (select 1 from public.reports r where r.building_id = buildings.id);
