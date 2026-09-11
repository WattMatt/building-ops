-- 2026-06-12_01_fix_tenant_docs_storage_policies.sql
-- Finding from scripts/rls-smoke.mjs (web repo), first run 2026-06-12:
-- both tenant-docs storage policies from 2026-06-11_03_storage_scoping.sql
-- reference the unqualified column `name` INSIDE their EXISTS subquery over
-- building_tenants. Postgres binds that to bt.name (inner scope), not
-- storage.objects.name, so the tenant-id path segment is parsed out of the
-- tenant's display name (never contains '/') and the clause is always false.
-- Effect: ALL user-context reads and writes of tenant-docs/* denied since
-- 2026-06-11 (fail-closed — no exposure; tenant-doc viewing/upload broken).
-- Fix: recreate both policies with the outer column qualified as objects.name.
-- Apply staging (vkrihpmjajjcxmzgjqdr) first, re-run rls-smoke, then prod.
begin;

drop policy if exists "td read tenant docs" on storage.objects;
create policy "td read tenant docs" on storage.objects for select using (
  bucket_id = 'tenant-documents'
  and split_part(objects.name, '/', 1) = 'tenant-docs'
  and exists (
    select 1 from public.building_tenants bt
    where bt.id = nullif(split_part(objects.name, '/', 2), '')::uuid
      and public.can_access_building(bt.building_id)
  )
);

drop policy if exists "td write tenant docs" on storage.objects;
create policy "td write tenant docs" on storage.objects for insert with check (
  bucket_id = 'tenant-documents'
  and split_part(objects.name, '/', 1) = 'tenant-docs'
  and exists (
    select 1 from public.building_tenants bt
    where bt.id = nullif(split_part(objects.name, '/', 2), '')::uuid
      and public.can_access_building(bt.building_id)
  )
);

commit;
