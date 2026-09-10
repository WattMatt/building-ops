-- 2026-09-14_01_r4_snapshots_sla.sql — R4a "Snapshots & SLA" (spec 2026-09-10-r4-insight-design.md §5.1–5.6).
-- Additive, idempotent. Requires 2026-09-11_03 (is_active_user, can_access_building), 2026-09-11_01
-- (notifications, stamp_issue_resolved_at), 2026-09-13_03/_05 (ppm_monthly_status, building_ppm_services).
--
--   1) Fixes: is_admin / is_admin_or_manager use EXISTS (a user with several user_roles rows raised 21000);
--      app_role gains the deactivation gate and picks the most privileged role; building_assets purchase /
--      warranty / lifespan columns vendored (they exist on prod, in no migration); media_attachments admin-only.
--   2) organizations.settings (jsonb object) + organization_branding view for anon; base table loses anon.
--   3) building_metrics_daily + snapshot_building_metrics(p_day, p_building) + portfolio_metrics_daily +
--      90-day backfill + cron metrics-snapshot-daily (03:00 UTC = 05:00 SAST, after generation and the sweep).
--   4) SLA: org_sla_hours(), issues_sla_defaults trigger, first-response trigger on issue_activity,
--      mark_sla_breaches() + cron sla-breach-sweep every 15 min, notification kind issue_sla_breached.
--   5) buildings.report_types + delete_empty_report(p_report).
--   6) expiring_items_at(p_day, p_days) / expiring_items(p_days): one invoker function over the five expiry
--      sources, read by the snapshot (as owner), the dashboard widget and notify-expiring-alerts (service role).
--
-- Apply staging (vkrihpmjajjcxmzgjqdr) first, then prod. Verified on a throwaway local Postgres 17 before
-- handover (stub + verify scripts live outside the repo; see the plan, Task 1 Step 2).
begin;

-- ============================================================
-- 1) Fixes and reconciliation
-- ============================================================
-- user_roles is unique (user_id, building_id): a user may hold a global row plus building-scoped rows, and
-- the bare scalar subquery of 2026-09-11_03 raised 21000 ("more than one row") for the first such user.
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_active_user()
     and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
$$;

create or replace function public.is_admin_or_manager()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_active_user()
     and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('admin','manager'))
$$;

-- Most privileged role wins; a deactivated caller has no role at all.
create or replace function public.app_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select case when public.is_active_user() then
    (select ur.role from public.user_roles ur where ur.user_id = auth.uid()
      order by case ur.role when 'admin' then 0 when 'manager' then 1 else 2 end
      limit 1)
  end
$$;

alter table public.building_assets
  add column if not exists purchase_date date,
  add column if not exists purchase_price numeric,
  add column if not exists replacement_cost numeric,
  add column if not exists warranty_expiry date,
  add column if not exists warranty_provider text,
  add column if not exists expected_lifespan_years integer;

-- media_attachments: 0 rows, no client; data-ops only (D9 spirit). Was readable by any signed-in user.
drop policy if exists ma_select on public.media_attachments;
create policy ma_select on public.media_attachments for select using (public.is_admin());
drop policy if exists ma_insert on public.media_attachments;
create policy ma_insert on public.media_attachments for insert with check (public.is_admin());
drop policy if exists ma_update on public.media_attachments;
create policy ma_update on public.media_attachments for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists ma_delete on public.media_attachments;
create policy ma_delete on public.media_attachments for delete using (public.is_admin());
comment on table public.media_attachments is 'Data-ops only: no client reads or writes it (0 rows). Admin-only policies since 2026-09-14_01.';

-- ============================================================
-- 2) Org settings + anon-safe branding view
-- ============================================================
alter table public.organizations add column if not exists settings jsonb not null default '{}'::jsonb;
alter table public.organizations drop constraint if exists organizations_settings_object_check;
alter table public.organizations add constraint organizations_settings_object_check check (jsonb_typeof(settings) = 'object');

-- The anon select policy predates the vendored migrations (name unknown): drop every SELECT policy by catalog.
do $$
declare p record;
begin
  for p in select polname from pg_policy where polrelid = 'public.organizations'::regclass and polcmd = 'r' loop
    execute format('drop policy %I on public.organizations', p.polname);
  end loop;
