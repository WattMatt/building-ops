-- ============================================================================
-- Fortress Reporting — 17: tenant_compliance.sprinkler_dedicated (re-audit finding)
-- The OHS&HK source has a "Sprinkler System — Dedicated? Y/N" column [src 12] with
-- no DB home; spec §6 added smoke_extraction/detection_dedicated but missed the
-- symmetric sprinkler one. Additive. The spurious generator_dedicated column (no
-- source equivalent) is left in place but unused (null going forward). Idempotent.
-- ============================================================================

alter table public.tenant_compliance
  add column if not exists sprinkler_dedicated text check (sprinkler_dedicated in ('yes','no','na'));
