-- 2026-09-14_02_r4_distribute.sql — R4b "Distribute & Share" (spec 2026-09-10-r4-insight-design.md §5.7–5.8).
-- Additive, idempotent. Requires 2026-09-14_01 (is_admin_or_manager EXISTS fix, notifications kind
-- issue_sla_breached, buildings.report_types), 2026-08-06_01 (report_artifacts, generated-reports bucket),
-- 2026-06-13_01 (reports, fortress_touch_updated_at), 2026-06-10_02 (can_access_building).
--
--   1) report_recipients_valid(jsonb): immutable shape check for a schedule's recipient list.
--   2) report_schedules: "this report type goes to these people on day N of the following month";
--      admin/manager CRUD, the six editable columns by column privilege on INSERT as well as UPDATE, run
--      bookkeeping (last_run_on / last_result) service-role only.
--   3) report_shares: a bearer link to ONE issued artifact (token minted by the client or by
--      report-distribution, passcode hash written only by report-share); a trigger pins the artifact to
--      the report; clients may only create (no passcode, zero counters, ≤90 days) and revoke, revocation
--      is one-way, and the passcode verifier + lockout columns are not readable by a client at all —
--      only the generated has_passcode boolean, which is what the UI's Passcode chip reads.
--   4) report_distributions: per-building log of every run; service role writes, admin/manager read; a
--      unique partial index makes one 'sent' row per (schedule, report) the DB-level double-send guard.
--   5) notifications_kind_check restated with report_due_soon and report_export_needed (server-only kinds).
--   6) cron report-distribution-daily (05:00 UTC = 07:00 SAST, after the 05:00 SAST snapshot).
--
-- Apply staging (vkrihpmjajjcxmzgjqdr) first, then prod; the cron block at the end carries
-- <PROJECT_REF> / <REPORT_DISTRIBUTION_SECRET> placeholders — substitute when applying, never commit a real
-- value. Verified twice on a throwaway local Postgres 17 before handover (stub + verify scripts live outside
-- the repo; see the R4b plan, Task 1).
begin;