end $$;
create policy o_select_authenticated on public.organizations for select using (auth.uid() is not null);
revoke all on public.organizations from anon;

-- Deliberately NOT security_invoker: anon has no privilege on the base table, and the view exposes exactly the
-- four branding columns the login screen needs. settings never leaves the table for anon.
create or replace view public.organization_branding as
  select o.id, o.name, o.logo_url, o.primary_color from public.organizations o;
revoke all on public.organization_branding from public;
grant select on public.organization_branding to anon, authenticated;

-- Default SLA hours per priority, overridable in organizations.settings.sla_hours. Only a JSON number counts;
-- anything else falls back, so a mistyped setting can never break issue inserts.
create or replace function public.org_sla_hours(p_priority text)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select case when jsonb_typeof(o.settings->'sla_hours'->p_priority) = 'number'
                 then (o.settings->'sla_hours'->>p_priority)::numeric end
       from public.organizations o order by o.created_at nulls last limit 1),
    case p_priority when 'critical' then 4 when 'high' then 24 when 'medium' then 72 when 'low' then 168 end)
$$;
revoke all on function public.org_sla_hours(text) from public;
revoke execute on function public.org_sla_hours(text) from anon;
grant execute on function public.org_sla_hours(text) to authenticated, service_role;

-- ============================================================
-- 6) Expiring items (defined before the snapshot, which reads it)
-- ============================================================
-- Security INVOKER on purpose: the five source tables' RLS applies to whoever calls it (a site user sees
-- their buildings, the service role everything, the snapshot below runs it as its own owner).
create or replace function public.expiring_items_at(p_day date, p_days integer)
returns table (
  kind text, entity_type text, entity_id uuid, parent_id uuid, building_id uuid, building_name text,
  name text, detail text, expiry_date date, days_left integer)
language sql stable
set search_path = ''
as $$
  with items as (
    select 'building_document'::text as kind, 'document'::text as entity_type, d.id as entity_id, null::uuid as parent_id,
           d.building_id, d.name, d.document_type as detail, d.expiry_date
      from public.building_documents d where d.expiry_date is not null
    union all
    select 'tenant_document', 'document', td.id, bt.id, bt.building_id, td.document_name,
           coalesce(bt.shop_name, bt.name), td.expiry_date
      from public.tenant_documents td join public.building_tenants bt on bt.id = td.tenant_id
     where td.expiry_date is not null
    union all
    select 'contractor_document', 'document', cd.id, c.id, null::uuid, cd.document_name, c.company_name, cd.expiry_date
      from public.contractor_documents cd join public.contractors c on c.id = cd.contractor_id
     where cd.expiry_date is not null
    union all
    select 'asset_warranty', 'asset', a.id, null::uuid, a.building_id, a.name, a.category, a.warranty_expiry
      from public.building_assets a where a.warranty_expiry is not null
    union all
    select 'asset_service', 'asset', a.id, null::uuid, a.building_id, a.name, a.category, a.next_service_date
      from public.building_assets a where a.next_service_date is not null
  )
  select i.kind, i.entity_type, i.entity_id, i.parent_id, i.building_id, b.name, i.name, i.detail, i.expiry_date,
         (i.expiry_date - p_day)::integer
    from items i
    left join public.buildings b on b.id = i.building_id
   where i.expiry_date <= p_day + greatest(coalesce(p_days, 0), 0)
   order by i.expiry_date, i.name
$$;
revoke all on function public.expiring_items_at(date, integer) from public;
revoke execute on function public.expiring_items_at(date, integer) from anon;
grant execute on function public.expiring_items_at(date, integer) to authenticated, service_role;

create or replace function public.expiring_items(p_days integer)
returns table (
  kind text, entity_type text, entity_id uuid, parent_id uuid, building_id uuid, building_name text,
  name text, detail text, expiry_date date, days_left integer)
language sql stable
set search_path = ''
as $$
  select * from public.expiring_items_at((now() at time zone 'Africa/Johannesburg')::date, p_days)
