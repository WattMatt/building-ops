# S1 "Team & coverage" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manager can put field staff on a building and say what they do there from one Team tab; every surface a manager already looks at (dashboard, Buildings list, invite dialog, morning digest) names the buildings that have nobody; a field-staff account can no longer be created with no building.

**Architecture:** One additive migration authored in `../GMI/sql/` and vendored: `user_buildings` writes open to managers (scoped by `can_access_building`), `assignable_people()` (SECURITY DEFINER, admin/manager only — a manager cannot read every profile through RLS) and `portfolio_coverage()` (SECURITY INVOKER, one row per building the caller can see; the service role sees all). Two TanStack hooks wrap the RPCs. A new `team` tab on `BuildingDetails` (admin/manager only) owns membership, role chips and "Apply to existing pending tasks"; `RoleAssignmentsPanel` on Checklists shrinks to a read-only summary with a guardrail. `CoverageWidget` on the dashboard and a "No team" badge on Buildings read `portfolio_coverage()`. The invite dialog and the `invite-user` edge function both refuse a `user` with no building. `composeDigest` gains a pure Coverage section fed by one service-role `portfolio_coverage()` call. Every write chains `.select('id')` and treats zero rows as failure.

**Tech Stack:** Postgres (plpgsql, RLS), Supabase JS, React 18 + TS, TanStack Query v5, shadcn/ui, vitest + Testing Library, Deno edge functions (read-verified only — no local Deno).

**Spec:** `docs/superpowers/specs/2026-09-12-field-readiness-design.md` §2, §4, §9.

**Ground rules for every agent:** never `git stash` / `checkout` / `switch` / `reset` / `worktree`; compare with `git show <sha>:<path>`; edit only the files your task names; commit with an explicit pathspec; retry after 5 s on `index.lock`; end commit messages with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; gate = `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E '<your files>'` prints nothing, `npm run test -- <pattern>` green, global count ≤ `.github/typecheck-baseline.txt` (46) on a clean tree; the new RPC names are not in the generated types until the controller regenerates them after the prod apply, so cast at the boundary with the comment `// <name> is not yet in the generated types; regenerate after the migration ships.`; guardrail copy plain, coaching through `<Hint>`; mobile-first, 44 px controls; every new function `revoke execute … from anon`.

**Facts every task relies on (verified in source 2026-09-12):**
- `user_buildings` (`supabase/schema/2026-06-10_01_security_user_roles.sql:67-90`): `id, user_id → auth.users, building_id, created_at`, `unique (user_id, building_id)`; policies `ub_select` (own row or `is_admin_or_manager()`), `ub_insert_admin` / `ub_update_admin` / `ub_delete_admin` (`is_admin()`).
- `can_access_building(b)` current definition is `2026-09-11_03_deactivated_rls_gate.sql:51-62`: `is_admin_or_manager() or (is_active_user() and exists user_buildings row)`. `is_admin_or_manager()` at `:42-49`.
- `building_members(b)` current definition is `2026-09-13_01_r3_schedule.sql` §6 (role precedence CASE `admin 0 / manager 1 / else 3`); the client hook is `src/hooks/useBuildingMembers.ts` → `{ data: BuildingMember[], byId, isLoading, isError, refetch }`, `BuildingMember = { id, full_name, avatar_url, role }`, `memberDisplayName(m)`.
- `building_role_assignments` (`2026-09-13_01_r3_schedule.sql:195-210`): `(building_id, role) pk, user_id, updated_at`; `bra_select` by access, `bra_write` admin/manager with access. The generator's assignment subquery is `:254-258`. The intake function reads rules `'issue'` then `'user'` (`supabase/functions/tenant-intake/index.ts:316-323`).
- `src/hooks/useBuildingRoleAssignments.ts` → `{ rules: Map<role, userId>, roles: string[], pendingByRole: Map<role, n>, isLoading, isError, setRule(role, userId|null), applyToPending(): Promise<number> }`. `setRule` already exists (upsert on `building_id,role`, delete when null) — the plan reuses it; no hook change.
- `task_instances.status` ∈ `('pending','completed','overdue','issue_logged')` (`2026-08-04_04_enum_check_constraints.sql:43`); `frequency` ∈ `('daily','weekly','monthly','quarterly','annually')` (`:48`); `complete_task` sets `status = 'completed'` (`2026-09-12_01_r2_field.sql:120`). `mark_overdue_tasks` flips `pending → overdue` nightly by SAST date (`:81-93`).
- `profiles.deactivated boolean not null default false` (`2026-08-04_05_staging_profiles_reconcile.sql:24`); `p_select` = own row or admin/manager; `ur_select` = own row or admin/manager; `b_select` / `ti_select` = `can_access_building`.
- `BuildingDetails.tsx` seeds `activeTab` straight from `?tab=` (`:49`) and syncs later changes (`:64-68`); there is **no allow-list** of tab values anywhere in `src/` (grep for `'maintenance', 'electrical'` / `['overview'` finds nothing) — the "allow list" is the set of `TabsTrigger`/`TabsContent` values. Tabs at `:202-231`, content at `:342-380`.
- `RoleAssignmentsPanel` is mounted once, `ChecklistsTab.tsx:413-415`, with `onApplied={fetchTasks}`.
- `Dashboard.tsx:250-257` is the `lg:grid-cols-2` grid holding `WaitingOnYouWidget` + `PendingSubmissionsWidget`, admin/manager only. `Buildings.tsx:207-240` is the card header; `Badge` is already imported (`:8`).
- `UserManagement.tsx`: invite state `:107-113`, `handleInvite` `:264-309`, dialog `:496-539` (label "Building Access (optional)", help text `:536-538`), submit button `:574-577`; `toast` from `sonner` (`:60`); no `useNavigate` import yet.
- `invite-user/index.ts`: role/buildingIds parsed `:90-91`, validated `:181-183`, `user_buildings` written `:240-247`.
- `daily-digest/index.ts` computes `adminIds` + `expiring` at `:114-127` and calls `composeDigest` at `:283-285`; `_shared/digest.ts` `DigestInput` `:29-37`, `composeDigest` `:66-107`, `SECTION_MAX = 15`; tests in `src/lib/digest.test.ts` import from `../../supabase/functions/_shared/digest`.
- `scripts/rls-smoke.mjs`: personas `admin, manager, userA (user, building A), userB (user, building B), norole` (`:228-232`); helpers `canInsert` (`:100-110`, deletes what it created), `rpcCall(jwt, fn, args) → { ok, status, body, code, rows }` (`:133-143`); the `user_buildings` block is `:355-359`; the last feature block ends before `// ════ Teardown` at `:1051`.
- **No vendored file creates the base tables** (`grep -l 'create table.*public.task_instances' supabase/schema/*.sql` prints nothing; same for `profiles`, `buildings`, `user_roles`): the mirror starts at the 2026-06-10 hardening, on top of a schema that predates it. The throwaway-Postgres recipe in Task 1 therefore applies a shim that reproduces exactly the objects this migration reads or alters (copied verbatim from the vendored files, cited per object), then the new migration, then the assertions. It does not pretend the whole mirror can be replayed on a blank cluster.
- Postgres 17 binaries: `/opt/homebrew/opt/postgresql@17/bin/{initdb,pg_ctl,psql}`. `deno` is not installed — edge functions are read-verified and deployed by the controller.

---

### Task 1: Migration + throwaway-Postgres verification + RLS smoke assertions

**Files:**
- Create: `../GMI/sql/2026-09-15_01_team_coverage.sql`
- Run: `npm run schema:vendor` → `supabase/schema/2026-09-15_01_team_coverage.sql`, `supabase/schema/.source`
- Modify: `scripts/rls-smoke.mjs` (`:357` flips; new block before `// ════ Teardown`)
- Scratch only (not committed): `$SCRATCH/pg17/shim.sql`, `$SCRATCH/pg17/verify.sql`

- [x] **Step 1: Write the migration** (exact content):

```sql
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
--     cannot mistake "forbidden" for "nobody".
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
grant execute on function public.assignable_people() to authenticated, service_role;

-- ------------------------------------------------------------------------------------------
-- 3) portfolio_coverage(): one row per building the caller can see.
--    field_members      active profiles whose most privileged role is 'user' with a
--                       user_buildings row here (precedence CASE mirrors building_members)
--    role_rules         rows in building_role_assignments for this building
--    has_user_rule      a rule exists for label 'user' (the daily-task default)
--    unassigned_open    task_instances pending or overdue with assigned_to null
--    overdue_open       task_instances in status 'overdue'
--    due_yesterday      daily task_instances (frequency = 'daily') due yesterday, SAST
--    completed_yesterday  of those, status 'completed'
--    "Yesterday" is the Africa/Johannesburg calendar date minus one, the same clock
--    generate_scheduled_tasks and mark_overdue_tasks use.
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
         (select count(*)::int from public.building_role_assignments bra where bra.building_id = b.id) as role_rules,
         exists (select 1 from public.building_role_assignments bra where bra.building_id = b.id and bra.role = 'user') as has_user_rule,
         (select count(*)::int from public.task_instances t
           where t.building_id = b.id and t.status in ('pending','overdue') and t.assigned_to is null) as unassigned_open,
         (select count(*)::int from public.task_instances t
           where t.building_id = b.id and t.status = 'overdue') as overdue_open,
         (select count(*)::int from public.task_instances t, yday
           where t.building_id = b.id and t.frequency = 'daily' and t.due_date = yday.d) as due_yesterday,
         (select count(*)::int from public.task_instances t, yday
           where t.building_id = b.id and t.frequency = 'daily' and t.due_date = yday.d and t.status = 'completed') as completed_yesterday
    from public.buildings b
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
```

- [x] **Step 2: Vendor and confirm**

```bash
npm run schema:vendor
ls supabase/schema | grep 2026-09-15_01
grep -c 'vendored_files: 105' supabase/schema/.source
```
Expected: `2026-09-15_01_team_coverage.sql` listed; `.source` shows `vendored_files: 105` (was 104) and the new GMI commit.

- [x] **Step 3: Verify on a throwaway Postgres 17.** The mirror cannot be replayed on a blank cluster (see Facts), so build a shim of exactly the objects the migration touches, copied from the vendored files, then apply the vendored migration, then assert. Everything lives in the scratchpad and is torn down at the end.

```bash
export LC_ALL=C
PG=/opt/homebrew/opt/postgresql@17/bin
SCRATCH="/private/tmp/claude-501/-Volumes-Extreme-SSD-DEVELOPER-APPS-FORTRESS-OPPS/3a19cdbf-6bae-4549-97f8-a26c108bf6f4/scratchpad/pg17"
mkdir -p "$SCRATCH"
"$PG/initdb" -D "$SCRATCH/data" -U postgres --no-locale -E UTF8 >"$SCRATCH/initdb.log" 2>&1 && echo initdb-ok
"$PG/pg_ctl" -D "$SCRATCH/data" -l "$SCRATCH/pg.log" \
  -o "-p 55433 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start
"$PG/psql" -h 127.0.0.1 -p 55433 -U postgres -c 'create database fortress'
```
Expected: `initdb-ok`, `server started`, `CREATE DATABASE`.

Write `$SCRATCH/shim.sql` (each object is a verbatim copy of the cited vendored lines, minus what this migration does not touch):

```sql
-- shim.sql: the slice of the live schema that 2026-09-15_01_team_coverage.sql reads or alters.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key);
-- auth.uid() as Supabase resolves it from the JWT claim; the assertions set the claim per persona.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, avatar_url text, email text,
  deactivated boolean not null default false               -- 2026-08-04_05_staging_profiles_reconcile.sql:24
);
create table public.user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin','manager','user'))   -- 2026-09-13_01_r3_schedule.sql §6
);
create table public.buildings (id uuid primary key default gen_random_uuid(), name text);
create table public.task_instances (
  id uuid primary key default gen_random_uuid(),
  building_id uuid references public.buildings(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','completed','overdue','issue_logged')),
  frequency text check (frequency in ('daily','weekly','monthly','quarterly','annually')),
  due_date date, responsible_role text,
  assigned_to uuid references public.profiles(id) on delete set null
);
-- 2026-06-10_01_security_user_roles.sql:67-90, verbatim
create table if not exists public.user_buildings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, building_id)
);
alter table public.user_buildings enable row level security;
grant select, insert, update, delete on public.user_buildings to authenticated;
revoke all on public.user_buildings from anon;
create policy ub_select on public.user_buildings
  for select using (user_id = auth.uid() or public.is_admin_or_manager());
create policy ub_insert_admin on public.user_buildings
  for insert with check (public.is_admin());
create policy ub_update_admin on public.user_buildings
  for update using (public.is_admin()) with check (public.is_admin());
create policy ub_delete_admin on public.user_buildings
  for delete using (public.is_admin());
-- 2026-09-13_01_r3_schedule.sql:195-210, verbatim
create table if not exists public.building_role_assignments (
  building_id uuid not null references public.buildings(id) on delete cascade,
  role        text not null,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  primary key (building_id, role)
);
alter table public.building_role_assignments enable row level security;
create policy bra_select on public.building_role_assignments
  for select using (public.can_access_building(building_id));
create policy bra_write on public.building_role_assignments
  for all
  using (public.is_admin_or_manager() and public.can_access_building(building_id))
  with check (public.is_admin_or_manager() and public.can_access_building(building_id));
-- 2026-09-11_03_deactivated_rls_gate.sql:21-62, verbatim
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and not coalesce((select p.deactivated from public.profiles p where p.id = auth.uid()), false)
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_user()
     and coalesce((select role from public.user_roles where user_id = auth.uid()) = 'admin', false)
$$;
create or replace function public.is_admin_or_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_user()
     and coalesce((select role from public.user_roles where user_id = auth.uid()) in ('admin','manager'), false)
$$;
create or replace function public.can_access_building(b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin_or_manager()
      or ( public.is_active_user()
           and exists (
             select 1 from public.user_buildings ub
             where ub.user_id = auth.uid() and ub.building_id = b
           ) )
$$;
-- 2026-06-10_01 :48-49 and 2026-06-10_02 :30, :73, :184 — the select policies the invoker function runs under
alter table public.profiles enable row level security;
create policy p_select on public.profiles for select using (id = auth.uid() or public.is_admin_or_manager());
alter table public.user_roles enable row level security;
create policy ur_select on public.user_roles for select using (user_id = auth.uid() or public.is_admin_or_manager());
alter table public.buildings enable row level security;
create policy b_select on public.buildings for select using (public.can_access_building(id));
alter table public.task_instances enable row level security;
create policy ti_select on public.task_instances for select using (public.can_access_building(building_id));
grant usage on schema public, auth to anon, authenticated, service_role;
grant select on all tables in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- Fixture: two buildings, four people, tasks at A. Fixed ids keep the assertions literal.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'), ('00000000-0000-0000-0000-000000000004');
insert into public.profiles (id, full_name) values
  ('00000000-0000-0000-0000-000000000001', 'Admin A'), ('00000000-0000-0000-0000-000000000002', 'Manager M'),
  ('00000000-0000-0000-0000-000000000003', 'User A'),  ('00000000-0000-0000-0000-000000000004', 'User B');
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-000000000001', 'admin'), ('00000000-0000-0000-0000-000000000002', 'manager'),
  ('00000000-0000-0000-0000-000000000003', 'user'),  ('00000000-0000-0000-0000-000000000004', 'user');
insert into public.buildings (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Alpha'), ('00000000-0000-0000-0000-0000000000b1', 'Beta');
insert into public.user_buildings (user_id, building_id) values
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b1');
insert into public.building_role_assignments (building_id, role, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'user', '00000000-0000-0000-0000-000000000003');
insert into public.task_instances (building_id, status, frequency, due_date, assigned_to) values
  ('00000000-0000-0000-0000-0000000000a1', 'pending', 'weekly', current_date + 1, null),
  ('00000000-0000-0000-0000-0000000000a1', 'pending', 'weekly', current_date + 2, null),
  ('00000000-0000-0000-0000-0000000000a1', 'overdue', 'daily',  current_date - 3, '00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-0000000000a1', 'completed', 'daily', ((now() at time zone 'Africa/Johannesburg')::date - 1), '00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-0000000000a1', 'overdue',   'daily', ((now() at time zone 'Africa/Johannesburg')::date - 1), '00000000-0000-0000-0000-000000000003');
```

