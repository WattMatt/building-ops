-- 2026-06-13_14_delete_zztest_buildings.sql
-- Remove the two ZZTEST pilot/mock buildings from production.
--
--   ZZTEST-Sandton Gate    aaaa1111-0000-4000-8000-000000000001
--   ZZTEST-Rosebank Mews   aaaa1111-0000-4000-8000-000000000002
--
-- These were seeded by 2026-06-11_04_seed_pilot_data.sql for the pilot and are
-- no longer wanted now that AbaQulusi Plaza is the live demo building.
--
-- FK behaviour (verified against prod information_schema): every building-scoped
-- child of `buildings` is ON DELETE CASCADE (building_assets -> asset_service_history,
-- building_tenants -> tenant_compliance/documents/shop_spec, issues -> issue_activity,
-- task_instances -> task_completions, building_documents, user_buildings, reports,
-- and all fortress reporting tables). The ONLY non-cascading direct child is
-- form_submissions.building_id (NO ACTION), so it is cleared first.
--
-- Org-scoped reference data the pilot seed also created (checklist_templates,
-- template_items, contractors, contractor_documents) is intentionally NOT deleted:
-- it is shared org data, not building-specific.
--
-- Reversible: re-apply sql/2026-06-11_04_seed_pilot_data.sql to recreate the
-- seeded rows (app-generated task_instances will regenerate).

begin;

delete from public.form_submissions
where  building_id in (
         'aaaa1111-0000-4000-8000-000000000001',
         'aaaa1111-0000-4000-8000-000000000002');

delete from public.buildings
where  id in (
         'aaaa1111-0000-4000-8000-000000000001',
         'aaaa1111-0000-4000-8000-000000000002');

commit;
