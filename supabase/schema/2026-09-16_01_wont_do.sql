-- 2026-09-16_01_wont_do.sql — S6b "Won't-do outcome" (docs/superpowers/specs/2026-09-13-pilot-field-design.md §5).
-- Additive, idempotent, one transaction. Apply order: staging (vkrihpmjajjcxmzgjqdr) -> notify pgrst ->
-- checklist-smoke + rls-smoke -> prod (qdzgkttiosahdfqresvz) -> notify pgrst -> rls-smoke. Requires
-- 2026-08-04_04 (task_instances_status_check), 2026-06-10_03 (task_completions_instance_uniq), 2026-09-12_01
-- (complete_task), 2026-09-13_05 (ppm_monthly_status as it stands), 2026-09-14_01 (snapshot_building_metrics,
-- building_metrics_daily, expiring_items_at) and 2026-09-15_01 (portfolio_coverage).
--
--   1) task_instances_status_check restated with 'wont_do' (a CHECK cannot be extended in place; the four
--      values it already has are copied verbatim from 2026-08-04_04). Every existing row is in the old list,
--      so the restated check validates without a scan surprise.
--   2) task_completions.outcome text not null default 'completed' check (completed | wont_do) and
--      task_completions.reason text. The reason lives on the completion, not the instance: the task list and
--      the evidence pack already read task_completions. Existing rows become outcome 'completed'.
--   3) complete_task gains p_outcome (default 'completed') and p_reason (default null). A plpgsql function with
--      a different parameter list is a NEW OVERLOAD under create or replace — the five-argument one would stay,
--      and PostgREST would then refuse every call that names only the five old parameters as ambiguous
--      ("Could not choose the best candidate function"). So the five-argument signature is dropped first and
--      the grants are restated on the seven-argument one; a caller passing the old five named parameters
--      still resolves, defaults fill the rest (verified below). Rules: outcome must be 'completed' or
--      'wont_do' (22023 otherwise); 'wont_do' needs a reason that is one of the fixed codes mirrored from
--      supabase/functions/_shared/wontDo.ts (area_locked, load_shedding, contractor_absent, no_materials) or
--      'other: <text>' with non-blank text (22023 otherwise, with a message a dialog can show); 'completed'
--      ignores the reason (stored null). On 'wont_do' the instance flips to status 'wont_do' with
--      completed_at = now() and completed_by = auth.uid(): the timestamp means "closed at", the status carries
--      the meaning. Signature and photo are not required here for either outcome; the dialog decides. Still
--      security INVOKER (tc_insert / ti_update apply unchanged), still idempotent on the completion id: a
--      second call for a closed instance reports already_completed whatever outcome it carries, and changes
--      nothing. Change the code list here and in wontDo.ts together.
--   4) snapshot_building_metrics: a task recorded as can't-do by the snapshot day is out of every task count —
--      neither numerator nor denominator of task_completion_30d_pct, never tasks_overdue, never tasks_due_7d.
--      "By the snapshot day" reads completed_at in SAST like the completed test does, so a reconstructed day
--      before the record still sees the task as open. issue_logged stays "not done", exactly as before.
--      Restated whole (plpgsql); the only changed lines are inside the `tk` lateral, plus the two column
--      comments. ppm_done_pct picks up (6) through the view.
--   5) portfolio_coverage.completed_yesterday counts 'wont_do' beside 'completed' and 'issue_logged': a
--      caretaker who recorded WHY the round could not be walked was there; the building is not "silent".
--      Restated whole (one-statement sql; same columns, same grants).
--   6) ppm_monthly_status maps 'wont_do' to 'missed'. A can't-do has a completion row, so it would satisfy
--      `tc.id is not null` and read as 'done' — the wont_do arm therefore comes FIRST in the case, tested on
--      both the instance status and the completion's outcome. Same column list, order and types as
--      2026-09-13_05 -> create or replace keeps the grants; security_invoker and the revokes restated anyway.
--      (2026-06-13_07's older definition was dropped by 2026-09-13_03; this is the one live view.)
--
-- No new tables, no new RLS surface: task_completions keeps tc_select / tc_insert (building access through
-- the instance) and tc_update / tc_delete (admin or manager); the two new columns fall under them. The status
-- vocabulary the iOS client decodes (2026-08-04_04 header) grows by one value — see the apply checklist.
begin;

-- ============================================================
-- 1) The status check, restated with wont_do appended.
-- ============================================================
alter table public.task_instances
  drop constraint if exists task_instances_status_check,
  add constraint task_instances_status_check
    check (status in ('pending','completed','overdue','issue_logged','wont_do'));

