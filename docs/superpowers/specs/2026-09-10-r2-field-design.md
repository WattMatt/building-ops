# R2 "Field" — design

Date: 2026-09-10 · Parent: `2026-09-10-daily-ops-v2-roadmap-design.md` §5 R2 · Status: DRAFT (applies the roadmap and decisions D1–D11 Arno approved on 2026-09-10; R0–R1 are live on staging and prod as of this date)

Headline: **The site walk works in a basement with no signal.**

## 1. What R2 changes, in one paragraph

R1 made the app tell each person what is theirs. R2 makes that usable where the work happens: on a phone, on site, with no signal. The app installs to the home screen, keeps the signed-in user's day readable offline, and lets them complete tasks, log issues, comment and attach photos while offline; the writes replay on reconnect, idempotently. Photos go through one pipeline everywhere, stamped with when (and optionally where) they were taken. Tasks are generated on the server every night so a day is never empty, and overdue becomes a real state instead of a label nothing sets. Push notifications reach the phone for the four things that need a person now. A "+" and a search palette make creating and finding things one tap from anywhere. The ten-tab Building Details page and the four field screens get a mobile-first pass.

## 2. Decisions applied and constraints

- D3 PWA, iOS stays frozen. D7 web push only. D1 person-first: everything offline-capable is scoped to *the signed-in user's* assigned buildings, not the whole portfolio.
- Schema is shared with iOS: additive migrations only, authored in `../GMI/sql/`, vendored with `npm run schema:vendor`, applied staging → smoke → prod through the Management API (see `docs/plans/R1_APPLY_CHECKLIST.md`). iOS ignores unknown columns and never calls the new RPCs.
- RLS remains the boundary. The new RPCs are `security invoker` where a user calls them (RLS applies) and `security definer` only for cron-owned generation, with `set search_path = ''` and explicit grants (`revoke … from anon` — the R1 lesson).
- Timezone stays the org constant `Africa/Johannesburg` (`src/lib/myWork.ts:35`, mirrored in every edge function). `buildings.timezone` exists but is dead; per-building time is an R3 scheduling-engine concern, not R2.
- Guardrail copy never goes through `<Hint>`; coaching copy always does.
- No new vendor beyond the two already decided (PostHog, Sentry). Web push uses the browser's Push API with our own VAPID keys; no third-party push service.

## 3. Three slices, each its own plan

| Slice | Theme | Depends on |
|---|---|---|
| R2a Shell | migration (task generation + overdue crons, `complete_task` RPC, `push_subscriptions`), PWA install + offline read cache, mobile-first pass, quick create, global search palette, one photo pipeline | R1 live (it is) |
| R2b Offline writes | IndexedDB write queue, replay engine, sync pill, offline-capable complete/issue/comment flows, photo blobs in the queue, caption overlay | R2a migration + photo pipeline |
| R2c Push | VAPID keys, `push_subscriptions` UI, push fan-out in `notify` and the daily digest, service-worker push + click handlers, deep links | R2a migration + service worker |

Each slice ends with a spec review, a code-quality review, and a whole-slice review, the same as R1.

## 4. Schema (R2a migration, `GMI/sql/2026-09-12_01_r2_field.sql`)

All statements idempotent, wrapped in `begin/commit`. Nothing here is required by iOS.

### 4.1 Server-side task generation

```sql
create or replace function public.generate_scheduled_tasks(
  p_building uuid default null, p_template uuid default null, p_frequency text default null)
returns integer language plpgsql security definer set search_path = '' as $$
-- For each active checklist template item that applies to a building (same scoping the client
-- uses today in ChecklistsTab.generateTasksForFrequency: building_type match or unscoped),
-- insert the task_instances row for the frequency's current period if it does not exist.
-- Due-date rule is IDENTICAL to src/components/building/ChecklistsTab.tsx:63 getDueDateForFrequency
-- (daily → today; weekly → the Sunday of the current Monday-start week; monthly → first of next
-- month; quarterly → first of next quarter; annually → 1 Jan next year), computed on the
-- Africa/Johannesburg calendar date.
-- Idempotent through `on conflict (building_id, template_item_id, due_date) do nothing`, which
-- is the existing task_instances_generated_uniq index (2026-06-11_02_fix_task_dedup_index.sql).
-- Returns the number of rows inserted. p_building null = every building; p_template null = every
-- active template; p_frequency null = every frequency. The app calls it per building (the
-- building page), per template from Apply Template, and per frequency from the Generate button.
$$;
revoke all on function public.generate_scheduled_tasks(uuid, uuid, text) from public;
revoke execute on function public.generate_scheduled_tasks(uuid, uuid, text) from anon;
grant execute on function public.generate_scheduled_tasks(uuid, uuid, text) to authenticated, service_role;
```

