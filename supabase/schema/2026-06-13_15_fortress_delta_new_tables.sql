-- ============================================================================
-- Fortress Reporting — 15: §6 delta, new tables (canonical spec 16 §6)
--   building_turnover, category_turnover, hazard_log, report_checklist_items,
--   local_resources_contacts, inspection_subitems  (+ growth view)
-- Requires 2026-06-13_01 (fortress_touch_updated_at). Idempotent end-to-end.
-- ============================================================================

-- building_turnover: 1 / report (CM Turnover headline). growth_pct is COMPUTED (view, never stored).
create table if not exists public.building_turnover (
    id                        uuid primary key default gen_random_uuid(),
    report_id                 uuid not null references public.reports(id) on delete cascade,
    building_id               uuid not null references public.buildings(id) on delete cascade,
    current_month_total       numeric,
    previous_year_month_total numeric,
    annual_trading_density    numeric,
    spend_per_head            numeric,
    cm_comment                text,
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),
    unique (report_id)
);

-- category_turnover: top-5 / report
create table if not exists public.category_turnover (
    id               uuid primary key default gen_random_uuid(),
    report_id        uuid not null references public.reports(id) on delete cascade,
    building_id      uuid not null references public.buildings(id) on delete cascade,
    category         text not null,
    monthly_turnover numeric,
    trading_density  numeric,
    rank             int,
    comment          text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    unique (report_id, category)
);

-- hazard_log: N / OHS assessment (OPS §4.1 potential hazard + corrective action)
create table if not exists public.hazard_log (
    id                uuid primary key default gen_random_uuid(),
    assessment_id     uuid not null references public.compliance_assessments(id) on delete cascade,
    building_id       uuid not null references public.buildings(id) on delete cascade,
    sort_order        int  not null default 0,
    hazard            text,
    corrective_action text,
    status            text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    unique (assessment_id, sort_order)
);

-- report_checklist_items: N / report (OPS GENERAL block + CM checklist summary)
create table if not exists public.report_checklist_items (
    id          uuid primary key default gen_random_uuid(),
    report_id   uuid not null references public.reports(id) on delete cascade,
    building_id uuid not null references public.buildings(id) on delete cascade,
    section_key text not null,
    item_key    text not null,
    sort_order  int  not null default 0,
    value_text  text,
    value_date  date,
    response    text check (response in ('yes','no','na')),
    comment     text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (report_id, section_key, item_key)
);

-- local_resources_contacts: N / report (CM Building Overview: CPF / Police / Authority)
create table if not exists public.local_resources_contacts (
    id                uuid primary key default gen_random_uuid(),
    report_id         uuid not null references public.reports(id) on delete cascade,
    building_id       uuid not null references public.buildings(id) on delete cascade,
    resource_type     text check (resource_type in ('cpf','police','authority')),
    name              text,
    last_meeting_date date,
    frequency         text,
    contact_person    text,
    contact_number    text,
    sort_order        int not null default 0,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    unique (report_id, resource_type, name)
);

-- inspection_subitems: N / inspection_response (annual nested grids)
create table if not exists public.inspection_subitems (
    id                     uuid primary key default gen_random_uuid(),
    inspection_response_id uuid not null references public.inspection_responses(id) on delete cascade,
    building_id            uuid not null references public.buildings(id) on delete cascade,
    label                  text,
    item_type              text,
    quantity               numeric,
    detail                 jsonb not null default '{}'::jsonb,   -- camelCase keys (contract §2.1)
    sort_order             int not null default 0,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    unique (inspection_response_id, label)
);

-- ---- indexes -----------------------------------------------------------------
create index if not exists building_turnover_building_idx       on public.building_turnover (building_id);
create index if not exists category_turnover_report_idx         on public.category_turnover (report_id, rank);
create index if not exists hazard_log_assessment_idx            on public.hazard_log (assessment_id);
create index if not exists report_checklist_items_report_idx    on public.report_checklist_items (report_id, section_key);
create index if not exists local_resources_contacts_report_idx  on public.local_resources_contacts (report_id);
create index if not exists inspection_subitems_resp_idx         on public.inspection_subitems (inspection_response_id);

-- ---- RLS standard block + touch triggers (idiom from 2026-06-13_06) -----------
do $$ declare t text;
begin
  foreach t in array array['building_turnover','category_turnover','hazard_log',
                            'report_checklist_items','local_resources_contacts','inspection_subitems'] loop
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

-- ---- computed growth view (growth_pct never stored) --------------------------
create or replace view public.v_building_turnover with (security_invoker = on) as
select bt.*,
       round( (bt.current_month_total - bt.previous_year_month_total)
              / nullif(bt.previous_year_month_total, 0) * 100, 1) as growth_pct
from public.building_turnover bt;
