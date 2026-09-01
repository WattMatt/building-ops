-- ============================================================================
-- Fortress Reporting — 06: per-tenant records (CM — slowly changing)
-- Finalized from fortress/sql-drafts/F03_to_F08_STUBS.sql §F06 + 01_SCHEMA.md §7.
-- Decisions baked in (fortress/build/PLAN_LOCK.md):
--   R-09 service-status columns are 3-STATE TEXT check (yes/no/na) — source
--        OHS&HK cells are Y/N/N-A; bool+null conflates "N/A" with "unanswered".
--   R-14 timestamps + touch triggers; R-08 natural unique keys.
-- tenant_shop_spec is versioned (is_current + effective_from) — specs change
-- on refit, not monthly; not tied to report_id.
-- Idempotent: re-runnable end to end. Requires 2026-06-13_01 (touch fn).
-- ============================================================================

create table if not exists public.tenant_compliance (
    id                            uuid primary key default gen_random_uuid(),
    report_id                     uuid references public.reports(id) on delete set null,
    building_id                   uuid not null references public.buildings(id) on delete cascade,
    tenant_id                     uuid not null references public.building_tenants(id) on delete cascade,
    period                        date,
    occupancy_cert_no             text,
    occupancy_cert_date           date,
    electrical_coc_cert_no        text,
    electrical_coc_responsibility text,        -- tenant / ll
    -- R-09: 3-state service-status columns (source cells are Y / N / N-A)
    hvac_records_current          text check (hvac_records_current in ('yes','no','na')),
    hvac_handover_month           text,
    hvac_responsibility           text,
    generator_records_current     text check (generator_records_current in ('yes','no','na')),
    generator_dedicated           text check (generator_dedicated in ('yes','no','na')),
    fire_sprinkler_weekly         text check (fire_sprinkler_weekly in ('yes','no','na')),
    fire_sprinkler_annual         text check (fire_sprinkler_annual in ('yes','no','na')),
    fire_sprinkler_3yr            text check (fire_sprinkler_3yr in ('yes','no','na')),
    smoke_extraction_current      text check (smoke_extraction_current in ('yes','no','na')),
    smoke_detection_current       text check (smoke_detection_current in ('yes','no','na')),
    handheld_fire_current         text check (handheld_fire_current in ('yes','no','na')),
    ohs_risks                     text,        -- stacking heights / DB boards
    evac_plan_displayed           text check (evac_plan_displayed in ('yes','no','na')),
    food_extraction_cert          text check (food_extraction_cert in ('yes','no','na')),
    grease_trap_clean             text check (grease_trap_clean in ('yes','no','na')),
    fire_blanket                  text check (fire_blanket in ('yes','no','na')),
    gas_coc                       text check (gas_coc in ('yes','no','na')),
    flammable_liquid_cert         text check (flammable_liquid_cert in ('yes','no','na')),
    comment                       text,
    created_at                    timestamptz not null default now(),
    updated_at                    timestamptz not null default now()
);

create table if not exists public.tenant_shop_spec (
    id                   uuid primary key default gen_random_uuid(),
    building_id          uuid not null references public.buildings(id) on delete cascade,
    tenant_id            uuid not null references public.building_tenants(id) on delete cascade,
    effective_from       date,
    is_current           bool not null default true,
    db_phase             text,                 -- single / three
    actual_amps          text,
    lease_amps           text,
    generator_connection bool,
    hvac_units           text,
    hvac_btu             text,
    hvac_gas             text,
    lighting_type        text,
    shopfront_type       text,
    roller_shutter_type  text,
    ceiling_structure    text,
    ceiling_height       text,
    floor_finish         text,
    walls                text,
    wall_finish          text,
    plumbing_toilets     int,
    plumbing_sink        text,
    notes                text,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);

-- ---- indexes + natural unique keys (R-08) -----------------------------------
create unique index if not exists tenant_compliance_uq on public.tenant_compliance (building_id, tenant_id, period);
create unique index if not exists tenant_shop_spec_current_uq
    on public.tenant_shop_spec (tenant_id) where is_current;   -- one current spec per tenant
create index if not exists tenant_compliance_report_idx on public.tenant_compliance (report_id);

-- ---- RLS (§9 standard block) + touch triggers (R-14) -------------------------
do $$ declare t text;
begin
  foreach t in array array['tenant_compliance','tenant_shop_spec'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t||'_read', t);
    execute format('create policy %I on public.%I for select using (can_access_building(building_id));', t||'_read', t);
    execute format('drop policy if exists %I on public.%I;', t||'_ins', t);
    execute format('create policy %I on public.%I for insert with check (is_admin_or_manager() or can_access_building(building_id));', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I;', t||'_upd', t);
    execute format('create policy %I on public.%I for update using (is_admin_or_manager() or can_access_building(building_id));', t||'_upd', t);
    execute format('drop policy if exists %I on public.%I;', t||'_del', t);
    execute format('create policy %I on public.%I for delete using (is_admin());', t||'_del', t);
    execute format('drop trigger if exists %I on public.%I;', 'trg_'||t||'_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.fortress_touch_updated_at();', 'trg_'||t||'_touch', t);
  end loop;
end $$;
