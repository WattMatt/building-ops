-- ============================================================================
-- Fortress Reporting — 19: reconcile a FOREIGN §6 delta to canonical.
-- A non-canonical §6 delta reached prod mid-session (hazard_log with report_id and
-- no sort_order; report_checklist_items/local_resources_contacts/inspection_subitems
-- missing sort_order; generator_responsibility CHECK = 'landlord'). The six §6 tables
-- were EMPTY and unreferenced. Owner decision (2026-06-13): "canonical wins" — drop the
-- empty §6 tables so 2026-06-13_15 recreates them canonically, and normalize the
-- tenant_compliance.generator_responsibility CHECK to 'll'.
--
-- MUST be applied immediately followed by _15.._18 (which recreate + re-seed the tables).
-- Universally safe + idempotent: each §6 table is dropped ONLY if it exists AND is empty
-- (so on an env where _18 already seeded building_turnover/report_checklist_items, those
-- are preserved). The generator_responsibility constraint swap is drop-if-exists + add.
-- ============================================================================

-- 1) drop empty §6 tables (cascade drops their policies/indexes/triggers + any dependent view)
do $$
declare t text; cnt int;
begin
  foreach t in array array['building_turnover','category_turnover','hazard_log',
                           'report_checklist_items','local_resources_contacts','inspection_subitems'] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('select count(*) from public.%I', t) into cnt;
      if cnt = 0 then
        execute format('drop table public.%I cascade', t);
      end if;
    end if;
  end loop;
end $$;

-- 2) normalize tenant_compliance.generator_responsibility CHECK ('landlord' -> 'll')
alter table public.tenant_compliance
  drop constraint if exists tenant_compliance_generator_responsibility_check;
alter table public.tenant_compliance
  add  constraint tenant_compliance_generator_responsibility_check
  check (generator_responsibility in ('tenant','ll','na'));
