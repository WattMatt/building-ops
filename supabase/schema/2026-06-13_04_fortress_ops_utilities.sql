-- ============================================================================
-- Fortress Reporting — 04: operational & utilities (OPS report sections)
-- Finalized from fortress/sql-drafts/F03_to_F08_STUBS.sql §F04 + 01_SCHEMA.md §5.
-- Decisions baked in: R-08 natural unique keys, R-14 timestamps + triggers.
-- masterfile_items: register of completeness — standalone per-building with
-- nullable report_id so a report can pin its snapshot (01_SCHEMA §5.6 note).
-- Idempotent: re-runnable end to end. Requires 2026-06-13_01 (touch fn).
-- ============================================================================

create table if not exists public.expense_recoveries (
    id                  uuid primary key default gen_random_uuid(),
    report_id           uuid references public.reports(id) on delete cascade,
    building_id         uuid not null references public.buildings(id) on delete cascade,
    service             text,                  -- AIRCON SERVICE, GENERATOR ...
    ytd_expense         numeric,
    ytd_recovery        numeric,
    pct_recovery        numeric,
    budget_pct_recovery numeric,
    records_uploaded    bool,
    fault_found         text,
    date_fault_reported date,
    date_fault_repaired date,
    comment             text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create table if not exists public.utility_readings (
    id          uuid primary key default gen_random_uuid(),
    report_id   uuid references public.reports(id) on delete cascade,
    building_id uuid not null references public.buildings(id) on delete cascade,
    utility     text check (utility in ('water','electricity')),
    meter_name  text,                          -- Council Bulk, Bulk Check, Borehole ...
    reading     numeric,
    unit        text,                          -- KL / KWh
    category    text check (category in ('bulk','common_area','tenant','night_usage','unmetered')),
    pct_of_bulk numeric,
    comment     text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists public.utility_yields (
    id              uuid primary key default gen_random_uuid(),
    report_id       uuid references public.reports(id) on delete cascade,
    building_id     uuid not null references public.buildings(id) on delete cascade,
    source          text check (source in ('borehole','solar')),
    predicted_yield numeric,
    actual_yield    numeric,
    pct_achieved    numeric,
    unit            text,
    comment         text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create table if not exists public.loadshedding_log (
    id            uuid primary key default gen_random_uuid(),
    report_id     uuid references public.reports(id) on delete cascade,
    building_id   uuid not null references public.buildings(id) on delete cascade,
    day           date,
    week_no       int,
    stage         text,
    hours         numeric,
    diesel_litres numeric,
    diesel_date   date,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create table if not exists public.service_interruptions (
    id                uuid primary key default gen_random_uuid(),
    report_id         uuid references public.reports(id) on delete cascade,
    building_id       uuid not null references public.buildings(id) on delete cascade,
    date              date,
    interruption_type text,                    -- Cable theft ...
    start_time        time,
    end_time          time,
    total_hours       numeric,
    council_ref       text,
    comment           text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create table if not exists public.masterfile_items (
    id             uuid primary key default gen_random_uuid(),
    report_id      uuid references public.reports(id) on delete set null,
    building_id    uuid not null references public.buildings(id) on delete cascade,
    document_label text,                       -- Zoning certificate, Occupation certificate, COC ...
    on_file        bool,
    comment        text,
    responsible    text,
    document_id    uuid references public.building_documents(id),
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

-- ---- indexes + natural unique keys (R-08) -----------------------------------
create unique index if not exists expense_recoveries_uq on public.expense_recoveries (report_id, service);
create unique index if not exists utility_readings_uq   on public.utility_readings (report_id, utility, meter_name, category);
create unique index if not exists utility_yields_uq     on public.utility_yields (report_id, source);
create unique index if not exists masterfile_items_uq   on public.masterfile_items (building_id, document_label, coalesce(report_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists loadshedding_log_report_idx      on public.loadshedding_log (report_id);
create index if not exists service_interruptions_report_idx on public.service_interruptions (report_id);

-- ---- RLS (§9 standard block) + touch triggers (R-14) -------------------------
do $$ declare t text;
begin
  foreach t in array array['expense_recoveries','utility_readings','utility_yields',
                           'loadshedding_log','service_interruptions','masterfile_items'] loop
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