Write `$SCRATCH/verify.sql`:

```sql
\set ON_ERROR_STOP off
\echo '--- 1. policies on user_buildings'
select policyname, cmd from pg_policies where tablename = 'user_buildings' order by 1;

\echo '--- 2. coverage as admin (both buildings, real counts)'
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select building_name, field_members, role_rules, has_user_rule, unassigned_open, overdue_open, due_yesterday, completed_yesterday
  from public.portfolio_coverage();

\echo '--- 3. coverage as userA (only Alpha), assignable_people as userA (error)'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select building_name from public.portfolio_coverage();
select count(*) from public.assignable_people();

\echo '--- 4. manager grants userB access to Alpha; userA cannot self-grant Beta'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
insert into public.user_buildings (user_id, building_id)
  values ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1') returning id is not null as granted;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
insert into public.user_buildings (user_id, building_id)
  values ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1');
reset role;
```

Run:
```bash
P="$PG/psql -h 127.0.0.1 -p 55433 -U postgres -d fortress -v ON_ERROR_STOP=1 -q"
$P -f "$SCRATCH/shim.sql" && echo shim-ok
$P -f supabase/schema/2026-09-15_01_team_coverage.sql && echo migration-ok
$P -f supabase/schema/2026-09-15_01_team_coverage.sql && echo migration-idempotent
"$PG/psql" -h 127.0.0.1 -p 55433 -U postgres -d fortress -f "$SCRATCH/verify.sql"
```
Expected output (exactly these rows; the `ERROR` lines are the assertions):
```
shim-ok
migration-ok
migration-idempotent
--- 1. policies on user_buildings
    policyname    | cmd
------------------+--------
 ub_select        | SELECT
 ub_write_managed | ALL
(2 rows)
--- 2. coverage as admin (both buildings, real counts)
 building_name | field_members | role_rules | has_user_rule | unassigned_open | overdue_open | due_yesterday | completed_yesterday
---------------+---------------+------------+---------------+-----------------+--------------+---------------+---------------------
 Alpha         |             1 |          1 | t             |               2 |            2 |             2 |                   1
 Beta          |             0 |          0 | f             |               0 |            0 |             0 |                   0
(2 rows)
--- 3. coverage as userA (only Alpha), assignable_people as userA (error)
 building_name
---------------
 Alpha
(1 row)
psql:verify.sql:NN: ERROR:  assignable_people: admin or manager only
--- 4. manager grants userB access to Alpha; userA cannot self-grant Beta
 granted
---------
 t
(1 row)
psql:verify.sql:NN: ERROR:  new row violates row-level security policy for table "user_buildings"
```
Tear down: `"$PG/pg_ctl" -D "$SCRATCH/data" stop && rm -rf "$SCRATCH"` → `server stopped`.

If row 2 differs, the SQL is wrong, not the fixture: `field_members` counts userA only (role `user`, active, ub row); `unassigned_open` is the two weekly pendings (the overdue ones are assigned); `overdue_open` is both overdue rows; `due_yesterday` is the two dailies dated yesterday SAST; `completed_yesterday` is the one with status `completed`.

- [x] **Step 4: Smoke assertions.** In `scripts/rls-smoke.mjs` replace line 357:

```js
  assert('user_buildings insert as manager (admin-only)', (await canInsert(personas.manager.jwt, 'user_buildings', { user_id: personas.norole.id, building_id: A })) === false, 'manager wrote an assignment');
```
with
```js
  // S1: managers may grant building access (ub_write_managed); a manager can access every building today.
  assert('user_buildings insert as manager (S1: managed)', (await canInsert(personas.manager.jwt, 'user_buildings', { user_id: personas.norole.id, building_id: A })) === true, 'manager could not grant building access');
```
Line 358 (`user_buildings self-grant as userA` → `false`) stays. Update the header comment line 13 from `(user_roles/user_buildings writes, profile/org deletes)` to `(user_roles writes, profile/org deletes; user_buildings writes are admin+manager since S1)`.

Insert, immediately before `  // ════ Teardown (service role)` (line 1051):

```js
  // ── S1 "Team & coverage": assignable_people admin/manager only, portfolio_coverage scoped by RLS ──
  {
    const apUser = await rpcCall(personas.userA.jwt, 'assignable_people', {});
    assert('assignable_people refused for a site user', !apUser.ok, `expected an error, got HTTP ${apUser.status} with ${apUser.rows.length} rows`);
    const apAnon = await rpcCall(null, 'assignable_people', {});
    assert('assignable_people not executable by anon', apAnon.status === 401 || apAnon.status === 403, `expected HTTP 401/403 (revoked grant), got HTTP ${apAnon.status}`);
    const apMgr = await rpcCall(personas.manager.jwt, 'assignable_people', {});
    assert('assignable_people lists every role-holding persona for a manager',
      apMgr.ok && ['admin', 'manager', 'userA', 'userB'].every((k) => apMgr.rows.some((r) => r.id === personas[k].id)), `HTTP ${apMgr.status}`);
    assert('assignable_people omits the role-less persona', !apMgr.rows.some((r) => r.id === personas.norole.id), 'profile with no user_roles row offered as assignable');
    assert('assignable_people resolves a role and a deactivated flag for everyone',
      apMgr.rows.every((r) => typeof r.role === 'string' && r.role.length > 0 && typeof r.deactivated === 'boolean'), 'null role or flag returned');

    const covUser = await rpcCall(personas.userA.jwt, 'portfolio_coverage', {});
    assert('portfolio_coverage as userA returns building A and never B',
      covUser.ok && covUser.rows.some((r) => r.building_id === A) && !covUser.rows.some((r) => r.building_id === B),
      `HTTP ${covUser.status} ${JSON.stringify(covUser.rows.map((r) => r.building_id))}`);
    const covAdmin = await rpcCall(personas.admin.jwt, 'portfolio_coverage', {});
    assert('portfolio_coverage as admin includes both fixture buildings',
      covAdmin.ok && [A, B].every((id) => covAdmin.rows.some((r) => r.building_id === id)), `HTTP ${covAdmin.status}`);
    const covA = covAdmin.rows.find((r) => r.building_id === A);
    assert('portfolio_coverage counts userA as a field member of A', !!covA && covA.field_members >= 1, JSON.stringify(covA));
    assert('portfolio_coverage row carries every spec column',
      !!covA && ['role_rules', 'has_user_rule', 'unassigned_open', 'overdue_open', 'due_yesterday', 'completed_yesterday'].every((k) => k in covA), JSON.stringify(covA));
    const covAnon = await rpcCall(null, 'portfolio_coverage', {});
    assert('portfolio_coverage not executable by anon', covAnon.status === 401 || covAnon.status === 403, `expected HTTP 401/403 (revoked grant), got HTTP ${covAnon.status}`);
  }
  console.log('  S1 team & coverage (user_buildings managed, assignable_people, portfolio_coverage): done');

```
Add a matrix line to the header comment block (after the R4c line): `*   S1 "Team"      → user_buildings writes admin+manager (scoped by access), user self-grant still denied; assignable_people admin/manager only, never anon; portfolio_coverage RLS-scoped (userA sees A only), never anon`.

The smoke cannot run here (needs `SUPABASE_*` env); it must parse: `node --check scripts/rls-smoke.mjs` → no output.

- [x] **Step 5: Commit (both repos)**

```bash
git -C ../GMI add sql/2026-09-15_01_team_coverage.sql && git -C ../GMI commit -m "S1 team coverage: managed user_buildings writes, assignable_people, portfolio_coverage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git add supabase/schema/2026-09-15_01_team_coverage.sql supabase/schema/.source scripts/rls-smoke.mjs
git commit -m "S1: vendor the team-coverage migration and prove its RLS in the smoke matrix

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**Controller after Task 1:** apply on staging with the Management API helper (`supa.mjs apply vkrihpmjajjcxmzgjqdr ../GMI/sql/2026-09-15_01_team_coverage.sql`, as for R2a–R4c), reload PostgREST, run `node scripts/rls-smoke.mjs` against staging (expect the S1 block green and the flipped manager assertion green).

---

### Task 2: `useAssignablePeople` and `usePortfolioCoverage` hooks

**Files:**
- Create: `src/hooks/useAssignablePeople.ts`
- Create: `src/hooks/useAssignablePeople.test.ts`
- Create: `src/hooks/usePortfolioCoverage.ts`
- Create: `src/hooks/usePortfolioCoverage.test.ts`

- [x] **Step 1: Failing test for `useAssignablePeople`**

```ts
// src/hooks/useAssignablePeople.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));

import { useAssignablePeople, addablePeople, type AssignablePerson } from './useAssignablePeople';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

