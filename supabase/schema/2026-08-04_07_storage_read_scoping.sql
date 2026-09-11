-- 2026-08-04_07_storage_read_scoping.sql
-- Audit remediation (2026-08-04). Security fix. Idempotent.
-- Apply order: staging -> verify -> prod.
--
-- A-08  Three storage read policies gate on nothing more than "is someone logged
--       in", so ANY authenticated principal can list and read every evidence
--       photo, contractor document and drawn signature in the entire portfolio.
--
--       Pre-fix (verified live on prod):
--         td read contractor docs and photos : prefix IN (contractor-docs, photos)
--                                              AND auth.uid() IS NOT NULL
--         td read signatures                 : prefix = signatures
--                                              AND auth.uid() IS NOT NULL
--
--       Their sibling policies already do this properly --
--       `td read building docs` and `td read tenant docs` both resolve the
--       building from the object path and call can_access_building(). These three
--       were simply never brought up to that standard.
--
--       Because the same policy governs the storage list/search API, a
--       site-restricted user or reviewer assigned to a single building can
--       enumerate and download every other building's evidence.
--
-- SAFE TO APPLY NOW: every current production user holds the admin role (5/5),
-- so is_admin_or_manager() is true for all of them and no existing read path
-- changes. This closes the hole before the first site-restricted user is invited,
-- which is exactly when it would begin to matter.

begin;

-- ---------------------------------------------------------------------------
-- photos/<uploader_uid>/...  and  contractor-docs/...
--
-- The photos path encodes the uploader, not a building, so building scoping is
-- not derivable from the key. Uploader-or-privileged is the tightest correct
-- rule available without a path-convention change: field staff keep reading
-- back their own evidence, admins and managers keep seeing everything.
--
-- Contractor documents are org-level compliance records managed by admin and
-- manager only (their INSERT policy is already so restricted), so reads match.
drop policy if exists "td read contractor docs and photos" on storage.objects;

create policy "td read own photos"
  on storage.objects for select
  using (
    bucket_id = 'tenant-documents'
    and split_part(name, '/', 1) = 'photos'
    and (
      split_part(name, '/', 2) = auth.uid()::text
      or public.is_admin_or_manager()
    )
  );

create policy "td read contractor docs"
  on storage.objects for select
  using (
    bucket_id = 'tenant-documents'
    and split_part(name, '/', 1) = 'contractor-docs'
    and public.is_admin_or_manager()
  );

-- ---------------------------------------------------------------------------
-- signatures/<submission_id>/<signer_uid>/...
--
-- Here the building IS derivable: the second path segment is the
-- form_submissions id, which carries building_id. So this one gets the same
-- can_access_building() treatment as building docs and tenant docs, plus a
-- signer-can-always-read-their-own-signature escape and an admin/manager
-- fallback (the latter also keeps signatures readable if the submission row is
-- ever deleted).
drop policy if exists "td read signatures" on storage.objects;

create policy "td read signatures"
  on storage.objects for select
  using (
    bucket_id = 'tenant-documents'
    and split_part(name, '/', 1) = 'signatures'
    and (
      split_part(name, '/', 3) = auth.uid()::text
      or public.is_admin_or_manager()
      or exists (
        select 1
        from public.form_submissions fs
        where fs.id = nullif(split_part(storage.objects.name, '/', 2), '')::uuid
          and public.can_access_building(fs.building_id)
      )
    )
  );

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK (restores the previous any-authenticated-user reads):
--   drop policy if exists "td read own photos"       on storage.objects;
--   drop policy if exists "td read contractor docs"  on storage.objects;
--   drop policy if exists "td read signatures"       on storage.objects;
--   create policy "td read contractor docs and photos" on storage.objects for select
--     using (bucket_id = 'tenant-documents'
--            and split_part(name,'/',1) = any (array['contractor-docs','photos'])
--            and auth.uid() is not null);
--   create policy "td read signatures" on storage.objects for select
--     using (bucket_id = 'tenant-documents'
--            and split_part(name,'/',1) = 'signatures'
--            and auth.uid() is not null);
