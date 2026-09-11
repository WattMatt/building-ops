-- 2026-06-18_08: explicit foreign tables for insight-linker DOCUMENT tables.
-- Per-subsection documents (COC certs + general electrical files) and site-level
-- documents. Files live in insight-linker's PUBLIC `documents` bucket -> URLs render
-- directly. Read-only. Requires 2026-06-15_05 (server + user mapping) applied first.
-- Re-runnable. Only the columns the integration reads are declared (all base types).
-- NOTE: site_documents has NO file_size column in insight-linker (verified 2026-06-18).

drop foreign table if exists insight_linker.subsection_documents;
drop foreign table if exists insight_linker.site_documents;

create foreign table insight_linker.subsection_documents (
  subsection_id   uuid,
  file_name       text,
  file_url        text,
  file_size       bigint,
  uploaded_at     timestamptz,
  coc_number      text,
  coc_type        text,
  coc_status      text,
  coc_issue_date  date,
  coc_expiry_date date
) server insight_linker_srv options (schema_name 'public', table_name 'subsection_documents');

create foreign table insight_linker.site_documents (
  site_id   uuid,
  file_name text,
  file_url  text
) server insight_linker_srv options (schema_name 'public', table_name 'site_documents');