$$;
revoke all on function public.expiring_items(integer) from public;
revoke execute on function public.expiring_items(integer) from anon;
grant execute on function public.expiring_items(integer) to authenticated, service_role;

-- ============================================================
-- 5a) buildings.report_types (needed by the snapshot's report_state)
-- ============================================================
alter table public.buildings
  add column if not exists report_types text[] not null default array['ops_monthly','cm_monthly'];
alter table public.buildings drop constraint if exists buildings_report_types_check;
alter table public.buildings add constraint buildings_report_types_check
  check (report_types <@ array['ops_monthly','cm_monthly','annual_inspection']::text[]);

-- ============================================================
-- 3) Metric snapshots
-- ============================================================
create table if not exists public.building_metrics_daily (
  building_id             uuid not null references public.buildings(id) on delete cascade,
  day                     date not null,
  compliance_pct          numeric,
  critical_pct            numeric,
  inspection_pass_pct     numeric,
  compliance_period       date,
  ohs_open_nc             integer,
  ppm_done_pct            numeric,
  task_completion_30d_pct numeric,
  tasks_overdue           integer,
  tasks_due_7d            integer,
  issues_open             integer,
  issues_open_by_priority jsonb,
  issues_breached         integer,
  issues_resolved_30d     integer,
  docs_expiring_30        integer,
  docs_expiring_60        integer,
  docs_expiring_90        integer,
  docs_expired            integer,
  assets_overdue          integer,
  report_state            jsonb,
  reconstructed           boolean not null default false,
  computed_at             timestamptz not null default now(),
  primary key (building_id, day)
);
create index if not exists building_metrics_daily_day_idx on public.building_metrics_daily (day);
alter table public.building_metrics_daily enable row level security;
drop policy if exists bmd_select on public.building_metrics_daily;
create policy bmd_select on public.building_metrics_daily for select using (public.can_access_building(building_id));
revoke all on public.building_metrics_daily from anon;
revoke insert, update, delete, truncate, references, trigger on public.building_metrics_daily from authenticated;

-- One row per building for one SAST day. Report and expiry columns are point-in-time reads of the data as it
-- is now (a re-run for an earlier day is marked reconstructed); task and issue columns are computed from
-- completed_at / created_at / resolved_at so a backfilled day is historically honest where the data allows.
-- expiring_items_at is security INVOKER: called from here it runs as this function's owner, so RLS does not
-- narrow the counts for the cron; a signed-in caller must be admin/manager (checked below), who see everything.
create or replace function public.snapshot_building_metrics(p_day date default null, p_building uuid default null)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today  date := (now() at time zone 'Africa/Johannesburg')::date;
  v_day    date := coalesce(p_day, (now() at time zone 'Africa/Johannesburg')::date);
  v_period date;
  v_month  text;
  v_end    timestamptz;   -- first instant of the next SAST day
  v_count  integer := 0;
