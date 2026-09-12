-- 2026-09-15_04_overdue_notify.sql
-- Field readiness S4 "Nudges" (docs/superpowers/specs/2026-09-12-field-readiness-design.md §7). Additive
-- and idempotent, one transaction. Requires 2026-09-12_01 (mark_overdue_tasks, task_instances.assigned_to,
-- the task-overdue-sweep cron) and 2026-09-14_03 (the notifications kind check this file restates).
--
--   1) notifications_kind_check gains 'task_overdue'. Restated as the full list because a CHECK cannot
--      be extended in place; the first nineteen kinds are copied verbatim from 2026-09-14_03.
--   2) mark_overdue_tasks() becomes plpgsql. Same name, same integer return (the number of tasks
--      flipped), same grants — service role only, so the existing cron line
--      ('task-overdue-sweep': select public.mark_overdue_tasks()) and scripts/checklist-smoke.mjs keep
--      working untouched. For every task it flips pending -> overdue it now inserts one notifications
--      row for the assignee, when there is one and that profile is not deactivated, in the
--      mark_sla_breaches style (2026-09-14_01): kind task_overdue, entity task, url /my-day, no actor.
--      An unassigned task still flips; it just tells nobody. Managers are not written to per task —
--      the daily digest's coverage section (S1) carries overdue and silent buildings for them.
--      No email and no push: these rows never pass through createNotifications, and notifyRules.ts
--      lists task_overdue as DIGEST_ONLY (the morning task_due_today push already leads with the
--      overdue count). No preference check here for the same reason mark_sla_breaches has none: an
--      inbox row is the record, and the row is read only by its recipient (n_select_own).
--      Idempotent by construction: a task flips once, so it notifies once.
--      Caller guard as in mark_sla_breaches: a signed-in caller who is not an admin or manager is
--      refused with 42501; a null auth.uid() (pg_cron as postgres, the service role) passes.
--
-- No new tables, no new columns, no new RLS surface. notifications keeps its owner-only policies and
-- no insert policy; the function is security definer with search_path '' and is revoked from public,
-- anon and authenticated.
begin;

-- ============================================================
-- 1) The kind check, restated with task_overdue appended.
-- ============================================================
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'task_assigned','issue_assigned','issue_comment','issue_mention',
  'report_submitted','report_returned','report_approved',
  'form_submitted','form_reviewed','signoff_requested','signoff_complete','signoff_overdue',
  'document_expiring','asset_service_due','task_due_today',
  'issue_sla_breached',
  'report_due_soon','report_export_needed',
  'issue_reported',
  'task_overdue'));

-- ============================================================
-- 2) The overdue sweep, now telling the assignee.
-- ============================================================
-- Runs from pg_cron as postgres (auth.uid() is null) and from the smokes as the service role. The
-- grants already keep sessions out; the caller guard below is the same belt-and-braces line
-- mark_sla_breaches carries (2026-09-14_01), so a signed-in caller who is not an admin or manager
-- is refused even if a grant ever drifts.
-- The body prints the due date as "1 Jan" while it is in the current SAST year and "1 Jan 2025"
-- once it is not, so a task that slept across New Year is not read as a fresh miss.
create or replace function public.mark_overdue_tasks()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_year  integer := extract(year from (now() at time zone 'Africa/Johannesburg'))::int;
  r record;
begin
  if auth.uid() is not null and not public.is_admin_or_manager() then
    raise exception 'mark_overdue_tasks: admin or manager only' using errcode = '42501';
  end if;
  for r in
    update public.task_instances t
       set status = 'overdue'
     where t.status = 'pending'
       and t.due_date < (now() at time zone 'Africa/Johannesburg')::date
    returning t.id, t.task_name, t.building_id, t.assigned_to, t.due_date
  loop
    v_count := v_count + 1;
    if r.assigned_to is null then
      continue;
    end if;
    insert into public.notifications (recipient_id, actor_id, actor_name, kind, entity_type, entity_id, building_id, title, body, url)
    select p.id, null, null, 'task_overdue', 'task', r.id, r.building_id,
           left('Overdue: ' || r.task_name, 200),
           'Was due ' || to_char(r.due_date, case when extract(year from r.due_date)::int = v_year then 'FMDD Mon' else 'FMDD Mon YYYY' end),
           '/my-day'
      from public.profiles p
     where p.id = r.assigned_to
       and not coalesce(p.deactivated, false);
  end loop;
  return v_count;
end $$;
revoke all on function public.mark_overdue_tasks() from public;
revoke execute on function public.mark_overdue_tasks() from anon, authenticated;
grant execute on function public.mark_overdue_tasks() to service_role;

commit;

-- Verify (staging, as service role):
--   select pg_get_constraintdef(oid) ~ 'task_overdue' from pg_constraint where conname = 'notifications_kind_check'; -- true
--   select prolang::regtype is not null, prosecdef from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'mark_overdue_tasks';   -- 1 row, prosecdef = true
--   select has_function_privilege('anon', 'public.mark_overdue_tasks()', 'execute'),          -- false
--          has_function_privilege('authenticated', 'public.mark_overdue_tasks()', 'execute'), -- false
--          has_function_privilege('service_role', 'public.mark_overdue_tasks()', 'execute');  -- true
--   select jobname, schedule, command from cron.job where jobname = 'task-overdue-sweep';     -- unchanged
--   Then: node scripts/checklist-smoke.mjs (the sweep block: one task_overdue row for the assignee,
--   none for the unassigned task, none added by a second sweep).
