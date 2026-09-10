# R4b "Distribute & Share" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every approved report has a final PDF the moment it is approved; a schedule says when each report type is due and to whom it goes, reminds the author three days before, and on the send day emails an expiring share link that serves exactly the issued artifact; external recipients open a public share page (branding, optional passcode, DRAFT watermark unless approved); any grid, list or register exports to CSV; an issue, a completed task or an asset can be handed over as an evidence pack (PDF, optionally zipped with the original photos).

**Architecture:** One additive migration (`report_schedules`, `report_distributions`, `report_shares`, RLS + column privileges, an artifact/report consistency trigger, the `notifications` kind check restated, the `report-distribution-daily` cron). Two edge functions: `report-distribution` (cron secret OR admin/manager JWT for run-now; dry-run mode; reminders + distribution; share creation with the service role; Resend email through `_shared/email.ts`) and `report-share` (`verify_jwt = false`; public `GET ?t=` metadata and `POST {t, passcode?}` open with a 10-minute signed URL; authenticated `POST {action:'create'}` when a passcode is set, because the hash uses a server-side salt). Client: approval auto-export in `useReportLifecycle`, Share dialog + active links + revoke, `/share/:token` public page, `reportArtifacts.ts` on the typed client, Settings → Report distribution behind `useFeature('report_schedules')`, CSV on every grid/list/register through the existing `exportCsv`, evidence packs from pure `pdfmake` doc builders zipped with `fflate`. Server-side PDF generation stays out of scope (spec §3): distribution and sharing always serve an artifact the browser already saved.

**Tech Stack:** Postgres (plpgsql, RLS, column privileges, pg_cron + pg_net), Deno edge functions (`_shared/{cors,email,notify,notifyRules}.ts`), Supabase JS, React 18 + TS, TanStack Query v5, shadcn/ui, `pdfmake`, `fflate`, vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-r4-insight-design.md` §2 (facts), §3 (constraints), §5.7 (distribution), §5.8 (share links), §5.9 (export + evidence packs), §7 (R4b), §9–§11.

**Ground rules for every agent:** never `git stash` / `checkout` / `switch` / `reset` / `worktree`; compare with `git show <sha>:<path>`; edit only the files your task names; commit with an explicit pathspec; retry after 5 s on `index.lock`; end commit messages with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; gate = `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E '<your files>'` prints nothing, `npm run test` green, global count ≤ `.github/typecheck-baseline.txt` (51) on a clean tree; new tables/views/RPCs are not in the generated types until the controller regenerates — cast ONCE at the module boundary with `// <name> is not yet in the generated types; regenerate after the migration ships.` (the R3c `db` pattern: `const db = supabase as unknown as { from: (table: string) => any }`), never `as never`; guardrail copy plain, coaching through `<Hint>`; mobile-first, 44 px touch targets; every new SQL function `set search_path = ''`, `revoke all … from public`, `revoke execute … from anon`; RLS in the same migration as the table; cron = unschedule-then-schedule; Deno functions import `../_shared/*`, never emit `*` CORS, never log a token, a passcode, a hash or an email body — counts only; day boundaries in `Africa/Johannesburg`.

**Facts every task relies on:** `reports(id, building_id, organization_id, report_type, report_period date 'YYYY-MM-01', title, status draft|submitted|reviewed|approved|rejected, author_id, author_name, reviewed_by, review_notes, prepared_for)`; unique `(building_id, report_type, report_period)`. `report_artifacts(id, org_id, kind, source_id, building_id, version, file_path, file_name, size_bytes, generated_by, created_at, status issued|superseded, superseded_by, report_status)` in the private bucket `generated-reports`; kinds `fortress_<report_type>`; `saveReportArtifact` is fail-closed (upload → insert → remove on failure → supersede). `generateReportPdf(reportId, branding)` reads `reports.status` at render time and prints DRAFT unless approved (`watermarkFor`), then calls `pdf.download()`. `useReportLifecycle(reportId)` writes `status` (+ `reviewed_by`, `review_notes`) and notifies. `calendar_tokens` + `ics-feed` are the public-token pattern: 43-char base64url minted by `mintToken()` in `src/lib/calendarTokens.ts`, service-role lookup, `user_can_access_building(p_user, p_building)` (service-role only), identical 404s, counts-only logs. `daily-digest` is the cron pattern: `corsHeaders(req, ['x-digest-secret'])`, 401 unless the header matches, cron `net.http_post` with placeholders `<PROJECT_REF>` / `<SECRET>` substituted at apply time. `createNotifications(admin, input)` in `_shared/notify.ts` writes inbox rows, pushes `PUSH_KINDS`, emails per `shouldEmail`; `sendEmail(from, to[], subject, html)` and `renderEmail({...})` + `loadBranding(admin)` + `escapeText` in `_shared/email.ts`; `adminAndManagerIds(admin)`. `ALLOWED_URL_PREFIXES` = `/issues, /buildings/, /reports/fortress/, /my-signoffs, /forms, /inbox, /my-day, /calendar, /contractors` (mirrored in `src/lib/pushUrl.ts`, parity-tested). `notifications_kind_check` was last restated in `2026-09-12_01_r2_field.sql`. `exportCsv(rows, columns: CsvColumn[], filename)` / `toCsv` exist; `AssetsTab`, `TenantsTab`, `Buildings` still carry an XLSX export branch (the three exporters to replace; `xlsx` stays for the importers under `src/components/import`). `EditableGrid({ table, columns: GridColumn[] })` renders 13 report grids from `sections/gridSections.tsx`. `task_completions(id, task_instance_id, completed_by, created_at, notes, photo_urls jsonb, signature_confirmed)` is the completion source of truth; `task_instances` carries a denormalised copy (`completed_at, completed_by, completion_notes, photo_urls, signature_url`). `issue_activity(id, issue_id, activity_type comment|status_change|assignment|contractor_assignment, old_value, new_value, comment, author_name, created_at, user_id, photo_urls jsonb, mentions)`. `issues` has `sla_target_hours, sla_breached_at, first_response_at, resolved_at, contractor_id, estimated_cost, actual_cost`; `contractor_ratings(issue_id unique, rating, comment)`. Photo URLs are public-style URLs re-signed by `resolveStorageUrl(stored)` (`src/integrations/supabase/storage.ts`). `pdfGenerator.ts` owns the pdfmake runtime (`pdfMake.vfs = pdfFonts.vfs`). `fortress_touch_updated_at()` exists (2026-06-13_01). Prod: 72 reports (66 submitted, 4 approved), 0 artifacts, 1 organization, 15 admin/manager users, 0 issues.

---

## Depends on R4a (pinned names — do not re-implement)

- `organizations.settings jsonb` with `features {share_links, report_schedules, tenant_intake}` (all false by default), `report_due_day` (1–28, default 7), `distribution_from` (optional display name), `sla_hours`.
- `useOrgSettings()` → typed accessor with defaults; `useFeature(name: 'share_links' | 'report_schedules' | 'tenant_intake'): boolean` — both exported from `src/hooks/useOrgSettings.ts`.
- `organization_branding` view (anon-readable: `id, name, logo_url, primary_color`); the base table is no longer anon-readable.
- `building_metrics_daily(building_id, day, compliance_pct, …)` — the email summary reads the latest row per building.
- `buildings.report_types text[] not null default '{ops_monthly,cm_monthly}'` — "every building with the type enabled".
- `NOTIFICATION_KINDS` already contains `issue_sla_breached`; `governingFlag` handles it; the DB check was restated by `2026-09-14_01`.
- `useIssues` selects `sla_target_hours, sla_breached_at, first_response_at, created_at, resolved_at` and `slaState(issue, now)` lives in `src/lib/sla.ts` (the issues CSV uses both).
- `src/components/reports/fortress/CoverageGrid.tsx` renders the per-type coverage grid with `rows: { buildingId, buildingName, cells: Record<ReportType, { status, reportId? }> }[]` (if R4a named it differently, follow R4a's Status section and adapt the one import in Task 5).
- `2026-09-14_01_r4_snapshots_sla.sql` is applied on staging and prod before `_02` (this plan's migration references `buildings.report_types` only from the edge function, so `_02` applies standalone, but the smoke needs `_01`).

---

## Contracts (pinned; every task codes against these)

### Tables (migration `2026-09-14_02_r4_distribute.sql`)

```
report_schedules (
  id uuid pk, report_type text check (ops_monthly|cm_monthly|annual_inspection),
  building_ids uuid[] null,                       -- null = every building whose report_types contains report_type
  recipients jsonb not null default '[]',          -- [{email?, name?, user_id?}]: email XOR/AND user_id, validated by report_recipients_valid()
  send_day int not null default 7 check 1..28,     -- day of the month AFTER the report period
  remind_days_before int not null default 3 check 0..27,
  is_active bool not null default true,
  created_by uuid null → profiles, created_at, updated_at (touch trigger),
  last_run_on date null, last_result jsonb null    -- service role only (column privileges)
)
report_distributions (
  id uuid pk, schedule_id → report_schedules cascade, report_id null → reports set null,
  building_id null → buildings set null, report_period date not null,
  artifact_id null → report_artifacts set null, share_id null → report_shares set null,
  sent_to jsonb not null default '[]',             -- [{email, name?, user_id?, ok: bool}]
  sent_at timestamptz default now(),
  status text check (sent|skipped_no_artifact|skipped_not_approved|failed), error text null
)                                                  -- service role writes only; admin/manager read
report_shares (
  id uuid pk, report_id → reports cascade, artifact_id → report_artifacts cascade (must belong to report_id — trigger),
  token text unique check ^[A-Za-z0-9_-]{43}$, created_by uuid not null → profiles cascade,
  created_at, expires_at not null (> created_at, ≤ created_at + 366 days),
  passcode_hash text null,                         -- hex sha256(passcode || token || SHARE_SALT); only the function writes it
  view_count int default 0, last_viewed_at, revoked_at,
  failed_attempts int default 0, locked_until timestamptz
)
```
RLS: `report_schedules` select/insert(created_by = caller)/update/delete admin/manager, update limited to the six editable columns by column privilege; `report_distributions` select admin/manager, no client writes; `report_shares` select/insert admin/manager with `can_access_building(reports.building_id)`, insert only with `passcode_hash is null` and zero counters, update limited to `revoked_at`, no client delete; anon revoked on all three.

### Edge functions

`report-share` (`verify_jwt = false`):
- `GET ?t=<token>` → `200 {building, title, type, period, reportStatus, issuedAt, expiresAt, needsPasscode}`; `404 "Not found"` for malformed / unknown / revoked / expired / artifact gone (byte-identical body).
- `POST {t, passcode?}` → `200 {url, fileName, expiresInSeconds: 600}`; `429 {error:'locked', retryAfterSeconds}` while `locked_until > now()`; otherwise `404` (wrong passcode increments `failed_attempts`; the 10th failure sets `locked_until = now() + 15 min` and resets the counter; success resets it, bumps `view_count`, sets `last_viewed_at`).
- `POST {action:'create', reportId, artifactId, token, expiresInDays: 7|30|90, passcode?}` with `Authorization: Bearer <user jwt>` → `200 {id, token, expiresAt}`; `401` no/invalid JWT; `403` not admin/manager or no access to the report's building; `400` bad body / artifact not of that report / token taken.
- `OPTIONS` → 204 with `corsHeaders(req)`. Logs: `report-share: get|open|create` with `{ ok, reason? }` counts only.

`report-distribution` (`verify_jwt = false`):
- Cron: header `x-distribution-secret` = `REPORT_DISTRIBUTION_SECRET`, body `{}` → every active schedule, real run, idempotent per day (`last_run_on = today` → skipped).
- Run-now: `Authorization: Bearer <user jwt>` (admin/manager) + body `{scheduleId, dryRun?: boolean (default true), period?: 'YYYY-MM-01'}` → that schedule only, action forced to `send` for `period ?? previous month`, reminders not run.
- Response: `200 {ok:true, dryRun, today, schedules:[{scheduleId, action:'send'|'remind'|'none'|'already_ran', period, buildings:[{buildingId, buildingName, reportId, status, recipients, shareId?, error?}]}], counts:{sent, skipped_no_artifact, skipped_not_approved, failed, reminded, already_sent}}`; `401`/`403` as above; `400` bad body.
- Cron `report-distribution-daily` `0 5 * * *` UTC (07:00 SAST).

### Notification kinds (server-only; both `issue_updates`-governed, email per item, no push, not in `CLIENT_KINDS`)
- `report_due_soon` — entity `report` (id null when the report does not exist yet), building set, url `/reports/fortress/<id>` or `/buildings/<id>?tab=reports`; recipients: the report's author (if any) + every admin/manager; one per (building, type, day).
- `report_export_needed` — entity `report`, url `/reports/fortress/<id>`; recipients: the author (+ admins/managers when there is no author).

### URL allowlist
No new prefix. `/share/` is a PUBLIC page and must NOT be added to `ALLOWED_URL_PREFIXES` or `PUSH_URL_PREFIXES` (a notification must never deep-link a signed-in user to the public surface; share URLs travel only in distribution emails, built from `APP_URL`). Share URL = `${APP_URL}/share/${token}` (server) = `${window.location.origin}/share/${token}` (client).

### Query keys
`['report-shares', reportId]`, `['report-schedules']`, `['report-distributions', scheduleId]`, `['share-page', token]`, existing `['report-artifacts', reportId]`, `['fortress-reports']`.

### Secrets & env
`REPORT_DISTRIBUTION_SECRET` (cron header), `SHARE_SALT` (passcode pepper) — generated by the controller in-shell, never printed, set on staging and prod. Functions also use `APP_URL`, `RESEND_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (already present on prod; staging lacks `APP_URL`/`RESEND_API_KEY` — the smoke tolerates `emailed: 0`).

---

### Task 1: Migration + smokes

**Files:** Create `../GMI/sql/2026-09-14_02_r4_distribute.sql` → vendor with `npm run schema:vendor` (commits `supabase/schema/2026-09-14_02_r4_distribute.sql` + `supabase/schema/.source`); create `scripts/distribution-smoke.mjs`; modify `scripts/rls-smoke.mjs`; modify `package.json` + `package-lock.json` (`smoke:distribution` script, and `npm install fflate@^0.8.2` so Task 5 can import it — Task 5 waits for this commit).

- [ ] Write the migration:

```sql
-- 2026-09-14_02_r4_distribute.sql — R4b (spec §5.7, §5.8). Additive, idempotent.
-- Apply after 2026-09-14_01_r4_snapshots_sla.sql. Staging -> npm run smoke -> prod.
-- The cron block at the end carries <PROJECT_REF> / <REPORT_DISTRIBUTION_SECRET> placeholders:
-- substitute when applying, never commit a real value.
begin;

-- 1) Recipients shape: [{email?, name?, user_id?}] — an external recipient carries a valid email; an
--    internal one carries a user_id (the function resolves the address from profiles). Immutable so it
--    can sit in a CHECK.
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

-- 2) Schedules: one row = "this report type goes to these people on day N of the following month".
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
create index if not exists report_schedules_active_idx on public.report_schedules (is_active, send_day);
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
-- last_run_on / last_result / created_by are written by the function (service role) only.
revoke all on table public.report_schedules from anon;
revoke update on table public.report_schedules from authenticated;
grant update (report_type, building_ids, recipients, send_day, remind_days_before, is_active)
  on table public.report_schedules to authenticated;

