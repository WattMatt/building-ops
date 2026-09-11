-- 2026-08-12_02_makhado_musina_buildings.sql
-- Two further buildings found once the OneDrive folder finished syncing.
-- Idempotent (guarded on name); safe to re-run.
--
-- The initial drop was partial (28 files). The completed sync brought 55 June-2026
-- reports, and two more buildings have no row in `buildings`:
--
--   Game Makhado           workbook: "Building Name: Game Makhado",
--                          "MASTERFILE INDEX / GAME MAKHADO"
--   Musina Shopping Centre workbook: "Building Name: Musina Shopping Centre",
--                          "Planned Preventative Maintenance Musina 2025 - 2026"
--
-- Both names are taken verbatim from the workbooks' own "Building Name" field.
--
-- Two other apparently-unmatched reports were NOT new buildings and are mapped to
-- existing rows instead of being created:
--   "Morone Ops Report"    -> Kopano (Morone) Shopping Centre
--                             (workbook says "Building Name: Kopano Shopping Centre")
--   "Mahikeng Station Ops" -> Mafikeng (Mahikeng) Station
--                             (workbook says "MAHIKENG STATION BOULEVARD CENTRE";
--                              spelling variant of the same site)
--
-- As with the Lephalale batch: no street address is invented. Makhado and Musina
-- are both in Limpopo; the workbooks carry no street address.

begin;

insert into public.buildings (organization_id, name, city, building_type)
select o.organization_id, v.name, v.city, 'retail'
from (select distinct organization_id from public.buildings where organization_id is not null limit 1) o
cross join (values
  ('Game Makhado',           'Makhado'),
  ('Musina Shopping Centre', 'Musina')
) as v(name, city)
where not exists (
  select 1 from public.buildings b where lower(b.name) = lower(v.name)
);

commit;

-- Verification:
--   select name, city, building_type from public.buildings
--   where name in ('Game Makhado','Musina Shopping Centre');   -- expect 2 rows
--
-- ROLLBACK (only before any report references them):
--   delete from public.buildings
--   where name in ('Game Makhado','Musina Shopping Centre')
--     and not exists (select 1 from public.reports r where r.building_id = buildings.id);
