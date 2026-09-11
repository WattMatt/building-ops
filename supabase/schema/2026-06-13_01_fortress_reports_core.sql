-- ============================================================================
-- Fortress Reporting — 01: report header + narratives
-- Finalized from fortress/sql-drafts/F01_reports_core.sql.
-- Decisions baked in (fortress/build/PLAN_LOCK.md):
--   R-10 report_period always first-of-month; inspection_date for annuals
--   R-11 asset_manager / ops_manager / centre_manager promoted to columns;
--        meta jsonb stays for the rest (camelCase keys per SCHEMA_CONTRACT §2.1)
--   R-14 created_at/updated_at + touch trigger on all new tables
--   R-16 report status transitions append to audit_logs
--   §9   author may update own report only while draft
-- Idempotent: re-runnable end to end.
-- ============================================================================

-- ---- shared touch function (used by all Fortress migrations) ---------------
create or replace function public.fortress_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---- reports: the spine ----------------------------------------------------
create table if not exists public.reports (
    id               uuid primary key default gen_random_uuid(),
    building_id      uuid not null references public.buildings(id) on delete cascade,
    organization_id  uuid references public.organizations(id),
    report_type      text not null check (report_type in
                        ('ops_monthly','cm_monthly','annual_inspection')),
    report_period    date not null,                 -- ALWAYS first-of-month for the period (R-10)
    inspection_date  date,                           -- annual: the actual inspection date
    title            text,
    status           text not null default 'draft' check (status in
                        ('draft','submitted','reviewed','approved','rejected')),
    author_id        uuid references public.profiles(id),
    author_name      text,                           -- denormalized (RLS hides profiles)
    reviewed_by      uuid references public.profiles(id),
    review_notes     text,
    prepared_for     text,
    asset_manager    text,                           -- R-11 promoted header fields
    ops_manager      text,
    centre_manager   text,
    meta             jsonb not null default '{}'::jsonb,  -- camelCase keys (contract §2.1)
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    unique (building_id, report_type, report_period)
);

create index if not exists reports_building_period_idx
    on public.reports (building_id, report_period desc);
create index if not exists reports_status_idx on public.reports (status);

-- ---- report_narratives: OPS/CM free-text sections --------------------------
create table if not exists public.report_narratives (
    id           uuid primary key default gen_random_uuid(),
    report_id    uuid not null references public.reports(id) on delete cascade,
    building_id  uuid not null references public.buildings(id) on delete cascade,
    section_key  text not null,        -- structural, cosmetic, roofing, fire, hvac, building_overview ...
    sort_order   int  not null default 0,
    heading      text,
    body         text,
    status_flag  text check (status_flag in ('ok','attention','escalated')),
    issue_id     uuid references public.issues(id),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index if not exists report_narratives_report_idx
    on public.report_narratives (report_id, sort_order);

-- idempotency: one narrative per section per report (R-08)
create unique index if not exists report_narratives_uq
    on public.report_narratives (report_id, section_key);

-- ---- RLS -------------------------------------------------------------------
alter table public.reports            enable row level security;
alter table public.report_narratives  enable row level security;

drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports for select
    using ( can_access_building(building_id) );
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert
    with check ( is_admin_or_manager() or can_access_building(building_id) );
drop policy if exists reports_update on public.reports;
create policy reports_update on public.reports for update
    using ( is_admin_or_manager() or (author_id = auth.uid() and status = 'draft') );
drop policy if exists reports_delete on public.reports;
create policy reports_delete on public.reports for delete
    using ( is_admin() );

drop policy if exists rn_read on public.report_narratives;
create policy rn_read on public.report_narratives for select
    using ( can_access_building(building_id) );
drop policy if exists rn_insert on public.report_narratives;
create policy rn_insert on public.report_narratives for insert
    with check ( is_admin_or_manager() or can_access_building(building_id) );
drop policy if exists rn_update on public.report_narratives;
create policy rn_update on public.report_narratives for update
    using ( is_admin_or_manager() or can_access_building(building_id) );
drop policy if exists rn_delete on public.report_narratives;
create policy rn_delete on public.report_narratives for delete
    using ( is_admin() );

-- ---- updated_at touch (R-14) ------------------------------------------------
drop trigger if exists trg_reports_touch on public.reports;
create trigger trg_reports_touch before update on public.reports
    for each row execute function public.fortress_touch_updated_at();
drop trigger if exists trg_report_narratives_touch on public.report_narratives;
create trigger trg_report_narratives_touch before update on public.report_narratives
    for each row execute function public.fortress_touch_updated_at();

-- ---- R-16: status transitions → audit_logs ----------------------------------
-- audit_logs(action text not null, entity_type text, entity_id uuid, user_id uuid)
-- al_insert policy permits (user_id = auth.uid() or user_id is null) — invoker rights suffice.
create or replace function public.fortress_report_status_audit()
returns trigger language plpgsql as $$
begin
    insert into public.audit_logs (action, entity_type, entity_id, user_id)
    values ('report_status_' || new.status, 'report', new.id, auth.uid());
    return new;
end $$;

drop trigger if exists trg_reports_status_audit on public.reports;
create trigger trg_reports_status_audit
    after update of status on public.reports
    for each row when (old.status is distinct from new.status)
    execute function public.fortress_report_status_audit();
