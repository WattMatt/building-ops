-- 2026-09-15_01_team_coverage.sql — S1 "Team & coverage" (field-readiness spec §4.1).
-- Additive, idempotent, one transaction. Apply order: staging (vkrihpmjajjcxmzgjqdr) ->
-- rls-smoke -> prod (qdzgkttiosahdfqresvz) -> rls-smoke. iOS ignores unknown functions.
--
-- Why:
--  1) user_buildings writes were admin-only (ub_insert_admin / ub_update_admin / ub_delete_admin,
--     2026-06-10_01_security_user_roles.sql:83-89), so a manager could not put field staff on a
--     building at all. Owner decision 2026-09-12: managers may grant access, scoped to buildings
--     they can access. can_access_building() is true for every building when the caller is a
--     manager today, so the scope clause is a no-op until manager access is ever narrowed; it is
--     written in so the policy already states the intended rule. Self-grant by a `user` stays
--     impossible (neither branch is true for them).
--  2) assignable_people(): the Team tab must offer people who are NOT yet members of the building,
--     and profiles RLS (p_select: own row or admin/manager) plus user_roles RLS mean a manager can
--     read them, but building_members(b) deliberately returns only members. SECURITY DEFINER,
--     gated on is_admin_or_manager() — anyone else gets an error, not an empty list, so a client
--     cannot mistake "forbidden" for "nobody". Granted to authenticated only: a service_role grant
--     would be dead, because is_admin_or_manager() is false when auth.uid() is null.
--  3) portfolio_coverage(): one row per building with the counts every coverage surface needs
--     (dashboard widget, Buildings badge, digest). SECURITY INVOKER on purpose: RLS scopes it to
--     the caller's buildings (b_select / ti_select / ub_select / ur_select / p_select), and the
--     service role sees everything. A field user therefore sees only their own buildings and,
--     because ub_select/p_select/ur_select show them only their own rows, counts only themselves
--     as a field member — the function is rendered for admins and managers only, who see all.
begin;

-- ------------------------------------------------------------------------------------------
-- 1) user_buildings: writes for admins, and for managers on buildings they can access.
--    ONE `for all` policy, named as the spec names it. `for all` also covers SELECT, which is
--    safe here: its USING clause (is_admin() or (is_admin_or_manager() and can_access_building))
--    is strictly narrower than ub_select's (user_id = auth.uid() or is_admin_or_manager()), and
--    permissive policies OR together, so the visible set is unchanged and ub_select stays the
--    only rule that grants a user their own rows. Three separate policies would say the same
--    thing three times.
-- ------------------------------------------------------------------------------------------
drop policy if exists ub_insert_admin on public.user_buildings;
drop policy if exists ub_update_admin on public.user_buildings;
drop policy if exists ub_delete_admin on public.user_buildings;
drop policy if exists ub_write_managed on public.user_buildings;
create policy ub_write_managed on public.user_buildings
  for all
  using (public.is_admin() or (public.is_admin_or_manager() and public.can_access_building(building_id)))
  with check (public.is_admin() or (public.is_admin_or_manager() and public.can_access_building(building_id)));

-- ------------------------------------------------------------------------------------------
-- 2) assignable_people(): every profile that holds a user_roles row, with the same role
--    precedence as building_members() (admin > manager > anything else). Deactivated people
--    are returned with the flag rather than hidden, so the Team tab can explain rather than
--    silently omit. Admin/manager only; raises 42501 (-> HTTP 403) for anyone else.
-- ------------------------------------------------------------------------------------------
create or replace function public.assignable_people()
returns table (id uuid, full_name text, avatar_url text, role text, deactivated boolean)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_admin_or_manager() then
    raise exception 'assignable_people: admin or manager only' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.avatar_url,
           (select r.role from public.user_roles r where r.user_id = p.id
             order by case r.role when 'admin' then 0 when 'manager' then 1 else 3 end limit 1) as role,
           coalesce(p.deactivated, false) as deactivated
      from public.profiles p
     where exists (select 1 from public.user_roles r where r.user_id = p.id)
     order by p.full_name nulls last;
end $$;
revoke all on function public.assignable_people() from public;
revoke execute on function public.assignable_people() from anon;
grant execute on function public.assignable_people() to authenticated;

-- ------------------------------------------------------------------------------------------
-- 3) portfolio_coverage(): one row per building the caller can see.
--    field_members      active profiles whose most privileged role is 'user' with a
--                       user_buildings row here (precedence CASE mirrors building_members)
--    role_rules         rows in building_role_assignments for this building
--    has_user_rule      a rule exists for label 'user' (the daily-task default)
--    unassigned_open    task_instances pending or overdue with assigned_to null
--    overdue_open       task_instances in status 'overdue'
--    due_yesterday      daily task_instances (frequency = 'daily') due yesterday, SAST
--    completed_yesterday  of those, status 'completed' OR 'issue_logged' — a caretaker who
--                       walked the round and logged an issue on a task did the work; the
--                       building is not "silent" because the answer was a problem.
--    "Yesterday" is the Africa/Johannesburg calendar date minus one, the same clock
--    generate_scheduled_tasks and mark_overdue_tasks use.
--    The task_instances counts come from ONE lateral aggregate per building and the
--    building_role_assignments counts from another: with SECURITY INVOKER every candidate row
--    is filtered by ti_select / bra_select, which call the definer can_access_building(); four
--    correlated subqueries would run that filter over the same rows four times per building.
-- ------------------------------------------------------------------------------------------
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
             count(*) filter (where t.frequency = 'daily' and t.due_date = yday.d
                                and t.status in ('completed','issue_logged'))::int                   as completed_yesterday
        from public.task_instances t
       where t.building_id = b.id
    ) ti on true
   order by b.name nulls last, b.id;
$$;
revoke all on function public.portfolio_coverage() from public;
revoke execute on function public.portfolio_coverage() from anon;
grant execute on function public.portfolio_coverage() to authenticated, service_role;

commit;

-- Verify (staging, as service role):
--   select policyname, cmd from pg_policies where tablename = 'user_buildings' order by 1;
--     -> ub_select (SELECT), ub_write_managed (ALL)
--   select proname, prosecdef from pg_proc where pronamespace = 'public'::regnamespace
--     and proname in ('assignable_people','portfolio_coverage') order by 1;
--     -> assignable_people t, portfolio_coverage f
--   select count(*) from public.portfolio_coverage();   -> number of buildings
