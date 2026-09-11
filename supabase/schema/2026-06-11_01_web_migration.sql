-- Migration: reconcile GMI-ops schema to support the web app (migrating it off
-- its Lovable backend onto GMI-ops as the single source of truth).
-- All changes are ADDITIVE — no column drops, no data loss.
-- Applied: 2026-06-11 via Supabase Management API.

begin;

-- 1. form_submissions.photo_urls — web app stores photo evidence on submissions
alter table public.form_submissions add column if not exists photo_urls jsonb;

-- 2. tenant_documents — web app tracks file metadata the iOS app doesn't
alter table public.tenant_documents add column if not exists file_name text;
alter table public.tenant_documents add column if not exists file_size bigint;
alter table public.tenant_documents add column if not exists issue_date date;
-- (web code is being aligned to GMI-ops's `document_name`; no `name` column added)

-- 3. Realtime — web app subscribes to live changes on these two tables
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='organizations') then
    alter publication supabase_realtime add table public.organizations;
  end if;
end $$;

-- 4. Storage buckets the web app expects (low-sensitivity → public, like organization-logos)
insert into storage.buckets (id, name, public)
  values ('building-logos','building-logos', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('avatars','avatars', true)
  on conflict (id) do nothing;

-- Storage policies: authenticated users manage these buckets; anyone reads (public branding/avatars)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='web buckets public read') then
    create policy "web buckets public read" on storage.objects
      for select using (bucket_id in ('building-logos','avatars'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='web buckets auth write') then
    create policy "web buckets auth write" on storage.objects
      for insert with check (bucket_id in ('building-logos','avatars') and auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='web buckets auth update') then
    create policy "web buckets auth update" on storage.objects
      for update using (bucket_id in ('building-logos','avatars') and auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='web buckets auth delete') then
    create policy "web buckets auth delete" on storage.objects
      for delete using (bucket_id in ('building-logos','avatars') and auth.uid() is not null);
  end if;
end $$;

commit;
