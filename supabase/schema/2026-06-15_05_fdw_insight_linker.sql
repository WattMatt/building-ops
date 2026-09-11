-- 2026-06-15_05 (REVISED 2026-06-18): live cross-DB read from insight-linker via postgres_fdw.
--
-- REVISION: insight-linker uses custom enum types (e.g. public.asset_category) on some
-- columns, so `IMPORT FOREIGN SCHEMA` fails ("type public.asset_category does not exist")
-- because those types don't exist in GMI. Instead we declare EXPLICIT foreign tables for
-- only the columns the integration reads (all base types). This also drops the tables
-- Phase 1 doesn't use (site_assets, inspection_items). The DOCUMENT foreign tables live
-- in 2026-06-18_08. The building-scoped RPC lives in 2026-06-18_09.
--
-- Exposes insight-linker (ref oltzgidkjxwsukvkomof, us-east-1) to GMI (eu-west-1),
-- STRICTLY READ-ONLY, joined on public.buildings.il_site_id = insight_linker.sites.id.
--
-- PREREQUISITE: Vault secret 'insight_linker_db_password' must exist in THIS project
-- (the user mapping reads vault.decrypted_secrets at apply time; never inline).
-- FDW MUST use the SESSION pooler (port 5432 — the 6543 transaction pooler breaks fdw).
-- Apply staging first, validate a sample SELECT, then prod (owner sign-off).
-- Re-runnable: DROP SERVER ... CASCADE drops the dependent foreign tables + user mapping.

create extension if not exists postgres_fdw;
create schema if not exists insight_linker;

drop server if exists insight_linker_srv cascade;
create server insight_linker_srv
  foreign data wrapper postgres_fdw
  options (
    host    'aws-1-us-east-1.pooler.supabase.com',
    port    '5432',
    dbname  'postgres',
    sslmode 'require',
    fetch_size '1000'
  );

do $$
declare pw text;
begin
  select decrypted_secret into pw from vault.decrypted_secrets where name = 'insight_linker_db_password';
  if pw is null then
    raise exception 'Vault secret "insight_linker_db_password" not found — create it before applying _05.';
  end if;
  execute format(
    'create user mapping for current_user server insight_linker_srv options (user %L, password %L)',
    'postgres.oltzgidkjxwsukvkomof', pw
  );
end $$;

-- Explicit foreign tables: only the columns the integration reads (all base types -> no
-- dependency on insight-linker's custom enum types). Column names match the remote.
create foreign table insight_linker.sites (
  id                   uuid,
  client_id            uuid,
  name                 text,
  supply_authority     text,
  nominated_max_demand text,
  site_image_url       text
) server insight_linker_srv options (schema_name 'public', table_name 'sites');

create foreign table insight_linker.subsections (
  id                  uuid,
  site_id             uuid,
  name                text,
  tenant_name         text,
  category            text,
  meter_serial_number text,
  ct_ratio            text,
  metering_status     text,
  coc_number          text,
  coc_status          text,
  coc_type            text,
  coc_issue_date      date,
  coc_expiry_date     date
) server insight_linker_srv options (schema_name 'public', table_name 'subsections');

create foreign table insight_linker.inspection_photo_refs (
  subsection_id     uuid,
  inspection_title  text,
  photo_url         text,
  exists_in_storage boolean
) server insight_linker_srv options (schema_name 'public', table_name 'inspection_photo_refs');

-- insight_linker.* is deliberately NOT granted to anon/authenticated (stays off PostgREST).
-- All client access is via the SECURITY DEFINER RPC in 2026-06-18_09.
