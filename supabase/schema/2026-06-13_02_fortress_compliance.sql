-- ============================================================================
-- Fortress Reporting — 02: OHS Act weighted compliance (the flagship KPI)
-- Finalized from fortress/sql-drafts/F02_compliance.sql.
-- Decisions baked in: R-01 security_invoker views, R-03 auth.uid() idiom,
-- R-13 unique(name,version), R-14 timestamps + touch triggers.
-- Templates are DATA (not code) so new sections need no deploy.
-- compliance_pct comes from a view so it can never drift from the answers.
-- Idempotent: re-runnable end to end. Requires 2026-06-13_01 (touch fn).
-- ============================================================================

-- ---- template (question bank) ---------------------------------------------
create table if not exists public.compliance_templates (
    id           uuid primary key default gen_random_uuid(),
    name         text not null,                 -- 'OHS Act Report'
    version      int  not null default 1,
    applies_to_building_types text[] default '{}',
    active       bool not null default true,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (name, version)                       -- R-13
);

create table if not exists public.compliance_template_items (
    id            uuid primary key default gen_random_uuid(),
    template_id   uuid not null references public.compliance_templates(id) on delete cascade,
    section_no    text not null,                 -- '1.1', '2.12'
    section_title text,
    item_no       text,                          -- '1.1.1'
    prompt        text not null,
    weight        numeric not null default 1,    -- source weights observed 1..5
    response_type text not null default 'yes_no_na'
                  check (response_type in ('yes_no_na','date','count','text')),
    is_critical   bool not null default false,
    sort_order    int  not null default 0,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create index if not exists cti_template_idx
    on public.compliance_template_items (template_id, sort_order);

-- ---- assessment (one per report) ------------------------------------------
create table if not exists public.compliance_assessments (
    id           uuid primary key default gen_random_uuid(),
    report_id    uuid not null references public.reports(id) on delete cascade,
    building_id  uuid not null references public.buildings(id) on delete cascade,
    template_id  uuid not null references public.compliance_templates(id),
    assessed_by  uuid references public.profiles(id),
    assessed_at  timestamptz not null default now(),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (report_id)
);

create table if not exists public.compliance_responses (
    id               uuid primary key default gen_random_uuid(),
    assessment_id    uuid not null references public.compliance_assessments(id) on delete cascade,
    template_item_id uuid not null references public.compliance_template_items(id),
    response         text check (response in ('yes','no','na')),
    value_text       text,        -- date string / count / payload for non yes_no types
    comment          text,
    score            numeric,     -- maintained by trigger = weight when yes, 0 when no, null when na
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    unique (assessment_id, template_item_id)
);
create index if not exists cr_assessment_idx
    on public.compliance_responses (assessment_id);

-- keep score consistent with response*weight
-- (R-07: bulk ETL should pre-compute score in the INSERT; this trigger covers app-side edits)
create or replace function public.compute_compliance_score()
returns trigger language plpgsql as $$
declare w numeric;
begin
    select weight into w from public.compliance_template_items
        where id = new.template_item_id;
    new.score := case
        when new.response = 'yes' then coalesce(w,0)
        when new.response = 'no'  then 0
        else null end;            -- na excluded from scoring
    return new;
end $$;

drop trigger if exists trg_compliance_score on public.compliance_responses;
create trigger trg_compliance_score
    before insert or update on public.compliance_responses
    for each row execute function public.compute_compliance_score();

-- ---- headline KPI view -----------------------------------------------------
-- security_invoker = on → the view applies the QUERYING user's RLS on the
-- underlying tables. WITHOUT this the view runs with the owner's rights and
-- leaks every building's score (review finding R-01).
create or replace view public.compliance_scores
  with (security_invoker = on) as
select a.id as assessment_id, a.report_id, a.building_id,
       sum(case when r.response='yes' then i.weight else 0 end)              as earned,
       sum(case when r.response in ('yes','no') then i.weight else 0 end)    as possible,
       round( 100.0 * sum(case when r.response='yes' then i.weight else 0 end)
              / nullif(sum(case when r.response in ('yes','no') then i.weight else 0 end),0), 1)
                                                                             as compliance_pct
from public.compliance_assessments a
join public.compliance_responses r       on r.assessment_id = a.id
join public.compliance_template_items i  on i.id = r.template_item_id
group by a.id, a.report_id, a.building_id;

-- per-section breakdown for the dashboard drill-down
create or replace view public.compliance_section_scores
  with (security_invoker = on) as
select a.id as assessment_id, a.building_id, i.section_no, i.section_title,
       round(100.0 * sum(case when r.response='yes' then i.weight else 0 end)
             / nullif(sum(case when r.response in ('yes','no') then i.weight else 0 end),0),1) as section_pct
from public.compliance_assessments a
join public.compliance_responses r       on r.assessment_id = a.id
join public.compliance_template_items i  on i.id = r.template_item_id
group by a.id, a.building_id, i.section_no, i.section_title;

-- ---- RLS -------------------------------------------------------------------
alter table public.compliance_templates        enable row level security;
alter table public.compliance_template_items   enable row level security;
alter table public.compliance_assessments      enable row level security;
alter table public.compliance_responses        enable row level security;

-- templates: readable by all authenticated, writable admin/manager
-- NB: auth.uid() is not null is the SANCTIONED idiom. auth.role()='authenticated'
-- was explicitly REMOVED as a vuln in sql/2026-06-10_01 — do not reintroduce (R-03).
drop policy if exists ct_read on public.compliance_templates;
create policy ct_read   on public.compliance_templates      for select using ( auth.uid() is not null );
drop policy if exists ct_write on public.compliance_templates;
create policy ct_write  on public.compliance_templates      for all    using ( is_admin_or_manager() ) with check ( is_admin_or_manager() );
drop policy if exists cti_read on public.compliance_template_items;
create policy cti_read  on public.compliance_template_items  for select using ( auth.uid() is not null );
drop policy if exists cti_write on public.compliance_template_items;
create policy cti_write on public.compliance_template_items  for all    using ( is_admin_or_manager() ) with check ( is_admin_or_manager() );

-- assessments + responses: building-scoped read, manager/author write
drop policy if exists ca_read on public.compliance_assessments;
create policy ca_read   on public.compliance_assessments for select using ( can_access_building(building_id) );
drop policy if exists ca_write on public.compliance_assessments;
create policy ca_write  on public.compliance_assessments for all
    using ( is_admin_or_manager() or can_access_building(building_id) )
    with check ( is_admin_or_manager() or can_access_building(building_id) );

drop policy if exists cr_read on public.compliance_responses;
create policy cr_read   on public.compliance_responses for select
    using ( exists (select 1 from public.compliance_assessments a
                    where a.id = assessment_id and can_access_building(a.building_id)) );
drop policy if exists cr_write on public.compliance_responses;
create policy cr_write  on public.compliance_responses for all
    using ( exists (select 1 from public.compliance_assessments a
                    where a.id = assessment_id
                      and (is_admin_or_manager() or can_access_building(a.building_id))) )
    with check ( exists (select 1 from public.compliance_assessments a
                    where a.id = assessment_id
                      and (is_admin_or_manager() or can_access_building(a.building_id))) );

-- ---- updated_at touch (R-14) ------------------------------------------------
do $$ declare t text;
begin
  foreach t in array array['compliance_templates','compliance_template_items',
                           'compliance_assessments','compliance_responses'] loop
    execute format('drop trigger if exists %I on public.%I;', 'trg_'||t||'_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.fortress_touch_updated_at();', 'trg_'||t||'_touch', t);
  end loop;
end $$;