-- ============================================================
-- 2) The outcome and the reason, on the completion row.
-- ============================================================
alter table public.task_completions add column if not exists outcome text not null default 'completed';
alter table public.task_completions add column if not exists reason text;
alter table public.task_completions
  drop constraint if exists task_completions_outcome_check,
  add constraint task_completions_outcome_check check (outcome in ('completed','wont_do'));
comment on column public.task_completions.outcome is
  'completed, or wont_do when the task was closed with a reason instead of being done (S6b). The instance status matches.';
comment on column public.task_completions.reason is
  'Required when outcome = wont_do: one of area_locked, load_shedding, contractor_absent, no_materials, or ''other: <text>''. Null for completed.';

-- ============================================================
-- 3) complete_task with an outcome. Drop the five-argument signature FIRST (see the header).
-- ============================================================
drop function if exists public.complete_task(uuid, uuid, text, boolean, jsonb);
create or replace function public.complete_task(
  p_completion_id uuid, p_task_instance_id uuid, p_notes text default null,
  p_signature_confirmed boolean default false, p_photo_urls jsonb default '[]'::jsonb,
  p_outcome text default 'completed', p_reason text default null)
returns table (completion_id uuid, already_completed boolean)
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_id      uuid;
  v_outcome text := coalesce(p_outcome, 'completed');
  v_reason  text := nullif(btrim(p_reason), '');
begin
  if auth.uid() is null then
    raise exception 'complete_task: sign in required' using errcode = '42501';
  end if;
  if v_outcome not in ('completed', 'wont_do') then
    raise exception 'complete_task: outcome must be completed or wont_do, got %', v_outcome using errcode = '22023';
  end if;
  if v_outcome = 'wont_do' then
    if v_reason is null then
      raise exception 'complete_task: a reason is required when the outcome is wont_do' using errcode = '22023';
    end if;
    -- Mirrors WONT_DO_CODES in supabase/functions/_shared/wontDo.ts; "other" must carry text after the prefix.
    if v_reason not in ('area_locked', 'load_shedding', 'contractor_absent', 'no_materials')
       and v_reason !~ '^other: \S' then
      raise exception 'complete_task: unknown reason %', v_reason using errcode = '22023';
    end if;
  else
    v_reason := null;   -- a completed task carries no reason, whatever the caller sent
  end if;
  insert into public.task_completions (id, task_instance_id, completed_by, notes, signature_confirmed, photo_urls, outcome, reason)
  values (coalesce(p_completion_id, gen_random_uuid()), p_task_instance_id, auth.uid(),
          p_notes, coalesce(p_signature_confirmed, false), coalesce(p_photo_urls, '[]'::jsonb), v_outcome, v_reason)
  on conflict (task_instance_id) do nothing
  returning id into v_id;
  if v_id is not null then
    -- 'completed' or 'wont_do': the status IS the outcome; completed_at means "closed at" for both.
    update public.task_instances
       set status = v_outcome, completed_at = now(), completed_by = auth.uid()
     where id = p_task_instance_id;
    -- RLS hid the row (0 rows updated): raising here rolls the completion insert back too, so the
    -- caller never sees "completed" with the instance still pending.
    if not found then
      raise exception 'complete_task: not allowed to update this task' using errcode = '42501';
    end if;
    return query select v_id, false;
  else
    select tc.id into v_id from public.task_completions tc where tc.task_instance_id = p_task_instance_id;
    return query select v_id, true;
  end if;
