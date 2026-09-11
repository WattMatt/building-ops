-- 2026-08-04_03_remaining_hot_indexes.sql
-- Audit remediation (2026-08-04), follow-up to _02. Additive; idempotent.
--
-- The _02 sweep covered the highest-volume FKs. This adds the remaining ones
-- that sit on an actual iOS/web request path. The ~35 still-unindexed FKs left
-- after this are all on report-scoped Fortress tables that are written once per
-- report and read by report id -- deliberately left alone rather than indexing
-- every FK on principle.

begin;

-- Storage-policy hot path: the tenant-docs prefix policy runs an EXISTS against
-- tenant_documents -> building_tenants on every signed-URL request.
create index if not exists idx_tenant_documents_tenant     on public.tenant_documents (tenant_id);

-- Contractor detail screen lists a contractor's certificates on every open.
create index if not exists idx_contractor_documents_contractor on public.contractor_documents (contractor_id);

-- Asset maintenance history tab.
create index if not exists idx_asset_service_history_asset on public.asset_service_history (asset_id);

-- Org-scoped reads done on every task generation run and contractor list load.
create index if not exists idx_checklist_templates_org     on public.checklist_templates (organization_id);
create index if not exists idx_contractors_org             on public.contractors (organization_id);

-- Issue activity timeline is read by issue; author lookups join on user_id.
create index if not exists idx_issue_activity_user         on public.issue_activity (user_id);

-- Building document expiry alerts filter on (building_id, expiry_date).
create index if not exists idx_building_documents_expiry   on public.building_documents (building_id, expiry_date);

commit;