begin
  if v_day > v_today then
    raise exception 'snapshot_building_metrics: p_day % is in the future', v_day using errcode = '22023';
  end if;
  if auth.uid() is not null then
    if not public.is_admin_or_manager() then
      raise exception 'snapshot_building_metrics: admin or manager only' using errcode = '42501';
    end if;
    if p_building is not null and not public.can_access_building(p_building) then
      raise exception 'snapshot_building_metrics: no access to that building' using errcode = '42501';
    end if;
  end if;
  v_period := date_trunc('month', v_day)::date;
  v_month  := to_char(v_day, 'YYYY-MM');
  v_end    := ((v_day + 1)::timestamp at time zone 'Africa/Johannesburg');

  insert into public.building_metrics_daily as m (
    building_id, day,
    compliance_pct, critical_pct, inspection_pass_pct, compliance_period, ohs_open_nc,
    ppm_done_pct,
    task_completion_30d_pct, tasks_overdue, tasks_due_7d,
    issues_open, issues_open_by_priority, issues_breached, issues_resolved_30d,
    docs_expiring_30, docs_expiring_60, docs_expiring_90, docs_expired, assets_overdue,
    report_state, reconstructed, computed_at)
  select b.id, v_day,
         rep.compliance_pct, rep.critical_pct, rep.inspection_pass_pct, rep.report_period, rep.ohs_open_nc,
         ppm.done_pct,
         t.completion_pct, t.overdue, t.due_7d,
         i.open_count, i.by_priority, i.breached, i.resolved_30d,
         x.d30, x.d60, x.d90, x.expired, x.assets_overdue,
         rs.report_state, v_day < v_today, now()
    from public.buildings b
    left join lateral (
      select r.report_period,
             (select cs.compliance_pct from public.compliance_scores cs where cs.report_id = r.id limit 1) as compliance_pct,
             (select ccs.critical_pct
                from public.compliance_critical_scores ccs
                join public.compliance_assessments ca on ca.id = ccs.assessment_id
               where ca.report_id = r.id limit 1) as critical_pct,
             (select count(*)::int
                from public.compliance_responses cr
                join public.compliance_assessments ca on ca.id = cr.assessment_id
               where ca.report_id = r.id and cr.response = 'no') as ohs_open_nc,
             (select round(100.0 * count(*) filter (where ir.acceptable = 'yes')
                           / nullif(count(*) filter (where ir.acceptable in ('yes','no')), 0), 1)
                from public.inspection_responses ir
                join public.building_inspections bi on bi.id = ir.inspection_id
               where bi.report_id = r.id) as inspection_pass_pct
        from public.reports r
       where r.building_id = b.id and r.report_type = 'ops_monthly' and r.status = 'approved'
         and r.report_period <= v_period
       order by r.report_period desc
       limit 1) rep on true
    left join lateral (
      select round(100.0 * count(*) filter (where s.status = 'done') / nullif(count(*), 0), 1) as done_pct
        from public.ppm_monthly_status s
       where s.building_id = b.id and s.period_month = v_month) ppm on true
    left join lateral (
      with tk as (
        select ti.due_date,
               (ti.status = 'completed'
                and coalesce((ti.completed_at at time zone 'Africa/Johannesburg')::date, ti.due_date) <= v_day) as done
          from public.task_instances ti
         where ti.building_id = b.id
           and ti.status in ('pending','overdue','completed')
           and ti.due_date between v_day - 365 and v_day + 6)
      select round(100.0 * count(*) filter (where done and due_date between v_day - 29 and v_day)
                   / nullif(count(*) filter (where due_date between v_day - 29 and v_day), 0), 1) as completion_pct,
             count(*) filter (where not done and due_date < v_day)::int as overdue,
             count(*) filter (where not done and due_date between v_day and v_day + 6)::int as due_7d
        from tk) t on true
    left join lateral (
      with op as (
        select iss.priority, iss.sla_breached_at
          from public.issues iss
         where iss.building_id = b.id
           and iss.created_at < v_end
           and (iss.resolved_at is null or iss.resolved_at >= v_end)
           and not (iss.status = 'resolved' and iss.resolved_at is null))
      select (select count(*)::int from op) as open_count,
             (select coalesce(jsonb_object_agg(p.priority, p.n), '{}'::jsonb)
                from (select priority, count(*) as n from op group by priority) p) as by_priority,
             (select count(*)::int from op where sla_breached_at is not null and sla_breached_at < v_end) as breached,
             (select count(*)::int from public.issues iss
               where iss.building_id = b.id
                 and iss.resolved_at > v_end - interval '30 days' and iss.resolved_at <= v_end) as resolved_30d) i on true
    left join lateral (
      select count(*) filter (where e.kind in ('building_document','tenant_document','asset_warranty') and e.days_left between 0 and 30)::int as d30,
             count(*) filter (where e.kind in ('building_document','tenant_document','asset_warranty') and e.days_left between 31 and 60)::int as d60,
             count(*) filter (where e.kind in ('building_document','tenant_document','asset_warranty') and e.days_left between 61 and 90)::int as d90,
             count(*) filter (where e.kind in ('building_document','tenant_document','asset_warranty') and e.days_left < 0)::int as expired,
             count(*) filter (where e.kind = 'asset_service' and e.days_left < 0)::int as assets_overdue
        from public.expiring_items_at(v_day, 90) e
       where e.building_id = b.id) x on true
    left join lateral (
      select coalesce(jsonb_object_agg(t.rt, jsonb_build_object('period', v_period, 'status', coalesce(r.status, 'missing'))), '{}'::jsonb) as report_state
        from unnest(b.report_types) as t(rt)
        left join lateral (
          select rr.status from public.reports rr
           where rr.building_id = b.id and rr.report_type = t.rt
             and case when t.rt = 'annual_inspection'
                      then date_trunc('year', rr.report_period) = date_trunc('year', v_period)
                      else rr.report_period = v_period end
           order by rr.report_period desc limit 1) r on true) rs on true
   where p_building is null or b.id = p_building
  on conflict (building_id, day) do update set
    compliance_pct = excluded.compliance_pct, critical_pct = excluded.critical_pct,
    inspection_pass_pct = excluded.inspection_pass_pct, compliance_period = excluded.compliance_period,
    ohs_open_nc = excluded.ohs_open_nc, ppm_done_pct = excluded.ppm_done_pct,
    task_completion_30d_pct = excluded.task_completion_30d_pct, tasks_overdue = excluded.tasks_overdue,
    tasks_due_7d = excluded.tasks_due_7d, issues_open = excluded.issues_open,
    issues_open_by_priority = excluded.issues_open_by_priority, issues_breached = excluded.issues_breached,
    issues_resolved_30d = excluded.issues_resolved_30d, docs_expiring_30 = excluded.docs_expiring_30,
    docs_expiring_60 = excluded.docs_expiring_60, docs_expiring_90 = excluded.docs_expiring_90,
    docs_expired = excluded.docs_expired, assets_overdue = excluded.assets_overdue,
    report_state = excluded.report_state, reconstructed = excluded.reconstructed, computed_at = now();
  get diagnostics v_count = row_count;

  if p_building is null then
    delete from public.building_metrics_daily where day < v_today - 400;
  end if;
  return v_count;
