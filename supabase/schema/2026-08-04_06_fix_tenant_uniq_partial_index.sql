-- 2026-08-04_06_fix_tenant_uniq_partial_index.sql
-- Corrects a regression introduced earlier today by sql/2026-08-04_02.
--
-- WHAT WENT WRONG
-- _02 added:
--   CREATE UNIQUE INDEX building_tenants_building_shop_uniq
--     ON building_tenants (building_id, shop_number) WHERE shop_number IS NOT NULL;
--
-- The PARTIAL predicate makes the index unusable for ON CONFLICT inference from
-- PostgREST/supabase-js: those clients send only `on_conflict=building_id,shop_number`
-- and cannot attach the matching `WHERE shop_number IS NOT NULL` predicate that
-- Postgres requires to infer a partial index. So the intended idempotent-upsert fix
-- is not expressible from either client, and the web tenant import
-- (src/components/import/TenantImportDialog.tsx) — which issues a plain insert —
-- now fails every duplicate row with a 23505 it does not surface to the user.
--
-- WHY A PLAIN INDEX IS THE RIGHT SHAPE
-- The partial predicate was only there to let several tenants share a NULL
-- shop_number. That is unnecessary: Postgres treats NULLs as DISTINCT in a unique
-- index by default, so a plain unique index already permits unlimited NULL
-- shop_numbers per building while still rejecting duplicate real shop numbers.
-- Verified on staging before applying:
--   2 rows with (building, NULL) inserted OK; a duplicate (building,'A1') rejected.
--
-- Net effect: identical data guarantees, but ON CONFLICT now works from both clients.

begin;

drop index if exists public.building_tenants_building_shop_uniq;

create unique index if not exists building_tenants_building_shop_uniq
  on public.building_tenants (building_id, shop_number);

commit;

-- Clients may now use:
--   supabase-js : .upsert(rows, { onConflict: 'building_id,shop_number', ignoreDuplicates: true })
--   PostgREST   : ?on_conflict=building_id,shop_number  +  Prefer: resolution=ignore-duplicates
--
-- ROLLBACK (restores the previous, ON CONFLICT-hostile shape):
--   drop index if exists public.building_tenants_building_shop_uniq;
--   create unique index building_tenants_building_shop_uniq
--     on public.building_tenants (building_id, shop_number) where shop_number is not null;