end $$;
revoke all on function public.complete_task(uuid, uuid, text, boolean, jsonb, text, text) from public;
revoke execute on function public.complete_task(uuid, uuid, text, boolean, jsonb, text, text) from anon;
grant execute on function public.complete_task(uuid, uuid, text, boolean, jsonb, text, text) to authenticated;

-- ============================================================
-- 4) snapshot_building_metrics: wont_do out of every task count. Restated whole; the changed lines are
--    the two `wont_do` expressions in the `tk` lateral, the three filters that use it, and the comments.
-- ============================================================
comment on column public.building_metrics_daily.task_completion_30d_pct is
  'Share of task instances due in the trailing 30 days that were completed by that day. Only status completed counts as done; issue_logged counts as not done; a task recorded as wont_do by that day is out of both numerator and denominator.';
comment on column public.building_metrics_daily.tasks_overdue is
  'Task instances due before the day and not completed by it (pending, overdue and issue_logged alike). A task recorded as wont_do by that day is not overdue.';

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
                and coalesce((ti.completed_at at time zone 'Africa/Johannesburg')::date, ti.due_date) <= v_day) as done,
               -- S6b: recorded as can't-do by v_day -> out of every count below (neither done nor open).
               (ti.status = 'wont_do'
                and coalesce((ti.completed_at at time zone 'Africa/Johannesburg')::date, ti.due_date) <= v_day) as wont_do
          from public.task_instances ti
         where ti.building_id = b.id
           and ti.due_date between v_day - 365 and v_day + 6)   -- every status: issue_logged is "not done"
      select round(100.0 * count(*) filter (where done and due_date between v_day - 29 and v_day)
                   / nullif(count(*) filter (where not wont_do and due_date between v_day - 29 and v_day), 0), 1) as completion_pct,
             count(*) filter (where not done and not wont_do and due_date < v_day)::int as overdue,
             count(*) filter (where not done and not wont_do and due_date between v_day and v_day + 6)::int as due_7d
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
    report_state = excluded.report_state, reconstructed = excluded.reconstructed, computed_at = now()
  where m.day >= v_today or m.reconstructed;   -- never overwrite a genuine nightly row for a past day
  get diagnostics v_count = row_count;

  if p_building is null then
    delete from public.building_metrics_daily where day < v_today - 400;
  end if;
  return v_count;
end $$;
revoke all on function public.snapshot_building_metrics(date, uuid) from public;
revoke execute on function public.snapshot_building_metrics(date, uuid) from anon;
grant execute on function public.snapshot_building_metrics(date, uuid) to authenticated, service_role;

-- ============================================================
-- 5) portfolio_coverage: a can't-do with a reason is activity. Restated whole; the one changed
--    predicate is completed_yesterday.
-- ============================================================
create or replace function public.portfolio_coverage()
returns table (
  building_id uuid,
  building_name text,
  field_members integer,
  role_rules integer,
  has_user_rule boolean,
  unassigned_open integer,
  overdue_open integer,
  due_yesterday integer,
  completed_yesterday integer)
