# R1 "Mine" — design

Date: 2026-09-10 · Parent: `2026-09-10-daily-ops-v2-roadmap-design.md` §5 R1 · Status: DRAFT (Arno approved the roadmap and decisions D1–D11 on 2026-09-10; this spec applies them)

Headline: **Open the app and it tells you what is yours today.**

## 1. What R1 changes, in one paragraph

Today nothing in Building Ops is addressed to a person. R1 gives tasks and issues a human owner, gives every user an inbox that fills when something becomes theirs, lets people talk on an issue, and gives field roles a landing page that lists their day. Managers get a "waiting on you" list. Every email sender starts honouring the notification preferences that already exist on the profile.

## 2. Decisions applied

- D1 person-first. D2 landing: `user` and `reviewer` land on My Day (2026-09-10, R3a: the reviewer role was removed; see the R3 spec §5.3); `admin` and `manager` keep the dashboard, which gains a My Day link. D7 web only, email + in-app in R1 (push is R2). D8 analytics: instrumentation scaffold ships in R1c, env-gated; vendor keys are an owner action.
- Schema is shared with iOS: every change is additive, authored in `../GMI/sql/`, vendored, applied staging-first by the owner. iOS ignores unknown columns.
- RLS remains the boundary. New tables get policies in the same migration. Anything that must read other users' profiles goes through a SECURITY DEFINER function, because `profiles` is self-or-manager readable only (`2026-06-10_02_rls_redesign.sql:184`).

## 3. Three slices, each its own plan

R1 is delivered as three independently shippable slices. Each produces working software and ends with a review.

| Slice | Theme | Depends on |
|---|---|---|
| R1a Assign & talk | migrations, assignee pickers, task assignment, issue comments + mentions, closing note on resolve, tel/mailto | R0 migrations applied |
| R1b Inbox & senders | `notify` helper + edge function, inbox UI, badges, realtime, retrofit of existing senders to write inbox rows and honour preferences, preferences consolidated on Profile, daily digest cron | R1a migrations |
| R1c My Day | `useMyWork`, My Day page, role landing, Waiting-on-you widget, activity feed, analytics scaffold | R1a (assignment), R1b (unread count) |

## 4. Schema (R1a migration, `GMI/sql/2026-09-1x_01_r1_mine.sql`)

All statements idempotent, wrapped in `begin/commit`.

```sql
-- Tasks get a human owner. responsible_role stays as the default-assignment input.
alter table public.task_instances add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
create index if not exists task_instances_assigned_to_due_idx on public.task_instances (assigned_to, due_date) where status in ('pending','overdue');

-- Mentions on a comment (issue_activity already carries comment + photo_urls).
alter table public.issue_activity add column if not exists mentions uuid[] not null default '{}';

-- resolved_at is set by the database, not the client, so cycle time is trustworthy.
create or replace function public.stamp_issue_resolved_at() returns trigger language plpgsql as $$
begin
  if new.status = 'resolved' and (old.status is distinct from 'resolved') then new.resolved_at := now(); end if;
  if new.status <> 'resolved' then new.resolved_at := null; end if;
  return new;
end $$;
drop trigger if exists trg_issue_resolved_at on public.issues;
create trigger trg_issue_resolved_at before update of status on public.issues for each row execute function public.stamp_issue_resolved_at();

-- Who can be assigned or mentioned on a building: admins/managers plus explicitly assigned users.
-- SECURITY DEFINER because profiles are not readable across users; returns only display fields.
create or replace function public.building_members(b uuid)
returns table (id uuid, full_name text, avatar_url text, role text)
language sql security definer set search_path = public stable as $$
  select p.id, p.full_name, p.avatar_url, r.role
  from public.profiles p
  join public.user_roles r on r.user_id = p.id
  where coalesce(p.deactivated, false) = false
    and public.can_access_building(b)            -- caller must be a member themselves
    and (r.role in ('admin','manager') or exists (select 1 from public.user_buildings ub where ub.user_id = p.id and ub.building_id = b))
  order by p.full_name;
$$;
revoke all on function public.building_members(uuid) from public;
grant execute on function public.building_members(uuid) to authenticated;

-- The inbox.
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  actor_id      uuid references public.profiles(id) on delete set null,
  actor_name    text,
  kind          text not null check (kind in (
                  'task_assigned','issue_assigned','issue_comment','issue_mention',
                  'report_submitted','report_returned','report_approved',
                  'form_submitted','form_reviewed','signoff_requested','signoff_complete','signoff_overdue',
                  'document_expiring','asset_service_due')),
  entity_type   text not null,        -- 'task' | 'issue' | 'report' | 'form_submission' | 'signoff_request' | 'document' | 'asset'
  entity_id     uuid,
  building_id   uuid references public.buildings(id) on delete cascade,
  title         text not null,
  body          text,
  url           text not null,        -- in-app path the row deep-links to
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists notifications_recipient_unread_idx on public.notifications (recipient_id, created_at desc) where read_at is null;
create index if not exists notifications_recipient_created_idx on public.notifications (recipient_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists n_select_own on public.notifications;
create policy n_select_own on public.notifications for select using (recipient_id = auth.uid());
drop policy if exists n_update_own on public.notifications;
create policy n_update_own on public.notifications for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
-- No client insert policy: rows are written by the notify edge function (service role).
alter publication supabase_realtime add table public.notifications;  -- guarded: only if not already a member
```