The client "Generate" buttons stay as a manual re-run and call this RPC (`p_building = <id>`); the two copies of the client logic (`ChecklistsTab.tsx:229`, `ApplyTemplateDialog.tsx:119`) are deleted. An `authenticated` caller must pass `can_access_building(p_building)` and `is_admin_or_manager()`; the function raises otherwise (definer functions do not get RLS for free).

Cron: `cron.schedule('task-generation-daily', '0 2 * * *', $$select public.generate_scheduled_tasks()$$)` — 04:00 SAST, after `certificate-renewal-tasks` (04:00 UTC is 06:00 SAST; the two do not overlap in tables they insert distinct rows into, so order is not load-bearing).

### 4.2 Overdue transition

```sql
create or replace function public.mark_overdue_tasks()
returns integer language sql security definer set search_path = '' as $$
  with u as (
    update public.task_instances
       set status = 'overdue'
     where status = 'pending'
       and due_date < (now() at time zone 'Africa/Johannesburg')::date
    returning 1)
  select count(*)::int from u;
$$;
```

Cron: `cron.schedule('task-overdue-sweep', '5 22 * * *', $$select public.mark_overdue_tasks()$$)` — 00:05 SAST. Today nothing ever sets `overdue` except the certificate cron at insert time (`2026-06-11_07_cert_renewal_tasks.sql:37`); every "overdue" KPI in the app (`useDashboardStats.ts:79`, `useMyWork.ts:37`, `useBuildingScore.ts:48`) is therefore under-counting. First run on prod will flip a backlog; the plan includes a count query to run before applying so the number is known.

### 4.3 Atomic, idempotent task completion

```sql
create or replace function public.complete_task(
  p_completion_id uuid, p_task_instance_id uuid, p_notes text default null,
  p_signature_confirmed boolean default false, p_photo_urls jsonb default '[]'::jsonb)
returns table (completion_id uuid, already_completed boolean)
language plpgsql security invoker set search_path = '' as $$
-- 1. insert into task_completions (id, task_instance_id, completed_by = auth.uid(), notes,
--    signature_confirmed, photo_urls) on conflict (task_instance_id) do nothing;
-- 2. if a row was inserted: update task_instances set status='completed', completed_at=now(),
--    completed_by=auth.uid() where id = p_task_instance_id;
-- 3. return (the winning completion id, whether it existed before this call).
-- Replaying the same p_completion_id is a no-op that returns already_completed = true with the
-- original id; a different user completing the same task gets already_completed = true too.
$$;
```

`security invoker` so `tc_insert` / `ti_update` policies apply exactly as they do to the two direct writes today (`CompleteTaskDialog.tsx:110-145`). Grant to `authenticated` only.

### 4.4 Push subscriptions

```sql
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  failed_at   timestamptz
);
-- RLS: owner-only select/insert/update/delete (user_id = auth.uid()); service_role reads all.
-- Index on user_id. Realtime not needed.
```

`failed_at` is stamped by the sender when a push returns 404/410 (subscription gone); rows with `failed_at` set are skipped and pruned by the digest job after 30 days.

### 4.5 Global search

```sql
create or replace function public.search_entities(q text, lim int default 20)
returns table (kind text, id uuid, building_id uuid, title text, subtitle text)
language sql stable security invoker set search_path = '' as $$
  -- union of buildings(name/address), issues(title/description), building_tenants(name/unit),
  -- building_documents(name) filtered with `ilike '%' || q || '%'`, kinds in the order building,
  -- issue, tenant, document, up to `lim` results per kind (so one kind cannot starve the others).
  -- RLS on each table applies because the function is security invoker.
$$;
-- grant execute to authenticated only; revoke from public and anon.
```