end $$;
revoke all on function public.snapshot_building_metrics(date, uuid) from public;
revoke execute on function public.snapshot_building_metrics(date, uuid) from anon;
grant execute on function public.snapshot_building_metrics(date, uuid) to authenticated, service_role;

-- Portfolio roll-up: security_invoker, so the averages run over the caller's accessible buildings only.
-- contractor documents are org-level (no building) and are counted here, relative to today.
create or replace view public.portfolio_metrics_daily with (security_invoker = on) as
select m.day,
       count(*)::int                              as buildings,
       round(avg(m.compliance_pct), 1)            as compliance_avg,
       round(avg(m.critical_pct), 1)              as critical_avg,
       round(avg(m.inspection_pass_pct), 1)       as inspection_pass_avg,
       round(avg(m.ppm_done_pct), 1)              as ppm_done_avg,
       round(avg(m.task_completion_30d_pct), 1)   as task_completion_avg,
       sum(m.tasks_overdue)::int                  as tasks_overdue,
       sum(m.tasks_due_7d)::int                   as tasks_due_7d,
       sum(m.issues_open)::int                    as issues_open,
       sum(m.issues_breached)::int                as issues_breached,
       sum(m.issues_resolved_30d)::int            as issues_resolved_30d,
       sum(m.docs_expiring_30)::int               as docs_expiring_30,
       sum(m.docs_expiring_60)::int               as docs_expiring_60,
       sum(m.docs_expiring_90)::int               as docs_expiring_90,
       sum(m.docs_expired)::int                   as docs_expired,
       sum(m.assets_overdue)::int                 as assets_overdue,
       (select count(*)::int from public.contractor_documents cd
         where cd.expiry_date between (now() at time zone 'Africa/Johannesburg')::date
                                  and (now() at time zone 'Africa/Johannesburg')::date + 30) as contractor_docs_expiring_30,
       (select count(*)::int from public.contractor_documents cd
         where cd.expiry_date between (now() at time zone 'Africa/Johannesburg')::date + 31
                                  and (now() at time zone 'Africa/Johannesburg')::date + 60) as contractor_docs_expiring_60,
       (select count(*)::int from public.contractor_documents cd
         where cd.expiry_date between (now() at time zone 'Africa/Johannesburg')::date + 61
                                  and (now() at time zone 'Africa/Johannesburg')::date + 90) as contractor_docs_expiring_90,
       (select count(*)::int from public.contractor_documents cd
         where cd.expiry_date < (now() at time zone 'Africa/Johannesburg')::date) as contractor_docs_expired,
       bool_or(m.reconstructed)                   as reconstructed
  from public.building_metrics_daily m
 group by m.day;
