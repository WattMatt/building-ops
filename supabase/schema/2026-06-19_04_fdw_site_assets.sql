-- 2026-06-19_04: add the site_assets foreign table to the existing insight_linker_srv FDW.
-- site_assets is insight-linker's electrical-asset registry (per meter / DB-board): it carries
-- breaker_size (+ meter_serial_number / ct_ratio), which insight_linker.subsections does NOT.
-- Used by building_insight_linker (_05) to surface circuit-breaker size per shop, joined on
-- (site_id, meter_serial_number). Additive — does NOT touch the server or user mapping (_05/2026-06-15).
-- Base-type columns only (skip the asset_category enum, per 2026-06-15_05's rationale).
-- Read-only; stays OFF PostgREST (no grants). Apply staging → validate → prod (owner sign-off).

create foreign table if not exists insight_linker.site_assets (
  id                   uuid,
  site_id              uuid,
  premises_id          text,
  meter_serial_number  text,
  ct_ratio             text,
  breaker_size         text
) server insight_linker_srv options (schema_name 'public', table_name 'site_assets');
