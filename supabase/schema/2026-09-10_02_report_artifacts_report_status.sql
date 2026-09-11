-- 2026-09-10_02_report_artifacts_report_status.sql
-- Record the lifecycle state of the source report at export time (finding E2), so a PDF
-- issued from a draft is distinguishable from one issued after approval — in the app
-- and in the version list. Nullable: pre-existing rows and non-Fortress kinds have none.
-- Idempotent. Apply order: staging (vkrihpmjajjcxmzgjqdr) -> verify -> prod (qdzgkttiosahdfqresvz).
begin;

alter table public.report_artifacts
  add column if not exists report_status text
  check (report_status is null or report_status in ('draft','submitted','reviewed','approved','rejected'));

comment on column public.report_artifacts.report_status is
  'Status of the source report when this PDF was generated; null for ad-hoc kinds.';

commit;