revoke all on public.portfolio_metrics_daily from anon;
revoke insert, update, delete, truncate, references, trigger on public.portfolio_metrics_daily from authenticated;

-- Backfill 90 days once (rows for a day that already has any row are left alone, so a re-run is cheap).
-- 47 buildings × 91 days ≈ 4 300 per-building evaluations; if the Management API times out mid-transaction,
-- apply the file without this block and run the block on its own in three 30-day windows (the not-exists
-- guard makes every window idempotent).
do $$
declare
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  d date;
begin
  for d in select generate_series(v_today - 90, v_today, interval '1 day')::date loop
    if not exists (select 1 from public.building_metrics_daily where day = d) then
      perform public.snapshot_building_metrics(d, null);
    end if;
  end loop;
end $$;

do $$ begin perform cron.unschedule('metrics-snapshot-daily'); exception when others then null; end $$;
select cron.schedule('metrics-snapshot-daily', '0 3 * * *', 'select public.snapshot_building_metrics()');

-- ============================================================
-- 4) SLA
-- ============================================================
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'task_assigned','issue_assigned','issue_comment','issue_mention',
  'report_submitted','report_returned','report_approved',
  'form_submitted','form_reviewed','signoff_requested','signoff_complete','signoff_overdue',
  'document_expiring','asset_service_due','task_due_today','issue_sla_breached'));

-- Default target on insert; on a priority change of an open issue the target follows the new priority only
-- when the row still carries the old priority's default and the same statement did not set a target itself
-- (an explicit target is always kept). Existing issues are NOT backfilled: only issues created from now on
-- carry a default, so nothing breaches all at once on apply.
create or replace function public.issues_sla_defaults()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.sla_target_hours := coalesce(new.sla_target_hours, public.org_sla_hours(new.priority));
  elsif new.priority is distinct from old.priority
        and new.sla_target_hours is not distinct from old.sla_target_hours   -- the statement did not set a target itself
        and new.status in ('open','in_progress','escalated')
        and (old.sla_target_hours is null or old.sla_target_hours = public.org_sla_hours(old.priority)) then
    new.sla_target_hours := public.org_sla_hours(new.priority);
  end if;
  return new;
end $$;
revoke all on function public.issues_sla_defaults() from public;
revoke execute on function public.issues_sla_defaults() from anon;
drop trigger if exists trg_issues_sla_defaults on public.issues;
create trigger trg_issues_sla_defaults
  before insert or update of priority on public.issues
  for each row execute function public.issues_sla_defaults();

-- First response = first activity by someone other than the reporter. The update touches no column that
-- trg_issues_activity_log (status / assigned_to) or trg_issue_resolved_at (status) act on, so it cannot re-enter.
create or replace function public.issue_activity_first_response()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.user_id is null
     or new.activity_type not in ('comment','status_change','assignment','contractor_assignment') then
    return null;
  end if;
  update public.issues i
     set first_response_at = new.created_at
   where i.id = new.issue_id
     and i.first_response_at is null
     and i.reported_by <> new.user_id;
  return null;
end $$;
revoke all on function public.issue_activity_first_response() from public;
revoke execute on function public.issue_activity_first_response() from anon;
drop trigger if exists trg_issue_activity_first_response on public.issue_activity;
create trigger trg_issue_activity_first_response
  after insert on public.issue_activity
  for each row execute function public.issue_activity_first_response();

