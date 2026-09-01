-- ============================================================================
-- Fortress Reporting — 03: inspections (Monthly Building Inspection + Annual)
-- Finalized from fortress/sql-drafts/F03_to_F08_STUBS.sql §F03 + 01_SCHEMA.md §4.
-- Decisions baked in: R-13 unique(name,version), R-14 timestamps + triggers,
-- PLAN_LOCK draft-defect fix: inspection_responses has NO building_id →
-- policies go EXISTS-via-building_inspections (same pattern as compliance_responses).
-- Idempotent: re-runnable end to end. Requires 2026-06-13_01 (touch fn).
-- ============================================================================

create table if not exists public.inspection_templates (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    cadence     text check (cadence in ('monthly','annual')),
    version     int  not null default 1,
    active      bool not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (name, version)                       -- R-13
);

create table if not exists public.inspection_template_items (
    id            uuid primary key default gen_random_uuid(),
    template_id   uuid not null references public.inspection_templates(id) on delete cascade,
    section_no    text,
    section_title text,                          -- STRUCTURE, ROOF, FIRE PROTECTION ...
    item_label    text,                          -- "Foundations", "Gutters and down pipes"
    rating_type   text not null default 'acceptable_yn'
                  check (rating_type in ('acceptable_yn','condition_scale')),
    allows_photo  bool not null default false,
    sort_order    int  not null default 0,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create index if not exists iti_template_idx
    on public.inspection_template_items (template_id, sort_order);

create table if not exists public.building_inspections (
    id              uuid primary key default gen_random_uuid(),
    report_id       uuid references public.reports(id) on delete cascade,
    building_id     uuid not null references public.buildings(id) on delete cascade,
    template_id     uuid references public.inspection_templates(id),
    inspected_by    uuid references public.profiles(id),
    inspection_date date,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index if not exists bi_report_idx   on public.building_inspections (report_id);
create index if not exists bi_building_idx on public.building_inspections (building_id);

create table if not exists public.inspection_responses (
    id               uuid primary key default gen_random_uuid(),
    inspection_id    uuid not null references public.building_inspections(id) on delete cascade,
    template_item_id uuid not null references public.inspection_template_items(id),
    acceptable       text check (acceptable in ('yes','no','na')),
    condition_rating text check (condition_rating in ('good','fair','poor','critical')),
    action_required  text check (action_required in ('none','within_3_months','immediate')),
    risk_level       text,
    recommendation   text,
    comment          text,
    photo_urls       jsonb not null default '[]'::jsonb,  -- documents/<building_id>/... paths (R-06)
    capex_estimate   numeric,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    unique (inspection_id, template_item_id)     -- R-08
);

-- ---- RLS -------------------------------------------------------------------
alter table public.inspection_templates      enable row level security;
alter table public.inspection_template_items enable row level security;
alter table public.building_inspections     enable row level security;
alter table public.inspection_responses     enable row level security;

-- templates: authenticated read, admin/manager write (R-03 idiom)
drop policy if exists it_read on public.inspection_templates;
create policy it_read   on public.inspection_templates       for select using ( auth.uid() is not null );
drop policy if exists it_write on public.inspection_templates;
create policy it_write  on public.inspection_templates       for all    using ( is_admin_or_manager() ) with check ( is_admin_or_manager() );
drop policy if exists iti_read on public.inspection_template_items;
create policy iti_read  on public.inspection_template_items  for select using ( auth.uid() is not null );
drop policy if exists iti_write on public.inspection_template_items;
create policy iti_write on public.inspection_template_items  for all    using ( is_admin_or_manager() ) with check ( is_admin_or_manager() );

-- building_inspections: building-scoped (§9 template)
drop policy if exists building_inspections_read on public.building_inspections;
create policy building_inspections_read on public.building_inspections for select
    using ( can_access_building(building_id) );
drop policy if exists building_inspections_ins on public.building_inspections;
create policy building_inspections_ins on public.building_inspections for insert
    with check ( is_admin_or_manager() or can_access_building(building_id) );
drop policy if exists building_inspections_upd on public.building_inspections;
create policy building_inspections_upd on public.building_inspections for update
    using ( is_admin_or_manager() or can_access_building(building_id) );
drop policy if exists building_inspections_del on public.building_inspections;
create policy building_inspections_del on public.building_inspections for delete
    using ( is_admin() );

-- inspection_responses: no building_id → scope via parent inspection
drop policy if exists ir_read on public.inspection_responses;
create policy ir_read on public.inspection_responses for select
    using ( exists (select 1 from public.building_inspections bi
                    where bi.id = inspection_id and can_access_building(bi.building_id)) );
drop policy if exists ir_write on public.inspection_responses;
create policy ir_write on public.inspection_responses for all
    using ( exists (select 1 from public.building_inspections bi
                    where bi.id = inspection_id
                      and (is_admin_or_manager() or can_access_building(bi.building_id))) )
    with check ( exists (select 1 from public.building_inspections bi
                    where bi.id = inspection_id
                      and (is_admin_or_manager() or can_access_building(bi.building_id))) );

-- ---- updated_at touch (R-14) ------------------------------------------------
do $$ declare t text;
begin
  foreach t in array array['inspection_templates','inspection_template_items',
                           'building_inspections','inspection_responses'] loop
    execute format('drop trigger if exists %I on public.%I;', 'trg_'||t||'_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.fortress_touch_updated_at();', 'trg_'||t||'_touch', t);
  end loop;
end $$;
