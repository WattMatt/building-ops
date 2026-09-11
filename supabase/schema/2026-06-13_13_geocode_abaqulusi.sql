-- 2026-06-13_13_geocode_abaqulusi.sql
-- Populate AbaQulusi Plaza's map coordinates.
--
-- Why: the Fortress seed (2026-06-13_10) inserted the text address but left
-- latitude/longitude null, so the Buildings list badge reads "No location"
-- (Buildings.tsx gates the badge on `latitude && longitude`) and the building
-- map has no pin. There is currently no in-app path to set coordinates from the
-- building form, so we backfill here.
--
-- Coordinates forward-geocoded via Mapbox (the app's own geocoder, country=ZA)
-- from the address "Cnr Utrecht and Mason Street, Vryheid"
--   -> Mason Street, Vryheid, KwaZulu-Natal 3100, South Africa
-- Idempotent: only fills when still null.

update public.buildings
set    latitude  = -27.771843,
       longitude = 30.803178,
       updated_at = now()
where  id = '63345a91-6706-5cf3-b26e-80174c36b2b5'
  and  latitude is null
  and  longitude is null;