-- Breach sweep. Resolving clears nothing: sla_breached_at is history. Inbox rows go to the assignee (if any)
-- and every active admin/manager; no email and no push from here (the rows never pass through
-- createNotifications), which is why issue_sla_breached is DIGEST_ONLY and not a PUSH_KIND in notifyRules.ts.
create or replace function public.mark_sla_breaches()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  r record;
begin
  if auth.uid() is not null and not public.is_admin_or_manager() then
    raise exception 'mark_sla_breaches: admin or manager only' using errcode = '42501';
  end if;
  for r in
    update public.issues i
       set sla_breached_at = now()
     where i.status in ('open','in_progress','escalated')
       and i.sla_breached_at is null
       and i.sla_target_hours is not null
       and i.created_at + (i.sla_target_hours * interval '1 hour') < now()
    returning i.id, i.title, i.building_id, i.assigned_to, i.priority, i.sla_target_hours
  loop
    v_count := v_count + 1;
    insert into public.notifications (recipient_id, actor_id, actor_name, kind, entity_type, entity_id, building_id, title, body, url)
    select u.id, null, null, 'issue_sla_breached', 'issue', r.id, r.building_id,
           left('SLA breached: ' || coalesce(r.title, 'Untitled issue'), 200),
           'Priority ' || r.priority || ' · target '
             || case when r.sla_target_hours = trunc(r.sla_target_hours) then trunc(r.sla_target_hours)::text else r.sla_target_hours::text end
             || ' h',
           '/issues?open=' || r.id
      from (
        select p.id
          from public.profiles p
         where not coalesce(p.deactivated, false)
           and (p.id = r.assigned_to
                or exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role in ('admin','manager')))
      ) u;
  end loop;
  return v_count;
end $$;
revoke all on function public.mark_sla_breaches() from public;
revoke execute on function public.mark_sla_breaches() from anon;
grant execute on function public.mark_sla_breaches() to authenticated, service_role;

do $$ begin perform cron.unschedule('sla-breach-sweep'); exception when others then null; end $$;
select cron.schedule('sla-breach-sweep', '*/15 * * * *', 'select public.mark_sla_breaches()');

