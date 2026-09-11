-- 2026-06-11_03_storage_scoping.sql
-- G-02 / F-28: scope storage.objects policies by path convention.
-- Approved by owner 2026-06-11 (gate decision "design-then-show" → sign-off).
-- Source proposal: specs/verification/STORAGE_POLICY_PROPOSAL.md
-- Applied to staging (vkrihpmjajjcxmzgjqdr) first, then production (qdzgkttiosahdfqresvz).
begin;

-- ── tenant-documents: replace blanket policies with prefix-scoped ones ──
drop policy if exists "Auth read docs"   on storage.objects;
drop policy if exists "Auth upload docs" on storage.objects;
drop policy if exists "Auth update docs" on storage.objects;
drop policy if exists "Auth delete docs" on storage.objects;

-- helper: first path segment after the prefix, cast to uuid (null-safe)
-- (inline expressions used below; no new function needed)

-- READ: building docs + tenant docs by building access; contractor docs + photos org-wide (any authenticated)
create policy "td read building docs" on storage.objects for select using (
  bucket_id = 'tenant-documents'
  and split_part(name, '/', 1) = 'documents'
  and public.can_access_building(nullif(split_part(name, '/', 2), '')::uuid)
);
create policy "td read tenant docs" on storage.objects for select using (
  bucket_id = 'tenant-documents'
  and split_part(name, '/', 1) = 'tenant-docs'
  and exists (
    select 1 from public.building_tenants bt
    where bt.id = nullif(split_part(name, '/', 2), '')::uuid
      and public.can_access_building(bt.building_id)
  )
);
create policy "td read contractor docs and photos" on storage.objects for select using (
  bucket_id = 'tenant-documents'
  and split_part(name, '/', 1) in ('contractor-docs', 'photos')
  and auth.uid() is not null
);

-- INSERT: same scoping; photos only into the uploader's own folder
create policy "td write building docs" on storage.objects for insert with check (
  bucket_id = 'tenant-documents'
  and split_part(name, '/', 1) = 'documents'
  and public.can_access_building(nullif(split_part(name, '/', 2), '')::uuid)
);
create policy "td write tenant docs" on storage.objects for insert with check (
  bucket_id = 'tenant-documents'
  and split_part(name, '/', 1) = 'tenant-docs'
  and exists (
    select 1 from public.building_tenants bt
    where bt.id = nullif(split_part(name, '/', 2), '')::uuid
      and public.can_access_building(bt.building_id)
  )
);
create policy "td write contractor docs" on storage.objects for insert with check (
  bucket_id = 'tenant-documents'
  and split_part(name, '/', 1) = 'contractor-docs'
  and public.is_admin_or_manager()
);
create policy "td write own photos" on storage.objects for insert with check (
  bucket_id = 'tenant-documents'
  and split_part(name, '/', 1) = 'photos'
  and split_part(name, '/', 2) = auth.uid()::text
);

-- UPDATE/DELETE: admin or manager only, whole bucket
create policy "td update admin" on storage.objects for update using (
  bucket_id = 'tenant-documents' and public.is_admin_or_manager()
);
create policy "td delete admin" on storage.objects for delete using (
  bucket_id = 'tenant-documents' and public.is_admin_or_manager()
);

-- ── logo/avatar buckets: keep public read; gate writes ──
drop policy if exists "Auth upload logos" on storage.objects;
drop policy if exists "Auth update logos" on storage.objects;
drop policy if exists "Auth delete logos" on storage.objects;
create policy "org logos admin write" on storage.objects for insert with check (
  bucket_id = 'organization-logos' and public.is_admin_or_manager()
);
create policy "org logos admin update" on storage.objects for update using (
  bucket_id = 'organization-logos' and public.is_admin_or_manager()
);
create policy "org logos admin delete" on storage.objects for delete using (
  bucket_id = 'organization-logos' and public.is_admin_or_manager()
);

drop policy if exists "web buckets auth write"  on storage.objects;
drop policy if exists "web buckets auth update" on storage.objects;
drop policy if exists "web buckets auth delete" on storage.objects;
create policy "web buckets write" on storage.objects for insert with check (
  bucket_id = 'building-logos' and public.is_admin_or_manager()
  or (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text)
);
create policy "web buckets update" on storage.objects for update using (
  bucket_id = 'building-logos' and public.is_admin_or_manager()
  or (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text)
);
create policy "web buckets delete" on storage.objects for delete using (
  bucket_id = 'building-logos' and public.is_admin_or_manager()
  or (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text)
);

commit;
