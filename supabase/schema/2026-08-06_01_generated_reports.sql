-- 2026-08-06_01_generated_reports.sql
-- PDF standardization (standard D1/D2): persistent, versioned report artifacts.
-- Private storage bucket `generated-reports` + `report_artifacts` history table.
-- Idempotent. Apply order: staging (vkrihpmjajjcxmzgjqdr) -> verify -> prod
-- (qdzgkttiosahdfqresvz), via the Supabase Management API per project practice.
--
-- Access model mirrors the app's existing scoping (this project is single-org;
-- there is no per-user org membership — RLS everywhere else gates on the
-- SECURITY DEFINER helpers): admin/manager see everything; site-restricted
-- users see artifacts only for buildings they can access via
-- can_access_building(); portfolio-level artifacts (building_id is null) are
-- admin/manager-only. Storage reads are derived from the linked
-- report_artifacts row (same pattern as the `td read signatures` policy in
-- 2026-08-04_07_storage_read_scoping.sql).
--
-- Fail-closed contract (client side, src/lib/reportArtifacts.ts):
--   upload (upsert:false) -> insert row -> on insert failure remove the
--   uploaded object -> supersede prior issued rows of the same (kind, source).
-- The partial-unique index below makes the version chain race-safe: a
-- concurrent duplicate insert fails, the client removes its orphan upload.

begin;

-- ---------------------------------------------------------------------------
-- 1) Private bucket: generated PDFs only, 50 MB cap.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('generated-reports', 'generated-reports', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 52428800,
      allowed_mime_types = array['application/pdf'];

-- ---------------------------------------------------------------------------
-- 2) Artifact history table.
create table if not exists public.report_artifacts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id),
  kind          text not null,
  source_id     uuid,
  building_id   uuid references public.buildings(id) on delete set null,
  version       int  not null default 1,
  file_path     text not null,
  file_name     text not null,
  size_bytes    bigint not null,
  generated_by  uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  status        text not null default 'issued',
  superseded_by uuid references public.report_artifacts(id),
  constraint report_artifacts_status_check   check (status in ('issued', 'superseded')),
  constraint report_artifacts_version_check  check (version >= 1),
  constraint report_artifacts_size_check     check (size_bytes >= 0),
  constraint report_artifacts_file_path_uniq unique (file_path)
);

-- One row per (org, kind, source, version). source_id is nullable (portfolio
-- summary has no source row), so a plain unique constraint would not bite —
-- coalesce to a sentinel uuid instead.
create unique index if not exists report_artifacts_version_uniq
  on public.report_artifacts
  (org_id, kind, coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid), version);

create index if not exists report_artifacts_list_idx
  on public.report_artifacts (org_id, created_at desc);
create index if not exists report_artifacts_building_idx
  on public.report_artifacts (building_id);

alter table public.report_artifacts enable row level security;

-- READ: admin/manager see all; site-restricted users see building-scoped
-- artifacts for their buildings. Portfolio-level rows are admin/manager-only.
drop policy if exists "ra read scoped" on public.report_artifacts;
create policy "ra read scoped"
  on public.report_artifacts for select
  using (
    public.is_admin_or_manager()
    or (building_id is not null and public.can_access_building(building_id))
  );

-- INSERT: a user records only their own generations, within the same scope
-- they can read (building access, or admin/manager for portfolio-level rows).
drop policy if exists "ra insert own" on public.report_artifacts;
create policy "ra insert own"
  on public.report_artifacts for insert
  with check (
    generated_by = auth.uid()
    and (
      public.is_admin_or_manager()
      or (building_id is not null and public.can_access_building(building_id))
    )
  );

-- UPDATE: only for the supersede step — whoever may generate in a scope may
-- close prior versions in that scope. Rows stay within the two known states.
drop policy if exists "ra supersede scoped" on public.report_artifacts;
create policy "ra supersede scoped"
  on public.report_artifacts for update
  using (
    public.is_admin_or_manager()
    or (building_id is not null and public.can_access_building(building_id))
  )
  with check (status in ('issued', 'superseded'));

-- DELETE: admin only (artifact history is meant to be immutable).
drop policy if exists "ra delete admin" on public.report_artifacts;
create policy "ra delete admin"
  on public.report_artifacts for delete
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3) Storage policies for generated-reports.
-- Object path convention: <org_id>/<kind>/<timestamp>-<sanitized-name>.pdf
-- The path does not encode a building, so reads resolve access through the
-- linked report_artifacts row; the uploader can always read back their own
-- object (covers the window before/while the row insert lands).
drop policy if exists "gr read scoped" on storage.objects;
create policy "gr read scoped"
  on storage.objects for select
  using (
    bucket_id = 'generated-reports'
    and (
      public.is_admin_or_manager()
      or owner = auth.uid()
      or exists (
        select 1
        from public.report_artifacts ra
        where ra.file_path = storage.objects.name
          and ra.building_id is not null
          and public.can_access_building(ra.building_id)
      )
    )
  );

-- INSERT: any authenticated org user may upload a generated report (the
-- report_artifacts insert policy is the authorization chokepoint — an object
-- without a row is readable only by its uploader and admins, and the client
-- removes it on row-insert failure).
drop policy if exists "gr write authed" on storage.objects;
create policy "gr write authed"
  on storage.objects for insert
  with check (
    bucket_id = 'generated-reports'
    and auth.uid() is not null
  );

-- DELETE: uploader (orphan cleanup on failed saves) or admin/manager.
drop policy if exists "gr delete own or admin" on storage.objects;
create policy "gr delete own or admin"
  on storage.objects for delete
  using (
    bucket_id = 'generated-reports'
    and (owner = auth.uid() or public.is_admin_or_manager())
  );

-- No UPDATE policy on purpose: artifacts are immutable (upsert:false).

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   drop policy if exists "gr read scoped"          on storage.objects;
--   drop policy if exists "gr write authed"         on storage.objects;
--   drop policy if exists "gr delete own or admin"  on storage.objects;
--   drop table if exists public.report_artifacts;
--   delete from storage.objects where bucket_id = 'generated-reports';
--   delete from storage.buckets where id = 'generated-reports';