-- 3) Shares: a bearer link to ONE artifact. The token is minted client-side (mintToken, 43-char
--    base64url) or by report-distribution; the passcode hash is written only by report-share
--    (it needs SHARE_SALT), which is why the client insert policy demands passcode_hash is null.
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
drop policy if exists rsh_select on public.report_shares;
create policy rsh_select on public.report_shares for select
  using (public.is_admin_or_manager()
         and exists (select 1 from public.reports r where r.id = report_id and public.can_access_building(r.building_id)));
drop policy if exists rsh_insert on public.report_shares;
create policy rsh_insert on public.report_shares for insert
  with check (public.is_admin_or_manager()
              and created_by = auth.uid()
              and exists (select 1 from public.reports r where r.id = report_id and public.can_access_building(r.building_id))
              and passcode_hash is null and view_count = 0 and failed_attempts = 0
              and last_viewed_at is null and revoked_at is null and locked_until is null);
drop policy if exists rsh_update on public.report_shares;
create policy rsh_update on public.report_shares for update
  using (public.is_admin_or_manager()
         and exists (select 1 from public.reports r where r.id = report_id and public.can_access_building(r.building_id)))
  with check (public.is_admin_or_manager());
-- Clients may only revoke; every other column belongs to the functions.
revoke all on table public.report_shares from anon;
revoke update, delete on table public.report_shares from authenticated;
grant update (revoked_at) on table public.report_shares to authenticated;

-- 4) Distribution log: what each run did per building. Service role writes; admin/manager read.
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
alter table public.report_distributions enable row level security;
drop policy if exists rd_select on public.report_distributions;
create policy rd_select on public.report_distributions for select using (public.is_admin_or_manager());
revoke all on table public.report_distributions from anon;
revoke insert, update, delete on table public.report_distributions from authenticated;

-- 5) Notification kinds: R4a's issue_sla_breached restated, R4b's two added. Server-written only.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'task_assigned','issue_assigned','issue_comment','issue_mention',
  'report_submitted','report_returned','report_approved',
  'form_submitted','form_reviewed','signoff_requested','signoff_complete','signoff_overdue',
  'document_expiring','asset_service_due','task_due_today',
  'issue_sla_breached',
  'report_due_soon','report_export_needed'));

commit;

-- 6) Cron: 05:00 UTC = 07:00 SAST, after the 05:00 SAST snapshot. pg_cron + pg_net are enabled
--    (2026-09-11_02). Substitute the two placeholders at apply time; do NOT commit real values.
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
--   select tablename, policyname, cmd from pg_policies where tablename in ('report_schedules','report_shares','report_distributions') order by 1,2;
--   select column_name from information_schema.column_privileges where grantee='authenticated' and table_name='report_shares' and privilege_type='UPDATE';  -- revoked_at only
--   select has_function_privilege('anon','public.report_recipients_valid(jsonb)','execute');  -- f
--   select jobname, schedule from cron.job where jobname = 'report-distribution-daily';
```

- [ ] Verify locally on a throwaway Postgres 17 before touching staging (the migration references `auth.uid()`, `cron`, `net`, `is_admin_or_manager`, `can_access_building`, `fortress_touch_updated_at`, `profiles`, `reports`, `report_artifacts`, `buildings`, `notifications` — stub them). Write the harness to the scratchpad, not the repo:

```bash
SCRATCH="${SCRATCHPAD_DIR:-${TMPDIR:-/tmp}}/r4b-check"; mkdir -p "$SCRATCH"   # your session scratchpad, never the repo
cat > "$SCRATCH/r4b-harness.sql" <<'SQL'
create schema if not exists auth; create schema if not exists cron; create schema if not exists net;
create or replace function auth.uid() returns uuid language sql as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create or replace function cron.unschedule(text) returns boolean language sql as $$ select true $$;
create or replace function cron.schedule(text, text, text) returns bigint language sql as $$ select 1::bigint $$;
create or replace function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $$ select 1::bigint $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create table public.profiles (id uuid primary key, deactivated boolean default false);
create table public.buildings (id uuid primary key default gen_random_uuid(), name text);
create table public.organizations (id uuid primary key default gen_random_uuid());
create table public.reports (id uuid primary key default gen_random_uuid(), building_id uuid references public.buildings(id), report_type text, report_period date, status text);
create table public.report_artifacts (id uuid primary key default gen_random_uuid(), source_id uuid, status text default 'issued', report_status text);
create table public.notifications (id uuid primary key default gen_random_uuid(), kind text);
create or replace function public.is_admin_or_manager() returns boolean language sql as $$ select coalesce(current_setting('app.admin', true), 'f')::boolean $$;
create or replace function public.can_access_building(b uuid) returns boolean language sql as $$ select true $$;
create or replace function public.fortress_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
SQL
dropdb --if-exists r4b_check && createdb r4b_check
psql -v ON_ERROR_STOP=1 -q r4b_check -f "$SCRATCH/r4b-harness.sql"
psql -v ON_ERROR_STOP=1 -q r4b_check -f ../GMI/sql/2026-09-14_02_r4_distribute.sql
psql -v ON_ERROR_STOP=1 -q r4b_check -f ../GMI/sql/2026-09-14_02_r4_distribute.sql   # idempotent
psql -q r4b_check -c "insert into public.profiles(id) values ('00000000-0000-0000-0000-000000000001');
insert into public.buildings(id) values ('00000000-0000-0000-0000-0000000000b1');
insert into public.reports(id, building_id, report_type, report_period, status) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','ops_monthly','2026-08-01','approved');
insert into public.report_artifacts(id, source_id) values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a1');
insert into public.report_artifacts(id, source_id) values ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000a2');
select public.report_recipients_valid('[{\"email\":\"a@b.co\"},{\"user_id\":\"00000000-0000-0000-0000-000000000001\",\"name\":\"Ann\"}]'::jsonb) as ok_true, public.report_recipients_valid('[{\"email\":\"nope\"}]'::jsonb) as ok_false, public.report_recipients_valid('[{\"name\":\"nobody\"}]'::jsonb) as ok_false2;
insert into public.report_shares(report_id, artifact_id, token, created_by, expires_at) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000f1', repeat('a',43), '00000000-0000-0000-0000-000000000001', now() + interval '30 days');"
psql -q r4b_check -c "insert into public.report_shares(report_id, artifact_id, token, created_by, expires_at) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000f2', repeat('b',43), '00000000-0000-0000-0000-000000000001', now() + interval '30 days');" 2>&1 | grep -q 'is not a PDF of report' && echo "artifact trigger OK"
psql -q r4b_check -c "insert into public.notifications(kind) values ('report_due_soon'),('report_export_needed'),('issue_sla_breached');" && echo "kinds OK"
psql -q r4b_check -c "insert into public.notifications(kind) values ('bogus');" 2>&1 | grep -q notifications_kind_check && echo "kind check OK"
dropdb r4b_check
```
Expected: two clean applies, `ok_true = t / ok_false = f / ok_false2 = f`, "artifact trigger OK", "kinds OK", "kind check OK".

- [ ] `npm run schema:vendor` (touches `supabase/schema/.source` — no other agent vendors SQL in this slice, so no serialisation needed).

- [ ] `scripts/rls-smoke.mjs` — add an R4b block (same persona set; fixtures: a report on building A with an issued artifact row inserted with the service role — `report_artifacts` insert needs `org_id`, `generated_by`, `file_path` unique, `file_name`, `size_bytes`; the storage object is not needed for RLS probes):
  - `report_schedules`: select `adminMgr()`; insert (`created_by = caller`) `adminMgr()`; insert with a foreign `created_by` → `nobody()`; insert with `recipients: [{email:'nope'}]` → `nobody()` (CHECK); update `send_day` `adminMgr()`; update `last_run_on` → `nobody()` (column privilege, expect HTTP 4xx); delete `adminMgr()`.
  - `report_shares`: insert (own, on A, valid artifact, `passcode_hash` null) `adminMgr()`; insert with `passcode_hash: 'x'` → `nobody()`; insert with an artifact of another report → `nobody()` (trigger 23514); select on A `adminMgr()` (userA is not admin → false); update `revoked_at` `adminMgr()`; update `view_count` → `nobody()`; delete → `nobody()`.
  - `report_distributions`: select `adminMgr()`; insert → `nobody()`.
  - anon (`apikey` only, no JWT): `GET /rest/v1/report_shares?select=id` → 401/403 or empty; same for schedules and distributions; `rpc/report_recipients_valid` as anon → 401/403.
  - Update the header comment block with an `R4b "Distribute"` line.

- [ ] `scripts/distribution-smoke.mjs` — mirrors `calendar-smoke.mjs` (env guard, prod refusal, `svcInsert/svcDelete/svcPatch`, LIFO cleanup, `persona`, `assert`). Sequence:

```js
#!/usr/bin/env node
/**
 * Distribution + share smoke — report-distribution and report-share end to end against the live backend
 * (both functions deployed; REPORT_DISTRIBUTION_SECRET and SHARE_SALT set; 2026-09-14_01 + _02 applied).
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... REPORT_DISTRIBUTION_SECRET=... \
 *   node scripts/distribution-smoke.mjs
 *
 * Proves: schedule -> run-now dry run lists the target building with skipped_not_approved (draft report) and
 * writes nothing; approved report without artifact -> skipped_no_artifact + report_export_needed inbox row for
 * the author; approved report with an artifact -> real run writes a report_distributions 'sent' row and a
 * report_shares row (expires ~30 days, no passcode), emails counted (0 when RESEND_API_KEY is absent);
 * a second real run the same day is 'already_ran'; reminders: a schedule whose reminder date is today raises one
 * report_due_soon per (building, type) and not twice; share GET 200 with needsPasscode=false; POST returns a
 * signed URL that fetches the PDF bytes (HTTP 200, application/pdf); create-with-passcode via JWT ->
 * GET needsPasscode=true, wrong passcode 404 x10 -> 429, right passcode after the lock window is not waited for
 * (asserts 429 body shape only), revoked share 404, malformed/unknown/expired tokens 404 with identical bodies;
 * cron secret missing -> 401; site user JWT run-now -> 403; anon cannot read the three tables.
 */
