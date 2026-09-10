# R3b "Calendar" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every dated thing in the portfolio — tasks, issue deadlines, document expiries, asset services, PPM services, sign-off due dates, report periods — on one calendar, per building and across the portfolio, with tasks draggable to another day, plus a subscribable ICS feed per user and per building.

**Architecture:** One pure event model (`src/lib/calendar/events.ts`: `CalendarEvent { id, kind, title, date, endDate?, buildingId, buildingName, href, status, entity }`) fed by one hook `useCalendarEvents(scope, range)` that fans out to the six source queries (persisted for the user's buildings). An in-house month/week grid (`components/calendar/`, date-fns, no new dependency) with source filter chips, tap → the existing entity dialog, and drag-to-reschedule for tasks only. ICS: `calendar_tokens` (owner-only) + an `ics-feed` edge function (`verify_jwt = false`, token in the query string) that renders the same event model through a pure `renderIcs()` shared with vitest. Profile and Building Details expose the feed URLs.

**Tech Stack:** React 18 + TS, TanStack Query v5 (+ `PERSIST_DEFAULTS`), date-fns, shadcn/ui, Supabase JS, Deno edge function (read-verified), vitest + Testing Library 16.

**Spec:** `docs/superpowers/specs/2026-09-10-r3-plan-design.md` §5.5, §7.

**Ground rules for every agent:** never `git stash` / `checkout` / `switch` / `reset` / `worktree`; compare with `git show <sha>:<path>`; edit only the files your task names; commit with an explicit pathspec; retry after 5 s on `index.lock`; end commit messages with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; gate = `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E '<your files>'` prints nothing, `npm run test` green, global count ≤ `.github/typecheck-baseline.txt` (55) on a clean tree; `calendar_tokens` is not in the generated types until the controller regenerates them — cast at the boundary with `// calendar_tokens is not yet in the generated types; regenerate after the migration ships.`; guardrail copy plain, coaching through `<Hint>`; mobile-first (week view on phones, 44 px targets); no new npm dependency for the grid.

**Facts every task relies on:** `task_instances(id, task_name, due_date date, status, building_id, assigned_to, template_item_id)` unique `(building_id, template_item_id, due_date)`; `issues(id, title, deadline date|null, status, building_id, priority)`; `building_documents(id, name, expiry_date date|null, building_id, document_type)`; `building_assets(id, name, next_service_date date|null, building_id, category)`; `ppm_services(id, building_id, service_name, months jsonb {"YYYY-MM": {status,date?}}, report_id)` — a PPM "event" is a month cell with status `due`/`missed` (day = the 1st of that month, or `date` when set); `form_signoff_requests(id, submission_id, assigned_to, due_at timestamptz|null, status, active)` + `form_submissions(id, form_name, building_id)`; `reports(id, building_id, report_period date, status)` (Fortress, via `fdb`). RLS scopes all of them by `can_access_building`. Existing dialogs: `CompleteTaskDialog` (props `taskId, taskName, taskDescription, requiresPhoto, requiresSignature`), `IssueDetailDialog` (needs the full issue row), documents/assets tabs deep-link via `/buildings/:id?tab=documents|assets`, sign-offs via `/my-signoffs`, reports via `/reports/fortress/:id`. `useMyWork` bucketing and `todayInOperatingTz()` in `src/lib/myWork.ts`; `PERSIST_DEFAULTS` in `src/lib/persist.ts`; `ResponsiveDialog`; `useOnlineStatus`; `track()`; route table in `src/App.tsx` (lazy pages + `ProtectedRoute` + `DashboardLayout`); nav arrays in `DashboardLayout.tsx` (`mainNavItems`); Building Details tabs list (`maintenance` tab renders `MaintenanceCalendarTab`, assets only). Edge function pattern for a public endpoint: `signoff-reminders/index.ts` (cors helper, service-role client); `supabase/config.toml` needs `[functions.ics-feed] verify_jwt = false`.

---

### Task 1: Migration — `calendar_tokens` + smoke

**Files:** Create `../GMI/sql/2026-09-13_02_r3_calendar.sql` → vendor; modify `scripts/rls-smoke.mjs`

```sql
-- 2026-09-13_02_r3_calendar.sql — R3b calendar tokens (spec §5.5). Additive, idempotent.
begin;
create table if not exists public.calendar_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  building_id  uuid references public.buildings(id) on delete cascade,      -- null = the user's own feed
  token        text not null unique,                                          -- 43-char base64url of 32 random bytes, minted client-side
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists calendar_tokens_user_idx on public.calendar_tokens (user_id);
alter table public.calendar_tokens enable row level security;
drop policy if exists ct_tokens_select on public.calendar_tokens;
create policy ct_tokens_select on public.calendar_tokens for select using (user_id = auth.uid());
drop policy if exists ct_tokens_insert on public.calendar_tokens;
create policy ct_tokens_insert on public.calendar_tokens for insert
  with check (user_id = auth.uid() and (building_id is null or public.can_access_building(building_id)));
drop policy if exists ct_tokens_update on public.calendar_tokens;
create policy ct_tokens_update on public.calendar_tokens for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists ct_tokens_delete on public.calendar_tokens;
create policy ct_tokens_delete on public.calendar_tokens for delete using (user_id = auth.uid());
-- The feed function resolves a token with the service role and then applies the OWNER's access:
-- this helper answers "can user X see building B" without a session, mirroring can_access_building.
create or replace function public.user_can_access_building(p_user uuid, p_building uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select deactivated from public.profiles where id = p_user), false) = false
     and ( exists (select 1 from public.user_roles r where r.user_id = p_user and r.role in ('admin','manager'))
        or exists (select 1 from public.user_buildings ub where ub.user_id = p_user and ub.building_id = p_building) )
$$;
revoke all on function public.user_can_access_building(uuid, uuid) from public;
revoke execute on function public.user_can_access_building(uuid, uuid) from anon, authenticated;
grant execute on function public.user_can_access_building(uuid, uuid) to service_role;
commit;
```

Smoke (`rls-smoke.mjs`, R1 block): `calendar_tokens` matrix — userA inserts own (`token` random) → true; userA inserts for admin → false; select of userA's row: `{admin:false, manager:false, userA:true, userB:false}`; userA inserts a building token for building B (no access) → false; anon cannot execute `user_can_access_building` (401/403) and neither can authenticated (403). Cleanup rows. Commit GMI + vendored + smoke.

---

### Task 2: Pure event model + ICS renderer

**Files:** Create `src/lib/calendar/events.ts`, `src/lib/calendar/events.test.ts`, `src/lib/calendar/ics.ts`, `src/lib/calendar/ics.test.ts`; copy the two pure modules into `supabase/functions/_shared/calendar.ts` (Deno import via a relative `../../../src/lib/calendar/…` is NOT possible in the edge bundle; keep ONE source of truth by making `_shared/calendar.ts` the canonical file and having `src/lib/calendar/ics.ts` re-export from it via a relative import exactly like `src/lib/notifyRules.test.ts` imports `notifyRules.ts` — i.e. put the pure code in `supabase/functions/_shared/calendar.ts` and `export * from '../../../supabase/functions/_shared/calendar'` from `src/lib/calendar/ics.ts` and `events.ts`; verify vite bundles it (it did for `notifyRules` in R1) and that the file has no Deno-only syntax).

- [x] `events.ts` (canonical in `_shared/calendar.ts`): `CalendarKind = 'task'|'issue'|'document'|'asset'|'ppm'|'signoff'|'report'`; `CalendarEvent { id: string; kind; title; date: string (YYYY-MM-DD); buildingId: string | null; buildingName: string | null; href: string; status: 'open'|'overdue'|'done'|'na'; entityId: string }`; mappers from raw rows: `taskEvent(row, buildingName, today)`, `issueEvent`, `documentEvent` (status overdue when expiry < today), `assetEvent`, `ppmEvents(row, buildingName, today)` (one per `due`/`missed` month cell; day = cell.date ?? `${YYYY-MM}-01`), `signoffEvent(req, submission, buildingName)` (`due_at` → SAST date), `reportEvent`; `sortEvents`, `groupByDate(events)`, `inRange(events, from, to)`, `KIND_LABELS`, `KIND_COLORS` (token classes, not hex). Hrefs: task → `/buildings/${b}?tab=checklists`, issue → `/issues?open=${id}`, document → `…?tab=documents`, asset → `…?tab=assets`, ppm → `/reports/fortress/${report_id}` when present else `…?tab=maintenance`, signoff → `/my-signoffs`, report → `/reports/fortress/${id}`. Tests for every mapper incl. status derivation and PPM month expansion.
- [x] `ics.ts`: `renderIcs(events, opts: { name: string; prodId?: string; tzid?: string }): string` — `BEGIN:VCALENDAR`, `VERSION:2.0`, `PRODID:-//Building Ops//EN`, `X-WR-CALNAME`, `CALSCALE:GREGORIAN`; one `VEVENT` per event with `UID:<kind>-<entityId>@buildingops.app`, `DTSTAMP` (now, UTC `YYYYMMDDTHHMMSSZ`), `DTSTART;VALUE=DATE:YYYYMMDD`, `DTEND;VALUE=DATE:<next day>`, `SUMMARY` (title + " · " + buildingName), `DESCRIPTION` (kind label + status), `URL:<APP_URL><href>`, `STATUS:CONFIRMED`, `CATEGORIES:<KIND>`; RFC 5545 text escaping (`\\`, `;`, `,`, newline → `\n`), line folding at 75 octets with CRLF + space, CRLF line endings. Tests: escaping, folding of a 200-char summary, date maths across month end, deterministic order, empty calendar still valid.

---

### Task 3: `ics-feed` edge function

**Files:** Create `supabase/functions/ics-feed/index.ts`; modify `supabase/config.toml` (`[functions.ics-feed] verify_jwt = false`)

- [x] `GET ?t=<token>`: reject non-GET; token must match `/^[A-Za-z0-9_-]{43}$/` else 404; service-role client; `select id, user_id, building_id, revoked_at from calendar_tokens where token = $t` → 404 when missing or revoked; resolve the scope: building token → verify `user_can_access_building(user_id, building_id)` (404 when false — never reveal existence); user token → building ids = (admin/manager → all buildings; else `user_buildings` for that user); load rows for `[today-90d, today+180d]` from the seven sources for those buildings (`task_instances` where `due_date` between; `issues` deadline; `building_documents` expiry; `building_assets` next_service_date; `ppm_services` for those buildings (expand month cells in range); `form_signoff_requests` for the user token only (`assigned_to = user_id`, active, due_at in range) joined to submissions; `reports` report_period in range); building names from one `buildings` read; map with the shared mappers; `renderIcs(events, { name: building ? `Building Ops · ${buildingName}` : 'Building Ops · My calendar' })`; respond `200` `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: inline; filename="building-ops.ics"`, `Cache-Control: private, max-age=300`; update `last_used_at` (fire-and-forget). Log only counts. No CORS needed (calendar clients fetch server-side), but answer `OPTIONS` with the shared cors helper for browser previews.

---

### Task 4: `useCalendarEvents` + grid components

**Files:** Create `src/hooks/useCalendarEvents.ts` (+ test), `src/components/calendar/CalendarGrid.tsx`, `src/components/calendar/CalendarWeek.tsx`, `src/components/calendar/EventChip.tsx`, `src/components/calendar/SourceFilters.tsx`, `src/components/calendar/CalendarGrid.test.tsx`

- [x] Hook: `useCalendarEvents({ scope: { kind: 'portfolio' } | { kind: 'building'; id }, from, to })` → `{ events, byDate, isLoading, isError, refetch, reschedule(taskId, newDate) }`. Seven queries (`useQueries` or seven `useQuery`s) keyed `['calendar', scopeKey, source, from, to]`; each `...PERSIST_DEFAULTS` for scope building or the user's assigned buildings (portfolio scope for managers is not persisted — too big); building names from one `buildings` select (`id, name`); PPM via `ppm_services` filtered by building ids; sign-offs via `useMySignoffs`-style query (own only). `reschedule` → `supabase.from('task_instances').update({ due_date }).eq('id', taskId).select('id')`, zero rows → permission error, code `23505` → "That task already has an occurrence on that day."; invalidates `['calendar']`, `['my-work']`, `['building-overview']`. Tests: mapping fan-out, `byDate`, reschedule error branches.
- [x] `CalendarGrid` (month): 7 columns, Monday first, day cells with up to 3 `EventChip`s + "+N", today ring, click day → `onSelectDate`; `EventChip` colour by kind, status strike/red for overdue; HTML5 drag for `kind === 'task'` (`draggable`, `onDragStart` sets `text/plain` task id, day cell `onDragOver/onDrop` → `onReschedule(taskId, date)`); keyboard alternative: focusing a task chip and pressing `M` opens a small date input (44 px) — record it as the accessible path. `CalendarWeek`: 7 stacked day sections (phone), same chips as 44 px rows. `SourceFilters`: chips per kind with counts, persisted in localStorage `fortress.calendar.filters.<uid>`. Tests: renders events on the right day, +N overflow, filter toggling, drop calls `onReschedule`.

---

### Task 5: Calendar page + Building tab

**Files:** Create `src/pages/CalendarPage.tsx` (+ test), `src/components/building/BuildingCalendarTab.tsx`; modify `src/App.tsx` (lazy route `/calendar`), `src/components/layout/DashboardLayout.tsx` (nav item "Calendar" after "Checklists", admin/manager + everyone — site roles see their assigned buildings), `src/pages/BuildingDetails.tsx` (the `maintenance` tab becomes "Calendar" rendering `BuildingCalendarTab`; keep the tab value `maintenance` so deep links keep working; delete `MaintenanceCalendarTab.tsx` and its import), `supabase/functions/_shared/notifyRules.ts` + `src/lib/pushUrl.ts` (`/calendar` added to the allowlists, parity test updates)

- [x] `CalendarPage`: header with month/week switch (week default on `< sm`, month on desktop), prev/today/next, building filter (portfolio scope; `useBuildings`), `SourceFilters`, the grid, and a right-side/bottom "selected day" list; tapping an event: task → `CompleteTaskDialog` (needs `requires_photo`/`requires_signature` — the task query selects them), issue → navigate `/issues?open=<id>`, others → `navigate(href)`. `track('calendar_viewed', { scope, view })`, `track('task_rescheduled')`. `BuildingCalendarTab({ buildingId })`: same components with building scope, the old asset summary cards (overdue / due in 30 days) kept above the grid computed from the asset events.
- [x] Tests: page renders with mocked hook; week view at 375 px; a drop triggers `reschedule`; Building tab replaces the old one (BuildingDetails.mobile.test mocks updated).

---

### Task 6: ICS subscription UI

**Files:** Create `src/lib/calendarTokens.ts` (+ test), `src/components/calendar/SubscribeCard.tsx` (+ test); modify `src/pages/Profile.tsx` (a "Calendar subscription" card after the notification card), `src/components/building/BuildingCalendarTab.tsx` (a "Subscribe" button → the same card in a `ResponsiveDialog`, admin/manager only)

- [x] `calendarTokens.ts`: `mintToken()` (32 random bytes via `crypto.getRandomValues` → base64url, 43 chars), `feedUrl(token)` = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ics-feed?t=${token}`, `useCalendarToken(buildingId | null)` → `{ token, url, isLoading, create(), rotate(), revoke() }` (select own row for that scope with `revoked_at is null`; create inserts; rotate = revoke + create; boundary cast comment). `SubscribeCard`: explains in plain text that the link is a secret ("Anyone with this link can read your calendar titles. Rotate it if it leaks."), shows the URL with Copy (44 px), "webcal://" variant for Outlook/Apple, Rotate and Turn off buttons with confirms; coaching line via `<Hint>`: "Paste it into Outlook or Google Calendar as a subscription; it refreshes every few hours." Tests: mint length/charset, url, create/rotate/revoke calls, copy button.

---

### Task 7: My Day "This week" strip

**Files:** Create `src/components/myday/WeekStrip.tsx` (+ test); modify `src/pages/MyDay.tsx`, `src/pages/MyDay.test.tsx`

- [x] Seven day columns (today first, `dd` + weekday), counts of the user's tasks + issue deadlines + sign-offs due that day from `useMyWork` data (tasks in `buckets`, issues `deadline`, signoffs `due_at`) — no new query; each column links to `/calendar?date=YYYY-MM-DD&view=week`; 44 px columns; renders below the greeting, above the sections. `CalendarPage` reads `?date`/`?view`. Test: counts per day with fixed data.

---

### Task 8 (controller): apply, deploy, verify, record

- [x] Staging: apply, `rls-smoke`; deploy `ics-feed`; create a token via a persona and `curl` the feed (200, `BEGIN:VCALENDAR`, event count > 0, revoked → 404, garbage → 404) — add that as `scripts/calendar-smoke.mjs` if time allows (plan §9 lists it); full battery.
- [x] Prod: apply, deploy `ics-feed`, `rls-smoke`; regenerate types; drop casts; whole-slice review; Status; `APPLY_CHECKLIST.md` R3b; push; PR body; memory.

---

## Status (2026-09-10)

**DONE and LIVE on staging and prod.** Commits `b1b9283..5116021` on `feat/reports-access-hardening` (PR #3);
canonical SQL GMI `173bacb`. Gates: typecheck 53 (= baseline, ratcheted from 55), 955 tests, build green; staging
battery + notifications + offline + calendar smokes green; prod `rls-smoke` 475/0. Apply record:
`docs/plans/APPLY_CHECKLIST.md` → R3b.

Task → commit: 1 migration + probes `b1b9283` (+ `bf3e6f1` WebCrypto minting); 2 event model + ICS `723ad8d`
(+ `240ea62` real semicolon escaping, sign-off declined → na); 3 `ics-feed` `39334a3` (+ `240ea62` ordered
sources, −14/+60 task window, truncation marker, no out-of-scope building names; `scripts/calendar-smoke.mjs`);
4 hook + grids `ac4dffc` (+ `623ac29` PPM month filter, week-view Move, filter fixes); 5 page + building tab
`1894886`; 6 subscription UI `42ceb4e` (+ `623ac29` rotate inserts first); 7 week strip `f8ff924`; types regen +
cast `5116021`.

Deviations worth knowing: the pure event model and ICS renderer live in `supabase/functions/_shared/calendar.ts`
and are re-exported under `src/lib/calendar/` (same pattern as `notifyRules`); PPM UIDs carry the month; a
`due` PPM cell in the past reads as overdue; the hook returns `buildingNames`; `CalendarView` is exported from
`src/pages/CalendarPage.tsx` and reused by the building tab (move to `components/calendar/` when convenient);
the building tab runs a second hook call over −365/+30 days for the asset summary cards; `useSourceFilters`
persists hidden kinds per user in localStorage; the `MaintenanceCalendarTab` deletion landed in `240ea62`
(index sweep) rather than `1894886` — history only.

Follow-ups: move `CalendarView` out of the page file; the `act(...).rejects` vacuous-assertion pattern may exist
in other tests (fixed in `calendarTokens.test.ts`); `lead` (R3a) still has no consumer — the calendar could show
"visible from" once it does; Outlook/Google subscription needs a real-world try by the owner.