-- ============================================================
-- 1) Recipients shape
-- ============================================================
-- [{email?, name?, user_id?}] — an external recipient carries a valid email; an internal one carries a
-- user_id (report-distribution resolves the address from profiles). Immutable so it can sit in a CHECK.
create or replace function public.report_recipients_valid(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 50
     and not exists (
       select 1 from jsonb_array_elements(p) e
        where jsonb_typeof(e) <> 'object'
           or (e->>'email' is null and e->>'user_id' is null)
           or (e->>'email' is not null and (e->>'email') !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
           or (e->>'user_id' is not null and (e->>'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
           or (e->>'name' is not null and length(e->>'name') > 120)
     )
$$;
revoke all on function public.report_recipients_valid(jsonb) from public;
revoke execute on function public.report_recipients_valid(jsonb) from anon;
grant execute on function public.report_recipients_valid(jsonb) to authenticated, service_role;

-- ============================================================
-- 2) Schedules
-- ============================================================
-- One row = "this report type goes to these people on day N of the following month". building_ids null =
-- every building whose report_types contains report_type (resolved by the function, not here).
create table if not exists public.report_schedules (
  id                 uuid primary key default gen_random_uuid(),
  report_type        text not null check (report_type in ('ops_monthly','cm_monthly','annual_inspection')),
  building_ids       uuid[],
  recipients         jsonb not null default '[]'::jsonb check (public.report_recipients_valid(recipients)),
  send_day           integer not null default 7 check (send_day between 1 and 28),
  remind_days_before integer not null default 3 check (remind_days_before between 0 and 27),
  is_active          boolean not null default true,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_run_on        date,
  last_result        jsonb
);
-- Partial: the cron only ever reads the active rows, so the inactive ones need not be in the index.
create index if not exists report_schedules_active_idx on public.report_schedules (is_active, send_day)
  where is_active;
drop trigger if exists trg_report_schedules_touch on public.report_schedules;
create trigger trg_report_schedules_touch before update on public.report_schedules
  for each row execute function public.fortress_touch_updated_at();

alter table public.report_schedules enable row level security;
drop policy if exists rs_select on public.report_schedules;
create policy rs_select on public.report_schedules for select using (public.is_admin_or_manager());
drop policy if exists rs_insert on public.report_schedules;
create policy rs_insert on public.report_schedules for insert
  with check (public.is_admin_or_manager() and created_by = auth.uid());
drop policy if exists rs_update on public.report_schedules;
create policy rs_update on public.report_schedules for update
  using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());
drop policy if exists rs_delete on public.report_schedules;
create policy rs_delete on public.report_schedules for delete using (public.is_admin_or_manager());
-- last_run_on / last_result are written by the function (service role) only, on INSERT as well as on
-- UPDATE: without the INSERT column grant an admin could create a schedule already stamped
-- last_run_on = today and silently suppress that day's cron run. created_by is client-supplied on
-- insert (rs_insert pins it to auth.uid()) and immutable afterwards.
revoke all on table public.report_schedules from anon;
revoke update on table public.report_schedules from authenticated;
grant update (report_type, building_ids, recipients, send_day, remind_days_before, is_active)
  on table public.report_schedules to authenticated;
revoke insert on table public.report_schedules from authenticated;
grant insert (report_type, building_ids, recipients, send_day, remind_days_before, is_active, created_by)
  on table public.report_schedules to authenticated;

-- ============================================================
-- 3) Shares
-- ============================================================
-- A bearer link to ONE artifact. The token is minted client-side (mintToken, 43-char base64url) or by
-- report-distribution; the passcode hash is written only by report-share (it needs SHARE_SALT), which is
-- why the client insert policy demands passcode_hash is null.
create table if not exists public.report_shares (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references public.reports(id) on delete cascade,
  artifact_id     uuid not null references public.report_artifacts(id) on delete cascade,
  token           text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  created_by      uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  passcode_hash   text,
  view_count      integer not null default 0,
  last_viewed_at  timestamptz,
  revoked_at      timestamptz,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  constraint report_shares_expiry_check check (expires_at > created_at and expires_at <= created_at + interval '366 days')
);
create index if not exists report_shares_report_idx on public.report_shares (report_id, created_at desc);
-- The one bit of passcode_hash a client is allowed to know: "is this link protected?". Hiding the verifier
-- (see the grants below) otherwise costs the active-links list its Passcode chip. Generated = no new write
-- surface: a client cannot set it, and it leaks a boolean rather than something brute-forceable.
alter table public.report_shares
  add column if not exists has_passcode boolean generated always as (passcode_hash is not null) stored;

-- The artifact must be a PDF of that very report (source_id), whoever inserts.
create or replace function public.report_shares_check_artifact()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.report_artifacts a where a.id = new.artifact_id and a.source_id = new.report_id) then
    raise exception 'report_shares: artifact % is not a PDF of report %', new.artifact_id, new.report_id using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.report_shares_check_artifact() from public;
revoke execute on function public.report_shares_check_artifact() from anon;
drop trigger if exists trg_report_shares_artifact on public.report_shares;
create trigger trg_report_shares_artifact before insert on public.report_shares
  for each row execute function public.report_shares_check_artifact();

alter table public.report_shares enable row level security;
-- NOTE (not building-scoped in practice): can_access_building() returns true for ANY admin or manager, so
-- `is_admin_or_manager() and exists (… can_access_building(r.building_id))` is a tautology today. The EXISTS
-- is kept deliberately — it is the clause that would start biting if per-building admins are ever introduced,
-- and it also proves report_id points at a real report — but do not read these policies as a building fence.
drop policy if exists rsh_select on public.report_shares;
create policy rsh_select on public.report_shares for select
  using (public.is_admin_or_manager()
         and exists (select 1 from public.reports r where r.id = report_id and public.can_access_building(r.building_id)));
