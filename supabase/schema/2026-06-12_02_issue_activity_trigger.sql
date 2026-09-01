-- 2026-06-12_02_issue_activity_trigger.sql
-- F-32: the issue lifecycle had NO audit trail on web — issue_activity was
-- never written by the web app (0 client writes, 0 rows). Owner ruling
-- 2026-06-12: log it via a DB trigger (robust across all writers) rather than
-- per-client code. This makes the trigger the canonical logger of issue
-- created / status_change / assignment for every client.
--
-- iOS caveat: the deployed iOS app (IssueDetailView) ALSO self-logs
-- 'status_change' (and 'contractor_assignment'/'comment') through its offline
-- queue. The web pilot logs nothing, so for web this trigger is the sole,
-- clean source. iOS-driven status changes will double-log until a future iOS
-- build removes its manual logActivity(type:"status_change") call — TODO noted
-- in the iOS spec. 'assignment' (assigned_to user) is NOT logged by iOS
-- (it logs 'contractor_assignment', a different event), so no overlap there.
-- 'comment' and 'contractor_assignment' stay client-written (not covered here).
--
-- Apply staging (vkrihpmjajjcxmzgjqdr) first, then prod.
begin;

create or replace function public.log_issue_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(auth.uid(), case when tg_op = 'INSERT' then new.reported_by else null end);
  v_name  text;
begin
  if v_actor is not null then
    select full_name into v_name from public.profiles where id = v_actor;
  end if;

  if tg_op = 'INSERT' then
    insert into public.issue_activity (issue_id, user_id, activity_type, new_value, author_name)
    values (new.id, v_actor, 'created', new.status, v_name);
    return new;
  end if;

  -- UPDATE: one row per changed dimension
  if new.status is distinct from old.status then
    insert into public.issue_activity (issue_id, user_id, activity_type, old_value, new_value, author_name)
    values (new.id, v_actor, 'status_change', old.status, new.status, v_name);
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into public.issue_activity (issue_id, user_id, activity_type, old_value, new_value, author_name)
    values (new.id, v_actor, 'assignment', old.assigned_to::text, new.assigned_to::text, v_name);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_issues_activity_log on public.issues;
create trigger trg_issues_activity_log
  after insert or update on public.issues
  for each row execute function public.log_issue_activity();

commit;