### 4.6 Photo geotag preference

`profiles.geotag_photos boolean not null default false`. Off by default (POPIA); read by `PhotoCapture` through the existing profile hook, written from Profile → Preferences.

### 4.7 Notification kinds

`notifications.kind` CHECK (`2026-09-11_01_r1_mine.sql:92`) gains `task_due_today`. It is written only by the daily digest job (server), never by clients, so `CLIENT_KINDS` does not change.

## 5. R2a — Shell

### 5.1 PWA

- `vite-plugin-pwa` (`registerType: 'prompt'`, `injectRegister: null`; we register in `src/main.tsx` through `virtual:pwa-register/react` so the "update available" toast is ours).
- Manifest: name "Building Ops", short name "Ops", `display: standalone`, `start_url: /`, theme and background from the existing brand tokens, icons 192/512 + maskable generated from `public/favicon.svg` into `public/icons/`. `index.html` gains `theme-color` and `viewport-fit=cover`.
- Workbox precaches the built app shell only. **No runtime caching of Supabase REST or storage responses in the service worker**: those carry the user's bearer token and per-user RLS results; a shared SW cache would leak across users on one device. Offline reads come from the query persister (§5.2), which is keyed per user.
- Install prompt: `useInstallPrompt()` captures `beforeinstallprompt`; My Day shows a dismissible "Add to home screen" card (through `<Hint>`, it is coaching) on mobile viewports when not already standalone; iOS Safari gets the "Share → Add to Home Screen" text instead because it has no prompt event.
- Offline banner in `DashboardLayout` driven by `useOnlineStatus()` (`navigator.onLine` + `online`/`offline` events). Guardrail copy, not a Hint.

### 5.2 Offline read cache

- `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister` over `idb-keyval`, `maxAge` 7 days, key `bo-cache-<uid>`; cleared on sign-out and when `uid` changes.
- Only queries that opt in persist: `meta: { persist: true }` on `useMyWork` (tasks, issues, waiting), the issue list for assigned buildings, building header + contacts (`useBuildingMembers`), and the task rows behind My Day. `shouldDehydrateQuery` checks that flag. Everything else stays network-only.
- `queryClient` gets `gcTime: 24h` for persisted queries so a reload offline restores them. `networkMode: 'offlineFirst'` on the persisted queries so cached data renders while offline instead of an error.

### 5.3 Mobile-first pass