drop policy if exists rsh_insert on public.report_shares;
-- expires_at is capped at 90 days here too: report-share only ever offers 7/30/90, and without this a client
-- inserting straight into the table could mint a link good for the table CHECK's full 366 days.
create policy rsh_insert on public.report_shares for insert
  with check (public.is_admin_or_manager()
              and created_by = auth.uid()
              and exists (select 1 from public.reports r where r.id = report_id and public.can_access_building(r.building_id))
              and passcode_hash is null and view_count = 0 and failed_attempts = 0
              and last_viewed_at is null and revoked_at is null and locked_until is null
              and expires_at <= created_at + interval '90 days');
drop policy if exists rsh_update on public.report_shares;
-- Revocation is one-way: `revoked_at is not null` in the WITH CHECK stops an admin PATCHing
-- {revoked_at: null} and resurrecting a link that was already handed out and then pulled.
create policy rsh_update on public.report_shares for update
  using (public.is_admin_or_manager()
         and exists (select 1 from public.reports r where r.id = report_id and public.can_access_building(r.building_id)))
  with check (public.is_admin_or_manager() and revoked_at is not null);
-- Clients may only revoke; every other column belongs to the functions.
revoke all on table public.report_shares from anon;
revoke update, delete on table public.report_shares from authenticated;
grant update (revoked_at) on table public.report_shares to authenticated;
-- passcode_hash is a verifier for a short human passcode: readable, it is brute-forceable offline against
-- SHARE_SALT, so a stolen admin JWT must not be able to fetch it. failed_attempts / locked_until are the
-- lockout state and are equally none of a client's business. Supabase grants SELECT on every column of a new
-- public table to `authenticated`, so the grant has to be narrowed by column, not by RLS.
-- CONSEQUENCE: PostgREST `select=*` (and a bare `Prefer: return=representation`) now 403s on this table for
-- `authenticated`; the client hook and scripts/rls-smoke.mjs must name the granted columns explicitly.
revoke select on table public.report_shares from authenticated;
grant select (id, report_id, artifact_id, token, created_by, created_at, expires_at, view_count,
              last_viewed_at, revoked_at, has_passcode)
  on table public.report_shares to authenticated;

-- ============================================================
-- 4) Distribution log
-- ============================================================
-- What each run did per building. Service role writes; admin/manager read.
create table if not exists public.report_distributions (
  id            uuid primary key default gen_random_uuid(),
  schedule_id   uuid not null references public.report_schedules(id) on delete cascade,
  report_id     uuid references public.reports(id) on delete set null,
  building_id   uuid references public.buildings(id) on delete set null,
  report_period date not null,
  artifact_id   uuid references public.report_artifacts(id) on delete set null,
  share_id      uuid references public.report_shares(id) on delete set null,
  sent_to       jsonb not null default '[]'::jsonb,
  sent_at       timestamptz not null default now(),
  status        text not null check (status in ('sent','skipped_no_artifact','skipped_not_approved','failed')),
  error         text
);
create index if not exists report_distributions_schedule_idx on public.report_distributions (schedule_id, sent_at desc);
create index if not exists report_distributions_report_idx on public.report_distributions (report_id);
-- THE double-send guard. report-distribution claims the send by inserting this row BEFORE the emails go out
-- and treats 23505 as "already sent", so two concurrent runs (cron + run-now, or two cron ticks) cannot both
-- deliver. The function's own "has it already been sent?" SELECT is a courtesy; this index is the guarantee.
-- Partial on status so a 'failed' attempt may be retried and re-logged as often as needed.
create unique index if not exists report_distributions_sent_once_idx
  on public.report_distributions (schedule_id, report_id) where status = 'sent';
alter table public.report_distributions enable row level security;
drop policy if exists rd_select on public.report_distributions;
create policy rd_select on public.report_distributions for select using (public.is_admin_or_manager());
revoke all on table public.report_distributions from anon;
revoke insert, update, delete on table public.report_distributions from authenticated;