-- ============================================================
-- 5b) Discard an empty draft
-- ============================================================
create or replace function public.delete_empty_report(p_report uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status text;
  v_rows   bigint;
begin
  if not public.is_admin() then
    raise exception 'delete_empty_report: admin only' using errcode = '42501';
  end if;
  select r.status into v_status from public.reports r where r.id = p_report;
  if not found then
    raise exception 'delete_empty_report: report not found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'delete_empty_report: only a draft can be discarded (this report is %)', v_status using errcode = '42501';
  end if;
  if exists (select 1 from public.report_artifacts a where a.source_id = p_report) then
    raise exception 'delete_empty_report: this draft has saved PDF versions; it cannot be discarded' using errcode = '42501';
  end if;
  select
      (select count(*) from public.report_narratives x where x.report_id = p_report and coalesce(x.body, '') <> '')
    + (select count(*) from public.report_checklist_items x where x.report_id = p_report)
    + (select count(*) from public.compliance_responses x join public.compliance_assessments a on a.id = x.assessment_id where a.report_id = p_report)
    + (select count(*) from public.hazard_log x join public.compliance_assessments a on a.id = x.assessment_id where a.report_id = p_report)
    + (select count(*) from public.inspection_responses x join public.building_inspections b on b.id = x.inspection_id where b.report_id = p_report)
    + (select count(*) from public.expense_recoveries x where x.report_id = p_report)
    + (select count(*) from public.utility_readings x where x.report_id = p_report)
    + (select count(*) from public.utility_yields x where x.report_id = p_report)
    + (select count(*) from public.ppm_services x where x.report_id = p_report
         and (coalesce(x.overrides, '{}'::jsonb) <> '{}'::jsonb or coalesce(x.months, '{}'::jsonb) <> '{}'::jsonb))
    + (select count(*) from public.masterfile_items x where x.report_id = p_report)
    + (select count(*) from public.building_turnover x where x.report_id = p_report)
    + (select count(*) from public.tenant_turnover x where x.report_id = p_report)
    + (select count(*) from public.category_turnover x where x.report_id = p_report)
    + (select count(*) from public.footfall_counts x where x.report_id = p_report)
    + (select count(*) from public.toilet_fund x where x.report_id = p_report)
    + (select count(*) from public.vacancies x where x.report_id = p_report)
    + (select count(*) from public.leasing_waitlist x where x.report_id = p_report)
    + (select count(*) from public.tenant_movements x where x.report_id = p_report)
    + (select count(*) from public.trading_hour_breaches x where x.report_id = p_report)
    + (select count(*) from public.tenant_arrears x where x.report_id = p_report)
    + (select count(*) from public.loadshedding_log x where x.report_id = p_report)
    + (select count(*) from public.service_interruptions x where x.report_id = p_report)
    + (select count(*) from public.tenant_compliance x where x.report_id = p_report)
    + (select count(*) from public.security_incidents x where x.report_id = p_report)
    + (select count(*) from public.capex_items x where x.report_id = p_report)
    + (select count(*) from public.local_resources_contacts x where x.report_id = p_report)
    into v_rows;
  if v_rows > 0 then
    raise exception 'delete_empty_report: this draft has % saved row(s); clear its sections before discarding it', v_rows using errcode = '42501';
  end if;
  -- Scaffold only from here on: plan-seeded PPM rows, empty narratives, auto-created parents.
  delete from public.ppm_services where report_id = p_report;
  delete from public.report_narratives where report_id = p_report;
  delete from public.compliance_assessments where report_id = p_report;
  delete from public.building_inspections where report_id = p_report;
  delete from public.reports where id = p_report;
end $$;
revoke all on function public.delete_empty_report(uuid) from public;
revoke execute on function public.delete_empty_report(uuid) from anon;
grant execute on function public.delete_empty_report(uuid) to authenticated, service_role;

commit;

-- Verify:
--   select proname, prosrc ~ 'exists' from pg_proc where proname in ('is_admin','is_admin_or_manager');        -- true, true
--   select prosrc ~ 'is_active_user' from pg_proc where proname = 'app_role';                                   -- true
--   select has_table_privilege('anon', 'public.organizations', 'select'),
--          has_table_privilege('anon', 'public.organization_branding', 'select');                               -- false, true
--   select polname from pg_policy where polrelid = 'public.organizations'::regclass order by 1;
--     -- o_delete, o_insert, o_select_authenticated, o_update
--   select polname from pg_policy where polrelid = 'public.media_attachments'::regclass order by 1;             -- ma_* (4), all is_admin()
--   select count(*), min(day), max(day), bool_or(reconstructed) from public.building_metrics_daily;             -- 91 × buildings, today-90, today, true
--   select has_table_privilege('anon', 'public.building_metrics_daily', 'select'),
--          has_table_privilege('anon', 'public.portfolio_metrics_daily', 'select');                             -- false, false
--   select jobname, schedule from cron.job where jobname in ('metrics-snapshot-daily','sla-breach-sweep');      -- 0 3 * * *, */15 * * * *
--   select public.org_sla_hours('critical'), public.org_sla_hours('low');                                       -- 4, 168
--   select tgname from pg_trigger where tgrelid = 'public.issues'::regclass and not tgisinternal;               -- includes trg_issues_sla_defaults
--   select tgname from pg_trigger where tgrelid = 'public.issue_activity'::regclass and not tgisinternal;       -- trg_issue_activity_first_response
--   select conname from pg_constraint where conname = 'buildings_report_types_check';                           -- 1 row
--   select proname, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace
--     and proname in ('snapshot_building_metrics','mark_sla_breaches','delete_empty_report','org_sla_hours',
--                     'issues_sla_defaults','issue_activity_first_response');                                   -- 6 rows, true, {search_path=}
--   select proname, prosecdef from pg_proc where proname in ('expiring_items','expiring_items_at');            -- 2 rows, false (invoker)
--   select has_function_privilege('anon', 'public.expiring_items(integer)', 'execute'),
--          has_function_privilege('anon', 'public.snapshot_building_metrics(date,uuid)', 'execute'),
--          has_function_privilege('anon', 'public.mark_sla_breaches()', 'execute'),
--          has_function_privilege('anon', 'public.delete_empty_report(uuid)', 'execute');                       -- false ×4
--   Then: npm run smoke:snapshot; node scripts/rls-smoke.mjs; npm run smoke:notifications (Task 5's assertions).