```
  Fixture notes for the implementer: upload a tiny real PDF (`%PDF-1.4 … %%EOF`, ~300 bytes) to `generated-reports/<orgId>/fortress_ops_monthly/<ts>-smoke.pdf` with the service role storage API, then insert the `report_artifacts` row (`report_status: 'approved'`, `status: 'issued'`); create the schedule with the service role (`created_by` = the admin persona, `building_ids: [A]`, `recipients: [{email:'zztest-'+RUN+'@example.invalid'}, {user_id: <admin persona id>, name: 'ZZTEST Admin'}]` — one external, one internal resolved from `profiles`, `send_day` = today's SAST day, `remind_days_before: 3`); call `POST /functions/v1/report-distribution` as the admin persona (`Authorization: Bearer <jwt>`, `apikey: ANON`) with `{scheduleId, dryRun:true}` then `{scheduleId, dryRun:false}`; for the reminder case create a second schedule whose `send_day` = SAST day + 3 (or day − 25 wrapped — compute with the same `planFor` rule: pick `send_day` so that `addDays(sendDate, -3) === today`, skipping the case when that is impossible in this month and asserting SKIP), and call it with the cron secret header and `{}`; then assert the `notifications` rows with the service role (`kind=eq.report_due_soon&building_id=eq.<A>`). Clean up shares, distributions, schedules, notifications (`title=like.ZZTEST%` and the two kinds for building A), artifact row + storage object, report, building, personas. Exit 1 on any failure and print the FAIL list.

- [ ] `package.json`: `"smoke:distribution": "node scripts/distribution-smoke.mjs"` as its own script (NOT in the `smoke` chain — like `smoke:calendar`, it needs deployed functions and `REPORT_DISTRIBUTION_SECRET`, which CI's `smoke.yml` does not carry); `npm install fflate@^0.8.2` (dependency; lockfile updated).

- [ ] Gate: `node --check scripts/distribution-smoke.mjs && node --check scripts/rls-smoke.mjs`; `npm run test` green.
- [ ] Commit, two repos: in `../GMI`, `git add sql/2026-09-14_02_r4_distribute.sql && git commit -m "Add the R4b distribution/share migration"` (same trailer); in this repo `git add supabase/schema/2026-09-14_02_r4_distribute.sql supabase/schema/.source scripts/distribution-smoke.mjs scripts/rls-smoke.mjs package.json package-lock.json && git commit -m "Add the R4b distribution/share schema, smokes and fflate"`.

**Controller after Task 1:** apply `_02` on staging (substituting the cron placeholders), run `node scripts/rls-smoke.mjs`. The distribution smoke waits for Task 2's functions.

---

### Task 2: Edge functions `report-distribution` + `report-share`

**Files:** Create `supabase/functions/_shared/distribution.ts`, `supabase/functions/_shared/reportAccess.ts`, `supabase/functions/report-distribution/index.ts`, `supabase/functions/report-share/index.ts`, `docs/fixtures/distribution-plan.json`, `src/lib/distributionPlan.test.ts`; modify `supabase/config.toml`, `supabase/functions/_shared/notifyRules.ts`, `src/lib/notifyRules.test.ts`, `src/lib/notify.ts` (the `NotificationKind` mirror only). `supabase/functions/_shared/cors.ts` needs NO change (the share page is same-origin; the cron header rides `corsHeaders(req, ['x-distribution-secret'])`) — verify and leave it.

- [ ] `_shared/notifyRules.ts`: `'issue_sla_breached'` is already there from R4a — leave it; append `'report_due_soon', 'report_export_needed'` to `NOTIFICATION_KINDS`; add both to the `issue_updates` case of `governingFlag` (the exhaustive `never` forces this); NOT in `CLIENT_KINDS`, `ORG_WIDE_KINDS`, `PUSH_KINDS`, `DIGEST_ONLY`. `src/lib/notifyRules.test.ts`: add both to `TABLE` as `'issue_updates'`; add an `it('R4b kinds are server-only', …)` asserting neither is in `CLIENT_KINDS`/`PUSH_KINDS`. `src/lib/notify.ts`: extend the `NotificationKind` union with `| 'issue_sla_breached' | 'report_due_soon' | 'report_export_needed'` and note in the comment that the client never sends them.

- [ ] `_shared/distribution.ts` — pure, no I/O (bundled into the function AND re-exported into the web app by Task 4):

```ts
// Pure scheduling and copy rules for report distribution (spec §5.7). No I/O and NO imports
// (like _shared/calendar.ts): it is unit-tested from vitest (src/lib/distributionPlan.test.ts,
// pinned by docs/fixtures/distribution-plan.json) and re-exported to the web app by
// src/lib/reportSchedule.ts, and neither runtime resolves a `./x.ts` import the other way.

/** Same escaping as _shared/email.ts escapeText, inlined so this module stays import-free. */
export function escapeText(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export type ReportType = "ops_monthly" | "cm_monthly" | "annual_inspection";
export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  ops_monthly: "Monthly OPS Report", cm_monthly: "Monthly CM Report", annual_inspection: "Annual Inspection Report",
};
export const EXPIRY_DAYS_DEFAULT = 30;
export const EXPIRY_DAYS_ALLOWED = [7, 30, 90] as const;
export const PASSCODE_MIN = 4;
export const PASSCODE_MAX = 64;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface ScheduleTiming { send_day: number; remind_days_before: number }
export type PlanAction =
  | { action: "send"; period: string }
  | { action: "remind"; period: string }
  | { action: "none" };

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` ± n days, UTC arithmetic on a date-only value. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
/** First day of the month containing `ymd`. */
export function monthStart(ymd: string): string { return `${ymd.slice(0, 7)}-01`; }
/** First day of the month before the one containing `ymd`. */
export function previousMonthStart(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`;
}
/** First day of the month after the one containing `ymd`. */
export function nextMonthStart(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
}
/** The date a report for `period` (YYYY-MM-01) is sent: send_day of the following month. send_day ≤ 28, so always valid. */
export function sendDateFor(period: string, timing: ScheduleTiming): string {
  return `${nextMonthStart(period).slice(0, 7)}-${pad(timing.send_day)}`;
}
export function reminderDateFor(period: string, timing: ScheduleTiming): string {
  return addDays(sendDateFor(period, timing), -timing.remind_days_before);
}
/**
 * What a schedule does on `today` (SAST date). Send wins over remind when they coincide
 * (remind_days_before = 0). The reminder for next month's send date can fall in this month
 * (send_day 2, remind 3 → the 29th/30th), so both this month's and next month's send dates are checked.
 */
export function planFor(today: string, timing: ScheduleTiming): PlanAction {
  const thisSend = `${today.slice(0, 7)}-${pad(timing.send_day)}`;
  if (today === thisSend) return { action: "send", period: previousMonthStart(today) };
  if (today === addDays(thisSend, -timing.remind_days_before)) return { action: "remind", period: previousMonthStart(thisSend) };
  const nextSend = `${nextMonthStart(today).slice(0, 7)}-${pad(timing.send_day)}`;
  if (today === addDays(nextSend, -timing.remind_days_before)) return { action: "remind", period: previousMonthStart(nextSend) };
  return { action: "none" };
}
/** Next send and reminder dates on or after `today`, for the Settings card. */
export function nextRunDates(today: string, timing: ScheduleTiming): { nextSend: string; nextReminder: string; period: string } {
  for (const base of [previousMonthStart(today), monthStart(today), nextMonthStart(today)]) {
    const send = sendDateFor(base, timing);
    const remind = reminderDateFor(base, timing);
    if (send >= today) return { nextSend: send, nextReminder: remind, period: base };
  }
  const base = nextMonthStart(nextMonthStart(today));
  return { nextSend: sendDateFor(base, timing), nextReminder: reminderDateFor(base, timing), period: base };
}
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });
}