-- ============================================================
-- 5) Notification kinds
-- ============================================================
-- R4a's issue_sla_breached restated, R4b's two added. Both R4b kinds are server-written only
-- (report-distribution); the client never sends them.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'task_assigned','issue_assigned','issue_comment','issue_mention',
  'report_submitted','report_returned','report_approved',
  'form_submitted','form_reviewed','signoff_requested','signoff_complete','signoff_overdue',
  'document_expiring','asset_service_due','task_due_today',
  'issue_sla_breached',
  'report_due_soon','report_export_needed'));
-- The reminder dedupe asks "is there already a report_due_soon for this building today?" on every building of
-- every active schedule, once a day; notifications is the largest table in the app and had no index for that
-- shape (kind + building_id + a created_at window).
create index if not exists notifications_kind_building_created_idx
  on public.notifications (kind, building_id, created_at desc);

commit;

-- ============================================================
-- 6) Cron
-- ============================================================
-- 05:00 UTC = 07:00 SAST, after the 05:00 SAST snapshot (metrics-snapshot-daily) so the email summary
-- reads today's compliance row. pg_cron + pg_net are enabled (2026-09-11_02). Mirrors daily-digest:
-- the function 401s unless the caller presents the shared secret, and returns COUNTS ONLY.
-- Substitute the two placeholders at apply time; do NOT commit real values.
do $$ begin perform cron.unschedule('report-distribution-daily'); exception when others then null; end $$;
select cron.schedule(
  'report-distribution-daily',
  '0 5 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/report-distribution',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-distribution-secret', '<REPORT_DISTRIBUTION_SECRET>'),
    body := '{}'::jsonb
  );
  $$
);

-- Verify:
--   select tablename, policyname, cmd from pg_policies
--     where tablename in ('report_schedules','report_shares','report_distributions') order by 1,2;          -- rs_* (4), rsh_* (3), rd_select
--   select column_name from information_schema.column_privileges
--     where grantee = 'authenticated' and table_name = 'report_shares' and privilege_type = 'UPDATE';         -- revoked_at only
--   select column_name from information_schema.column_privileges
--     where grantee = 'authenticated' and table_name = 'report_schedules' and privilege_type = 'UPDATE';      -- the six editable columns
--   select column_name from information_schema.column_privileges
--     where grantee = 'authenticated' and table_name = 'report_schedules' and privilege_type = 'INSERT'
--     order by 1;                                    -- the six + created_by; NOT last_run_on / last_result
--   select column_name from information_schema.column_privileges
--     where grantee = 'authenticated' and table_name = 'report_shares' and privilege_type = 'SELECT'
--     order by 1;                                    -- eleven columns incl. has_passcode; NOT passcode_hash /
--                                                    -- failed_attempts / locked_until
--   select indexdef from pg_indexes where indexname in
--     ('report_distributions_sent_once_idx','notifications_kind_building_created_idx','report_schedules_active_idx');
--                                                    -- 3 rows; the first UNIQUE … where status = 'sent'
--   select has_table_privilege('anon', 'public.report_schedules', 'select'),
--          has_table_privilege('anon', 'public.report_shares', 'select'),
--          has_table_privilege('anon', 'public.report_distributions', 'select');                              -- false ×3
--   select has_function_privilege('anon', 'public.report_recipients_valid(jsonb)', 'execute');               -- false
--   select tgname from pg_trigger where tgrelid = 'public.report_shares'::regclass and not tgisinternal;      -- trg_report_shares_artifact
--   select pg_get_constraintdef(oid) ~ 'report_due_soon' from pg_constraint where conname = 'notifications_kind_check'; -- true
--   select jobname, schedule from cron.job where jobname = 'report-distribution-daily';                       -- 0 5 * * *
--   select command !~ '<PROJECT_REF>|<REPORT_DISTRIBUTION_SECRET>' as placeholders_substituted, command
--     from cron.job where jobname = 'report-distribution-daily';   -- true: the apply-time values went in
--   Then: node scripts/rls-smoke.mjs; after Task 2's functions deploy: npm run smoke:distribution.
