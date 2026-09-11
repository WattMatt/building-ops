-- 2026-08-04_02_integrity_and_indexes.sql
-- Audit remediation (2026-08-04). Purely additive; idempotent; safe to re-run.
-- Apply order: staging -> verify -> prod.
--
-- A-04  building_tenants has no unique key, so re-importing a roster silently
--       duplicates every tenant.
-- A-05  Foreign-key and hot-filter columns are unindexed, so every
--       building-scoped list and every cascade seq-scans.

begin;

-- ---------------------------------------------------------------------------
-- A-04: make tenant import idempotent
--
-- sql/2026-06-18_01 noted explicitly that building_tenants has NO unique
-- constraint on (building_id, shop_number). TenantImportView bulk-POSTs with no
-- dedup and no on_conflict, so re-importing an updated roster -- a routine
-- action -- doubles every tenant with no warning.
--
-- Precondition verified on prod 2026-08-04: 59 rows, 0 null shop_number,
-- 0 duplicate (building_id, shop_number) groups. The index applies cleanly.
--
-- Partial (WHERE shop_number IS NOT NULL) so tenants legitimately lacking a
-- shop number are still insertable and don't collide with each other.
create unique index if not exists building_tenants_building_shop_uniq
  on public.building_tenants (building_id, shop_number)
  where shop_number is not null;

-- ---------------------------------------------------------------------------
-- A-05: index the hot FK / filter columns
--
-- Volumes are small today, so these are cheap to create now and prevent the
-- cliff later. building_tenants(building_id) additionally backs the
-- tenant-docs storage policy's EXISTS probe, which runs on every signed-URL
-- request for a tenant document.
create index if not exists idx_building_tenants_building      on public.building_tenants (building_id);
create index if not exists idx_form_submissions_building      on public.form_submissions (building_id);
create index if not exists idx_form_submissions_status        on public.form_submissions (status);
create index if not exists idx_task_instances_template_item   on public.task_instances (template_item_id);
create index if not exists idx_task_instances_source_document on public.task_instances (source_document_id);
create index if not exists idx_template_items_template        on public.template_items (template_id);
create index if not exists idx_issues_task_instance           on public.issues (task_instance_id);
create index if not exists idx_building_documents_building    on public.building_documents (building_id);
create index if not exists idx_building_assets_building       on public.building_assets (building_id);
create index if not exists idx_building_notes_building        on public.building_notes (building_id);
create index if not exists idx_user_buildings_building        on public.user_buildings (building_id);
create index if not exists idx_buildings_organization         on public.buildings (organization_id);
create index if not exists idx_tenant_compliance_tenant       on public.tenant_compliance (tenant_id);
create index if not exists idx_tenant_shop_spec_building      on public.tenant_shop_spec (building_id);
create index if not exists idx_masterfile_items_report        on public.masterfile_items (report_id);
create index if not exists idx_masterfile_items_document      on public.masterfile_items (document_id);
create index if not exists idx_inspection_responses_item      on public.inspection_responses (template_item_id);
create index if not exists idx_compliance_responses_item      on public.compliance_responses (template_item_id);

-- Dashboard/report hot paths: "completed today" and per-building task lists.
create index if not exists idx_task_instances_status_due      on public.task_instances (status, due_date);
create index if not exists idx_task_instances_building_status on public.task_instances (building_id, status);

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   drop index if exists public.building_tenants_building_shop_uniq;
--   (and drop any idx_* above; all are additive and safe to leave in place)