export interface DistributionCopyInput {
  buildingName: string; reportType: ReportType; period: string; title: string;
  compliancePct: number | null; expiresAt: string; appName: string;
}
export function distributionCopy(i: DistributionCopyInput): { subject: string; heading: string; bodyHtml: string; ctaText: string } {
  const label = REPORT_TYPE_LABELS[i.reportType];
  const when = periodLabel(i.period);
  const compliance = i.compliancePct === null ? "" : ` Compliance at ${Math.round(i.compliancePct)}%.`;
  const expires = new Date(i.expiresAt).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" });
  return {
    subject: `${label} — ${i.buildingName} — ${when}`,
    heading: `${label}: ${i.buildingName}`,
    bodyHtml: `<p style="margin:0 0 12px;">The approved ${escapeText(label.toLowerCase())} for <strong>${escapeText(i.buildingName)}</strong> (${escapeText(when)}) is ready.${escapeText(compliance)}</p>` +
      `<p style="margin:0 0 12px;">The link opens the issued PDF and expires on ${escapeText(expires)}.</p>`,
    ctaText: "Open the report",
  };
}
export function reminderCopy(i: { buildingName: string; reportType: ReportType; period: string; sendDate: string; exists: boolean; status: string | null }): { title: string; body: string } {
  const label = REPORT_TYPE_LABELS[i.reportType];
  const due = new Date(`${i.sendDate}T00:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "long", timeZone: "UTC" });
  const state = !i.exists ? "has not been started" : `is ${i.status?.replace(/_/g, " ")}`;
  return {
    title: `Report due soon: ${label} — ${i.buildingName} ${periodLabel(i.period)}`,
    body: `This report ${state}. It is distributed on ${due}; approve it before then so the final PDF goes out.`,
  };
}
/** Deno + browsers: 32 random bytes as base64url without padding (43 chars). Same as src/lib/calendarTokens.mintToken. */
export function mintShareToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function passcodeHash(passcode: string, token: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${passcode}${token}${salt}`));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] `docs/fixtures/distribution-plan.json` — pinned cases for `planFor` and `nextRunDates` (`[{today, send_day, remind_days_before, expect: {action, period}}]`): `2026-10-07/7/3 → send 2026-09-01`; `2026-10-04/7/3 → remind 2026-09-01`; `2026-10-05/7/3 → none`; `2026-09-29/2/3 → remind 2026-09-01` (reminder for next month's send); `2026-01-07/7/0 → send 2025-12-01`; `2026-03-01/1/3 → send 2026-02-01`; `2026-02-26/1/3 → remind 2026-02-01`; `2026-12-31/3/3 → remind 2026-12-01`; plus `nextRunDates` cases (`2026-10-08/7/3 → nextSend 2026-11-07, period 2026-10-01`; `2026-10-07/7/3 → nextSend 2026-10-07`). `src/lib/distributionPlan.test.ts` imports `../../supabase/functions/_shared/distribution` and runs the fixture; also asserts `distributionCopy` escapes `<` in a building name, `mintShareToken()` matches `TOKEN_RE`, and `passcodeHash` is 64 hex chars and salt-sensitive.

- [ ] `_shared/reportAccess.ts`:

```ts
// Caller validation for functions that accept BOTH a cron secret and a user JWT (report-distribution)
// or a public token and a user JWT (report-share create). Mirrors set-user-status: the JWT is
// validated by asking Auth with an anon client carrying the caller's header; roles/access are then
// answered by the service role (user_roles is not readable across users under RLS).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// deno-lint-ignore no-explicit-any
type Admin = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

export async function callerId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  return error || !user ? null : user.id;
}

export async function isAdminOrManager(admin: Admin, userId: string): Promise<boolean> {
  const { data: profile } = await admin.from("profiles").select("deactivated").eq("id", userId).maybeSingle();
  if (!profile || profile.deactivated === true) return false;
  const { data } = await admin.from("user_roles").select("role").eq("user_id", userId).in("role", ["admin", "manager"]).limit(1);
  return (data?.length ?? 0) > 0;
}

export async function canAccessBuilding(admin: Admin, userId: string, buildingId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("user_can_access_building", { p_user: userId, p_building: buildingId });
  return !error && data === true;
}
```

- [ ] `supabase/functions/report-share/index.ts`:

```ts
// report-share — public share links for issued report PDFs (spec §5.8).
// GET ?t=   → metadata; POST {t, passcode?} → 10-minute signed URL; POST {action:'create'} (JWT) → new link.
// No user JWT on the public paths (verify_jwt = false): the token IS the credential. Rows are read with
// the service role. Every public failure that could reveal whether a token exists answers the same 404;
// the only other public status is 429 while a passcode lockout is running.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { callerId, canAccessBuilding, isAdminOrManager } from "../_shared/reportAccess.ts";
import { EXPIRY_DAYS_ALLOWED, PASSCODE_MAX, PASSCODE_MIN, TOKEN_RE, passcodeHash } from "../_shared/distribution.ts";

const SHARE_SALT = Deno.env.get("SHARE_SALT") ?? "";
const SIGNED_URL_TTL = 600;
const MAX_FAILURES = 10;
const LOCK_MINUTES = 15;
const BUCKET = "generated-reports";

type ShareRow = {
  id: string; report_id: string; artifact_id: string; expires_at: string; revoked_at: string | null;
  passcode_hash: string | null; failed_attempts: number; locked_until: string | null; view_count: number;
};

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors } });
const notFound = (cors: Record<string, string>) =>
  new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...cors } });

async function loadLiveShare(admin: ReturnType<typeof createClient>, token: string): Promise<ShareRow | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data, error } = await admin.from("report_shares")
    .select("id, report_id, artifact_id, expires_at, revoked_at, passcode_hash, failed_attempts, locked_until, view_count")
    .eq("token", token).maybeSingle();
  if (error) throw error;
  const row = data as ShareRow | null;
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return json(cors, { error: "method" }, 405);
  if (!SHARE_SALT) { console.error("report-share: SHARE_SALT not set"); return json(cors, { error: "unavailable" }, 503); }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    if (req.method === "GET") {
      const token = new URL(req.url).searchParams.get("t") ?? "";
      const share = await loadLiveShare(admin, token);
      if (!share) { console.log("report-share: get", { ok: false }); return notFound(cors); }
      const [{ data: report }, { data: artifact }] = await Promise.all([
        admin.from("reports").select("title, report_type, report_period, status, building_id").eq("id", share.report_id).maybeSingle(),
        admin.from("report_artifacts").select("file_name, report_status, created_at").eq("id", share.artifact_id).maybeSingle(),
      ]);
      if (!report || !artifact) { console.log("report-share: get", { ok: false, reason: "orphan" }); return notFound(cors); }
      const { data: building } = await admin.from("buildings").select("name").eq("id", report.building_id).maybeSingle();
      console.log("report-share: get", { ok: true, needsPasscode: !!share.passcode_hash });
      return json(cors, {
        building: building?.name ?? "Building", title: report.title, type: report.report_type, period: report.report_period,
        reportStatus: artifact.report_status ?? report.status, issuedAt: artifact.created_at, expiresAt: share.expires_at,
        needsPasscode: !!share.passcode_hash,
      });
    }

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json(cors, { error: "bad body" }, 400);

    // ── Authenticated create (only path that can set a passcode: the hash needs SHARE_SALT) ──
    if (body.action === "create") {
      const uid = await callerId(req);
      if (!uid) return json(cors, { error: "unauthorized" }, 401);
      if (!(await isAdminOrManager(admin, uid))) return json(cors, { error: "forbidden" }, 403);
      const { reportId, artifactId, token, expiresInDays, passcode } = body as Record<string, unknown>;
      if (typeof reportId !== "string" || typeof artifactId !== "string" || typeof token !== "string" || !TOKEN_RE.test(token)) return json(cors, { error: "bad body" }, 400);
      if (!EXPIRY_DAYS_ALLOWED.includes(expiresInDays as 7 | 30 | 90)) return json(cors, { error: "bad expiry" }, 400);
      if (passcode !== undefined && (typeof passcode !== "string" || passcode.length < PASSCODE_MIN || passcode.length > PASSCODE_MAX)) return json(cors, { error: "bad passcode" }, 400);
      const { data: report } = await admin.from("reports").select("id, building_id").eq("id", reportId).maybeSingle();
      if (!report) return json(cors, { error: "bad report" }, 400);
      if (!(await canAccessBuilding(admin, uid, report.building_id))) return json(cors, { error: "forbidden" }, 403);
      const { data: artifact } = await admin.from("report_artifacts").select("id, source_id").eq("id", artifactId).maybeSingle();
      if (!artifact || artifact.source_id !== reportId) return json(cors, { error: "bad artifact" }, 400);
      const expiresAt = new Date(Date.now() + (expiresInDays as number) * 86_400_000).toISOString();
      const hash = typeof passcode === "string" ? await passcodeHash(passcode, token, SHARE_SALT) : null;
      const { data: row, error } = await admin.from("report_shares")
        .insert({ report_id: reportId, artifact_id: artifactId, token, created_by: uid, expires_at: expiresAt, passcode_hash: hash })
        .select("id, token, expires_at").single();
      if (error) { console.log("report-share: create", { ok: false, code: error.code }); return json(cors, { error: error.code === "23505" ? "token taken" : "insert failed" }, 400); }
      console.log("report-share: create", { ok: true, passcode: !!hash, days: expiresInDays });
      return json(cors, { id: row.id, token: row.token, expiresAt: row.expires_at });
    }

    // ── Public open ──
    const token = typeof body.t === "string" ? body.t : "";
    const share = await loadLiveShare(admin, token);
    if (!share) { console.log("report-share: open", { ok: false }); return notFound(cors); }
    if (share.locked_until && new Date(share.locked_until).getTime() > Date.now()) {
      const retryAfterSeconds = Math.ceil((new Date(share.locked_until).getTime() - Date.now()) / 1000);
      console.log("report-share: open", { ok: false, reason: "locked" });
      return json({ ...cors, "Retry-After": String(retryAfterSeconds) }, { error: "locked", retryAfterSeconds }, 429);
    }
    if (share.passcode_hash) {
      const passcode = typeof body.passcode === "string" ? body.passcode : "";
      const ok = passcode.length >= PASSCODE_MIN && (await passcodeHash(passcode, token, SHARE_SALT)) === share.passcode_hash;
      if (!ok) {
        const failures = share.failed_attempts + 1;
        const patch = failures >= MAX_FAILURES
          ? { failed_attempts: 0, locked_until: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() }
          : { failed_attempts: failures };
        await admin.from("report_shares").update(patch).eq("id", share.id);
        console.log("report-share: open", { ok: false, reason: "passcode", locked: failures >= MAX_FAILURES });
        return notFound(cors);
      }
    }
    const { data: artifact } = await admin.from("report_artifacts").select("file_path, file_name").eq("id", share.artifact_id).maybeSingle();
    if (!artifact) { console.log("report-share: open", { ok: false, reason: "orphan" }); return notFound(cors); }
    const { data: signed, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(artifact.file_path, SIGNED_URL_TTL);
    if (signErr || !signed?.signedUrl) { console.error("report-share: sign failed", signErr?.message); return notFound(cors); }
    await admin.from("report_shares")
      .update({ view_count: share.view_count + 1, last_viewed_at: new Date().toISOString(), failed_attempts: 0, locked_until: null })
      .eq("id", share.id);
    console.log("report-share: open", { ok: true });
    return json(cors, { url: signed.signedUrl, fileName: artifact.file_name, expiresInSeconds: SIGNED_URL_TTL });
  } catch (error) {
    console.error("report-share error:", error instanceof Error ? error.message : error);
    return json(cors, { error: "unavailable" }, 500);
  }
});
```

- [ ] `supabase/functions/report-distribution/index.ts`:

```ts
// report-distribution — reminders and send-day distribution of approved report PDFs (spec §5.7).
// Cron (x-distribution-secret, body {}) runs every active schedule for today's SAST date, once per
// day. An admin/manager JWT may run ONE schedule now ({scheduleId, dryRun, period?}); dry run
// returns what would happen and writes nothing. Reports are never generated here (spec §3): an
// approved report without an approved-status artifact is skipped and its author is asked to export.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { loadBranding, renderEmail } from "../_shared/email.ts";
import { APP_URL, adminAndManagerIds, createNotifications, sendEmail, senderName } from "../_shared/notify.ts";
import { todayInOperatingTz } from "../_shared/calendar.ts";
import { callerId, isAdminOrManager } from "../_shared/reportAccess.ts";
import {
  EXPIRY_DAYS_DEFAULT, REPORT_TYPE_LABELS, distributionCopy, mintShareToken, planFor, previousMonthStart,
  reminderCopy, sendDateFor, type PlanAction, type ReportType,
} from "../_shared/distribution.ts";

const SECRET = Deno.env.get("REPORT_DISTRIBUTION_SECRET");
const PERIOD_RE = /^\d{4}-\d{2}-01$/;

type Schedule = {
  id: string; report_type: ReportType; building_ids: string[] | null;
  recipients: { email?: string; name?: string; user_id?: string }[];
  send_day: number; remind_days_before: number; is_active: boolean; created_by: string | null; last_run_on: string | null;
};
type ReportRow = { id: string; building_id: string; title: string; status: string; author_id: string | null };
type BuildingResult = { buildingId: string; buildingName: string; reportId: string | null; status: string; recipients: number; shareId?: string; error?: string };
type Counts = { sent: number; skipped_no_artifact: number; skipped_not_approved: number; failed: number; reminded: number; already_sent: number };

// deno-lint-ignore no-explicit-any
type Admin = any;

const startOfSastDay = (ymd: string) => new Date(`${ymd}T00:00:00+02:00`).toISOString();

async function targetBuildings(admin: Admin, s: Schedule): Promise<{ id: string; name: string }[]> {
  const q = admin.from("buildings").select("id, name").order("name").limit(500);
  const { data, error } = s.building_ids ? await q.in("id", s.building_ids) : await q.contains("report_types", [s.report_type]);
  if (error) throw error;
  return data ?? [];
}

async function latestCompliance(admin: Admin, buildingId: string): Promise<number | null> {
  const { data } = await admin.from("building_metrics_daily").select("compliance_pct").eq("building_id", buildingId)
    .order("day", { ascending: false }).limit(1).maybeSingle();
  return typeof data?.compliance_pct === "number" ? data.compliance_pct : null;
}

/** One reminder per (building, type, day): dedupe on the title, which carries both. */
async function alreadyReminded(admin: Admin, buildingId: string, title: string, today: string): Promise<boolean> {
  const { data } = await admin.from("notifications").select("id").eq("kind", "report_due_soon").eq("building_id", buildingId)
    .eq("title", title).gte("created_at", startOfSastDay(today)).limit(1);
  return (data?.length ?? 0) > 0;
}

async function runSchedule(admin: Admin, s: Schedule, plan: PlanAction, today: string, dryRun: boolean, counts: Counts): Promise<BuildingResult[]> {
  if (plan.action === "none") return [];
  const period = plan.period;
  const buildings = await targetBuildings(admin, s);
  const results: BuildingResult[] = [];
  const adminIds = await adminAndManagerIds(admin);
  const branding = await loadBranding(admin);
  const { data: org } = await admin.from("organizations").select("settings").limit(1).maybeSingle();
  const fromName = senderName((org?.settings?.distribution_from as string | undefined) || branding.appName);
  const from = `${fromName} <notifications@buildingops.app>`;
  const label = REPORT_TYPE_LABELS[s.report_type];

  for (const b of buildings) {
    const { data: report } = await admin.from("reports").select("id, building_id, title, status, author_id")
      .eq("building_id", b.id).eq("report_type", s.report_type).eq("report_period", period).maybeSingle();
    const r = report as ReportRow | null;
    const base: BuildingResult = { buildingId: b.id, buildingName: b.name, reportId: r?.id ?? null, status: "", recipients: s.recipients.length };

    if (plan.action === "remind") {
      if (r?.status === "approved") { results.push({ ...base, status: "approved" }); continue; }
      const copy = reminderCopy({ buildingName: b.name, reportType: s.report_type, period, sendDate: sendDateFor(period, s), exists: !!r, status: r?.status ?? null });
      if (await alreadyReminded(admin, b.id, copy.title, today)) { results.push({ ...base, status: "already_reminded" }); continue; }
      if (!dryRun) {
        await createNotifications(admin, {
          recipients: [...(r?.author_id ? [r.author_id] : []), ...adminIds], actorId: null, actorName: "Report schedule",
          kind: "report_due_soon", entityType: "report", entityId: r?.id ?? null, buildingId: b.id,
          title: copy.title, body: copy.body, url: r ? `/reports/fortress/${r.id}` : `/buildings/${b.id}?tab=reports`,
        }, branding);
      }
      counts.reminded++;
      results.push({ ...base, status: "reminded" });
      continue;
    }

    // send
    if (!r || r.status !== "approved") {
      counts.skipped_not_approved++;
      if (!dryRun) await admin.from("report_distributions").insert({ schedule_id: s.id, report_id: r?.id ?? null, building_id: b.id, report_period: period, status: "skipped_not_approved", sent_to: [] });
      results.push({ ...base, status: "skipped_not_approved" });
      continue;
    }
    const { data: prior } = await admin.from("report_distributions").select("id").eq("schedule_id", s.id).eq("report_id", r.id).eq("status", "sent").limit(1);
    if ((prior?.length ?? 0) > 0) { counts.already_sent++; results.push({ ...base, status: "already_sent" }); continue; }
    const { data: artifact } = await admin.from("report_artifacts").select("id, file_name").eq("source_id", r.id)
      .eq("status", "issued").eq("report_status", "approved").order("version", { ascending: false }).limit(1).maybeSingle();
    if (!artifact) {
      counts.skipped_no_artifact++;
      if (!dryRun) {
        await admin.from("report_distributions").insert({ schedule_id: s.id, report_id: r.id, building_id: b.id, report_period: period, status: "skipped_no_artifact", sent_to: [] });
        await createNotifications(admin, {
          recipients: r.author_id ? [r.author_id] : adminIds, actorId: null, actorName: "Report schedule",
          kind: "report_export_needed", entityType: "report", entityId: r.id, buildingId: b.id,
          title: `Export needed: ${label} — ${b.name}`,
          body: "This report is approved but has no final PDF, so it could not be distributed. Open it and use Export PDF.",
          url: `/reports/fortress/${r.id}`,
        }, branding);
      }
      results.push({ ...base, status: "skipped_no_artifact" });
      continue;
    }
    if (dryRun) { results.push({ ...base, status: "would_send" }); counts.sent++; continue; }

    const createdBy = s.created_by ?? adminIds[0] ?? null;
    if (!createdBy) { counts.failed++; results.push({ ...base, status: "failed", error: "no owner for the share" }); continue; }
    const expiresAt = new Date(Date.now() + EXPIRY_DAYS_DEFAULT * 86_400_000).toISOString();
    const { data: share, error: shareErr } = await admin.from("report_shares")
      .insert({ report_id: r.id, artifact_id: artifact.id, token: mintShareToken(), created_by: createdBy, expires_at: expiresAt })
      .select("id, token").single();
    if (shareErr || !share) {
      counts.failed++;
      await admin.from("report_distributions").insert({ schedule_id: s.id, report_id: r.id, building_id: b.id, report_period: period, artifact_id: artifact.id, status: "failed", sent_to: [], error: `share: ${shareErr?.message ?? "no row"}` });
      results.push({ ...base, status: "failed", error: "share" });
      continue;
    }
    const copy = distributionCopy({ buildingName: b.name, reportType: s.report_type, period, title: r.title, compliancePct: await latestCompliance(admin, b.id), expiresAt, appName: branding.appName });
    const shareUrl = `${APP_URL}/share/${share.token}`;
    const sentTo: Record<string, unknown>[] = [];
    let delivered = 0;
    for (const rcpt of s.recipients) {
      let email = rcpt.email ?? null;
      if (rcpt.user_id) {
        const { data: p } = await admin.from("profiles").select("email, deactivated").eq("id", rcpt.user_id).maybeSingle();
        if (!p || p.deactivated) { sentTo.push({ ...rcpt, ok: false, reason: "deactivated" }); continue; }
        email = p.email ?? email;
      }
      if (!email) { sentTo.push({ ...rcpt, ok: false, reason: "no email" }); continue; }
      const html = renderEmail({ branding, preheader: copy.subject, heading: copy.heading, greeting: rcpt.name ? `Hi ${rcpt.name},` : undefined, bodyHtml: copy.bodyHtml, ctaText: copy.ctaText, ctaUrl: shareUrl });
      try {
        const ok = await sendEmail(from, [email], copy.subject, html);
        if (ok) delivered++;
        sentTo.push({ ...rcpt, email, ok });
      } catch (e) {
        console.error("report-distribution: email failed", e instanceof Error ? e.message : e);
        sentTo.push({ ...rcpt, email, ok: false });
      }
    }
    const status = delivered > 0 || !Deno.env.get("RESEND_API_KEY") ? "sent" : "failed";
    if (status === "sent") counts.sent++; else counts.failed++;
    await admin.from("report_distributions").insert({
      schedule_id: s.id, report_id: r.id, building_id: b.id, report_period: period, artifact_id: artifact.id, share_id: share.id,
      status, sent_to: sentTo, error: status === "failed" ? "no recipient accepted" : null,
    });
    results.push({ ...base, status, shareId: share.id });
  }
  return results;
}

serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req, ["x-distribution-secret"]);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const today = todayInOperatingTz();
  const counts: Counts = { sent: 0, skipped_no_artifact: 0, skipped_not_approved: 0, failed: 0, reminded: 0, already_sent: 0 };

  try {
    const isCron = !!SECRET && req.headers.get("x-distribution-secret") === SECRET;
    let schedules: Schedule[];
    let dryRun = false;
    let forced: PlanAction | null = null;

    if (isCron) {
      const { data, error } = await admin.from("report_schedules").select("*").eq("is_active", true);
      if (error) throw error;
      schedules = (data ?? []) as Schedule[];
    } else {
      const uid = await callerId(req);
      if (!uid) return json({ error: "unauthorized" }, 401);
      if (!(await isAdminOrManager(admin, uid))) return json({ error: "forbidden" }, 403);
      if (typeof body.scheduleId !== "string") return json({ error: "scheduleId required" }, 400);
      dryRun = body.dryRun !== false;
      const period = typeof body.period === "string" ? body.period : previousMonthStart(today);
      if (!PERIOD_RE.test(period)) return json({ error: "period must be YYYY-MM-01" }, 400);
      const { data, error } = await admin.from("report_schedules").select("*").eq("id", body.scheduleId).maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "unknown schedule" }, 404);
      schedules = [data as Schedule];
      forced = { action: "send", period };
    }

    const out: { scheduleId: string; action: string; period: string | null; buildings: BuildingResult[] }[] = [];
    for (const s of schedules) {
      if (isCron && s.last_run_on === today) { out.push({ scheduleId: s.id, action: "already_ran", period: null, buildings: [] }); continue; }
      const plan = forced ?? planFor(today, s);
      const buildings = await runSchedule(admin, s, plan, today, dryRun, counts);
      out.push({ scheduleId: s.id, action: plan.action, period: plan.action === "none" ? null : plan.period, buildings });
      if (!dryRun && plan.action !== "none") {
        await admin.from("report_schedules").update({ last_run_on: today, last_result: { ranAt: new Date().toISOString(), action: plan.action, period: plan.period, buildings } }).eq("id", s.id);
      }
    }
    console.log("report-distribution: run", { cron: isCron, dryRun, schedules: schedules.length, ...counts });
    return json({ ok: true, dryRun, today, schedules: out, counts });
  } catch (error) {
    console.error("report-distribution error:", error instanceof Error ? error.message : error);
    return json({ error: "run failed" }, 500);
  }
});
```
  Note for the implementer: `createNotifications` takes an `InboxInput` whose `kind` must type-check against the widened `NOTIFICATION_KINDS` — do the `notifyRules.ts` edit first. A cron real run marks `last_run_on` even on `remind` days, so a `send` later the same month is unaffected (different date); the per-report `already_sent` check is what stops double sends across manual + cron runs.

- [ ] `supabase/config.toml`: append

```toml
# Cron-invoked (x-distribution-secret) OR admin/manager JWT validated in code (run-now).
[functions.report-distribution]
verify_jwt = false

# Public share-link endpoint (no user JWT): token looked up with the service role; unknown/expired/revoked → 404.
[functions.report-share]
verify_jwt = false
```

- [ ] Gate: `deno check supabase/functions/report-share/index.ts supabase/functions/report-distribution/index.ts` (if `deno` is installed; otherwise `npx tsc` on the vitest-covered `_shared/distribution.ts` through the test), `npx vitest run src/lib/distributionPlan.test.ts src/lib/notifyRules.test.ts src/lib/pushUrl.test.ts`, `npm run test`.
- [ ] Commit: `git add supabase/functions/_shared/distribution.ts supabase/functions/_shared/reportAccess.ts supabase/functions/report-distribution/index.ts supabase/functions/report-share/index.ts supabase/config.toml supabase/functions/_shared/notifyRules.ts src/lib/notifyRules.test.ts src/lib/notify.ts docs/fixtures/distribution-plan.json src/lib/distributionPlan.test.ts && git commit -m "Add the report-distribution and report-share edge functions"`.

---

### Task 3: Approval auto-export, Share dialog, public share page, typed artifacts client

**Files:** Modify `src/lib/fortressReportPdf.ts` (`download` option), `src/hooks/useFortressReports.ts`, `src/components/reports/fortress/FortressReportEditor.tsx`, `src/components/reports/fortress/ReportSavedVersions.tsx`, `src/lib/reportArtifacts.ts`, `src/App.tsx`; create `src/lib/reportApproval.ts` (+ `.test.ts`), `src/lib/reportShares.ts` (+ `.test.ts`), `src/components/reports/fortress/ShareReportDialog.tsx` (+ `.test.tsx`), `src/pages/SharePage.tsx` (+ `.test.tsx`). Uses `useFeature('share_links')` from R4a and `mintToken` from `src/lib/calendarTokens.ts` (read-only import).

- [ ] `fortressReportPdf.ts`: `export async function generateReportPdf(reportId: string, branding: ReportBranding, opts: { download?: boolean } = {}): Promise<GeneratedFortressPdf>` — replace `await pdf.download(fileName);` with `if (opts.download !== false) await pdf.download(fileName);`. Nothing else changes (existing callers keep the download).

- [ ] `reportArtifacts.ts`: delete the hand-rolled `PgErr`/`Artifact*Builder`/`ArtifactTable`/`ArtifactBucket` interfaces and the `as unknown as ReportArtifactsClient` cast; replace with

```ts
import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export type ReportArtifactRow = Tables<'report_artifacts'>;
export type ReportArtifactInsert = TablesInsert<'report_artifacts'>;
/** The two surfaces this module touches, typed straight off the generated client (injectable for tests). */
export type ReportArtifactsClient = Pick<typeof supabase, 'from' | 'storage'>;
const defaultClient: ReportArtifactsClient = supabase;
```
  Keep every function body; the queries now type-check against the generated table (`version` is `number`, `report_status` is `string | null`). Rewrite the module comment: the table IS in the generated types (spec §2 latent defect). `reportArtifacts.test.ts` keeps its mock via `as unknown as ReportArtifactsClient` — adjust only if a property name changed (none should). Gate: `npx vitest run src/lib/reportArtifacts.test.ts`.

- [ ] `src/lib/reportApproval.ts`:

```ts
/**
 * Approval issues the final PDF (spec §5.7): the transition writes `status = 'approved'` first, then the
 * browser renders the report (no watermark, because generateReportPdf reads the status it just got) and
 * saves it as the current artifact. Never throws — a failed export must not undo an approval; the caller
 * says so in the toast and the distribution function reports `skipped_no_artifact` with an inbox nudge.
 */
import { generateReportPdf, type ReportBranding } from '@/lib/fortressReportPdf';
import { saveReportArtifact, type ReportArtifactKind } from '@/lib/reportArtifacts';

export interface ApprovalExportInput { reportId: string; orgId: string | null | undefined; userId: string | null | undefined; branding: ReportBranding }
export type ApprovalExportResult = { ok: true; artifactId: string; reportType: string } | { ok: false; error: string };
export const APPROVAL_EXPORT_FAILED = 'Approved, but the final PDF could not be saved — open the report and use Export PDF.';

export async function exportApprovedArtifact(
  input: ApprovalExportInput,
  deps: { generate: typeof generateReportPdf; save: typeof saveReportArtifact } = { generate: generateReportPdf, save: saveReportArtifact },
): Promise<ApprovalExportResult> {
  if (!input.orgId || !input.userId) return { ok: false, error: 'organisation or user not loaded' };
  try {
    const generated = await deps.generate(input.reportId, input.branding, { download: false });
    if (generated.reportStatus !== 'approved') return { ok: false, error: `report rendered as ${generated.reportStatus}` };
    const saved = await deps.save({
      orgId: input.orgId, kind: `fortress_${generated.reportType}` as ReportArtifactKind, blob: generated.blob, fileName: generated.fileName,
      generatedBy: input.userId, sourceId: input.reportId, buildingId: generated.buildingId, reportStatus: generated.reportStatus,
    });
    return saved.ok ? { ok: true, artifactId: saved.artifact.id, reportType: generated.reportType } : { ok: false, error: saved.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'export failed' };
  }
}
```
  Test: injected `generate`/`save` — success path returns the artifact id and passes `download: false`; generate throwing → `ok:false` with the message; save `ok:false` propagates; missing org → `ok:false` without calling generate; a generate result whose `reportStatus` is not `approved` is refused (guards a stale read).

- [ ] `useFortressReports.ts` → `useReportLifecycle`: import `useOrganization`, `exportApprovedArtifact`, `APPROVAL_EXPORT_FAILED`, `track`. `mutationFn` returns `{ report: Report; exported: ApprovalExportResult | null }`: after the status update, `if (params.status === 'approved') exported = await exportApprovedArtifact({ reportId, orgId: organization?.id, userId: user?.id, branding: { name: organization?.name ?? '', primaryColor: organization?.primary_color ?? '#2563eb', logoUrl: organization?.logo_url ?? null } })`. `onSuccess({ report: r, exported })`: existing notifications unchanged; `qc.invalidateQueries({ queryKey: ['report-artifacts', reportId] })`; when `exported?.ok` → `track('report_exported', { reportType: exported.reportType, reportStatus: 'approved' })` and toast `Report approved and the final PDF was saved.`; when `exported && !exported.ok` → `toast.warning(APPROVAL_EXPORT_FAILED)` (plus `console.error` in DEV); other statuses keep the existing verb toast. Update the `FortressReportEditor` `transition` callback for the new success shape (it only uses `onSuccess` to close the dialog — no change needed unless typed).

- [ ] `src/lib/reportShares.ts`:

```ts
/**
 * Share links (spec §5.8): a bearer URL to ONE issued artifact. Token minted client-side (same 43-char
 * base64url as calendar_tokens). A link WITHOUT a passcode is inserted straight through RLS; a link WITH
 * one goes through the report-share function's `create` action, because the hash uses the server salt.
 * Revoke is a client update of `revoked_at` (the only column clients may write).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { mintToken } from '@/lib/calendarTokens';
import { track } from '@/lib/analytics';

// report_shares is not yet in the generated types; regenerate after the migration ships.
const db = supabase as unknown as { from: (table: string) => any };

export type ExpiryDays = 7 | 30 | 90;
export const EXPIRY_OPTIONS: { value: ExpiryDays; label: string }[] = [{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }];
export const PASSCODE_MIN = 4;
export const PASSCODE_MAX = 64;
export const SHARE_PERMISSION_MESSAGE = "You don't have permission to share this report.";

export interface ReportShareRow {
  id: string; report_id: string; artifact_id: string; token: string; created_by: string; created_at: string;
  expires_at: string; passcode_hash: string | null; view_count: number; last_viewed_at: string | null; revoked_at: string | null;
}
export const shareUrl = (token: string) => `${window.location.origin}/share/${token}`;
export const isActiveShare = (s: ReportShareRow, now = Date.now()) => !s.revoked_at && new Date(s.expires_at).getTime() > now;
export function passcodeProblem(p: string): string | null {
  if (!p) return null;
  if (p.length < PASSCODE_MIN) return `Passcode must be at least ${PASSCODE_MIN} characters.`;
  if (p.length > PASSCODE_MAX) return `Passcode must be at most ${PASSCODE_MAX} characters.`;
  return null;
}

export interface CreateShareInput { reportId: string; artifactId: string; expiresInDays: ExpiryDays; passcode?: string }

export async function createShare(input: CreateShareInput, userId: string): Promise<{ id: string; token: string; expiresAt: string }> {
  const token = mintToken();
  if (input.passcode) {
    const { data, error } = await supabase.functions.invoke('report-share', {
      body: { action: 'create', reportId: input.reportId, artifactId: input.artifactId, token, expiresInDays: input.expiresInDays, passcode: input.passcode },
    });
    if (error) throw new Error(error.message ?? 'Could not create the link.');
    return { id: data.id, token: data.token, expiresAt: data.expiresAt };
  }
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString();
  const { data, error } = await db.from('report_shares')
    .insert({ report_id: input.reportId, artifact_id: input.artifactId, token, created_by: userId, expires_at: expiresAt })
    .select('id, token, expires_at');
  if (error) throw error;
  if (!data?.length) throw new Error(SHARE_PERMISSION_MESSAGE);   // RLS filtered the insert silently
  return { id: data[0].id, token: data[0].token, expiresAt: data[0].expires_at };
}

export async function listShares(reportId: string): Promise<ReportShareRow[]> {
  const { data, error } = await db.from('report_shares').select('*').eq('report_id', reportId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ReportShareRow[];
}

export async function revokeShare(id: string): Promise<void> {
  const { data, error } = await db.from('report_shares').update({ revoked_at: new Date().toISOString() }).eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error(SHARE_PERMISSION_MESSAGE);
}

export function useReportShares(reportId: string | undefined) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const key = ['report-shares', reportId];
  const query = useQuery({ queryKey: key, enabled: !!reportId, queryFn: () => listShares(reportId!) });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: (input: CreateShareInput) => createShare(input, user!.id),
    onSuccess: (_r, input) => { track('report_shared', { action: 'create', days: input.expiresInDays, passcode: !!input.passcode }); void invalidate(); },
  });
  const revoke = useMutation({
    mutationFn: revokeShare,
    onSuccess: () => { track('report_shared', { action: 'revoke' }); void invalidate(); },
  });
  return { ...query, shares: query.data ?? [], create, revoke };
}
```
  Test (`reportShares.test.ts`, mocked `supabase`): no-passcode create inserts through the table with a 43-char token and the right expiry; passcode create calls `functions.invoke('report-share')` with `action: 'create'` and never inserts; zero rows back → `SHARE_PERMISSION_MESSAGE`; `isActiveShare`, `passcodeProblem`.

- [ ] `ShareReportDialog.tsx` (`ResponsiveDialog`; props `{ reportId, artifacts: ReportArtifactRow[], initialArtifactId?: string | null, open, onOpenChange }`): version select (default the `issued` row; rows exported while not approved show the "exported while <status>" badge and a plain guardrail line "This version carries a DRAFT watermark."); expiry radio group (7/30/90, default 30); optional passcode input (`passcodeProblem` inline); "Create link" (44 px). On success: link box with `shareUrl(token)`, Copy button (`navigator.clipboard.writeText`, toast), "Expires <date>" and "Passcode required" chip. Below: "Active links" list from `useReportShares` filtered by `isActiveShare` (version, created, expires, `view_count` views, last viewed, passcode chip, Revoke with a confirm). Expired/revoked links are counted in one muted line ("3 older links are expired or revoked"). Coaching through `<Hint>`: "Anyone with the link can open this PDF until it expires. Add a passcode for external recipients." Test: renders versions, disables Create without an artifact, calls `create.mutate` with the chosen values, shows the copied link, revoke calls `revoke.mutate`.

- [ ] `FortressReportEditor.tsx`: `const shareLinks = useFeature('share_links')`; `const { data: artifacts } = useQuery({ queryKey: ['report-artifacts', id], … })` — reuse `listReportArtifactsForSource` (the same key `ReportSavedVersions` uses, so both stay in sync); state `shareOpen`, `shareArtifactId`; header button `Share` (icon `Share2`, `variant="outline"`, `size="sm"`) shown when `shareLinks && isAdminOrManager`, disabled with `title="Export a PDF first"` when there is no artifact; mount `<ShareReportDialog reportId={report.id} artifacts={artifacts ?? []} initialArtifactId={shareArtifactId} open={shareOpen} onOpenChange={setShareOpen} />`; pass `onShare={shareLinks && isAdminOrManager ? (a) => { setShareArtifactId(a.id); setShareOpen(true); } : undefined}` to `ReportSavedVersions`. Approve action: label stays "Approve"; add to `statusHint` for submitted/reviewed (admin/manager): "…Approving also saves the final PDF." (coaching, via the existing `<Hint>`).

- [ ] `ReportSavedVersions.tsx`: new optional prop `onShare?: (a: ReportArtifactRow) => void`; each row gains a "Share this version" outline button (`Share2`) when `onShare` is given. No other change.

- [ ] `src/pages/SharePage.tsx` (public, no `DashboardLayout`, mobile-first, `min-h-[44px]` controls):

```tsx
/**
 * Public share page (spec §5.8): /share/:token. No session. Branding from the anon-readable
 * organization_branding view; report metadata from report-share GET; the PDF opens through a
 * 10-minute signed URL from report-share POST. The PDF itself carries DRAFT unless approved.
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Lock, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatPeriodLabel } from '@/lib/fortressReports';
import { REPORT_TYPE_LABELS, type ReportType } from '@/integrations/supabase/fortress-db';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/report-share`;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface ShareMeta { building: string; title: string; type: ReportType; period: string; reportStatus: string; issuedAt: string; expiresAt: string; needsPasscode: boolean }
interface Branding { name: string | null; logo_url: string | null; primary_color: string | null }

// organization_branding is not yet in the generated types; regenerate after the R4a migration ships.
const db = supabase as unknown as { from: (table: string) => any };

export async function fetchShareMeta(token: string): Promise<ShareMeta | null> {
  if (!TOKEN_RE.test(token)) return null;
  const res = await fetch(`${FN_URL}?t=${encodeURIComponent(token)}`, { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ShareMeta;
}
export type OpenResult = { ok: true; url: string } | { ok: false; reason: 'not_found' | 'locked' | 'error'; retryAfterSeconds?: number };
export async function openShare(token: string, passcode?: string): Promise<OpenResult> {
  const res = await fetch(FN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }, body: JSON.stringify({ t: token, passcode }) });
  if (res.status === 200) return { ok: true, url: ((await res.json()) as { url: string }).url };
  if (res.status === 429) return { ok: false, reason: 'locked', retryAfterSeconds: ((await res.json().catch(() => ({}))) as { retryAfterSeconds?: number }).retryAfterSeconds };
  if (res.status === 404) return { ok: false, reason: 'not_found' };
  return { ok: false, reason: 'error' };
}

export default function SharePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [passcode, setPasscode] = useState('');
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const branding = useQuery({ queryKey: ['organization-branding'], staleTime: 300_000, queryFn: async (): Promise<Branding | null> => {
    const { data } = await db.from('organization_branding').select('name, logo_url, primary_color').limit(1).maybeSingle();
    return (data as Branding | null) ?? null;
  } });
  const meta = useQuery({ queryKey: ['share-page', token], retry: false, queryFn: () => fetchShareMeta(token) });

  const open = async () => {
    setProblem(null); setOpening(true);
    // Open the tab synchronously (popup blockers), then point it at the signed URL.
    const tab = window.open('', '_blank');
    try {
      const r = await openShare(token, passcode || undefined);
      if (r.ok) { if (tab) tab.location.href = r.url; else window.location.assign(r.url); return; }
      tab?.close();
      setProblem(r.reason === 'locked' ? `Too many attempts. Try again in ${Math.ceil((r.retryAfterSeconds ?? 900) / 60)} minutes.`
        : r.reason === 'not_found' ? (meta.data?.needsPasscode ? 'That passcode is not right, or the link has expired.' : 'This link is no longer available.')
        : 'Could not open the report. Try again.');
    } finally { setOpening(false); }
  };

  const color = branding.data?.primary_color && /^#[0-9a-f]{6}$/i.test(branding.data.primary_color) ? branding.data.primary_color : '#2563eb';
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="px-4 py-4" style={{ background: color }}>
        <div className="mx-auto flex max-w-lg items-center gap-3">
          {branding.data?.logo_url ? <img src={branding.data.logo_url} alt="" className="h-8 w-auto rounded bg-white p-1" /> : null}
          <span className="text-base font-semibold text-white">{branding.data?.name ?? 'Building Ops'}</span>
        </div>
      </header>
      <main className="mx-auto max-w-lg p-4">
        {meta.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : meta.isError ? <p className="text-sm text-destructive">Could not load this link. Try again later.</p>
        : !meta.data ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">This link is not available. It may have expired or been revoked — ask the sender for a new one.</CardContent></Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{meta.data.title?.toUpperCase()}</CardTitle>
              <p className="text-sm text-muted-foreground">{REPORT_TYPE_LABELS[meta.data.type] ?? meta.data.type} · {meta.data.building} · {formatPeriodLabel(meta.data.period)}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant={meta.data.reportStatus === 'approved' ? 'default' : 'outline'} className="capitalize">{meta.data.reportStatus}</Badge>
                <span className="text-xs text-muted-foreground">Issued {new Date(meta.data.issuedAt).toLocaleDateString('en-ZA')} · Link expires {new Date(meta.data.expiresAt).toLocaleDateString('en-ZA')}</span>
              </div>
              {meta.data.reportStatus !== 'approved' && <p className="text-sm">This PDF was issued before approval and carries a DRAFT watermark.</p>}
            </CardHeader>
            <CardContent className="space-y-4">
              {meta.data.needsPasscode && (
                <div className="space-y-1">
                  <Label htmlFor="passcode" className="flex items-center gap-1"><Lock className="h-3 w-3" /> Passcode</Label>
                  <Input id="passcode" type="password" autoComplete="off" inputMode="text" className="h-11" value={passcode} onChange={(e) => setPasscode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void open(); }} />
                </div>
              )}
              {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
              <Button className="h-11 w-full" disabled={opening || (meta.data.needsPasscode && !passcode)} onClick={() => void open()}>
                {opening ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />} Open PDF
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
```
  Test (`SharePage.test.tsx`, mocked `fetch` + `supabase`): 404 renders the "not available" card; metadata renders title/building/DRAFT line; passcode field appears only when `needsPasscode`; `openShare` maps 200/404/429 to the result union.

- [ ] `App.tsx`: `const SharePage = lazy(() => import("./pages/SharePage"));` and, in the public block, `<Route path="/share/:token" element={<SharePage />} />` with the comment `{/* Public share page (spec §5.8): no session; the token is the credential. Never wrap in ProtectedRoute. */}`.

- [ ] Gate: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'reportArtifacts|reportApproval|reportShares|ShareReportDialog|SharePage|useFortressReports|FortressReportEditor|ReportSavedVersions|fortressReportPdf|App.tsx'` empty; `npx vitest run src/lib/reportArtifacts.test.ts src/lib/reportApproval.test.ts src/lib/reportShares.test.ts src/components/reports/fortress src/pages/SharePage.test.tsx`; `npm run test`.
- [ ] Commit: `git add src/lib/fortressReportPdf.ts src/hooks/useFortressReports.ts src/components/reports/fortress/FortressReportEditor.tsx src/components/reports/fortress/ReportSavedVersions.tsx src/lib/reportArtifacts.ts src/App.tsx src/lib/reportApproval.ts src/lib/reportApproval.test.ts src/lib/reportShares.ts src/lib/reportShares.test.ts src/components/reports/fortress/ShareReportDialog.tsx src/components/reports/fortress/ShareReportDialog.test.tsx src/pages/SharePage.tsx src/pages/SharePage.test.tsx && git commit -m "Issue the final PDF on approval, share links, and the public share page"`.

---

### Task 4: Settings → Report distribution

**Files:** Create `src/hooks/useReportSchedules.ts` (+ `.test.ts`), `src/lib/reportSchedule.ts`, `src/components/settings/ReportDistributionCard.tsx` (+ `.test.tsx`), `src/components/settings/ScheduleDialog.tsx`, `src/components/settings/RecipientsEditor.tsx` (+ `.test.tsx`), `src/components/settings/DistributionResults.tsx`; modify `src/pages/Settings.tsx`. Waits for Task 2's commit (`_shared/distribution.ts`). Uses `useFeature('report_schedules')`, `useBuildings()` (`report_types` from R4a), `useBuildingMembers(buildingId)` for the colleague picker.

- [ ] `src/lib/reportSchedule.ts`: `export * from '../../supabase/functions/_shared/distribution';` (same seam as `src/lib/calendar/events.ts`) plus `describeSchedule(s: { send_day, remind_days_before }): string` → `"Sends on the 7th of the following month · reminder 3 days before"` (ordinal helper; `remind_days_before === 0` → "no reminder").

- [ ] `useReportSchedules.ts`:

```ts
// report_schedules / report_distributions are not yet in the generated types; regenerate after the migration ships.
const db = supabase as unknown as { from: (table: string) => any };
export interface Recipient { email?: string; name?: string; user_id?: string }   // external: email; colleague: user_id (address resolved server-side)
export interface ReportSchedule { id: string; report_type: ReportType; building_ids: string[] | null; recipients: Recipient[]; send_day: number; remind_days_before: number; is_active: boolean; created_by: string | null; created_at: string; updated_at: string; last_run_on: string | null; last_result: LastResult | null }
export interface LastResult { ranAt: string; action: 'send' | 'remind'; period: string; buildings: { buildingId: string; buildingName: string; reportId: string | null; status: string; recipients: number; error?: string }[] }
export interface ScheduleInput { report_type: ReportType; building_ids: string[] | null; recipients: Recipient[]; send_day: number; remind_days_before: number; is_active: boolean }
export interface Distribution { id: string; schedule_id: string; report_id: string | null; building_id: string | null; report_period: string; artifact_id: string | null; share_id: string | null; sent_to: (Recipient & { ok: boolean })[]; sent_at: string; status: 'sent' | 'skipped_no_artifact' | 'skipped_not_approved' | 'failed'; error: string | null }
export type RunResponse = { ok: true; dryRun: boolean; today: string; schedules: { scheduleId: string; action: string; period: string | null; buildings: LastResult['buildings'] }[]; counts: Record<string, number> };
export const SCHEDULE_PERMISSION_MESSAGE = 'Only admins and managers can change report schedules.';
```
  `useReportSchedules()`: query `['report-schedules']` (`select('*').order('created_at')`); `create` (insert with `created_by: user.id`, `.select('id')`, zero rows → permission message), `update(id, patch)` (only the six editable columns; `.select('id')` guard), `remove(id)`; `runNow({ scheduleId, dryRun, period? })` → `supabase.functions.invoke('report-distribution', { body })` → `RunResponse` (throw `error.message`); invalidates `['report-schedules']` and `['report-distributions', scheduleId]` after a real run. `useScheduleDistributions(scheduleId)`: `['report-distributions', scheduleId]`, last 100 by `sent_at desc`. `isEmail(s)` helper (same regex as `report_recipients_valid`). Test: call shapes for create/update/runNow, `isEmail`, zero-row permission error.

- [ ] `RecipientsEditor.tsx` (`{ value: Recipient[]; onChange; buildingId?: string | null }`): list of chips (name or email, `user_id` ones marked "colleague", remove ×, 44 px); "Add email" input + optional name (validated with `isEmail`, duplicates rejected with a plain line); "Add colleague" select from `useBuildingMembers(buildingId)` (the first selected building, or the first building in `useBuildings()` when the schedule covers all — admins and managers are members everywhere) adding `{ user_id: member.id, name: memberDisplayName(member) }` — `BuildingMember` carries no email (other users' profiles are not readable under RLS), which is why `report_recipients_valid` accepts `user_id` without one and the function resolves the address with the service role. Duplicate `user_id` rejected. Max 50. Test: add/remove, invalid email rejected, duplicate email and duplicate colleague rejected, a colleague row has no `email` key.

- [ ] `ScheduleDialog.tsx` (`ResponsiveDialog`, create/edit): report type select (`REPORT_TYPE_LABELS`), buildings: "All buildings with this report type" switch vs a checkbox list of `useBuildings()` (filtered to those whose `report_types` includes the type, search box), `RecipientsEditor`, send day (1–28 number input, default `useOrgSettings().report_due_day`), reminder days (0–27), active switch, `describeSchedule` preview + `nextRunDates(todayInOperatingTz(), timing)` line ("Next reminder 4 Oct · next send 7 Oct for September"). Save → create/update. `<Hint>`: "The report for a month is sent on this day of the following month. Only approved reports with a final PDF go out; the rest are listed as skipped."

- [ ] `DistributionResults.tsx` (`{ rows: LastResult['buildings'] | Distribution[]; title }`): table building · status chip (`sent` green, `would_send` outline, `skipped_*` amber, `failed` red, `already_sent`/`reminded` muted) · recipients · when · error; mobile: stacked rows.

- [ ] `ReportDistributionCard.tsx`: gated by `useFeature('report_schedules') && isAdminOrManager` (renders `null` otherwise); list of schedules (type, "All buildings" or "N buildings", recipients count, `describeSchedule`, next send, active switch → `update`, last run chip "Ran 7 Oct: 31 sent · 4 skipped"), row actions: Edit, "Preview run" (`runNow({ scheduleId, dryRun: true })` → `DistributionResults` in a dialog with the counts line), "Send now" (guardrail confirm dialog: "This emails the share links for <period> to <n> recipients now. Reports already sent by this schedule are not re-sent." → `runNow({ dryRun: false })`), History (`useScheduleDistributions` → `DistributionResults`), Delete (confirm). "New schedule" button. Test: hidden when the flag is off; renders rows; preview calls `runNow` with `dryRun: true`.

- [ ] `Settings.tsx`: import `useFeature`, `ReportDistributionCard`; `const schedulesOn = useFeature('report_schedules')`; add `<TabsTrigger value="distribution">Report distribution</TabsTrigger>` when `isAdminOrManager && schedulesOn`, and `<TabsContent value="distribution"><ReportDistributionCard /></TabsContent>`. Do not touch R4a's SLA/flags cards.

- [ ] Gate: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'useReportSchedules|reportSchedule|ReportDistributionCard|ScheduleDialog|RecipientsEditor|DistributionResults|Settings.tsx'` empty; `npx vitest run src/hooks/useReportSchedules.test.ts src/components/settings`; `npm run test`.
- [ ] Commit: `git add src/hooks/useReportSchedules.ts src/hooks/useReportSchedules.test.ts src/lib/reportSchedule.ts src/components/settings/ReportDistributionCard.tsx src/components/settings/ReportDistributionCard.test.tsx src/components/settings/ScheduleDialog.tsx src/components/settings/RecipientsEditor.tsx src/components/settings/RecipientsEditor.test.tsx src/components/settings/DistributionResults.tsx src/pages/Settings.tsx && git commit -m "Add Settings → Report distribution (schedules, recipients, dry run, results)"`.

---

### Task 5: CSV everywhere + evidence packs

**Files:** Modify `src/components/reports/fortress/EditableGrid.tsx`, `src/pages/Issues.tsx`, `src/pages/Buildings.tsx`, `src/pages/Contractors.tsx`, `src/components/contractors/ContractorDocuments.tsx`, `src/components/building/AssetsTab.tsx`, `src/components/building/TenantsTab.tsx`, `src/components/building/ChecklistsTab.tsx`, `src/components/building/DocumentsTab.tsx`, `src/components/building/DocumentsToolbar.tsx`, `src/components/building/AssetServiceHistoryDialog.tsx`, `src/components/building/PpmTab.tsx`, `src/components/building/TasksList.tsx`, `src/components/reports/fortress/CoverageGrid.tsx` (R4a), `src/components/issues/IssueDetailDialog.tsx`, `src/lib/pdfGenerator.ts`; create `src/lib/evidencePack.ts` (+ `.test.ts`), `src/lib/evidencePackData.ts`, `src/lib/evidencePackExport.ts`, `src/components/evidence/EvidencePackMenu.tsx`. Waits for Task 1's commit (`fflate` in `package.json`). Does not touch `exportCsv.ts` (unchanged).

- [ ] CSV — one rule everywhere: a `Download`-icon "Export CSV" button (44 px on mobile, `variant="outline" size="sm"`), disabled when there are no rows, exporting exactly the rows on screen after the current filters, filename `<subject>_<yyyy-mm-dd>.csv`, `toast.success('Exported N rows')`. Columns:
  - `EditableGrid.tsx`: button beside Save; columns from `columns` (`header: c.label`, value = `c.compute ? c.compute(row) : row[c.key]`, `select` columns map value → option label, `bool`/`tristate` → `Yes`/`No`/`N/A`, `format` applied when present); rows = saved `rows` (not the dirty draft: if `dirty`, toast "Save your changes before exporting" and stop — same rule as the PDF); filename `${table}_${reportId.slice(0, 8)}`.
  - `Issues.tsx`: filtered list; columns title, building, priority, status, category, reported (created_at), deadline, assigned_to, resolved_at, `sla_target_hours`, `sla_due` (from `slaState(issue).due`), `sla_state` (`slaState(issue).label`), `sla_breached_at`, `first_response_at`, corrective_action.
  - `Buildings.tsx`: replace the XLSX exporter with `exportCsv` (Name, Address, City, Latitude, Longitude, Timezone, plus `report_types` joined by `;`); delete `import * as XLSX` and the Excel menu item (single button).
  - `AssetsTab.tsx` / `TenantsTab.tsx`: remove the `'xlsx'` branch, the `XLSX` import and the dropdown; keep the existing `columns` list and `exportCsv` call behind one button.
  - `ChecklistsTab.tsx`: tasks of the active tab/range; columns task_name, category, frequency, responsible_role, assignee (`nameOf(assigned_to)`), due_date, status, completed_by (`nameOf`), completed_at.
  - `DocumentsTab.tsx` + `DocumentsToolbar.tsx` (`onExport` prop, button in the toolbar): filtered `UnifiedDocument[]`; columns name, type, scope, shopNumber, tenantName, issueDate, expiryDate, status.label, source.
  - `AssetServiceHistoryDialog.tsx`: service_date, service_type, description, performed_by, contractor (name via `useContractors`), cost, next_service_date, notes.
  - `Contractors.tsx`: company_name, trade, default_trade_role, contact_name, contact_email, contact_phone, rating, vat_number, address, is_active.
  - `ContractorDocuments.tsx`: document_name, document_type, expiry_date, is_verified, uploaded_at, notes.
  - `PpmTab.tsx`: second button "Export grid CSV": service × 12 fiscal months (`done`/`missed`/`due`/`—`) + contractor.
  - `CoverageGrid.tsx` (R4a): building + one column per report type (status).

- [ ] `pdfGenerator.ts`: export the runtime for other builders — `export async function renderPdfBlob(doc: Parameters<typeof pdfMake.createPdf>[0]): Promise<Blob> { return pdfMake.createPdf(doc).getBlob(); }` (no download). Nothing else changes.

- [ ] `src/lib/evidencePack.ts` — pure doc builders (`TDocumentDefinitions`), no I/O, no DOM:

```ts
import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import type { EmbeddedPhoto } from '@/lib/fortressReportDoc';
import { runningHeader, safePrimaryColor } from '@/lib/reportDocs';

export interface PackMeta { orgName: string; primaryColor: string; generatedAt: string; generatedBy: string; buildingName: string }
export interface IssuePack {
  kind: 'issue'; meta: PackMeta;
  issue: { id: string; title: string; description: string; priority: string; status: string; category: string | null; createdAt: string; deadline: string | null; resolvedAt: string | null; reportedBy: string; assignee: string | null; contractor: string | null; estimatedCost: number | null; actualCost: number | null; correctiveAction: string | null };
  sla: { targetHours: number | null; dueAt: string | null; breachedAt: string | null; firstResponseAt: string | null; label: string };
  photos: EmbeddedPhoto[];
  timeline: { at: string; author: string; type: string; text: string; photos: EmbeddedPhoto[] }[];
  rating: { stars: number; comment: string | null } | null;
}
export interface TaskPack {
  kind: 'task'; meta: PackMeta;
  task: { id: string; name: string; description: string | null; frequency: string; dueDate: string; status: string; responsibleRole: string; category: string | null; assignee: string | null };
  completion: { completedBy: string; completedAt: string; notes: string | null; signatureConfirmed: boolean; photos: EmbeddedPhoto[]; source: 'task_completions' | 'task_instances' } | null;
}
export interface AssetPack {
  kind: 'asset'; meta: PackMeta;
  asset: { id: string; name: string; category: string; location: string | null; manufacturer: string | null; model: string | null; serialNumber: string | null; status: string; installationDate: string | null; purchaseDate: string | null; purchasePrice: number | null; replacementCost: number | null; warrantyExpiry: string | null; warrantyProvider: string | null; expectedLifespanYears: number | null; lastServiceDate: string | null; nextServiceDate: string | null; notes: string | null };
  services: { date: string; type: string; description: string | null; performedBy: string | null; contractor: string | null; cost: number | null; nextServiceDate: string | null }[];
}
export type EvidencePack = IssuePack | TaskPack | AssetPack;

export function packFileName(pack: EvidencePack): string  // evidence-issue-<8>.pdf etc.
export function buildIssuePackDoc(p: IssuePack): TDocumentDefinitions
export function buildTaskPackDoc(p: TaskPack): TDocumentDefinitions
export function buildAssetPackDoc(p: AssetPack): TDocumentDefinitions
export function buildEvidencePackDoc(p: EvidencePack): TDocumentDefinitions   // dispatch on kind
```
  Layout: `runningHeader(orgName, title)`; a key/value header table (two columns, 44 % / 56 %); "Photos" as a 2-per-row grid (`width: 240`, caption + time under each, `EmbeddedPhoto.caption`); issue timeline as a table (when · who · what) with comment photos inline after their row; "Resolution" block (corrective action, resolved at, rating stars as `★★★★☆` + comment); task pack: instance block, then completion block with `source` printed as "Recorded in task_completions" / "Recorded on the task (no completion row)", "Signature confirmed: Yes/No", photos; asset pack: lifecycle table (purchase → warranty → services with costs → next service), total service cost, and a "Costs" line. Footer: "Generated <at> by <who> · <orgName>". Every string through pdfmake `text` (no HTML). Test (`evidencePack.test.ts`): each builder returns a doc whose stringified content contains the title, building, every photo caption, the SLA label, the rating line, "Recorded in task_completions" for the source, the service total; `packFileName`; an issue with no photos renders "No photos attached"; a task with no completion renders "Not completed".

- [ ] `src/lib/evidencePackData.ts` — loaders (`supabase` typed client; only R3c/R4a columns already in the generated types):
  - `loadIssuePack(issueId, meta)`: `issues` row (+ `buildings.name`, `contractors.company_name` via a second query), `issue_activity` ordered by `created_at`, `contractor_ratings` by `issue_id`; names via `building_members(b)` for `assigned_to`/`reported_by`/activity `author_name`; `slaState(issue)` from R4a for `sla`; photos: `photo_urls` → `resolveStorageUrl` → `fetch` → `blobToDataUrl` (canvas downscale to max 1100 px at 0.7 quality, same numbers as `fortressReportPdf`; a photo that fails to load becomes a caption-only placeholder "Photo unavailable" rather than failing the pack).
  - `loadTaskPack(taskId, meta)`: `task_instances` row; completion from `task_completions` (newest by `created_at`) — `source: 'task_completions'`; only when no row exists and `task_instances.completed_at` is set, fall back to the denormalised copy (`source: 'task_instances'`, `signatureConfirmed: !!signature_url`); photos as above.
  - `loadAssetPack(assetId, meta)`: `building_assets` row + `asset_service_history` (+ contractor names).
  - `export async function loadEvidencePack(kind: 'issue'|'task'|'asset', id: string, meta: PackMeta): Promise<{ pack: EvidencePack; originals: { name: string; blob: Blob }[] }>` — `originals` are the fetched photo blobs (numbered `photos/01.jpg`… with the source noted in a `photos/index.txt`).

- [ ] `src/lib/evidencePackExport.ts`:

```ts
import { zipSync } from 'fflate';
import { buildEvidencePackDoc, packFileName, type PackMeta } from '@/lib/evidencePack';
import { loadEvidencePack } from '@/lib/evidencePackData';
import { renderPdfBlob } from '@/lib/pdfGenerator';
import { track } from '@/lib/analytics';

/** Object URL + anchor click, the same path exportCsv and the XLSX writers use inside the PWA sandbox. */
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadEvidencePack(kind: 'issue' | 'task' | 'asset', id: string, meta: PackMeta, opts: { withOriginals: boolean }): Promise<void> {
  const { pack, originals } = await loadEvidencePack(kind, id, meta);
  const pdf = await renderPdfBlob(buildEvidencePackDoc(pack));
  const name = packFileName(pack);
  if (!opts.withOriginals) { download(pdf, name); track('evidence_pack', { kind, originals: false }); return; }
  const files: Record<string, Uint8Array> = { [name]: new Uint8Array(await pdf.arrayBuffer()) };
  for (const o of originals) files[o.name] = new Uint8Array(await o.blob.arrayBuffer());
  const zip = zipSync(files, { level: 0 });   // JPEGs and PDFs do not compress; store them
  download(new Blob([zip], { type: 'application/zip' }), name.replace(/\.pdf$/, '.zip'));
  track('evidence_pack', { kind, originals: true, files: originals.length });
}
```

- [ ] `src/components/evidence/EvidencePackMenu.tsx`: `{ kind, id, buildingName, disabled? }` → `DropdownMenu` trigger "Evidence pack" (`FileDown`), items "PDF" and "PDF + original photos (zip)"; builds `meta` from `useOrganization()` + `useAuth()` (`generatedBy` = profile name or email); busy spinner; errors → `toast.error('Could not build the evidence pack. ' + message)`.
  - `IssueDetailDialog.tsx`: mount `<EvidencePackMenu kind="issue" id={issue.id} buildingName={…} />` in the header actions row (every signed-in viewer of the issue may export — RLS already scopes what they can read).
  - `TasksList.tsx`: new optional prop `onEvidencePack?: (task: TaskInstance) => void`; rendered as a menu item / small button only when `task.completion` exists; `ChecklistsTab.tsx` passes a handler that opens the `EvidencePackMenu` flow for that task (simplest: render `<EvidencePackMenu kind="task" …>` inline in the row when `task.completion`, gated by the prop).
  - `AssetsTab.tsx`: dropdown item "Evidence pack" → `EvidencePackMenu` items (reuse by rendering the two `DropdownMenuItem`s from a small exported `evidencePackItems(...)` helper in `EvidencePackMenu.tsx`).

- [ ] Gate: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'EditableGrid|Issues.tsx|Buildings.tsx|Contractors.tsx|ContractorDocuments|AssetsTab|TenantsTab|ChecklistsTab|DocumentsTab|DocumentsToolbar|AssetServiceHistoryDialog|PpmTab|TasksList|CoverageGrid|IssueDetailDialog|pdfGenerator|evidencePack|EvidencePackMenu'` empty; `grep -rn "from 'xlsx'" src/pages src/components/building` shows only the importers under `src/components/import` (none in the three replaced exporters); `npx vitest run src/lib/evidencePack.test.ts src/lib/exportCsv.test.ts`; `npm run test`; `npm run build` (confirms `fflate` and `pdfmake` chunk only where used).
- [ ] Commit: `git add src/components/reports/fortress/EditableGrid.tsx src/pages/Issues.tsx src/pages/Buildings.tsx src/pages/Contractors.tsx src/components/contractors/ContractorDocuments.tsx src/components/building/AssetsTab.tsx src/components/building/TenantsTab.tsx src/components/building/ChecklistsTab.tsx src/components/building/DocumentsTab.tsx src/components/building/DocumentsToolbar.tsx src/components/building/AssetServiceHistoryDialog.tsx src/components/building/PpmTab.tsx src/components/building/TasksList.tsx src/components/reports/fortress/CoverageGrid.tsx src/components/issues/IssueDetailDialog.tsx src/lib/pdfGenerator.ts src/lib/evidencePack.ts src/lib/evidencePack.test.ts src/lib/evidencePackData.ts src/lib/evidencePackExport.ts src/components/evidence/EvidencePackMenu.tsx && git commit -m "CSV export on every grid, list and register; evidence packs for issues, tasks and assets"`.

---

### Task 6 (controller): apply, deploy, verify, record

- [ ] Secrets, generated in-shell and never printed: `REPORT_DISTRIBUTION_SECRET="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"`, `SHARE_SALT="$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=')"`; `supabase secrets set REPORT_DISTRIBUTION_SECRET="$REPORT_DISTRIBUTION_SECRET" SHARE_SALT="$SHARE_SALT" --project-ref vkrihpmjajjcxmzgjqdr` (staging), then the same values (or fresh ones) for `qdzgkttiosahdfqresvz` (prod). Staging also needs `APP_URL` for the share URL in emails (set it to the staging origin) — `RESEND_API_KEY` may stay absent (emails count 0).
- [ ] Staging: apply `2026-09-14_01` (R4a, if not already) then `_02` with the two cron placeholders substituted (Management API, scratch `supa.mjs`); `supabase functions deploy report-distribution report-share --project-ref vkrihpmjajjcxmzgjqdr`; `node scripts/rls-smoke.mjs`, `REPORT_DISTRIBUTION_SECRET=… node scripts/distribution-smoke.mjs`, `npm run smoke:notifications`, `npm run smoke:calendar`, `npm run smoke`.
- [ ] Manual staging pass (Vercel preview of this branch): enable `share_links` + `report_schedules` on the staging org (`settings.features`); approve a submitted report → artifact row with `report_status = 'approved'` appears in Issued PDFs without a download; Share → link with and without passcode; open `/share/<token>` in a private window (branding, DRAFT line absent for the approved one, passcode gate, PDF opens); revoke → 404 card; Settings → Report distribution → schedule for OPS with your own email → Preview run → Send now → email arrives with the link and the compliance line; issues/documents/assets CSVs open in Numbers/Excel with the BOM intact; an issue evidence pack PDF and zip open.
- [ ] Prod: apply `_02` (placeholders substituted with the prod ref + prod secret); deploy both functions to prod; `node scripts/rls-smoke.mjs` against prod (`SMOKE_ALLOW_PROD=1` is NOT needed for rls-smoke); do NOT run `distribution-smoke` on prod. Leave both feature flags off on prod until the owner enables them (spec §11).
- [ ] Types: `supabase gen types typescript --project-id qdzgkttiosahdfqresvz > src/integrations/supabase/types.ts`; drop the four boundary casts (`reportShares.ts`, `useReportSchedules.ts`, `SharePage.tsx` branding, and any R4a leftovers); `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'` ≤ 51.
- [ ] Whole-slice review (superpowers:code-reviewer over `git diff <plan-sha>..HEAD`): look specifically for a share created for a DRAFT-status artifact by distribution (must be impossible — the query filters `report_status = 'approved'`), `/share/` appearing in any allowlist, a token or passcode reaching `console.log`, `as never`, XLSX left in the three exporters, an evidence pack reading `task_instances` before `task_completions`, the `report_shares` insert policy admitting a non-null `passcode_hash`, `last_run_on` writable by clients, and the cron placeholder strings surviving into an applied job.
- [ ] Records: append a `## Status — shipped <date>` section to this plan (range, migrations, smoke counts, decisions, follow-ups — R3c format); `docs/plans/APPLY_CHECKLIST.md` gains `## R4b "Distribute & Share"` (migration + GMI sha, functions, secrets, cron `report-distribution-daily 0 5 * * *`, staging/prod DONE lines, owner items: enable the two flags, set `report_due_day`, mark `report_types` per building, decide `distribution_from`); `git push`; PR #3 body gets an R4b paragraph; memory `fortress-daily-ops-roadmap.md` updated (R4b live; open owner items).