const people: AssignablePerson[] = [
  { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user', deactivated: false },
  { id: 'u2', full_name: 'Lerato K', avatar_url: null, role: 'manager', deactivated: false },
  { id: 'u3', full_name: 'Sipho N', avatar_url: null, role: 'user', deactivated: true },
  { id: 'u4', full_name: 'Ayanda D', avatar_url: null, role: 'user', deactivated: false },
  { id: 'u5', full_name: 'Root', avatar_url: null, role: 'admin', deactivated: false },
];

describe('useAssignablePeople', () => {
  beforeEach(() => rpc.mockReset());

  it('calls assignable_people and returns the rows', async () => {
    rpc.mockResolvedValueOnce({ data: people, error: null });
    const { result } = renderHook(() => useAssignablePeople(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(5));
    expect(rpc).toHaveBeenCalledWith('assignable_people');
  });

  it('does not call the RPC when disabled (non-managers get a 403 from it)', () => {
    const { result } = renderHook(() => useAssignablePeople(false), { wrapper });
    expect(result.current.isLoading).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces the RPC error message', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'assignable_people: admin or manager only' } });
    const { result } = renderHook(() => useAssignablePeople(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('assignable_people: admin or manager only');
  });
});

describe('addablePeople', () => {
  it('drops current members, admins, managers and deactivated accounts, keeping input order', () => {
    expect(addablePeople(people, new Set(['u1'])).map((p) => p.id)).toEqual(['u4']);
  });

  it('returns everyone eligible when nobody is a member yet', () => {
    expect(addablePeople(people, new Set()).map((p) => p.id)).toEqual(['u1', 'u4']);
  });
});
```

- [x] **Step 2: Run** `npm run test -- src/hooks/useAssignablePeople.test.ts` → FAIL (`Cannot find module './useAssignablePeople'`).

- [x] **Step 3: Implement**

```ts
// src/hooks/useAssignablePeople.ts
/**
 * Everyone who holds a role, for the Team tab's "Add person" picker. Served by the
 * `assignable_people` SECURITY DEFINER RPC because `building_members(b)` returns members only
 * and `profiles` RLS does not let a manager enumerate accounts. The RPC raises for anyone who is
 * not an admin or manager, so callers pass `enabled = isAdminOrManager` and never see that error.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AssignablePerson {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  /** Most privileged role held: admin > manager > user (same precedence as building_members). */
  role: string;
  deactivated: boolean;
}

export const assignablePeopleKey = ['assignable-people'] as const;

/**
 * Who can be ADDED as a field member of a building: not already a member, not an admin or
 * manager (they see every building without a row), and not deactivated (they could not act).
 */
export function addablePeople(people: AssignablePerson[], memberIds: Set<string>): AssignablePerson[] {
  return people.filter((p) => !memberIds.has(p.id) && p.role !== 'admin' && p.role !== 'manager' && !p.deactivated);
}

export function useAssignablePeople(enabled = true) {
  return useQuery({
    queryKey: assignablePeopleKey,
    enabled,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<AssignablePerson[]> => {
      // assignable_people is not yet in the generated types; regenerate after the migration ships.
      const { data, error } = await (supabase.rpc as unknown as (fn: string) => Promise<{ data: AssignablePerson[] | null; error: { message: string } | null }>)('assignable_people');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
```

- [x] **Step 4: Run** `npm run test -- src/hooks/useAssignablePeople.test.ts` → PASS (5 tests).

- [x] **Step 5: Failing test for `usePortfolioCoverage`**

```ts
// src/hooks/usePortfolioCoverage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));

import { usePortfolioCoverage, needsTeam, coverageGaps, type CoverageRow } from './usePortfolioCoverage';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

const row = (over: Partial<CoverageRow>): CoverageRow => ({
  building_id: 'b', building_name: 'B', field_members: 1, role_rules: 1, has_user_rule: true,
  unassigned_open: 0, overdue_open: 0, due_yesterday: 0, completed_yesterday: 0, ...over,
});

const rows: CoverageRow[] = [
  row({ building_id: 'b1', building_name: 'Alpha Court' }),
  row({ building_id: 'b2', building_name: 'Beta Place', field_members: 0, has_user_rule: false, unassigned_open: 3 }),
  row({ building_id: 'b3', building_name: 'Gamma House', field_members: 2, has_user_rule: false, unassigned_open: 1 }),
];

describe('usePortfolioCoverage', () => {
  beforeEach(() => rpc.mockReset());

  it('calls portfolio_coverage and derives the gaps and the unassigned total', async () => {
    rpc.mockResolvedValueOnce({ data: rows, error: null });
    const { result } = renderHook(() => usePortfolioCoverage(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(3));
    expect(rpc).toHaveBeenCalledWith('portfolio_coverage');
    expect(result.current.gaps.map((r) => r.building_id)).toEqual(['b2', 'b3']);
    expect(result.current.unassignedOpen).toBe(4);
    expect(result.current.byBuilding.get('b2')?.field_members).toBe(0);
  });

  it('does not call the RPC when disabled', () => {
    const { result } = renderHook(() => usePortfolioCoverage(false), { wrapper });
    expect(result.current.isLoading).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces the RPC error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => usePortfolioCoverage(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.gaps).toEqual([]);
    expect(result.current.unassignedOpen).toBe(0);
  });
});

describe('needsTeam / coverageGaps', () => {
  it('flags a building with no field members OR no user rule', () => {
    expect(needsTeam(row({}))).toBe(false);
    expect(needsTeam(row({ field_members: 0 }))).toBe(true);
    expect(needsTeam(row({ has_user_rule: false }))).toBe(true);
  });

  it('coverageGaps keeps the RPC order', () => {
    expect(coverageGaps(rows).map((r) => r.building_name)).toEqual(['Beta Place', 'Gamma House']);
  });
});
```

- [x] **Step 6: Run** `npm run test -- src/hooks/usePortfolioCoverage.test.ts` → FAIL (module missing).

- [x] **Step 7: Implement**

```ts
// src/hooks/usePortfolioCoverage.ts
/**
 * One row per building the caller can see, from the `portfolio_coverage` RPC (SECURITY INVOKER,
 * so RLS does the scoping). Feeds the dashboard CoverageWidget, the "No team" badge on the
 * Buildings list and nothing else on the client; the digest calls the same function as the
 * service role. Admin/manager surfaces only — pass `enabled = isAdminOrManager`.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CoverageRow {
  building_id: string;
  building_name: string;
  /** Active `user`-role profiles with a user_buildings row here. */
  field_members: number;
  /** Rows in building_role_assignments for this building. */
  role_rules: number;
  /** A rule exists for label 'user' — the daily-task default. */
  has_user_rule: boolean;
  /** task_instances pending or overdue with nobody assigned. */
  unassigned_open: number;
  overdue_open: number;
  /** Daily tasks due yesterday (SAST) and how many of those were completed. */
  due_yesterday: number;
  completed_yesterday: number;
}

export const portfolioCoverageKey = ['portfolio-coverage'] as const;

/** Spec §4.3: a building "needs a team" when it has no field member or no daily-task default. */
export function needsTeam(r: CoverageRow): boolean {
  return r.field_members === 0 || !r.has_user_rule;
}

export function coverageGaps(rows: CoverageRow[]): CoverageRow[] {
  return rows.filter(needsTeam);
}

export function usePortfolioCoverage(enabled = true) {
  const query = useQuery({
    queryKey: portfolioCoverageKey,
    enabled,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<CoverageRow[]> => {
      // portfolio_coverage is not yet in the generated types; regenerate after the migration ships.
      const { data, error } = await (supabase.rpc as unknown as (fn: string) => Promise<{ data: CoverageRow[] | null; error: { message: string } | null }>)('portfolio_coverage');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  // One stable array per fetch, or the memos below would recompute on every render while loading.
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const gaps = useMemo(() => coverageGaps(rows), [rows]);
  const unassignedOpen = useMemo(() => rows.reduce((n, r) => n + r.unassigned_open, 0), [rows]);
  const byBuilding = useMemo(() => new Map(rows.map((r) => [r.building_id, r])), [rows]);
  return { ...query, gaps, unassignedOpen, byBuilding };
}
```

- [x] **Step 8: Run** `npm run test -- src/hooks/usePortfolioCoverage.test.ts` → PASS (5 tests). Gate: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'useAssignablePeople|usePortfolioCoverage'` prints nothing.

- [x] **Step 9: Commit**

```bash
git add src/hooks/useAssignablePeople.ts src/hooks/useAssignablePeople.test.ts src/hooks/usePortfolioCoverage.ts src/hooks/usePortfolioCoverage.test.ts
git commit -m "Add hooks for the assignable-people and portfolio-coverage RPCs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The Team tab

**Files:**
- Create: `src/components/building/team/teamActions.ts`
- Create: `src/components/building/team/teamActions.test.ts`
- Create: `src/components/building/team/MemberRow.tsx`
- Create: `src/components/building/team/AddPersonDialog.tsx`
- Create: `src/components/building/team/RemoveMemberDialog.tsx`
- Create: `src/components/building/team/TeamTab.tsx`
- Create: `src/components/building/team/TeamTab.test.tsx`
- Modify: `src/pages/BuildingDetails.tsx` (import `:19-21`; trigger after `:211`; content after `:344`; `Tabs value` `:202`)
- Create: `src/pages/BuildingDetails.team.test.tsx`

`useBuildingRoleAssignments` already exposes `setRule(role, userId | null)` (`src/hooks/useBuildingRoleAssignments.ts:133-141`, tested at `useBuildingRoleAssignments.test.ts:129-139`), so no hook change is needed. `roleLabel()` stays exported from `RoleAssignmentsPanel.tsx` (Task 4 keeps it) and is imported from there.

- [x] **Step 1: Failing test for the write sequence** (the chain mock is the one `useBuildingRoleAssignments.test.ts:15-42` uses, extended with `insert`, `in` and a `count` on the resolved result):

```ts
// src/components/building/team/teamActions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; count?: number | null; error: { message: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & {
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
};

const state = vi.hoisted(() => ({
  queries: [] as { table: string; calls: RecordedCall[] }[],
  result: (() => ({ data: [], error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
}));

vi.mock('@/integrations/supabase/client', () => {
  const METHODS = ['select', 'eq', 'in', 'is', 'insert', 'update', 'delete'];
  const from = (table: string): Chain => {
    const own: RecordedCall[] = [];
    const chain = {} as Chain;
    for (const method of METHODS) {
      chain[method] = (...args: unknown[]) => { own.push({ table, method, args }); return chain; };
    }
    chain.then = (resolve, reject) => {
      state.queries.push({ table, calls: own });
      return Promise.resolve(state.result(table, own)).then(resolve, reject);
    };
    return chain;
  };
  return { supabase: { from } };
});

import { addMember, removeMember, countOpenTasksFor, describeRemoveOutcome } from './teamActions';

const has = (calls: RecordedCall[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));
const q = (table: string, method: string) => state.queries.filter((x) => x.table === table && has(x.calls, method));

beforeEach(() => {
  state.queries = [];
  state.result = (table, calls) => {
    if (table === 'task_instances' && has(calls, 'select', 'id', { count: 'exact', head: true })) return { count: 2, error: null };
    if (table === 'user_buildings' && has(calls, 'insert')) return { data: [{ id: 'ub1' }], error: null };
    if (table === 'building_role_assignments' && has(calls, 'delete')) return { data: [{ role: 'user' }], error: null };
    if (table === 'task_instances' && has(calls, 'update')) return { data: [{ id: 't1' }, { id: 't2' }], error: null };
    if (table === 'user_buildings' && has(calls, 'delete')) return { data: [{ id: 'ub1' }], error: null };
    return { data: [], error: null };
  };
});

describe('countOpenTasksFor', () => {
  it('counts pending and overdue tasks assigned to the person at the building', async () => {
    expect(await countOpenTasksFor('b1', 'u1')).toBe(2);
    const [read] = q('task_instances', 'select');
    expect(has(read.calls, 'eq', 'building_id', 'b1') && has(read.calls, 'eq', 'assigned_to', 'u1') && has(read.calls, 'in', 'status', ['pending', 'overdue'])).toBe(true);
  });
});

describe('addMember', () => {
  it('inserts the access row with a zero-row check, then writes the user rule when asked', async () => {
    const setRule = vi.fn(async () => {});
    expect(await addMember('b1', 'u1', true, setRule)).toEqual({ ok: true });
    const [ins] = q('user_buildings', 'insert');
    expect(has(ins.calls, 'insert', { user_id: 'u1', building_id: 'b1' }) && has(ins.calls, 'select', 'id')).toBe(true);
    expect(setRule).toHaveBeenCalledWith('user', 'u1');
  });

  it('skips the rule when not asked', async () => {
    const setRule = vi.fn(async () => {});
    expect(await addMember('b1', 'u1', false, setRule)).toEqual({ ok: true });
    expect(setRule).not.toHaveBeenCalled();
  });

  it('treats zero inserted rows as a membership failure and never touches the rule', async () => {
    state.result = () => ({ data: [], error: null });
    const setRule = vi.fn(async () => {});
    expect(await addMember('b1', 'u1', true, setRule)).toEqual({ ok: false, step: 'membership', message: 'no access row was written' });
    expect(setRule).not.toHaveBeenCalled();
  });

  it('reports a rule failure after the access row was written', async () => {
    const setRule = vi.fn(async () => { throw new Error('rls'); });
    expect(await addMember('b1', 'u1', true, setRule)).toEqual({ ok: false, step: 'default_rule', message: 'rls' });
  });
});

describe('removeMember', () => {
  it('deletes rules, unassigns open tasks, deletes access — in that order, each with .select()', async () => {
    const out = await removeMember('b1', 'u1', ['user'], 2);
    expect(out).toEqual({ ok: true, done: ['rules', 'tasks', 'membership'], tasksUnassigned: 2 });
    expect(state.queries.map((x) => `${x.table}:${x.calls[0].method}`)).toEqual([
      'building_role_assignments:delete', 'task_instances:update', 'user_buildings:delete',
    ]);
    const [rules] = q('building_role_assignments', 'delete');
    expect(has(rules.calls, 'eq', 'building_id', 'b1') && has(rules.calls, 'eq', 'user_id', 'u1') && has(rules.calls, 'select', 'role')).toBe(true);
    const [tasks] = q('task_instances', 'update');
    expect(has(tasks.calls, 'update', { assigned_to: null }) && has(tasks.calls, 'in', 'status', ['pending', 'overdue']) && has(tasks.calls, 'select', 'id')).toBe(true);
    const [ub] = q('user_buildings', 'delete');
    expect(has(ub.calls, 'eq', 'user_id', 'u1') && has(ub.calls, 'select', 'id')).toBe(true);
  });

  it('skips the rules delete when the person holds none, and accepts zero unassigned tasks when none were expected', async () => {
    state.result = (table, calls) => (table === 'user_buildings' && has(calls, 'delete') ? { data: [{ id: 'ub1' }], error: null } : { data: [], error: null });
    const out = await removeMember('b1', 'u1', [], 0);
    expect(out).toEqual({ ok: true, done: ['rules', 'tasks', 'membership'], tasksUnassigned: 0 });
    expect(q('building_role_assignments', 'delete')).toHaveLength(0);
  });

  it('stops at the first failing step and says what was done', async () => {
    const base = state.result;
    state.result = (table, calls) => (table === 'user_buildings' && has(calls, 'delete') ? { data: [], error: null } : base(table, calls));
    const out = await removeMember('b1', 'u1', ['user'], 2);
    expect(out).toEqual({ ok: false, done: ['rules', 'tasks'], failed: 'membership', message: 'no access row was removed', tasksUnassigned: 2 });
    expect(describeRemoveOutcome('Thabo M', out)).toBe(
      'Could not finish removing Thabo M: no access row was removed. Done: their rules here were removed, 2 tasks were unassigned. Not done: building access was not removed.',
    );
  });

  it('a zero-row task update is a failure when the dialog promised tasks', async () => {
    const base = state.result;
    state.result = (table, calls) => (table === 'task_instances' && has(calls, 'update') ? { data: [], error: null } : base(table, calls));
    const out = await removeMember('b1', 'u1', ['user'], 2);
    expect(out.ok).toBe(false);
    expect(out.failed).toBe('tasks');
    expect(q('user_buildings', 'delete')).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run** `npm run test -- src/components/building/team/teamActions.test.ts` → FAIL (module missing).

- [x] **Step 3: Implement the write sequence**

```ts
// src/components/building/team/teamActions.ts
/**
 * The Team tab's writes, kept out of the component so the order and the zero-row checks are
 * unit-tested. Every write chains `.select(...)` and treats zero rows as failure (a policy that
 * silently filters a row returns 200 with nothing). Remove is three steps in a fixed order —
 * rules, open tasks, access — and stops at the first failure; the outcome says which steps ran so
 * the manager is told what was and was not undone.
 */
import { supabase } from '@/integrations/supabase/client';

/** Tasks a leaving member must not keep: not yet done, whether or not already late. */
export const OPEN_STATUSES = ['pending', 'overdue'] as const;

export async function countOpenTasksFor(buildingId: string, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('task_instances')
    .select('id', { count: 'exact', head: true })
    .eq('building_id', buildingId)
    .eq('assigned_to', userId)
    .in('status', [...OPEN_STATUSES]);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type AddOutcome = { ok: true } | { ok: false; step: 'membership' | 'default_rule'; message: string };

/** Insert the user_buildings row; when asked, make the person the building's 'user' rule. */
export async function addMember(
  buildingId: string,
  userId: string,
  makeDefault: boolean,
  setRule: (role: string, userId: string | null) => Promise<void>,
): Promise<AddOutcome> {
  const { data, error } = await supabase
    .from('user_buildings')
    .insert({ user_id: userId, building_id: buildingId })
    .select('id');
  if (error) return { ok: false, step: 'membership', message: error.message };
  if (!data?.length) return { ok: false, step: 'membership', message: 'no access row was written' };
  if (!makeDefault) return { ok: true };
  try {
    await setRule('user', userId);
  } catch (e) {
    return { ok: false, step: 'default_rule', message: e instanceof Error ? e.message : 'unknown error' };
  }
  return { ok: true };
}

export type RemoveStep = 'rules' | 'tasks' | 'membership';
export interface RemoveOutcome {
  ok: boolean;
  done: RemoveStep[];
  failed?: RemoveStep;
  message?: string;
  tasksUnassigned: number;
}

/**
 * @param rulesHeld  role labels whose rule points at this person here (from useBuildingRoleAssignments);
 *                   with none, the rules step has nothing to delete and zero rows is not a failure.
 * @param expectedOpenTasks  what the confirm dialog showed; a zero-row unassign is a failure only
 *                   when the dialog promised tasks.
 */
export async function removeMember(
  buildingId: string,
  userId: string,
  rulesHeld: string[],
  expectedOpenTasks: number,
): Promise<RemoveOutcome> {
  const done: RemoveStep[] = [];
  let tasksUnassigned = 0;
  const fail = (failed: RemoveStep, message: string): RemoveOutcome => ({ ok: false, done, failed, message, tasksUnassigned });

  if (rulesHeld.length > 0) {
    const { data, error } = await supabase
      .from('building_role_assignments')
      .delete()
      .eq('building_id', buildingId)
      .eq('user_id', userId)
      .select('role');
    if (error) return fail('rules', error.message);
    if (!data?.length) return fail('rules', 'no rule was removed');
  }
  done.push('rules');

  const { data: tasks, error: taskErr } = await supabase
    .from('task_instances')
    .update({ assigned_to: null })
    .eq('building_id', buildingId)
    .eq('assigned_to', userId)
    .in('status', [...OPEN_STATUSES])
    .select('id');
  if (taskErr) return fail('tasks', taskErr.message);
  if (expectedOpenTasks > 0 && !tasks?.length) return fail('tasks', 'no task was unassigned');
  tasksUnassigned = tasks?.length ?? 0;
  done.push('tasks');

  const { data: access, error: accessErr } = await supabase
    .from('user_buildings')
    .delete()
    .eq('building_id', buildingId)
    .eq('user_id', userId)
    .select('id');
  if (accessErr) return fail('membership', accessErr.message);
  if (!access?.length) return fail('membership', 'no access row was removed');
  done.push('membership');

  return { ok: true, done, tasksUnassigned };
}

const STEP_DONE: Record<RemoveStep, (o: RemoveOutcome) => string> = {
  rules: () => 'their rules here were removed',
  tasks: (o) => `${o.tasksUnassigned} task${o.tasksUnassigned === 1 ? ' was' : 's were'} unassigned`,
  membership: () => 'building access was removed',
};
const STEP_NOT_DONE: Record<RemoveStep, string> = {
  rules: 'their rules here were not removed',
  tasks: 'their open tasks were not unassigned',
  membership: 'building access was not removed',
};

/** Plain sentence for the failure toast: what happened, what did, what did not. */
export function describeRemoveOutcome(name: string, o: RemoveOutcome): string {
  if (o.ok) return `Removed ${name} from this building`;
  const steps: RemoveStep[] = ['rules', 'tasks', 'membership'];
  const doneText = o.done.length ? o.done.map((s) => STEP_DONE[s](o)).join(', ') : 'nothing';
  const notDone = steps.filter((s) => !o.done.includes(s)).map((s) => STEP_NOT_DONE[s]).join(', ');
  return `Could not finish removing ${name}: ${o.message}. Done: ${doneText}. Not done: ${notDone}.`;
}
```

- [x] **Step 4: Run** `npm run test -- src/components/building/team/teamActions.test.ts` → PASS (9 tests).

- [x] **Step 5: Child components** (no separate tests: they are driven through `TeamTab.test.tsx` in Step 7).

```tsx
// src/components/building/team/MemberRow.tsx
/** One field member: avatar, name, a chip per role label (filled when the rule points at them), Remove. */
import { UserMinus } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { memberDisplayName, type BuildingMember } from '@/hooks/useBuildingMembers';
import { roleLabel } from '@/components/building/RoleAssignmentsPanel';

interface MemberRowProps {
  member: BuildingMember;
  /** Every label worth ruling on at this building (`useBuildingRoleAssignments().roles`). */
  roles: string[];
  /** role label → profile id (`useBuildingRoleAssignments().rules`). */
  rules: Map<string, string>;
  /** The role whose rule is being written right now, if any. */
  busyRole: string | null;
  onToggleRule: (role: string, held: boolean) => void;
  onRemove: () => void;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

export function MemberRow({ member, roles, rules, busyRole, onToggleRule, onRemove }: MemberRowProps) {
  const name = memberDisplayName(member);
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4" data-testid={`member-${member.id}`}>
      <div className="flex items-center gap-3 sm:w-56 sm:shrink-0">
        <Avatar className="h-9 w-9">
          {member.avatar_url && <AvatarImage src={member.avatar_url} alt="" />}
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
        <p className="font-medium text-sm truncate">{name}</p>
      </div>
      <div className="flex flex-wrap gap-2 flex-1" role="group" aria-label={`Roles for ${name}`}>
        {roles.map((role) => {
          const held = rules.get(role) === member.id;
          return (
            <Button
              key={role}
              type="button"
              size="sm"
              variant={held ? 'default' : 'outline'}
              aria-pressed={held}
              disabled={busyRole !== null}
              onClick={() => onToggleRule(role, held)}
              className="min-h-11 rounded-full"
            >
              {roleLabel(role)}
            </Button>
          );
        })}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove ${name}`} className="min-h-11 self-start text-destructive">
        <UserMinus className="h-4 w-4 mr-2" aria-hidden="true" />
        Remove
      </Button>
    </li>
  );
}
```

```tsx
// src/components/building/team/AddPersonDialog.tsx
/**
 * Pick one person who is not yet a member. When the building has no 'user' rule yet, offer to
 * make them the daily-task default (checked by default) — one action, both tables (spec §4.2).
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { AssignablePerson } from '@/hooks/useAssignablePeople';

interface AddPersonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingName: string;
  people: AssignablePerson[];
  isLoading: boolean;
  isError: boolean;
  /** True when the building has no 'user' rule yet, so the default-for-daily-tasks offer is shown. */
  offerDefault: boolean;
  onAdd: (personId: string, makeDefault: boolean) => Promise<void>;
}

export function AddPersonDialog({ open, onOpenChange, buildingName, people, isLoading, isError, offerDefault, onAdd }: AddPersonDialogProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [makeDefault, setMakeDefault] = useState(true);
  const [saving, setSaving] = useState(false);

  const close = (next: boolean) => {
    if (!next) { setSelected(null); setMakeDefault(true); }
    onOpenChange(next);
  };

  const submit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await onAdd(selected, offerDefault && makeDefault);
      close(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a person to {buildingName}</DialogTitle>
          <DialogDescription>Field staff only see the buildings they are added to.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading people…
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive py-4">Could not load people.</p>
        ) : people.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Everyone with a field-staff account is already a member here.</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto space-y-1" role="listbox" aria-label="People">
            {people.map((p) => {
              const on = selected === p.id;
              return (
                <li key={p.id} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onClick={() => setSelected(p.id)}
                    className={`w-full text-left min-h-11 rounded-md px-3 text-sm ${on ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50'}`}
                  >
                    {p.full_name?.trim() || 'Unnamed user'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {offerDefault && people.length > 0 && (
          <label className="flex items-start gap-3 min-h-11 cursor-pointer">
            <Checkbox id="add-person-default" checked={makeDefault} onCheckedChange={(v) => setMakeDefault(v === true)} className="mt-1" />
            <Label htmlFor="add-person-default" className="font-normal cursor-pointer leading-snug">Also make them the default for daily tasks</Label>
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={saving} className="min-h-11">Cancel</Button>
          <Button onClick={submit} disabled={saving || !selected} className="min-h-11">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

```tsx
// src/components/building/team/RemoveMemberDialog.tsx
/** Confirm removal, stating how many open tasks at this building are assigned to the person. */
import { Loader2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface RemoveMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  buildingName: string;
  /** null while the count is loading. */
  openTasks: number | null;
  busy: boolean;
  onConfirm: () => void;
}

export function removeDescription(openTasks: number): string {
  const tasks = openTasks === 1 ? '1 open task at this building is assigned to them and will be left with no owner.' : `${openTasks} open tasks at this building are assigned to them and will be left with no owner.`;
  return `${openTasks === 0 ? 'No open tasks at this building are assigned to them.' : tasks} Their role rules here will be removed and they will lose access to this building.`;
}

export function RemoveMemberDialog({ open, onOpenChange, name, buildingName, openTasks, busy, onConfirm }: RemoveMemberDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {name} from {buildingName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {openTasks === null ? 'Counting their open tasks…' : removeDescription(openTasks)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="min-h-11">Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); onConfirm(); }} disabled={busy || openTasks === null} className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [x] **Step 6: Failing test for `TeamTab`**

```tsx
// src/components/building/team/TeamTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({
  isAdminOrManager: true,
  members: [
    { id: 'm1', full_name: 'Lerato K', avatar_url: null, role: 'manager' },
    { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' },
    { id: 'u2', full_name: 'Ayanda D', avatar_url: null, role: 'user' },
  ],
  membersError: false,
  rules: new Map<string, string>([['user', 'u1']]),
  roles: ['user', 'manager', 'HVAC Contractor'],
  pendingByRole: new Map<string, number>([['user', 3]]),
  people: [
    { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user', deactivated: false },
    { id: 'u3', full_name: 'Sipho N', avatar_url: null, role: 'user', deactivated: false },
    { id: 'm1', full_name: 'Lerato K', avatar_url: null, role: 'manager', deactivated: false },
  ],
  setRule: vi.fn(async () => {}),
  applyToPending: vi.fn(async () => 0),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  // Untyped vi.fn() on purpose: beforeEach sets the resolved values, and single tests override
  // them with shapes (partial failures) an inferred success type would reject.
  actions: {
    countOpenTasksFor: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'me' } }) }));
vi.mock('sonner', () => ({ toast: state.toast }));
vi.mock('@/hooks/useBuildingMembers', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useBuildingMembers')>()),
  useBuildingMembers: () => ({
    data: state.membersError ? undefined : state.members,
    byId: new Map(state.members.map((m) => [m.id, m])),
    isLoading: false,
    isError: state.membersError,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useBuildingRoleAssignments', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useBuildingRoleAssignments')>()),
  useBuildingRoleAssignments: () => ({
    rules: state.rules,
    roles: state.roles,
    pendingByRole: state.pendingByRole,
    isLoading: false,
    isError: false,
    setRule: state.setRule,
    applyToPending: state.applyToPending,
  }),
}));
vi.mock('@/hooks/useAssignablePeople', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useAssignablePeople')>()),
  useAssignablePeople: () => ({ data: state.people, isLoading: false, isError: false }),
}));
vi.mock('./teamActions', async (orig) => ({
  ...(await orig<typeof import('./teamActions')>()),
  countOpenTasksFor: state.actions.countOpenTasksFor,
  addMember: state.actions.addMember,
  removeMember: state.actions.removeMember,
}));

import TeamTab from './TeamTab';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);
const renderTab = () => render(<TeamTab buildingId="b1" buildingName="Fortress Mall" />, { wrapper });

beforeEach(() => {
  state.isAdminOrManager = true;
  state.membersError = false;
  state.rules = new Map([['user', 'u1']]);
  state.pendingByRole = new Map([['user', 3]]);
  state.setRule.mockClear();
  state.applyToPending.mockClear().mockResolvedValue(0);
  state.actions.countOpenTasksFor.mockClear().mockResolvedValue(2);
  state.actions.addMember.mockClear().mockResolvedValue({ ok: true });
  state.actions.removeMember.mockClear().mockResolvedValue({ ok: true, done: ['rules', 'tasks', 'membership'], tasksUnassigned: 2 });
  Object.values(state.toast).forEach((f) => f.mockClear());
});

describe('TeamTab', () => {
  it('renders nothing for users who cannot manage the team', () => {
    state.isAdminOrManager = false;
    renderTab();
    expect(screen.queryByTestId('team-tab')).toBeNull();
  });

  it('lists managers without controls and field members with role chips', () => {
    renderTab();
    const managers = screen.getByRole('list', { name: 'Managers' });
    expect(within(managers).getByText('Lerato K')).toBeInTheDocument();
    expect(within(managers).queryByRole('button')).toBeNull();

    const thabo = screen.getByTestId('member-u1');
    expect(within(thabo).getByRole('button', { name: 'User (default)' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(thabo).getByRole('button', { name: 'HVAC Contractor' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(screen.getByTestId('member-u2')).getByRole('button', { name: 'User (default)' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('tapping an unheld chip moves that rule to the member', async () => {
    renderTab();
    fireEvent.click(within(screen.getByTestId('member-u2')).getByRole('button', { name: 'User (default)' }));
    await waitFor(() => expect(state.setRule).toHaveBeenCalledWith('user', 'u2'));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('User (default): Ayanda D'));
  });

  it('tapping the held chip clears the rule', async () => {
    renderTab();
    fireEvent.click(within(screen.getByTestId('member-u1')).getByRole('button', { name: 'User (default)' }));
    await waitFor(() => expect(state.setRule).toHaveBeenCalledWith('user', null));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('User (default): nobody'));
  });

  it('a failed rule write toasts the reason', async () => {
    state.setRule.mockRejectedValueOnce(new Error('rls'));
    renderTab();
    fireEvent.click(within(screen.getByTestId('member-u2')).getByRole('button', { name: 'HVAC Contractor' }));
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith('Could not save the rule: rls'));
  });

  it('Add person offers only non-members who are field staff and, with a user rule present, no default checkbox', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add person/ }));
    const list = await screen.findByRole('listbox', { name: 'People' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Sipho N']);
    expect(screen.queryByLabelText('Also make them the default for daily tasks')).toBeNull();
    fireEvent.click(within(list).getByText('Sipho N'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(state.actions.addMember).toHaveBeenCalledWith('b1', 'u3', false, state.setRule));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('Added Sipho N to Fortress Mall'));
  });

  it('with no user rule, Add person offers the daily-task default checked by default and writes both', async () => {
    state.rules = new Map();
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add person/ }));
    const box = await screen.findByLabelText('Also make them the default for daily tasks');
    expect(box).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByText('Sipho N'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(state.actions.addMember).toHaveBeenCalledWith('b1', 'u3', true, state.setRule));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('Added Sipho N to Fortress Mall and made them the default for daily tasks'));
  });

  it('reports a rule failure after access was granted', async () => {
    state.rules = new Map();
    state.actions.addMember.mockResolvedValueOnce({ ok: false, step: 'default_rule', message: 'rls' });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add person/ }));
    fireEvent.click(await screen.findByText('Sipho N'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith('Added Sipho N to Fortress Mall, but could not make them the default for daily tasks: rls'));
  });

  it('Remove asks with the open-task count, then runs the three-step removal', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Thabo M' }));
    expect(await screen.findByText('2 open tasks at this building are assigned to them and will be left with no owner. Their role rules here will be removed and they will lose access to this building.')).toBeInTheDocument();
    expect(state.actions.countOpenTasksFor).toHaveBeenCalledWith('b1', 'u1');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(state.actions.removeMember).toHaveBeenCalledWith('b1', 'u1', ['user'], 2));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('Removed Thabo M from this building'));
  });

  it('a partial removal failure says what was and was not undone', async () => {
    state.actions.removeMember.mockResolvedValueOnce({ ok: false, done: ['rules', 'tasks'], failed: 'membership', message: 'no access row was removed', tasksUnassigned: 2 });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Thabo M' }));
    await screen.findByText(/2 open tasks/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith(
      'Could not finish removing Thabo M: no access row was removed. Done: their rules here were removed, 2 tasks were unassigned. Not done: building access was not removed.',
    ));
  });

  it('Apply to existing pending tasks counts only ruled roles and reports the total', async () => {
    state.applyToPending.mockResolvedValue(3);
    renderTab();
    const apply = screen.getByRole('button', { name: /Apply to existing pending tasks \(3\)/ });
    fireEvent.click(apply);
    await waitFor(() => expect(state.applyToPending).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('Assigned 3 pending tasks at Fortress Mall'));
  });

  it('shows a plain error with retry when the member list fails', () => {
    state.membersError = true;
    renderTab();
    expect(screen.getByText('Could not load the people on this building.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
```

- [x] **Step 7: Run** `npm run test -- src/components/building/team/TeamTab.test.tsx` → FAIL (module missing).

- [x] **Step 8: Implement `TeamTab`**

```tsx
// src/components/building/team/TeamTab.tsx
/**
 * "Team" on a building, admin/manager only (the trigger is not mounted for `user`): who is on
 * this building, what each field member does here (one person per role label — tapping a chip
 * moves the rule), Add person (writes user_buildings and, when offered, the 'user' rule), Remove
 * (rules → open tasks → access, reported honestly on partial failure), and the one-off "Apply to
 * existing pending tasks" catch-up that used to live on the Checklists tab.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, UserCheck, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useBuildingMembers, memberDisplayName, type BuildingMember } from '@/hooks/useBuildingMembers';
import { useBuildingRoleAssignments, buildingRolesKey } from '@/hooks/useBuildingRoleAssignments';
import { useAssignablePeople, addablePeople } from '@/hooks/useAssignablePeople';
import { portfolioCoverageKey } from '@/hooks/usePortfolioCoverage';
import { roleLabel } from '@/components/building/RoleAssignmentsPanel';
import { MemberRow } from './MemberRow';
import { AddPersonDialog } from './AddPersonDialog';
import { RemoveMemberDialog } from './RemoveMemberDialog';
import { addMember, countOpenTasksFor, removeMember, describeRemoveOutcome } from './teamActions';

interface TeamTabProps {
  buildingId: string;
  buildingName?: string;
}

const isManagerRole = (m: BuildingMember) => m.role === 'admin' || m.role === 'manager';

export default function TeamTab({ buildingId, buildingName }: TeamTabProps) {
  const { isAdminOrManager } = useAuth();
  const queryClient = useQueryClient();
  const members = useBuildingMembers(buildingId);
  const { rules, roles, pendingByRole, isLoading: rulesLoading, isError: rulesError, setRule, applyToPending } = useBuildingRoleAssignments(buildingId);
  const people = useAssignablePeople(isAdminOrManager);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<{ member: BuildingMember; openTasks: number | null } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const name = buildingName ?? 'this building';
  const all = useMemo(() => members.data ?? [], [members.data]);
  const managers = useMemo(() => all.filter(isManagerRole), [all]);
  const field = useMemo(() => all.filter((m) => !isManagerRole(m)), [all]);
  const addable = useMemo(() => addablePeople(people.data ?? [], new Set(all.map((m) => m.id))), [people.data, all]);
  const hasUserRule = rules.has('user');
  const applicable = roles.reduce((n, role) => n + (rules.has(role) ? pendingByRole.get(role) ?? 0 : 0), 0);

  if (!isAdminOrManager) return null;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['building-members', buildingId] }),
      queryClient.invalidateQueries({ queryKey: buildingRolesKey(buildingId) }),
      queryClient.invalidateQueries({ queryKey: portfolioCoverageKey }),
    ]);

  const handleToggleRule = async (member: BuildingMember, role: string, held: boolean) => {
    setBusyRole(role);
    try {
      await setRule(role, held ? null : member.id);
      toast.success(held ? `${roleLabel(role)}: nobody` : `${roleLabel(role)}: ${memberDisplayName(member)}`);
      void queryClient.invalidateQueries({ queryKey: portfolioCoverageKey });
    } catch (e) {
      toast.error(`Could not save the rule: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusyRole(null);
    }
  };

  const handleAdd = async (personId: string, makeDefault: boolean) => {
    const person = addable.find((p) => p.id === personId);
    const who = person?.full_name?.trim() || 'Unnamed user';
    const out = await addMember(buildingId, personId, makeDefault, setRule);
    if (out.ok) {
      toast.success(makeDefault ? `Added ${who} to ${name} and made them the default for daily tasks` : `Added ${who} to ${name}`);
    } else if (out.step === 'membership') {
      toast.error(`Could not add ${who}: ${out.message}`);
    } else {
      toast.error(`Added ${who} to ${name}, but could not make them the default for daily tasks: ${out.message}`);
    }
    await refresh();
  };

  const openRemove = async (member: BuildingMember) => {
    setRemoving({ member, openTasks: null });
    try {
      const n = await countOpenTasksFor(buildingId, member.id);
      setRemoving((cur) => (cur && cur.member.id === member.id ? { member, openTasks: n } : cur));
    } catch (e) {
      toast.error(`Could not count their open tasks: ${e instanceof Error ? e.message : 'unknown error'}`);
      setRemoving(null);
    }
  };

  const confirmRemove = async () => {
    if (!removing || removing.openTasks === null) return;
    const { member, openTasks } = removing;
    const held = [...rules].filter(([, uid]) => uid === member.id).map(([role]) => role);
    setRemoveBusy(true);
    try {
      const out = await removeMember(buildingId, member.id, held, openTasks);
      const text = describeRemoveOutcome(memberDisplayName(member), out);
      if (out.ok) toast.success(text); else toast.error(text);
    } finally {
      setRemoveBusy(false);
      setRemoving(null);
      await refresh();
    }
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      const n = await applyToPending();
      if (n > 0) toast.success(`Assigned ${n} pending task${n === 1 ? '' : 's'} at ${name}`);
      else toast.info('No unassigned pending tasks match these rules');
    } catch (e) {
      toast.error(`Could not apply the rules: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="team-tab">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" aria-hidden="true" />
                Team at {name}
              </CardTitle>
              <CardDescription>Who works here and what each person does. New tasks are assigned from these roles every night.</CardDescription>
            </div>
            <Button onClick={() => setAddOpen(true)} className="min-h-11 w-full sm:w-auto">
              <UserPlus className="h-4 w-4 mr-2" aria-hidden="true" />
              Add person
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {members.isLoading || rulesLoading ? (
            <div className="space-y-2" role="status" aria-label="Loading team">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : members.isError ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
                <p className="text-sm">Could not load the people on this building.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void members.refetch()} className="min-h-11">Try again</Button>
            </div>
          ) : (
            <>
              {rulesError && <p className="text-sm text-destructive">Could not load the role rules for this building; chips may be stale.</p>}
              <section>
                <h3 className="text-sm font-medium mb-1">Managers</h3>
                <p className="text-xs text-muted-foreground mb-2">Admins and managers see every building; nothing to set here.</p>
                <ul aria-label="Managers" className="divide-y">
                  {managers.map((m) => (
                    <li key={m.id} className="py-2 text-sm">{memberDisplayName(m)} <span className="text-muted-foreground">· {m.role}</span></li>
                  ))}
                  {managers.length === 0 && <li className="py-2 text-sm text-muted-foreground">No managers found.</li>}
                </ul>
              </section>
              <section>
                <h3 className="text-sm font-medium mb-2">Field staff</h3>
                {field.length === 0 ? (
                  // Guardrail, not a hint: this is the state every coverage surface is nagging about.
                  <p className="text-sm text-destructive">Nobody is on this building yet. Tasks here reach no one.</p>
                ) : (
                  <ul aria-label="Field staff" className="divide-y">
                    {field.map((m) => (
                      <MemberRow
                        key={m.id}
                        member={m}
                        roles={roles}
                        rules={rules}
                        busyRole={busyRole}
                        onToggleRule={(role, held) => void handleToggleRule(m, role, held)}
                        onRemove={() => void openRemove(m)}
                      />
                    ))}
                  </ul>
                )}
              </section>
              <Button variant="secondary" onClick={handleApply} disabled={applying || applicable === 0} className="min-h-11 w-full sm:w-auto">
                {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <UserCheck className="mr-2 h-4 w-4" aria-hidden="true" />}
                Apply to existing pending tasks ({applicable})
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <AddPersonDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        buildingName={name}
        people={addable}
        isLoading={people.isLoading}
        isError={people.isError}
        offerDefault={!hasUserRule}
        onAdd={handleAdd}
      />
      <RemoveMemberDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open && !removeBusy) setRemoving(null); }}
        name={removing ? memberDisplayName(removing.member) : ''}
        buildingName={name}
        openTasks={removing?.openTasks ?? null}
        busy={removeBusy}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
}
```

- [x] **Step 9: Run** `npm run test -- src/components/building/team` → PASS (teamActions 9, TeamTab 12). If the Radix `Checkbox` asserts `aria-checked` differently in jsdom, assert `toBeChecked()` instead; if the `AlertDialogAction` `preventDefault` leaves the dialog open after a successful remove, that is intended (`setRemoving(null)` closes it).

- [x] **Step 10: Failing page test for the tab**

```tsx
// src/pages/BuildingDetails.team.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const auth = vi.hoisted(() => ({ isAdminOrManager: true }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdminOrManager: auth.isAdminOrManager, user: { id: 'u1' } }) }));
vi.mock('@/hooks/useBuildingScore', () => ({ useBuildingScore: () => ({ ohsPct: 80, taskPct: 90 }) }));
vi.mock('@/hooks/useBuildingTrend', () => ({
  useBuildingTrend: () => ({ rows: [], series: { compliance: [], tasks: [], issuesOpen: [], tasksOverdue: [], docsExpiring30: [] }, latest: null, isLoading: false }),
}));
// Each tab has its own tests; here only the shell matters (same stubs as BuildingDetails.mobile.test.tsx:19-29).
vi.mock('@/components/building/TenantsTab', () => ({ default: () => <div>TenantsTab</div> }));
vi.mock('@/components/building/AssetsTab', () => ({ default: () => <div>AssetsTab</div> }));
vi.mock('@/components/building/PpmTab', () => ({ default: () => <div>PpmTab</div> }));
vi.mock('@/components/building/DocumentsTab', () => ({ default: () => <div>DocumentsTab</div> }));
vi.mock('@/components/building/BuildingCalendarTab', () => ({ default: () => <div>BuildingCalendarTab</div> }));
vi.mock('@/components/building/NotesTab', () => ({ default: () => <div>NotesTab</div> }));
vi.mock('@/components/building/OverviewWidgets', () => ({ default: () => <div>OverviewWidgets</div> }));
vi.mock('@/components/building/ChecklistsTab', () => ({ default: () => <div>ChecklistsTab</div> }));
vi.mock('@/components/building/FormsTab', () => ({ default: () => <div>FormsTab</div> }));
vi.mock('@/components/building/ReportsTab', () => ({ default: () => <div>ReportsTab</div> }));
vi.mock('@/components/building/InsightLinkerTab', () => ({ default: () => <div>InsightLinkerTab</div> }));
vi.mock('@/components/building/team/TeamTab', () => ({ default: () => <div>TeamTab</div> }));
vi.mock('@/components/building/BuildingAvatar', () => ({ BuildingAvatar: () => <div>BuildingAvatar</div> }));
vi.mock('@/components/building/BuildingAvatarDialog', () => ({ BuildingAvatarDialog: () => null }));
vi.mock('@/components/building/BuildingScoreChips', () => ({ BuildingScoreChips: () => <div>BuildingScoreChips</div> }));

const building = { id: 'b1', name: 'Alpha', address: '1 Road', city: 'Cape Town', logo_url: null, logo_position: null, avatar_color: null, emergency_contacts: null, created_at: '2026-01-01T00:00:00Z' };
vi.mock('@/integrations/supabase/client', () => {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: building, error: null })) };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return { supabase: { from: vi.fn(() => query) } };
});

import BuildingDetails from './BuildingDetails';

beforeEach(() => { auth.isAdminOrManager = true; Element.prototype.scrollIntoView = vi.fn(); });

const renderAt = (url: string) =>
  render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/buildings/:id" element={<BuildingDetails />} /></Routes></MemoryRouter>);

describe('BuildingDetails Team tab', () => {
  it('mounts a Team trigger between Checklists and Forms for a manager, and ?tab=team opens it', async () => {
    renderAt('/buildings/b1?tab=team');
    const tabs = (await screen.findAllByRole('tab')).map((t) => t.textContent);
    expect(tabs.indexOf('Team')).toBe(tabs.indexOf('Forms') - 1);
    expect(tabs.indexOf('Team')).toBeGreaterThan(tabs.findIndex((t) => t?.includes('Checklists')));
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Team');
    expect(screen.getByText('TeamTab')).toBeInTheDocument();
  });

  it('does not mount the trigger for a field user, and ?tab=team falls back to Overview', async () => {
    auth.isAdminOrManager = false;
    renderAt('/buildings/b1?tab=team');
    await screen.findByRole('tablist');
    expect(screen.queryByRole('tab', { name: 'Team' })).toBeNull();
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Overview');
    expect(screen.queryByText('TeamTab')).toBeNull();
  });
});
```
- [x] **Step 11: Run** `npm run test -- src/pages/BuildingDetails.team.test.tsx` → FAIL (no `Team` tab).

- [x] **Step 12: Wire the tab into `BuildingDetails.tsx`**

After line 19 (`import ChecklistsTab …`):
```tsx
import TeamTab from '@/components/building/team/TeamTab';
```
Replace line 202:
```tsx
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
```
with
```tsx
      {/* `team` exists for admins and managers only; a field user following that deep link lands on Overview. */}
      <Tabs value={activeTab === 'team' && !isAdminOrManager ? 'overview' : activeTab} onValueChange={handleTabChange} className="w-full">
```
After line 211 (the closing `</TabsTrigger>` of `checklists`), before `forms`:
```tsx
          {isAdminOrManager && (
            <TabsTrigger value="team" className="snap-start shrink-0 min-h-11 sm:min-h-0 sm:flex-none">Team</TabsTrigger>
          )}
```
After line 344 (the `checklists` `TabsContent`), before `forms`:
```tsx
        {isAdminOrManager && (
          <TabsContent value="team" className="mt-6">
            <TeamTab buildingId={building.id} buildingName={building.name} />
          </TabsContent>
        )}
```

- [x] **Step 13: Run** `npm run test -- src/pages/BuildingDetails` → PASS (both BuildingDetails test files). Gate: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'components/building/team|BuildingDetails'` prints nothing.

- [x] **Step 14: Commit**

```bash
git add src/components/building/team src/pages/BuildingDetails.tsx src/pages/BuildingDetails.team.test.tsx
git commit -m "Add the Team tab: members, role chips, add and remove with honest partial-failure reporting

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `RoleAssignmentsPanel` becomes a summary line with a guardrail

**Files:**
- Modify: `src/components/building/RoleAssignmentsPanel.tsx` (rewrite; keep `roleLabel` and the test id)
- Modify: `src/components/building/RoleAssignmentsPanel.test.tsx` (rewrite)
- Modify: `src/components/building/ChecklistsTab.tsx:414` (drop the props the panel no longer takes)

- [x] **Step 1: Rewrite the test first**

```tsx
// src/components/building/RoleAssignmentsPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  isAdminOrManager: true,
  rules: new Map<string, string>(),
  pendingByRole: new Map<string, number>(),
  isLoading: false,
  isError: false,
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'me' } }) }));
vi.mock('@/hooks/useBuildingRoleAssignments', () => ({
  useBuildingRoleAssignments: () => ({
    rules: state.rules,
    roles: ['user', 'manager'],
    pendingByRole: state.pendingByRole,
    isLoading: state.isLoading,
    isError: state.isError,
    setRule: vi.fn(),
    applyToPending: vi.fn(),
  }),
}));
vi.mock('@/hooks/useBuildingMembers', async (orig) => {
  const members = [
    { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' },
    { id: 'u2', full_name: 'Lerato K', avatar_url: null, role: 'manager' },
  ];
  return {
    ...(await orig<typeof import('@/hooks/useBuildingMembers')>()),
    useBuildingMembers: () => ({ data: members, byId: new Map(members.map((m) => [m.id, m])), isLoading: false, isError: false }),
  };
});

import { RoleAssignmentsPanel, roleLabel, summaryLine, NO_DAILY_OWNER_WARNING } from './RoleAssignmentsPanel';

const renderPanel = () => render(<MemoryRouter><RoleAssignmentsPanel buildingId="b1" /></MemoryRouter>);

beforeEach(() => {
  state.isAdminOrManager = true;
  state.rules = new Map([['user', 'u1'], ['issue', 'u2']]);
  state.pendingByRole = new Map([['user', 3]]);
  state.isLoading = false;
  state.isError = false;
});

describe('RoleAssignmentsPanel (summary)', () => {
  it('renders nothing for users who cannot manage the team', () => {
    state.isAdminOrManager = false;
    renderPanel();
    expect(screen.queryByTestId('role-assignments-panel')).toBeNull();
  });

  it('names who catches daily tasks and issues, and links to the Team tab', () => {
    renderPanel();
    expect(screen.getByText('Daily tasks: Thabo M · Issues: Lerato K')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage team' })).toHaveAttribute('href', '/buildings/b1?tab=team');
    expect(screen.queryByRole('alert')).toBeNull();
    // No pickers, no apply button — those moved to the Team tab.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Apply to existing pending tasks/ })).toBeNull();
  });

  it('says Nobody for a rule that has no person', () => {
    state.rules = new Map([['user', 'u1']]);
    renderPanel();
    expect(screen.getByText('Daily tasks: Thabo M · Issues: Nobody')).toBeInTheDocument();
  });

  it('warns plainly when there is no user rule and pending tasks exist', () => {
    state.rules = new Map([['issue', 'u2']]);
    renderPanel();
    expect(screen.getByRole('alert')).toHaveTextContent(NO_DAILY_OWNER_WARNING);
    expect(screen.getByText('Daily tasks: Nobody · Issues: Lerato K')).toBeInTheDocument();
  });

  it('does not warn when nothing is pending, even with no user rule', () => {
    state.rules = new Map();
    state.pendingByRole = new Map();
    renderPanel();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not warn while loading or on error', () => {
    state.rules = new Map();
    state.isLoading = true;
    const { unmount } = renderPanel();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading roles…');
    unmount();
    state.isLoading = false;
    state.isError = true;
    renderPanel();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Could not load the rules for this building.')).toBeInTheDocument();
  });

  it('summaryLine falls back for an id the member list does not know', () => {
    expect(summaryLine(new Map([['user', 'ghost']]), () => 'Assigned user')).toBe('Daily tasks: Assigned user · Issues: Nobody');
  });

  it('roleLabel humanises the two fixed roles and leaves template labels alone', () => {
    expect(roleLabel('user')).toBe('User (default)');
    expect(roleLabel('manager')).toBe('Manager');
    expect(roleLabel('HVAC Contractor')).toBe('HVAC Contractor');
  });
});
```

- [x] **Step 2: Run** `npm run test -- src/components/building/RoleAssignmentsPanel.test.tsx` → FAIL (`summaryLine` / `NO_DAILY_OWNER_WARNING` not exported; pickers still rendered).

- [x] **Step 3: Rewrite the panel** (whole file):

```tsx
// src/components/building/RoleAssignmentsPanel.tsx
/**
 * Read-only "who does what here" line on the Checklists tab. Since S1 the rules are edited on
 * the Team tab; this card tells a manager at a glance who catches daily tasks ('user' rule) and
 * issues ('issue' rule — what tenant-intake assigns to), links there, and warns when daily tasks
 * have no owner while work is pending. The warning is a guardrail: plain text, never <Hint>.
 */
import { Link } from 'react-router-dom';
import { AlertTriangle, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { useBuildingMembers, memberDisplayName } from '@/hooks/useBuildingMembers';
import { useBuildingRoleAssignments } from '@/hooks/useBuildingRoleAssignments';

interface RoleAssignmentsPanelProps {
  buildingId: string;
}

/** `user`/`manager` are stored lower-case; template labels are already title-case. */
export function roleLabel(role: string): string {
  if (role === 'user') return 'User (default)';
  if (role === 'manager') return 'Manager';
  return role;
}

export const NO_DAILY_OWNER_WARNING = 'Nobody is assigned to daily tasks here. New tasks land with no owner.';

/** "Daily tasks: Thandi · Issues: Nobody" — the 'user' and 'issue' rules. */
export function summaryLine(rules: Map<string, string>, nameFor: (userId: string) => string): string {
  const who = (role: string) => {
    const id = rules.get(role);
    return id ? nameFor(id) : 'Nobody';
  };
  return `Daily tasks: ${who('user')} · Issues: ${who('issue')}`;
}

export function RoleAssignmentsPanel({ buildingId }: RoleAssignmentsPanelProps) {
  const { isAdminOrManager } = useAuth();
  const { byId } = useBuildingMembers(buildingId);
  const { rules, pendingByRole, isLoading, isError } = useBuildingRoleAssignments(buildingId);

  if (!isAdminOrManager) return null;

  const nameFor = (id: string) => {
    const m = byId.get(id);
    return m ? memberDisplayName(m) : 'Assigned user';
  };
  const pending = [...pendingByRole.values()].reduce((a, b) => a + b, 0);
  const warn = !isLoading && !isError && !rules.has('user') && pending > 0;

  return (
    <Card data-testid="role-assignments-panel">
      <CardContent className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          {warn ? (
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
          ) : (
            <Users className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <div className="text-sm space-y-1">
            {isLoading ? (
              <span role="status" className="text-muted-foreground">Loading roles…</span>
            ) : isError ? (
              <span className="text-destructive">Could not load the rules for this building.</span>
            ) : (
              <span>{summaryLine(rules, nameFor)}</span>
            )}
            {warn && <p role="alert" className="font-medium text-destructive">{NO_DAILY_OWNER_WARNING}</p>}
          </div>
        </div>
        <Link
          to={`/buildings/${buildingId}?tab=team`}
          className="inline-flex items-center min-h-11 shrink-0 text-sm font-medium underline-offset-4 hover:underline"
        >
          Manage team
        </Link>
      </CardContent>
    </Card>
  );
}

export default RoleAssignmentsPanel;
```

- [x] **Step 4: Update the mount.** `ChecklistsTab.tsx:412-415` becomes:

```tsx
      {/* Who does what here — read-only since S1 (edited on the Team tab); the panel renders nothing for non-managers, the guard here only skips its queries. */}
      {isAdminOrManager && (
        <RoleAssignmentsPanel buildingId={buildingId} />
      )}
```
`fetchTasks` and `buildingName` stay in use elsewhere in the file; do not remove them.

- [x] **Step 5: Run** `npm run test -- src/components/building/RoleAssignmentsPanel.test.tsx` → PASS (8 tests). Gate: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'RoleAssignmentsPanel|ChecklistsTab'` prints nothing; `grep -rn 'onApplied' src` prints nothing.

- [x] **Step 6: Commit**

```bash
git add src/components/building/RoleAssignmentsPanel.tsx src/components/building/RoleAssignmentsPanel.test.tsx src/components/building/ChecklistsTab.tsx
git commit -m "Reduce the Checklists role panel to a summary line with a no-owner guardrail

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `CoverageWidget` on the dashboard and the "No team" badge on Buildings

**Files:**
- Create: `src/components/dashboard/CoverageWidget.tsx`
- Create: `src/components/dashboard/CoverageWidget.test.tsx`
- Modify: `src/pages/Dashboard.tsx` (import after `:33`; grid `:250-257`)
- Modify: `src/pages/Buildings.tsx` (import after `:33`; hook after `:57`; card title `:233-239`)
- Create: `src/pages/Buildings.test.tsx`

- [x] **Step 1: Failing widget test**

```tsx
// src/components/dashboard/CoverageWidget.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CoverageRow } from '@/hooks/usePortfolioCoverage';

const state = vi.hoisted(() => ({
  rows: [] as CoverageRow[],
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
}));

vi.mock('@/hooks/usePortfolioCoverage', async (orig) => {
  const real = await orig<typeof import('@/hooks/usePortfolioCoverage')>();
  return {
    ...real,
    usePortfolioCoverage: () => ({
      data: state.isLoading || state.isError ? undefined : state.rows,
      isLoading: state.isLoading,
      isError: state.isError,
      isSuccess: !state.isLoading && !state.isError,
      isFetching: state.isFetching,
      refetch: state.refetch,
      gaps: real.coverageGaps(state.rows),
      unassignedOpen: state.rows.reduce((n, r) => n + r.unassigned_open, 0),
      byBuilding: new Map(state.rows.map((r) => [r.building_id, r])),
    }),
  };
});

import CoverageWidget, { gapReason, unassignedLine } from './CoverageWidget';

const row = (over: Partial<CoverageRow>): CoverageRow => ({
  building_id: 'b', building_name: 'B', field_members: 1, role_rules: 1, has_user_rule: true,
  unassigned_open: 0, overdue_open: 0, due_yesterday: 0, completed_yesterday: 0, ...over,
});
const renderWidget = () => render(<MemoryRouter><CoverageWidget /></MemoryRouter>);

beforeEach(() => {
  state.rows = [];
  state.isLoading = false;
  state.isError = false;
  state.isFetching = false;
  state.refetch.mockClear();
});

describe('CoverageWidget', () => {
  it('lists buildings needing a team, each linking to its Team tab, with the reason', () => {
    state.rows = [
      row({ building_id: 'b1', building_name: 'Alpha Court' }),
      row({ building_id: 'b2', building_name: 'Beta Place', field_members: 0, has_user_rule: false, unassigned_open: 3 }),
      row({ building_id: 'b3', building_name: 'Gamma House', has_user_rule: false, unassigned_open: 1 }),
    ];
    renderWidget();
    expect(screen.getByText('Buildings needing a team')).toBeInTheDocument();
    expect(screen.getByText('2 buildings')).toBeInTheDocument();
    const beta = screen.getByRole('link', { name: /Beta Place/ });
    expect(beta).toHaveAttribute('href', '/buildings/b2?tab=team');
    expect(beta).toHaveTextContent('No field staff and no default for daily tasks');
    expect(screen.getByRole('link', { name: /Gamma House/ })).toHaveTextContent('No default for daily tasks');
    expect(screen.queryByRole('link', { name: /Alpha Court/ })).toBeNull();
    expect(screen.getByText('4 open tasks have nobody assigned')).toBeInTheDocument();
  });

  it('shows the honest empty state', () => {
    state.rows = [row({ building_id: 'b1', building_name: 'Alpha Court' })];
    renderWidget();
    expect(screen.getByText('Every building has field staff and a daily-task default.')).toBeInTheDocument();
    expect(screen.getByText('No open tasks are waiting for an owner.')).toBeInTheDocument();
  });

  it('caps the list and points at the Buildings page for the rest', () => {
    state.rows = Array.from({ length: 8 }, (_, i) => row({ building_id: `b${i}`, building_name: `Building ${i}`, field_members: 0 }));
    renderWidget();
    expect(screen.getAllByRole('link', { name: /Building \d/ })).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'View all 8 in Buildings' })).toHaveAttribute('href', '/buildings');
  });

  it('renders skeletons while loading', () => {
    state.isLoading = true;
    renderWidget();
    expect(screen.getByRole('status', { name: 'Loading team coverage' })).toBeInTheDocument();
  });

  it('shows an error with retry', () => {
    state.isError = true;
    renderWidget();
    expect(screen.getByText('Could not load team coverage.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it('gapReason and unassignedLine word the three cases and the singular', () => {
    expect(gapReason(row({ field_members: 0 }))).toBe('No field staff');
    expect(gapReason(row({ has_user_rule: false }))).toBe('No default for daily tasks');
    expect(gapReason(row({ field_members: 0, has_user_rule: false }))).toBe('No field staff and no default for daily tasks');
    expect(unassignedLine(1)).toBe('1 open task has nobody assigned');
    expect(unassignedLine(0)).toBe('No open tasks are waiting for an owner.');
  });
});
```

- [x] **Step 2: Run** `npm run test -- src/components/dashboard/CoverageWidget.test.tsx` → FAIL (module missing).

- [x] **Step 3: Implement the widget**

```tsx
// src/components/dashboard/CoverageWidget.tsx
/**
 * Dashboard widget for admins/managers (spec §4.3): the buildings where nobody would receive a
 * task — no field member, or no 'user' rule for daily tasks — each linking to that building's
 * Team tab, plus one line for how many open tasks across the portfolio have nobody assigned.
 * One TanStack query (usePortfolioCoverage); loading, error-with-retry and empty states are
 * rendered honestly, the way WaitingOnYouWidget does it.
 */
import { Link } from 'react-router-dom';
import { AlertTriangle, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBuildingName } from '@/lib/buildingName';
import { usePortfolioCoverage, type CoverageRow } from '@/hooks/usePortfolioCoverage';

/** Most buildings the widget lists; the heading badge carries the true count. */
export const MAX_ROWS = 6;

export function gapReason(r: CoverageRow): string {
  if (r.field_members === 0 && !r.has_user_rule) return 'No field staff and no default for daily tasks';
  if (r.field_members === 0) return 'No field staff';
  return 'No default for daily tasks';
}

export function unassignedLine(n: number): string {
  if (n === 0) return 'No open tasks are waiting for an owner.';
  return n === 1 ? '1 open task has nobody assigned' : `${n} open tasks have nobody assigned`;
}

export default function CoverageWidget() {
  const query = usePortfolioCoverage();
  const { gaps, unassignedOpen } = query;
  const shown = gaps.slice(0, MAX_ROWS);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <Users className="h-5 w-5" aria-hidden="true" />
          Buildings needing a team
          {query.isSuccess && gaps.length > 0 && (
            <Badge variant="destructive">{gaps.length} {gaps.length === 1 ? 'building' : 'buildings'}</Badge>
          )}
        </CardTitle>
        <CardDescription>Where a task would reach nobody</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isLoading ? (
          <div className="space-y-2" role="status" aria-label="Loading team coverage">
            {[1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : query.isError ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" aria-hidden="true" />
              <p className="text-xs text-muted-foreground truncate">Could not load team coverage.</p>
            </div>
            <Button onClick={() => void query.refetch()} variant="outline" size="sm" disabled={query.isFetching}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            {gaps.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Every building has field staff and a daily-task default.</p>
            ) : (
              <div className="space-y-2">
                {shown.map((r) => (
                  <Link key={r.building_id} to={`/buildings/${r.building_id}?tab=team`} className="block focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
                    <div className="flex items-center justify-between gap-3 p-3 min-h-11 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                      <p className="font-medium text-sm truncate">{formatBuildingName(r.building_name)}</p>
                      <p className="text-xs text-destructive whitespace-nowrap">{gapReason(r)}</p>
                    </div>
                  </Link>
                ))}
                {gaps.length > shown.length && (
                  <div className="text-center pt-1">
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/buildings">View all {gaps.length} in Buildings</Link>
                    </Button>
                  </div>
                )}
              </div>
            )}
            <p className={`text-sm ${unassignedOpen > 0 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>{unassignedLine(unassignedOpen)}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [x] **Step 4: Run** `npm run test -- src/components/dashboard/CoverageWidget.test.tsx` → PASS (6 tests).

- [x] **Step 5: Mount on the dashboard.** `Dashboard.tsx`: after line 33 add `import CoverageWidget from '@/components/dashboard/CoverageWidget';`. Replace lines 246-257 with:

```tsx
      {/* The manager's own queues, directly under the portfolio numbers and side by side:
          these are the only blocks on this page that are work *for the viewer*, and they were
          previously below three portfolio-wide widgets and a week of activity — off-screen on a
          laptop, so the things actually blocking other people went unseen. Coverage sits with
          them because a building with nobody on it is the manager's to fix, not a statistic. */}
      {isAdminOrManager && (
        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {/* Reports and sign-offs waiting on this manager specifically */}
          <WaitingOnYouWidget />
          {/* Buildings where a task would reach nobody */}
          <CoverageWidget />
          {/* Pending Form Submissions for Managers */}
          <PendingSubmissionsWidget />
        </div>
      )}
```
(The page has no test of its own — the three widgets are each tested; the mount is covered by the typecheck gate and `grep -n 'CoverageWidget' src/pages/Dashboard.tsx` printing two lines.)

- [x] **Step 6: Failing Buildings-page test**

```tsx
// src/pages/Buildings.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CoverageRow } from '@/hooks/usePortfolioCoverage';

const state = vi.hoisted(() => ({
  isAdminOrManager: true,
  coverage: [] as CoverageRow[],
  coverageEnabledArg: [] as unknown[],
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'me' } }) }));
vi.mock('@/hooks/useBuildings', () => ({
  useBuildings: () => ({
    buildings: [
      { id: 'b1', name: 'Alpha Court', address: '1 Road', city: 'Cape Town', logo_url: null, logo_position: null, avatar_color: null },
      { id: 'b2', name: 'Beta Place', address: '2 Road', city: 'Durban', logo_url: null, logo_position: null, avatar_color: null },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
    deleteBuilding: vi.fn(),
  }),
}));
vi.mock('@/hooks/useBuildingsScores', () => ({ useBuildingsScores: () => ({ scores: {} }), chipValues: () => ({}) }));
vi.mock('@/hooks/useBuildingTrend', () => ({ useBuildingsTrends: () => ({ latest: {}, series: {} }) }));
vi.mock('@/hooks/usePortfolioCoverage', () => ({
  usePortfolioCoverage: (enabled: boolean) => {
    state.coverageEnabledArg.push(enabled);
    return { data: state.coverage, isLoading: false, isError: false, byBuilding: new Map(state.coverage.map((r) => [r.building_id, r])), gaps: [], unassignedOpen: 0 };
  },
}));
vi.mock('@/components/building/BuildingAvatar', () => ({ BuildingAvatar: () => <div>Avatar</div> }));
vi.mock('@/components/building/BuildingAvatarDialog', () => ({ BuildingAvatarDialog: () => null }));
vi.mock('@/components/building/BuildingImportDialog', () => ({ default: () => null }));
vi.mock('@/components/building/BuildingScoreChips', () => ({ BuildingScoreChips: () => null }));
vi.mock('@/components/ui/export-csv-button', () => ({ ExportCsvButton: () => null }));

import Buildings from './Buildings';

const row = (over: Partial<CoverageRow>): CoverageRow => ({
  building_id: 'b', building_name: 'B', field_members: 1, role_rules: 1, has_user_rule: true,
  unassigned_open: 0, overdue_open: 0, due_yesterday: 0, completed_yesterday: 0, ...over,
});
const renderPage = () => render(<MemoryRouter><Buildings /></MemoryRouter>);

beforeEach(() => {
  state.isAdminOrManager = true;
  state.coverage = [row({ building_id: 'b1', building_name: 'Alpha Court' }), row({ building_id: 'b2', building_name: 'Beta Place', field_members: 0 })];
  state.coverageEnabledArg = [];
});

describe('Buildings "No team" badge', () => {
  it('marks a card whose building has no field members, for a manager', () => {
    renderPage();
    const beta = screen.getByText('Beta Place').closest('[data-testid^="building-card-"]') as HTMLElement;
    expect(within(beta).getByText('No team')).toBeInTheDocument();
    const alpha = screen.getByText('Alpha Court').closest('[data-testid^="building-card-"]') as HTMLElement;
    expect(within(alpha).queryByText('No team')).toBeNull();
    expect(state.coverageEnabledArg[0]).toBe(true);
  });

  it('never shows the badge to a field user and does not query coverage for them', () => {
    state.isAdminOrManager = false;
    renderPage();
    expect(screen.queryByText('No team')).toBeNull();
    expect(state.coverageEnabledArg[0]).toBe(false);
  });
});
```

- [x] **Step 7: Run** `npm run test -- src/pages/Buildings.test.tsx` → FAIL (no badge, no `data-testid`).

- [x] **Step 8: Add the badge.** `Buildings.tsx`: after line 33 add `import { usePortfolioCoverage } from '@/hooks/usePortfolioCoverage';`. After line 57 (`const trends = …`) add:

```tsx
  // Coverage rows are RLS-scoped and only meaningful for managers; the hook is disabled for everyone else.
  const coverage = usePortfolioCoverage(isAdminOrManager);
```
Line 179 becomes:
```tsx
              <Card key={building.id} data-testid={`building-card-${building.id}`} className="group hover:shadow-md transition-shadow relative overflow-hidden">
```
Replace lines 233-239 with:
```tsx
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base">{formatBuildingName(building.name)}</CardTitle>
                        {isAdminOrManager && coverage.byBuilding.get(building.id)?.field_members === 0 && (
                          <Badge variant="destructive" className="text-xs">No team</Badge>
                        )}
                      </div>
                      <CardDescription className="flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3" />
                        {building.city}
                      </CardDescription>
                    </div>
```

- [x] **Step 9: Run** `npm run test -- src/pages/Buildings.test.tsx src/components/dashboard/CoverageWidget.test.tsx` → PASS. Gate: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'CoverageWidget|Dashboard.tsx|Buildings'` prints nothing.

- [x] **Step 10: Commit**

```bash
git add src/components/dashboard/CoverageWidget.tsx src/components/dashboard/CoverageWidget.test.tsx src/pages/Dashboard.tsx src/pages/Buildings.tsx src/pages/Buildings.test.tsx
git commit -m "Show the buildings nobody is on: dashboard coverage widget and a No team badge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Invite flow — field staff need a building (client and edge function)

**Files:**
- Create: `src/lib/invite.ts`
- Create: `src/lib/invite.test.ts`
- Modify: `src/pages/UserManagement.tsx` (imports `:1-3`; component `:99`; `handleInvite` `:264-309`; dialog `:510-539`; submit `:574-577`)
- Modify: `supabase/functions/invite-user/index.ts:181` (read-verified; the controller deploys)

- [x] **Step 1: Failing test for the rule and the copy**

```ts
// src/lib/invite.test.ts
import { describe, it, expect } from 'vitest';
import { inviteBlockedReason, teamTabUrl, FIELD_STAFF_BUILDING_HELP, FIELD_STAFF_NEEDS_BUILDING } from './invite';

describe('inviteBlockedReason', () => {
  it('blocks a field-staff invite with no building', () => {
    expect(inviteBlockedReason('user', [])).toBe(FIELD_STAFF_NEEDS_BUILDING);
    expect(FIELD_STAFF_NEEDS_BUILDING).toBe('Field staff need at least one building');
  });

  it('allows field staff with a building, and managers or admins with none', () => {
    expect(inviteBlockedReason('user', ['b1'])).toBeNull();
    expect(inviteBlockedReason('manager', [])).toBeNull();
    expect(inviteBlockedReason('admin', [])).toBeNull();
  });
});

describe('copy and links', () => {
  it('uses the spec wording for the building help text', () => {
    expect(FIELD_STAFF_BUILDING_HELP).toBe('Field staff only see the buildings ticked here. Managers and admins see every building.');
  });

  it('teamTabUrl deep-links to the Team tab', () => {
    expect(teamTabUrl('b1')).toBe('/buildings/b1?tab=team');
  });
});
```

- [x] **Step 2: Run** `npm run test -- src/lib/invite.test.ts` → FAIL (module missing).

- [x] **Step 3: Implement**

```ts
// src/lib/invite.ts
/**
 * The one rule the invite dialog and the invite-user edge function both enforce (spec §4.3): a
 * field-staff account with no building can see nothing and receives nothing, so it must not be
 * created. Kept pure so the dialog's validation is unit-tested without rendering the page.
 */
export const FIELD_STAFF_NEEDS_BUILDING = 'Field staff need at least one building';
export const FIELD_STAFF_BUILDING_HELP = 'Field staff only see the buildings ticked here. Managers and admins see every building.';
export const SET_TEAM_ACTION_LABEL = 'Set what they do at each building';

/** Why the invite cannot be sent yet, or null when it can. */
export function inviteBlockedReason(role: string, buildingIds: string[]): string | null {
  return role === 'user' && buildingIds.length === 0 ? FIELD_STAFF_NEEDS_BUILDING : null;
}

export function teamTabUrl(buildingId: string): string {
  return `/buildings/${buildingId}?tab=team`;
}
```

- [x] **Step 4: Run** `npm run test -- src/lib/invite.test.ts` → PASS (4 tests).

- [x] **Step 5: Wire the dialog.** In `UserManagement.tsx`:

After line 2 (`import { formatBuildingName } …`):
```tsx
import { useNavigate } from 'react-router-dom';
import { inviteBlockedReason, teamTabUrl, FIELD_STAFF_BUILDING_HELP, SET_TEAM_ACTION_LABEL } from '@/lib/invite';
```
After line 101 (`const { buildings, loading: buildingsLoading } = useBuildings();`):
```tsx
  const navigate = useNavigate();
```
In `handleInvite`, after the email check (line 269 `}`), add:
```tsx
    const blocked = inviteBlockedReason(inviteRole, inviteBuildingIds);
    if (blocked) {
      toast.error(blocked);
      return;
    }
    // After a field-staff invite the next thing to do is say what they do at their building.
    const firstBuildingId = inviteRole === 'user' ? inviteBuildingIds[0] : undefined;
    const teamAction = firstBuildingId
      ? { label: SET_TEAM_ACTION_LABEL, onClick: () => navigate(teamTabUrl(firstBuildingId)) }
      : undefined;
```
Replace lines 284-299 (the three result branches) with:
```tsx
      if (result.status === 'temp_password' && result.tempPassword) {
        // Show the generated password exactly once.
        setTempPasswordResult({ email, password: result.tempPassword });
        setCopied(false);
        if (teamAction) toast.success(`Account created for ${email}`, { action: teamAction });
      } else if (result.actionLink) {
        // Email delivery wasn't available — copy the setup link so the admin
        // can send it manually. Onboarding still completes.
        try {
          await navigator.clipboard.writeText(result.actionLink);
          toast.success(`Invite created — email couldn't be sent, so the setup link is copied to your clipboard. Send it to ${email} (valid 24 hours).`, { action: teamAction });
        } catch {
          toast.success(`Invite created for ${email}, but email couldn't be sent. Use "Resend → Copy link" on their row to get the setup link.`, { action: teamAction });
        }
      } else {
        toast.success(`Invite emailed to ${email}`, { action: teamAction });
      }
```
(`sonner`'s `toast.success(message, { action: { label, onClick } })` renders the button; `action: undefined` renders none.)

Replace line 511:
```tsx
                <Label>Building Access (optional)</Label>
```
with
```tsx
                <Label>{inviteRole === 'user' ? 'Building access (required for field staff)' : 'Building access (optional)'}</Label>
```
Replace lines 536-538:
```tsx
                <p className="text-xs text-muted-foreground">
                  Leave empty for organization-wide access (subject to role).
                </p>
```
with
```tsx
                <p className="text-xs text-muted-foreground">{FIELD_STAFF_BUILDING_HELP}</p>
```
Replace line 574:
```tsx
              <Button onClick={handleInvite} disabled={isInviting}>
```
with
```tsx
              <Button onClick={handleInvite} disabled={isInviting || inviteBlockedReason(inviteRole, inviteBuildingIds) !== null}>
```

- [x] **Step 6: Gate.** `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'UserManagement|lib/invite'` prints nothing; `npm run test -- src/lib/invite.test.ts` PASS; `grep -n 'Leave empty for organization-wide' src/pages/UserManagement.tsx` prints nothing.

- [x] **Step 7: Edge function.** In `supabase/functions/invite-user/index.ts`, the exact diff:

```diff
@@ -180,3 +180,7 @@
     if (!VALID_ROLES.includes(role)) return json({ error: "Invalid role" }, 400);
+    // A field-staff account with no building sees nothing and receives nothing (spec §4.3) —
+    // refuse it here too, so a stale client cannot create a zombie.
+    if (role === "user" && buildingIds.length === 0) {
+      return json({ error: "Field staff need at least one building" }, 400);
+    }
     const uuidRe = /^[0-9a-f-]{36}$/i;
     if (buildingIds.some((b) => !uuidRe.test(b))) return json({ error: "Invalid building id" }, 400);
```
`deno` is not installed here: read-verify the diff (`git diff supabase/functions/invite-user/index.ts` shows exactly those five added lines), no local run. The controller deploys it in Task 8 (`supabase functions deploy invite-user`) and proves it with one curl as the admin persona: `{"email":"zztest-nob@buildingops.app","role":"user","buildingIds":[]}` → HTTP 400 `{"error":"Field staff need at least one building"}`.

- [x] **Step 8: Commit**

```bash
git add src/lib/invite.ts src/lib/invite.test.ts src/pages/UserManagement.tsx supabase/functions/invite-user/index.ts
git commit -m "Field staff invites need a building: dialog validation, spec copy, Team-tab toast action, 400 in invite-user

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Digest — Coverage section for admins and managers

**Files:**
- Modify: `supabase/functions/_shared/digest.ts` (types after `:27`; `DigestInput` `:29-37`; `composeDigest` between the expiring block `:89-98` and the unread block `:99-104`)
- Modify: `src/lib/digest.test.ts` (append a `describe`)
- Modify: `supabase/functions/daily-digest/index.ts` (import `:19-26`; after the expiring block `:127`; the `composeDigest` call `:283-285`) — read-verified; the controller deploys

- [x] **Step 1: Failing tests** — append to `src/lib/digest.test.ts` (and add `coverageSummary`, `type CoverageRow` to the import on line 2):

```ts
describe('coverage section', () => {
  const cov = (over: Partial<CoverageRow>): CoverageRow => ({
    building_id: 'b', building_name: 'B', field_members: 1, role_rules: 1, has_user_rule: true,
    unassigned_open: 0, overdue_open: 0, due_yesterday: 0, completed_yesterday: 0, ...over,
  });

  it('coverageSummary names no-team buildings, totals unassigned work and finds silent buildings', () => {
    expect(coverageSummary([
      cov({ building_name: 'Alpha Court', field_members: 0, unassigned_open: 2 }),
      cov({ building_name: 'Beta Place', unassigned_open: 3, due_yesterday: 4, completed_yesterday: 0 }),
      cov({ building_name: 'Gamma House', due_yesterday: 2, completed_yesterday: 1 }),
      cov({ building_name: 'Delta Row', due_yesterday: 0, completed_yesterday: 0 }),
    ])).toEqual({ noTeam: ['Alpha Court'], unassignedOpen: 5, silentYesterday: ['Beta Place'] });
  });

  it('coverageSummary is null when there is nothing to say', () => {
    expect(coverageSummary([cov({}), cov({ building_name: 'C' })])).toBeNull();
    expect(coverageSummary([])).toBeNull();
  });

  it('composeDigest adds a Coverage section between expiring and unread, worded per line', () => {
    const sections = composeDigest({
      ...empty,
      unread: 1,
      expiring: { expired: 1, d30: 0, d60: 0, d90: 0 },
      coverage: { noTeam: ['Alpha Court', 'Beta Place'], unassignedOpen: 5, silentYesterday: ['Gamma House'] },
    });
    expect(sections!.map((s) => s.heading)).toEqual([
      '1 expiring document, warranty or service',
      'Coverage',
      '1 unread notification',
    ]);
    expect(sections![1].lines).toEqual([
      'Alpha Court has no field team',
      'Beta Place has no field team',
      '5 open tasks have nobody assigned',
      'Nothing was logged yesterday at Gamma House',
    ]);
  });

  it('singularises the unassigned line and omits it at zero', () => {
    expect(composeDigest({ ...empty, coverage: { noTeam: [], unassignedOpen: 1, silentYesterday: [] } })![0].lines).toEqual(['1 open task has nobody assigned']);
    expect(composeDigest({ ...empty, coverage: { noTeam: ['A'], unassignedOpen: 0, silentYesterday: [] } })![0].lines).toEqual(['A has no field team']);
  });

  it('caps the no-team list at SECTION_MAX and still appends the other lines', () => {
    const noTeam = Array.from({ length: SECTION_MAX + 2 }, (_, i) => `Building ${i}`);
    const lines = composeDigest({ ...empty, coverage: { noTeam, unassignedOpen: 2, silentYesterday: ['Z'] } })![0].lines;
    expect(lines).toHaveLength(SECTION_MAX + 3);
    expect(lines[SECTION_MAX]).toBe('…and 2 more');
    expect(lines.slice(-2)).toEqual(['2 open tasks have nobody assigned', 'Nothing was logged yesterday at Z']);
  });

  it('adds no section for null or all-empty coverage (site users pass null)', () => {
    expect(composeDigest({ ...empty, coverage: null })).toBeNull();
    expect(composeDigest({ ...empty, coverage: { noTeam: [], unassignedOpen: 0, silentYesterday: [] } })).toBeNull();
  });
});
```

- [x] **Step 2: Run** `npm run test -- src/lib/digest.test.ts` → FAIL (`coverageSummary` not exported; no Coverage section).

- [x] **Step 3: Implement in `_shared/digest.ts`.** After line 27 (`ExpiryBuckets`):

```ts
/** One row of `portfolio_coverage()` (the columns the digest reads; the full row has more). */
export interface CoverageRow {
  building_id: string;
  building_name: string;
  field_members: number;
  unassigned_open: number;
  due_yesterday: number;
  completed_yesterday: number;
}

/** What the Coverage section says, shaped once per run from the service-role call. */
export interface CoverageSummary {
  /** Buildings with no active field member. */
  noTeam: string[];
  /** Open (pending or overdue) tasks across the portfolio with nobody assigned. */
  unassignedOpen: number;
  /** Buildings that had daily tasks due yesterday and completed none of them. */
  silentYesterday: string[];
}

/** Pure shaping of the RPC rows; null when every line would be empty so the caller can pass nothing. */
export function coverageSummary(rows: CoverageRow[]): CoverageSummary | null {
  const s: CoverageSummary = {
    noTeam: rows.filter((r) => r.field_members === 0).map((r) => r.building_name),
    unassignedOpen: rows.reduce((n, r) => n + r.unassigned_open, 0),
    silentYesterday: rows.filter((r) => r.due_yesterday > 0 && r.completed_yesterday === 0).map((r) => r.building_name),
  };
  return s.noTeam.length || s.unassignedOpen || s.silentYesterday.length ? s : null;
}
```
In `DigestInput` (after `expiring?`):
```ts
  /** Portfolio coverage gaps; only admins and managers get this section. */
  coverage?: CoverageSummary | null;
```
In `composeDigest`, after the expiring block (after line 98's `}`) and before `if (input.unread)`:
```ts
  const c = input.coverage;
  if (c && (c.noTeam.length || c.unassignedOpen || c.silentYesterday.length)) {
    const lines: string[] = capLines(c.noTeam.map((name) => `${name} has no field team`));
    if (c.unassignedOpen) {
      lines.push(`${c.unassignedOpen} open ${plural(c.unassignedOpen, 'task has', 'tasks have')} nobody assigned`);
    }
    for (const name of c.silentYesterday) lines.push(`Nothing was logged yesterday at ${name}`);
    sections.push({ heading: 'Coverage', lines });
  }
```
Update the `composeDigest` doc comment (`:60-65`) to read "…the portfolio expiry counts and the coverage gaps (admins and managers only — the caller passes null for everyone else), then the unread-inbox count."

- [x] **Step 4: Run** `npm run test -- src/lib/digest.test.ts` → PASS (all prior tests plus 6 new).

- [x] **Step 5: `daily-digest/index.ts`** (read-verified). The import block `:19-26` gains `coverageSummary`, `type CoverageRow`, `type CoverageSummary`:

```ts
import {
  composeDigest,
  coverageSummary,
  dueTodayPush,
  type CoverageRow,
  type CoverageSummary,
  type DigestIssue,
  type DigestSection,
  type DigestTask,
  type ExpiryBuckets,
} from "../_shared/digest.ts";
```
After line 127 (the end of the `expiring` try/catch), add:
```ts
    // Coverage gaps for admins and managers, one service-role call per run (S1 §4.4). The service
    // role bypasses RLS, so this is the whole portfolio; site users never receive this section.
    let coverage: CoverageSummary | null = null;
    try {
      const { data: covRows, error: covErr } = await supabase.rpc("portfolio_coverage");
      if (covErr) throw covErr;
      coverage = coverageSummary((covRows ?? []) as CoverageRow[]);
    } catch (e) {
      // The digest still goes out without the coverage lines; the dashboard widget covers it.
      console.error("daily-digest: portfolio_coverage failed", e);
    }
```
Replace lines 283-285:
```ts
        const sections = composeDigest({
          today, tasks, issues, expiring: adminIds.has(p.id) ? expiring : null, unread: unreadCount ?? 0,
        });
```
with
```ts
        const isManager = adminIds.has(p.id);
        const sections = composeDigest({
          today, tasks, issues,
          expiring: isManager ? expiring : null,
          coverage: isManager ? coverage : null,
          unread: unreadCount ?? 0,
        });
```
Also extend the header comment (`:1-5`) with "for admins and managers the portfolio's coverage gaps (`portfolio_coverage()`, S1 §4.4)".

- [x] **Step 6: Gate.** `npm run test -- src/lib/digest.test.ts` PASS; `git diff --stat supabase/functions/daily-digest/index.ts` shows one file, ~25 insertions; `grep -c 'coverage' supabase/functions/daily-digest/index.ts` ≥ 6.

- [x] **Step 7: Commit**

```bash
git add supabase/functions/_shared/digest.ts src/lib/digest.test.ts supabase/functions/daily-digest/index.ts
git commit -m "Digest tells managers which buildings have nobody and where nothing was logged yesterday

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8 (controller only): apply, deploy, smoke, prod, regenerate, record

**Files:**
- Modify: `src/integrations/supabase/types.ts` (regenerated from prod)
- Modify: `src/hooks/useAssignablePeople.ts`, `src/hooks/usePortfolioCoverage.ts` (drop the boundary casts)
- Modify: `docs/plans/APPLY_CHECKLIST.md` (new "S1" section)

- [ ] **Step 1: Staging.** `supa.mjs apply vkrihpmjajjcxmzgjqdr ../GMI/sql/2026-09-15_01_team_coverage.sql` (expect 201), apply a second time (idempotent, 201), `NOTIFY pgrst, 'reload schema'`. Verify with the three queries in the migration footer. Deploy `invite-user` and `daily-digest` (`supabase functions deploy invite-user --project-ref vkrihpmjajjcxmzgjqdr`, same for `daily-digest`). Run `node scripts/rls-smoke.mjs` (expect the previous count + 11 passes, 0 failures) and `npm run smoke:notifications`. Curl `invite-user` as the admin persona with `role: "user", buildingIds: []` → 400 `Field staff need at least one building`. Trigger `daily-digest` once with the secret header and confirm the response counts and that an admin's email carries a `Coverage` heading (or none, if staging has no gaps — then check `select * from portfolio_coverage()` shows none).

- [ ] **Step 2: Gates on the clean tree.** `npm run test` green; `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'` ≤ 46; `npm run build`.

- [ ] **Step 3: Production.** Same apply (`qdzgkttiosahdfqresvz`), reload, deploy both functions, `node scripts/rls-smoke.mjs` against prod, the same invite-user curl.

- [ ] **Step 4: Regenerate types and drop the casts.** `npx supabase gen types typescript --project-id qdzgkttiosahdfqresvz --schema public > src/integrations/supabase/types.ts` (the same invocation the R4a record used). Then in `useAssignablePeople.ts` and `usePortfolioCoverage.ts` replace the cast line with `const { data, error } = await supabase.rpc('assignable_people');` / `await supabase.rpc('portfolio_coverage');` and delete the `not yet in the generated types` comment. `grep -rn "assignable_people is not yet\|portfolio_coverage is not yet" src` prints nothing. `npm run test -- src/hooks/useAssignablePeople.test.ts src/hooks/usePortfolioCoverage.test.ts` still PASS; typecheck count ≤ 46.

- [ ] **Step 5: Record.** Append to `docs/plans/APPLY_CHECKLIST.md`:

```markdown
## S1 "Team & coverage" (2026-09-15)

Spec `docs/superpowers/specs/2026-09-12-field-readiness-design.md` §4; plan `docs/superpowers/plans/2026-09-12-s1-team-coverage.md`.

### Migration

- `2026-09-15_01_team_coverage.sql` (GMI `<sha>`) — additive, idempotent, one transaction. `user_buildings` writes move
  from `ub_insert_admin` / `ub_update_admin` / `ub_delete_admin` to one `ub_write_managed` (`for all`: admin, or manager
  with `can_access_building`; `ub_select` unchanged, so a user still sees only their own rows and can still not
  self-grant). `assignable_people()` — SECURITY DEFINER, raises 42501 unless admin/manager, every profile with a
  `user_roles` row plus a `deactivated` flag. `portfolio_coverage()` — SECURITY INVOKER (RLS-scoped; service role sees
  all), one row per building: `field_members, role_rules, has_user_rule, unassigned_open, overdue_open, due_yesterday,
  completed_yesterday` ("yesterday" = SAST date − 1). Both `set search_path = ''`, `anon` revoked, granted to
  `authenticated` and `service_role`.

### Verification queries (run as service role after each apply)

- `select policyname, cmd from pg_policies where tablename = 'user_buildings' order by 1;` → `ub_select SELECT`,
  `ub_write_managed ALL` — nothing else.
- `select proname, prosecdef from pg_proc where pronamespace = 'public'::regnamespace and proname in
  ('assignable_people','portfolio_coverage') order by 1;` → `assignable_people t`, `portfolio_coverage f`.
- `select count(*) from portfolio_coverage();` → equals `select count(*) from buildings;`.
- `select building_name from portfolio_coverage() where field_members = 0 order by 1;` → the list the dashboard
  widget and the "No team" badges show (expected to be most buildings on day one: production had 0 `user`-role
  accounts at R3a).

### Staging — <date>

- [ ] Applied twice (201, idempotent), PostgREST reloaded; verification queries as above.
- [ ] `invite-user` and `daily-digest` deployed; `invite-user` answers 400 `Field staff need at least one building`
      to `role: "user", buildingIds: []`.
- [ ] `rls-smoke` <n>/0 (manager `user_buildings` insert now allowed, user self-grant still denied, S1 block green).
- [ ] `daily-digest` triggered once: admins' email carries a `Coverage` section (or `portfolio_coverage()` shows no gaps).

### Production — <date>

- [ ] Applied, reloaded, both functions deployed, `rls-smoke` <n>/0, invite-user 400 check.
- [ ] Types regenerated from prod; boundary casts dropped; `npm run test` green; tsc ≤ 46.

### Owner items

- **Every building will show "No team" until someone is added.** There were no `user`-role accounts in production
  at R3a; the badge and the dashboard widget are telling the truth. Invite field staff (a building is now required)
  and use Building → Team to add them and set the daily-task default. Managers can do this now, not only admins.
- **The Team tab writes access AND the daily-task default in one action** when the building has no `user` rule yet
  (checkbox on by default). Untick it if the person is not the one who should catch daily tasks.
- **Removing a person unassigns their open tasks here** and tells you how many before you confirm. Reassign them on
  the Checklists tab or set a new default and press "Apply to existing pending tasks" on the Team tab.
- **The digest's "Nothing was logged yesterday at …" line** only fires for buildings that had daily tasks due; a
  building with no daily template is never listed.
```

- [ ] **Step 6: Commit**

```bash
git add src/integrations/supabase/types.ts src/hooks/useAssignablePeople.ts src/hooks/usePortfolioCoverage.ts docs/plans/APPLY_CHECKLIST.md
git commit -m "S1 applied: regenerate types from prod, drop the RPC boundary casts, record the apply

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

If the Management API token is unavailable to the session, stop after Task 7 with the Staging/Production checklists above unticked and say so (spec §9).

---

## Self-review

### Spec §4 requirement → task

| Spec | Requirement | Task |
|---|---|---|
| §4.1 | `ub_*_admin` replaced by `ub_write_managed` (`is_admin() or (is_admin_or_manager() and can_access_building)`), self-grant still impossible | 1 (Step 1 §1; Step 3 rows 1 and 4; Step 4 line 357 flip + line 358 kept) |
| §4.1 | `assignable_people()` SECURITY DEFINER, `is_admin_or_manager()` only, `(id, full_name, avatar_url, role, deactivated)` for every profile with a `user_roles` row | 1 (Step 1 §2) |
| §4.1 | `portfolio_coverage()` SECURITY INVOKER, the nine columns, yesterday in SAST | 1 (Step 1 §3; Step 3 row 2 asserts every column against a fixture) |
| §4.1 | Grants `authenticated` + `service_role`; both `set search_path = ''` | 1 (Step 1, both functions; `anon` revoked too) |
| §4.2 | Tab `team` between Checklists and Forms, admin/manager only, trigger not mounted for `user`, `?tab=team` deep link | 3 (Step 12; Step 10 tests both roles) |
| §4.2 | Members: managers under a heading with no controls; field members with avatar, name, role chips, Remove | 3 (`TeamTab` sections; `MemberRow`) |
| §4.2 | Add person: `assignable_people()` minus members minus admin/manager; inserts `user_buildings`; offers "Also make them the default for daily tasks" checked by default when no `'user'` rule; writes the `'user'` rule | 2 (`addablePeople`), 3 (`AddPersonDialog`, `addMember`) |
| §4.2 | Role chips: tapping sets that label's rule to this member via `setRule` | 3 (`MemberRow` + `handleToggleRule`) |
| §4.2 | Remove: confirm with pending-task count; delete rules, null `assigned_to`, delete `user_buildings`; zero-row checks; partial failure reported with what was and was not undone | 3 (`countOpenTasksFor`, `removeMember`, `describeRemoveOutcome`, `RemoveMemberDialog`) |
| §4.2 | "Apply to existing pending tasks" moves to the Team tab | 3 (`TeamTab`), 4 (removed from the panel) |
| §4.2 | `RoleAssignmentsPanel` → read-only "Daily tasks: … · Issues: …" + link; guardrail (not `<Hint>`) "Nobody is assigned to daily tasks here. New tasks land with no owner." when no `'user'` rule and pending tasks exist | 4 |
| §4.3 | `CoverageWidget` beside `WaitingOnYouWidget`, admin/manager: "Buildings needing a team" (`field_members = 0` or `has_user_rule = false`) linking to `/buildings/:id?tab=team`, plus "N open tasks have nobody assigned"; honest loading/error/empty | 5 (Steps 1–5) |
| §4.3 | Buildings list: destructive "No team" badge when `field_members = 0`, admin/manager only | 5 (Steps 6–8) |
| §4.3 | Invite: `user` needs ≥ 1 building, button disabled until ticked; help text verbatim; post-invite toast action "Set what they do at each building" → first ticked building's Team tab | 6 (Steps 1–5) |
| §4.3 | `invite-user` rejects `role = 'user'` with empty `buildingIds` (400, `Field staff need at least one building`) | 6 (Step 7) |
| §4.4 | `daily-digest` calls `portfolio_coverage()` once as service role; Coverage section for admins/managers only: no-team buildings (≤ `SECTION_MAX`), unassigned count, "Nothing was logged yesterday at …"; `DigestInput.coverage?: CoverageSummary \| null`; `composeDigest` pure and tested | 7 |
| §4.5 | `rls-smoke`: manager `user_buildings` insert succeeds; user self-grant fails; `assignable_people` as user errors; `portfolio_coverage` as userA only their buildings, as admin all | 1 (Step 4) |
| §4.5 | Unit tests: TeamTab (add, chip move, remove with count, errors), CoverageWidget, Buildings badge, invite validation, composeDigest coverage, RoleAssignmentsPanel warning | 3, 5, 5, 6, 7, 4 |
| §4.5 | Migration verified on throwaway Postgres 17 before staging | 1 (Step 3) |
| §9 | Staging → smokes → prod → regenerate types; `APPLY_CHECKLIST.md` section with verification queries; stop with a written checklist if no token | 8 |

### Ambiguities resolved (and how)

1. **One policy or three.** The spec names one policy (`ub_write_managed`) and quotes one `using`/`with check` pair. A `for all` policy also grants SELECT, but its USING is strictly narrower than `ub_select`'s, and permissive policies OR together, so nothing becomes visible that was not; one `for all` policy it is, with `ub_select` untouched and the reasoning in the migration comment. The throwaway run asserts exactly two policies remain.
2. **`assignable_people` for a non-manager: error, not empty.** §4.1 says "`is_admin_or_manager()` only" and §4.5 says "as `user` errors". A `where` clause would return an empty list; the function raises `42501` (HTTP 403 through PostgREST) so a client cannot mistake "forbidden" for "nobody".
3. **Deactivated people are returned, not hidden** (the spec lists `deactivated` as a column). The client's `addablePeople` excludes them from the Add picker — a deactivated account cannot act on a building.
4. **`portfolio_coverage` as a field user counts only themselves** as `field_members` (ub_select/p_select/ur_select show them only their own rows). Documented in the migration header; the surfaces are admin/manager-only so no user ever sees the partial number.
5. **"Pending tasks" in Remove = `status in ('pending','overdue')`.** Leaving an overdue task assigned to someone who no longer has access to the building would strand it; overdue is still open work. The count shown in the dialog and the rows unassigned use the same filter. (The Checklists-tab `pendingByRole` count, which drives "Apply", keeps its existing `status = 'pending'` semantics — unchanged.)
6. **Zero-row rule.** Deleting rules for a member who holds none, and unassigning zero tasks when the dialog showed zero, are not failures; `removeMember` takes the rules held and the count shown so the check is "did what we expected happen", never "did anything happen".
7. **Tapping a held chip clears the rule.** The spec only describes moving a chip; a pressed chip that does nothing on tap is a dead control, and `setRule(role, null)` already exists and is tested. Toast copy mirrors the old panel's ("User (default): nobody").
8. **Summary line names.** The spec's "Thandi" is illustrative; the line uses `memberDisplayName` (full name) for the `'user'` rule and the `'issue'` rule — `'issue'` because that is the label `tenant-intake` assigns from.
9. **Warning condition.** "Pending tasks exist" is read as the hook's existing unassigned-pending count (`pendingByRole` summed) being > 0; the warning is suppressed while loading or on error so a fetch failure never masquerades as a coverage gap.
10. **Dashboard placement.** "Beside `WaitingOnYouWidget`" — the existing two-column grid becomes `lg:grid-cols-2 xl:grid-cols-3` with Coverage as the second child, so on a laptop it sits directly beside Waiting on You and on a wide screen all three share a row.
11. **`CoverageWidget` "N open tasks" at zero** reads "No open tasks are waiting for an owner." rather than "0 open tasks have nobody assigned"; for N ≥ 1 the spec wording is used verbatim (singular handled).
12. **Invite toast on the temp-password path.** That path shows a modal, not a toast; an extra `toast.success('Account created for …', { action })` is added there so a field-staff invite always offers the Team-tab action.
13. **Deep-link allow list.** There is none in `BuildingDetails.tsx` (the value comes straight from `?tab=`); the guard for a `user` hitting `?tab=team` is a one-line fallback to `overview` in the `Tabs value` prop, tested.
14. **Throwaway Postgres.** The vendored mirror contains no base-table DDL, so it cannot be replayed on a blank cluster in filename order; Task 1 builds a cited-line shim of exactly the objects the migration touches and applies the vendored migration file on top, twice, then asserts. This is stated in the plan rather than hidden behind a command that would fail on the first file.

### Open questions for the owner (none block implementation)

- Should a manager be able to remove an **admin or manager** from a building? No — they have no `user_buildings` row to remove; the Managers list has no controls, per spec.
- Digest "Coverage" heading carries no count (other headings do). If a count is wanted, `${noTeam.length} buildings need a team` is a one-line change in `composeDigest` and its test.