Nothing is dropped. `responsible_role`, the five profile preference booleans, and `issue_activity.activity_type` values are unchanged.

## 5. R1a — Assign & talk

**Assignee picker.** One component `AssigneePicker({ buildingId, value, onChange, allowUnassigned })` backed by `useBuildingMembers(buildingId)` → `supabase.rpc('building_members', { b })`. Used by the issue detail dialog (replacing the unfiltered profiles read at `IssueDetailDialog.tsx:94`), by the task assign control, and later by the mention picker.

**Task assignment.** In the building Checklists tab: a person column on each task row (avatar + name, or "Unassigned"), an Assign control per row (admin/manager, or the assignee themselves to hand off), and bulk assign for the selected frequency's pending tasks. Writes `task_instances.assigned_to` with a zero-row check. Task generation (`ChecklistsTab.tsx:281`) leaves `assigned_to` null in R1a; default-assignment rules are R3.

**Issue comments.** `IssueDetailDialog` gains a composer under the history: textarea, optional photos via the existing `PhotoCapture` pipeline (uploaded to the same private prefix as issue photos), post button. Inserts `issue_activity { activity_type: 'comment', comment, photo_urls, mentions, user_id, author_name }` (author name from the caller's own profile). History renders comment photos as signed thumbnails and shows mentioned names. Realtime is not required for R1a; the list refetches after post.

**Mentions.** Typing `@` in the composer opens the member list (from `useBuildingMembers`); choosing one inserts `@Name` into the text and records the id in `mentions`. Rendering resolves `mentions` to names via the same list.

**Resolve with a closing note.** Changing status to `resolved` opens a small dialog requiring a note (and offering a photo). The note is written as a comment row first, then the status update; if the status update fails, the comment stays (it is true) and the error is shown. `resolved_at` is stamped by the trigger.

**Contacts.** `BuildingDetails` contact cards render phone as `tel:` and email as `mailto:` links.

**Out of scope for R1a:** notifications (rows are created in R1b; R1a leaves a single `notifyStub` seam that R1b replaces), My Day.

## 6. R1b — Inbox & senders

**One sender.** `supabase/functions/_shared/notify.ts` exports `createNotifications(admin, { recipients: string[], kind, entityType, entityId, buildingId, title, body, url, actor })`: inserts one `notifications` row per recipient (service role), then for each recipient reads the five profile flags and emails via Resend when `email_notifications` is true and the kind's governing flag is true (table below). Returns `{ inserted, emailed }`. Also exports `sendEmail(to, subject, html)` so the five existing senders stop re-declaring it.

| Kind | Governing flag | Email? |
|---|---|---|
| task_assigned | task_reminders | yes |
| issue_assigned, issue_comment, issue_mention | issue_updates | yes |
| report_submitted (to managers), report_returned, report_approved (to author) | issue_updates (R1; a `report_updates` flag is R3) | yes |
| form_submitted, form_reviewed, signoff_* | existing senders keep their recipients; now also insert inbox rows and skip email when `email_notifications` is false | yes |
| document_expiring, asset_service_due | overdue_alerts (already read by notify-expiring-alerts) | digest only |

**New edge function `notify`** (`verify_jwt = true`): body `{ kind, entityType, entityId, buildingId, recipients, title, body, url }`; verifies the caller, requires `can_access_building(buildingId)` for the caller (via a service-role `rpc('can_access_building')` check or a direct `user_buildings`/role read), filters recipients to building members, calls `createNotifications`. The client helper `notify(input)` wraps `supabase.functions.invoke('notify')` and is fire-and-forget with a DEV warn.

**Where the client calls it (R1a seams):** task assigned → assignee; issue assigned → assignee; comment → issue assignee + reporter (minus author); mention → mentioned users; report submitted → admins/managers of the org (recipient list resolved server-side when `recipients` is omitted and kind is `report_submitted`); report returned/approved → author.

**Retrofit.** `notify-form-submission`, `notify-form-review`, `notify-signoff-request`, `notify-signoff-complete`, `signoff-reminders`, `notify-expiring-alerts` call `createNotifications` (inbox row + preference-aware email) instead of their local `sendEmail`.

**Inbox UI.** Header bell with unread count (`useNotifications`: query + realtime subscription on `notifications` filtered by `recipient_id=eq.<uid>`); popover with the 10 newest, "Mark all read", link to `/inbox` (full list, paged 50, unread filter). Clicking a row marks it read and navigates to `url`. Nav badges: Issues (unread issue_*), My Sign-offs (unread signoff_*), Building Reports (unread report_*). `NavItem` gains `badge?: () => number`.

**Preferences.** Profile keeps the five toggles with clearer labels ("Email me when…"); the Settings notifications tab is removed (finding: duplicate, admin/manager-only). A sixth toggle is not added.

**Daily digest.** Edge function `daily-digest` (cron secret header, `verify_jwt = false`), pg_cron `30 4 * * *` UTC (06:30 SAST). For each active profile with `daily_digest = true`: overdue + due-today tasks assigned to them, their open issues, unread notification count; no email when all are empty. One branded email via `renderEmail`.

## 7. R1c — My Day

**Data.** `useMyWork()` returns `{ tasks: { overdue, today, upcoming7 }, issues, signoffs, returnedReports, unread }` from: `task_instances` where `assigned_to = me` and status in pending/overdue; `issues` where `assigned_to = me` and status not resolved; `useMySignoffs`; `reports` where `author_id = me` and status = rejected; unread count from `useNotifications`. Building names hydrated in one query.

**Page.** `/my-day`: greeting, four sections in that order, each row actionable inline (Complete → `CompleteTaskDialog`; issue → `IssueDetailDialog`; sign → existing sign flow; report → editor). Empty state per section, a single overall "Nothing waiting on you" state, honest error state with retry. Mobile-first layout (single column, large tap targets), since this is the page site staff open on a phone.

**Landing.** `App.tsx` `/` renders `RoleHome`: `user`/`reviewer` → `MyDay`; `admin`/`manager` → `Dashboard`. Sidebar gets "My Day" for all roles (first item). Conformance A1 closes.

**Waiting on you (admin/manager).** Dashboard widget: submitted building reports (count + 5 newest, link to editor), overdue sign-off requests, plus the existing pending-submissions widget beside it. Closes reporting finding R2.

**Activity feed.** Dashboard card "Last 7 days": `issue_activity` rows for buildings the user can access (RLS already scopes), newest 30, grouped by day, each linking to the issue.

**Analytics scaffold.** `src/lib/analytics.ts` with `track(event, props)` and `identify(userId, role)`; no-op unless `VITE_POSTHOG_KEY` is set; events: `my_day_viewed`, `task_completed`, `issue_commented`, `notification_opened`, `report_exported`. Sentry likewise behind `VITE_SENTRY_DSN`. Owner supplies keys.

## 8. Testing

- Migrations: `scripts/rls-smoke.mjs` gains assertions: a `user` can read only their own notifications and cannot insert; `building_members` returns members for a building the caller can access and errors/empty otherwise; `assigned_to` update by a non-member is denied.
- Unit: `AssigneePicker`, comment composer parsing (`@` detection, mention ids), `useMyWork` bucketing (overdue/today/upcoming) with a fixed clock, `createNotifications` preference matrix (Deno test or extracted pure function), digest composition (pure), `RoleHome` branching, nav badge counts.
- Smoke: `notifications-smoke.mjs` — assign a task via service role, call `notify`, assert row + read/unread transitions.

## 9. Risks and mitigations

- **Profiles RLS.** Every cross-user name goes through `building_members` or the denormalised `actor_name`/`author_name`. Never widen `p_select`.
- **Notification fatigue.** Comments notify only assignee + reporter; mentions are explicit; digest is opt-in via the existing flag.
- **iOS double-logging.** Comments are client-written on both platforms already; no new overlap.
- **Realtime volume.** One channel per user filtered on `recipient_id`; the publication addition is a one-liner but must be applied.

## 10. Owner actions this release needs

Apply the R1a migration (staging → prod), deploy `notify`, `daily-digest`, and the six retrofitted functions, set the digest cron secret, regenerate `types.ts` after each migration, and supply PostHog/Sentry keys when ready.