language sql stable security invoker
set search_path = ''
as $$
  with yday as (
    select ((now() at time zone 'Africa/Johannesburg')::date - 1) as d
  )
  select b.id as building_id,
         b.name as building_name,
         (select count(*)::int
            from public.user_buildings ub
            join public.profiles p on p.id = ub.user_id
           where ub.building_id = b.id
             and coalesce(p.deactivated, false) = false
             and (select r.role from public.user_roles r where r.user_id = p.id
                   order by case r.role when 'admin' then 0 when 'manager' then 1 else 3 end limit 1) = 'user'
         ) as field_members,
         bra.role_rules,
         bra.has_user_rule,
         ti.unassigned_open,
         ti.overdue_open,
         ti.due_yesterday,
         ti.completed_yesterday
    from public.buildings b
   cross join yday
    left join lateral (
      select count(*)::int                              as role_rules,
             coalesce(bool_or(x.role = 'user'), false)  as has_user_rule
        from public.building_role_assignments x
       where x.building_id = b.id
    ) bra on true
    left join lateral (
      select count(*) filter (where t.status in ('pending','overdue') and t.assigned_to is null)::int as unassigned_open,
             count(*) filter (where t.status = 'overdue')::int                                      as overdue_open,
             count(*) filter (where t.frequency = 'daily' and t.due_date = yday.d)::int              as due_yesterday,
             -- completed, issue_logged or wont_do: somebody was there and said what happened (S6b adds wont_do)
             count(*) filter (where t.frequency = 'daily' and t.due_date = yday.d
                                and t.status in ('completed','issue_logged','wont_do'))::int         as completed_yesterday
        from public.task_instances t
       where t.building_id = b.id
    ) ti on true
   order by b.name nulls last, b.id;
$$;
revoke all on function public.portfolio_coverage() from public;
revoke execute on function public.portfolio_coverage() from anon;
grant execute on function public.portfolio_coverage() to authenticated, service_role;

-- ============================================================
-- 6) ppm_monthly_status: wont_do is missed, and it is tested BEFORE the completion-row arm.
-- ============================================================
create or replace view public.ppm_monthly_status with (security_invoker = on) as
select ti.building_id,
       ti.source_ppm_id                            as ppm_service_id,
       s.service_name,
       to_char(ti.due_date, 'YYYY-MM')             as period_month,
       case when ti.status = 'wont_do' or tc.outcome = 'wont_do' then 'missed'   -- S6b: a can't-do has a completion row; it is not done
            when tc.id is not null or ti.status = 'completed' then 'done'
            when ti.status = 'issue_logged' then 'missed'
            when ti.due_date < (now() at time zone 'Africa/Johannesburg')::date then 'missed'
            else 'due' end                          as status,
       (coalesce(tc.created_at, ti.completed_at) at time zone 'Africa/Johannesburg')::date as done_on
from public.task_instances ti
join public.building_ppm_services s on s.id = ti.source_ppm_id
left join public.task_completions tc on tc.task_instance_id = ti.id
where ti.source_ppm_id is not null;
revoke all on public.ppm_monthly_status from anon;
revoke insert, update, delete, truncate, references, trigger on public.ppm_monthly_status from authenticated;

commit;

-- Verify (staging, as service role):
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'task_instances_status_check';  -- … 'wont_do'
--   select column_name, data_type, column_default from information_schema.columns
--    where table_name = 'task_completions' and column_name in ('outcome','reason');                -- outcome text 'completed', reason text
--   select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'complete_task';  -- 1
--   select pg_get_function_identity_arguments(oid) from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'complete_task';   -- … p_outcome text, p_reason text
--   select has_function_privilege('anon', 'public.complete_task(uuid,uuid,text,boolean,jsonb,text,text)', 'execute'),          -- false
--          has_function_privilege('authenticated', 'public.complete_task(uuid,uuid,text,boolean,jsonb,text,text)', 'execute'); -- true
--   select pg_get_functiondef('public.snapshot_building_metrics(date,uuid)'::regprocedure) ~ 'wont_do';   -- true
--   select pg_get_functiondef('public.portfolio_coverage()'::regprocedure) ~ 'wont_do';                    -- true
--   select pg_get_viewdef('public.ppm_monthly_status') ~ 'wont_do',
--          (select reloptions from pg_class where relname = 'ppm_monthly_status');                      -- true, {security_invoker=on}
--   notify pgrst, 'reload schema';
--   Then: node scripts/checklist-smoke.mjs (the S6b block: reason-less refused, wont_do lands with its reason,
--   the old five-argument call still works) and node scripts/rls-smoke.mjs (userB cannot record a can't-do on A).
