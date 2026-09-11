-- 2026-06-14_02_signoff_storage.sql
-- Scoped storage policies for drawn signature images in the private tenant-documents bucket.
-- Path convention: signatures/<submission_id>/<signer_id>/<file>
-- Mirrors 2026-06-11_03_storage_scoping.sql. Apply to STAGING first; PROD on owner sign-off.

create policy "td read signatures" on storage.objects for select using (
  bucket_id = 'tenant-documents'
  and split_part(name, '/', 1) = 'signatures'
  and auth.uid() is not null
);

create policy "td write own signatures" on storage.objects for insert with check (
  bucket_id = 'tenant-documents'
  and split_part(name, '/', 1) = 'signatures'
  and split_part(name, '/', 3) = auth.uid()::text
);

create policy "td delete signatures admin" on storage.objects for delete using (
  bucket_id = 'tenant-documents'
  and split_part(name, '/', 1) = 'signatures'
  and public.is_admin_or_manager()
);