- `BuildingDetails.tsx`: the ten-tab `TabsList` becomes a horizontally scrollable segmented control on `< sm` (640 px, the app's phone breakpoint for layout; `useIsMobile` stays at 768 for behaviour) (CSS only, `overflow-x-auto`, snap, active tab scrolled into view on change), with the overview reordered for phone: score, today's tasks, open issues, contacts, then the rest.
- My Day: single column, task rows are 56px tap targets, primary action ("Complete") is a full-width button in a bottom sheet (`Drawer` from vaul, already a dependency via shadcn) rather than a centred dialog on mobile. `CompleteTaskDialog`, `NewIssue`, `IssueDetailDialog` render inside `Drawer` on mobile and `Dialog` on desktop via one `ResponsiveDialog` wrapper.
- `PhotoCapture` drops its two copies of UA sniffing (`photo-capture.tsx:118-132`, `:517-529`) for `useIsMobile()`.
- Review checklist gains "renders at 375px without horizontal scroll" and each touched screen gets a vitest render at a mobile `matchMedia` (override the stub in `src/test/setup.ts:21-33`).

### 5.4 Quick create and global search

- Top bar (`DashboardLayout.tsx:350`) gains a "+" (`QuickCreateMenu`: Issue, Note, Task — Task only for admin/manager; each opens the existing dialog with the building pre-selected from the current route when on `/buildings/:id`) and a search button; `⌘K` / `Ctrl+K` opens the same palette.
- `CommandPalette` on the unused `components/ui/command.tsx`: sections Buildings, Issues, Tenants, Documents, Pages. Sources: buildings from the existing cache; issues/tenants/documents through one RPC `search_entities(q text, limit int)` (`security invoker`, `ilike` over name/title/description, unions the four tables, RLS applies) so the palette never pulls whole tables. Recent selections in localStorage (`fortress.palette.recent.<uid>`, max 8).

### 5.5 One photo pipeline

- `src/lib/photos.ts`: `uploadPhotos(files: PhotoFile[], opts: { prefix: 'photos/<uid>' | 'documents/<building>/annual/<section>' }) => Promise<string[]>`; path `<prefix>/<Date.now()>-<crypto.randomUUID()>.jpg`. Replaces the five inline loops (`NewIssue.tsx:80`, `CompleteTaskDialog.tsx:84`, `ReportIssueDialog.tsx:96`, `FillableFormDialog.tsx:155`, `ConditionInspectionSection.tsx:36`) and absorbs `issuePhotos.ts`. The two sites that used the original filename now use a UUID (closes reporting findings P1–P6's "unpredictable names" thread).
- `ConditionInspectionSection` moves from a raw `<input type=file>` to `PhotoCapture` (gets HEIC + compression + cap). Its `{ref, caption, path}[]` shape is preserved; only the file handling changes.
- Caption overlay: `PhotoCapture`'s compress step draws a bottom strip on the canvas with the capture time (`en-ZA`, Africa/Johannesburg) and, when the user has granted location for the session and `geotag` is enabled in Profile → Preferences (off by default; POPIA), lat/long to 4 decimals. The overlay is drawn *because* canvas re-encoding strips EXIF; it is the only provenance that survives. Text only; no map tiles.

## 6. R2b — Offline writes

### 6.1 Queue

- `src/lib/offline/queue.ts`: IndexedDB store `bo-queue-<uid>` (idb), one record per operation `{ id, kind, payload, blobs: Blob[], createdAt, attempts, lastError }`. Kinds: `task_complete`, `issue_create`, `issue_comment`, `issue_resolve`. Every payload carries a client-generated `id` for the row it will create (`crypto.randomUUID()`), so replay is idempotent at the row level: `issues.id`, `issue_activity.id`, `task_completions.id` are all supplied by the client from R2b onward (the columns already default to `gen_random_uuid()`; supplying a value is additive).
- Photos are stored as blobs in the record and uploaded at replay time to the same paths §5.5 produces; the payload stores the intended storage path so a retry after a partial upload reuses it (storage `upsert: true`).
- `useOfflineQueue()` exposes `enqueue`, `pending`, `failed`, `retry(id)`, `discard(id)`; a `SyncStatusPill` in the top bar shows "Offline · 3 queued", "Syncing…", "All synced", or "2 need attention" (tap opens a sheet listing operations with retry/discard).

### 6.2 Replay

- `replay()` runs on `online`, on app focus, and after enqueue when online. Sequential, oldest first, one operation at a time; a failure with a 4xx other than 409/23505 marks the record failed (needs attention); network errors leave it pending; 409/unique-violation is treated as success (already applied).
- `task_complete` → `rpc('complete_task', …)`; `already_completed = true` shows the existing "someone else completed this" toast on the next My Day render.
- `issue_create` → insert `issues` with client id, then `notify` (`issue_assigned` if an assignee was chosen).
- `issue_comment` / `issue_resolve` → `postIssueComment` with client id, then the two existing `notify` calls.
- The dialogs call the same `enqueue` whether online or not; online, replay follows immediately, so the UI path is one code path with no "are we offline" branching inside forms. Optimistic UI: My Day marks the task done locally (query cache write) and issue lists show the queued issue with a "queued" chip, from a `pendingOverlay` selector that merges queue payloads into the cached query data.

### 6.3 Scope guard

Only the four kinds above are queued. Everything else (reports, forms, sign-offs, admin) stays online-only and shows the offline banner's "not available offline" state on its actions.

## 7. R2c — Push

- VAPID key pair generated once (`npx web-push generate-vapid-keys`); public key in `VITE_VAPID_PUBLIC_KEY`, private key + subject (`mailto:`) as function secrets `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` on both projects (owner action, like the digest secret).
- Profile gains a "Push notifications on this device" switch: subscribes through the service worker (`pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`) and upserts `push_subscriptions` on `endpoint`; off deletes the row and unsubscribes. Denied permission shows the browser-settings guidance.
- `supabase/functions/_shared/push.ts`: `sendPush(recipientIds, { title, body, url, tag })` — loads subscriptions (service role), signs with `npm:web-push`, stamps `failed_at` on 404/410. Pure kind→push decision lives in `notifyRules.ts` (`PUSH_KINDS = task_assigned, issue_mention, signoff_requested`), gated by the same preference flags the inbox uses, plus `task_due_today` sent by `daily-digest` to users who have tasks due today, `task_reminders` on, and at least one live subscription (one push per user with the count, deep link `/my-day`).
- Service worker (`src/sw.ts`, injectManifest mode): `push` shows the notification (`tag` = entity id so repeats collapse), `notificationclick` focuses an existing client and navigates to `url`, else opens it. `url` is validated with the same `isAllowedUrl` prefixes; `ALLOWED_URL_PREFIXES` gains `/my-day` (an R1 follow-up).
- Push is fire-and-forget after the inbox row is written, exactly like email: an inbox row is the source of truth, push is a hint.

## 8. Testing

- Unit (vitest): `generateScheduledTasks` due-date rule mirrored as a pure TS function with the SQL kept in lockstep by a fixture table (both read `docs/fixtures/frequency-due-dates.json`); queue reducer (`enqueue/replay/fail/retry`) against `fake-indexeddb`; `pendingOverlay` merge; `useInstallPrompt` + `useOnlineStatus` with event simulation; `CommandPalette` keyboard flow; `ResponsiveDialog` picks Drawer at 375px; caption overlay formatter (text, not pixels); `PUSH_KINDS` × preference matrix in `notifyRules.test.ts`; `search_entities` query shape.
- Smokes (live): `rls-smoke` gains `push_subscriptions` owner-only matrix and `complete_task`/`generate_scheduled_tasks`/`search_entities` executability by role (anon must get 401/403); `checklist-smoke` gains replaying the same `complete_task` twice (second returns `already_completed`), a foreign user completing an already-completed task, and `mark_overdue_tasks` flipping a back-dated pending task; new `offline-smoke.mjs` drives the queue module under Node with `fake-indexeddb` against staging: enqueue three ops offline (stubbed fetch), go online, assert rows with the client ids exist once after two replays.
- Push cannot be smoke-tested end to end without a browser; `push.ts` is tested through its pure decision function and a stubbed `web-push` transport.

## 9. Risks and mitigations

- **Shared SW cache leaking data across users.** Mitigated by design: the SW caches static assets only; data lives in per-user IDB stores cleared on sign-out.
- **Replay conflicts.** `task_completions` UNIQUE on `task_instance_id` plus the RPC's `already_completed` flag; client ids make every insert idempotent. Two people completing the same task offline resolves to one completion and one polite toast.
- **Overdue backlog on first sweep.** Count first, tell the owner, run once manually on prod inside the apply window; the KPI jump is real and expected.
- **Generation parity with the client rule.** The fixture table pins both implementations; the plan deletes the client generators so there is one rule.
- **`npm:web-push` under Deno.** Verified in the R2c plan's first task by deploying a one-line probe to staging; if it fails, fall back to the Web Crypto VAPID JWT (about 60 lines) — spec allows either.
- **iOS PWA push** requires iOS 16.4+ and an installed PWA; the Profile switch explains this rather than failing silently.
- **Geotag is personal data.** Off by default, per-user opt-in on Profile, overlay only (never stored as separate columns), stated in the hint copy.

## 10. Owner actions this release needs

Apply the R2a migration staging → prod (cron jobs `task-generation-daily`, `task-overdue-sweep`), run the overdue count first, generate VAPID keys and set `VITE_VAPID_PUBLIC_KEY` (Vercel env) + `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (function secrets), redeploy `notify` and `daily-digest`, regenerate `types.ts` after the migration, add `fake-indexeddb` and the PWA/persist packages, and confirm the two `building_type` values on prod so template scoping generates the right tasks.
