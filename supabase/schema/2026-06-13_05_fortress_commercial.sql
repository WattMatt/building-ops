-- ============================================================================
-- Fortress Reporting — 05: commercial / trading (CM report sections)
-- Finalized from fortress/sql-drafts/F03_to_F08_STUBS.sql §F05 + 01_SCHEMA.md §6.
-- Decisions baked in: R-04 tenant identity via building_tenants FK + snapshot
-- columns, R-08 natural unique keys, R-14 timestamps + triggers,
-- R-15 28-value incident_type CHECK (prevents typo fragmentation in the matrix).
-- Idempotent: re-runnable end to end. Requires 2026-06-13_01 (touch fn).
-- ============================================================================

create table if not exists public.tenant_turnover (
    id                     uuid primary key default gen_random_uuid(),
    report_id              uuid references public.reports(id) on delete cascade,
    building_id            uuid not null references public.buildings(id) on delete cascade,
    tenant_id              uuid references public.building_tenants(id),
    tenant_name            text,
    gla                    numeric,            -- point-in-time snapshot (live value: building_tenants.area, TEXT — cast on read)
    monthly_avg_turnover   numeric,
    annual_trading_density numeric,
    coo_pct                numeric,            -- cost of occupancy
    annual_growth_pct      numeric,
    rank_band              text check (rank_band in ('anchor','top5','bottom5','other')),
    comment                text,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);

create table if not exists public.footfall_counts (
    id           uuid primary key default gen_random_uuid(),
    report_id    uuid references public.reports(id) on delete cascade,
    building_id  uuid not null references public.buildings(id) on delete cascade,
    entrance     text,                         -- Public Toilets, Bus Rank, Total
    month_count  int,
    ytd_count    int,
    prev_ytd     int,
    variance_pct numeric,
    source       text,                         -- footcount system / ticksheet
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create table if not exists public.toilet_fund (
    id                  uuid primary key default gen_random_uuid(),
    report_id           uuid references public.reports(id) on delete cascade,
    building_id         uuid not null references public.buildings(id) on delete cascade,
    issued_bales        int,
    stock_on_hand_bales int,
    actual_banked       numeric,
    budget              numeric,
    variance            numeric,
    profit_per_roll     numeric,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create table if not exists public.vacancies (
    id                uuid primary key default gen_random_uuid(),
    report_id         uuid references public.reports(id) on delete cascade,
    building_id       uuid not null references public.buildings(id) on delete cascade,
    shop_no           text,
    area              numeric,
    budget_relet_rpm  numeric,
    gross_mandate_rpm numeric,
    comment           text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create table if not exists public.leasing_waitlist (
    id           uuid primary key default gen_random_uuid(),
    report_id    uuid references public.reports(id) on delete cascade,
    building_id  uuid not null references public.buildings(id) on delete cascade,
    trading_as   text,
    contact      text,
    category     text,
    optimal_size text,
    comment      text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create table if not exists public.tenant_movements (
    id                     uuid primary key default gen_random_uuid(),
    report_id              uuid references public.reports(id) on delete cascade,
    building_id            uuid not null references public.buildings(id) on delete cascade,
    tenant_id              uuid references public.building_tenants(id),
    trading_as             text,
    movement_type          text check (movement_type in ('new','vacate','beneficial_occupation')),
    vacate_or_bo_date      date,
    prelim_inspection_date date,
    take_on_back_date      date,
    first_trade_date       date,
    comment                text,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);

create table if not exists public.trading_hour_breaches (
    id             uuid primary key default gen_random_uuid(),
    report_id      uuid references public.reports(id) on delete cascade,
    building_id    uuid not null references public.buildings(id) on delete cascade,
    tenant_name    text,
    date           date,
    time           time,
    letter_sent_to text,
    comment        text,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

create table if not exists public.tenant_arrears (
    id              uuid primary key default gen_random_uuid(),
    report_id       uuid references public.reports(id) on delete cascade,
    building_id     uuid not null references public.buildings(id) on delete cascade,
    tenant_id       uuid references public.building_tenants(id),
    trading_as      text,
    deposit_held    numeric,
    closing_balance numeric,
    contact         text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create table if not exists public.security_incidents (
    id            uuid primary key default gen_random_uuid(),
    report_id     uuid references public.reports(id) on delete cascade,
    building_id   uuid not null references public.buildings(id) on delete cascade,
    period        date,                        -- the incident month (YYYY-MM-01)
    incident_type text check (incident_type in (         -- R-15: the 28 documented values
        'arrests','sexual_harassment','after_hours_break_in','attempted_motor_theft',
        'motor_theft','break_in_theft','snatch_and_grab','weapon_discharge',
        'motor_accident','armed_robbery','robbery','unsecure_premises',
        'shoplifting','assault_fight','lost_property','property_damage',
        'medical','fraud','refuse_to_pay','theft',
        'vehicle_jamming','drinking_in_public','public_indecency','atm_robbery',
        'atm_bombing','cable_theft','malicious_damage','other')),
    count         int,
    narrative     text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    unique (building_id, period, incident_type)
);

create table if not exists public.capex_items (
    id          uuid primary key default gen_random_uuid(),
    report_id   uuid references public.reports(id) on delete cascade,
    building_id uuid not null references public.buildings(id) on delete cascade,
    item        text,
    motivation  text,
    estimate    numeric,
    year        int,
    priority    text,
    status      text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- ---- indexes + natural unique keys (R-08) -----------------------------------
create unique index if not exists tenant_turnover_uq  on public.tenant_turnover (report_id, tenant_id);
create unique index if not exists footfall_counts_uq  on public.footfall_counts (report_id, entrance);
create unique index if not exists tenant_movements_uq on public.tenant_movements (report_id, trading_as);
create unique index if not exists tenant_arrears_uq   on public.tenant_arrears (report_id, trading_as);
create unique index if not exists capex_items_uq      on public.capex_items (report_id, item);
create index if not exists toilet_fund_report_idx           on public.toilet_fund (report_id);
create index if not exists vacancies_report_idx             on public.vacancies (report_id);
create index if not exists leasing_waitlist_report_idx      on public.leasing_waitlist (report_id);
create index if not exists trading_hour_breaches_report_idx on public.trading_hour_breaches (report_id);
create index if not exists security_incidents_report_idx    on public.security_incidents (report_id);

-- ---- RLS (§9 standard block) + touch triggers (R-14) -------------------------
do $$ declare t text;
begin
  foreach t in array array['tenant_turnover','footfall_counts','toilet_fund','vacancies',
                           'leasing_waitlist','tenant_movements','trading_hour_breaches',
                           'tenant_arrears','security_incidents','capex_items'] loop
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
