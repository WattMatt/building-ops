# Apply checklist (R0 onward)

One section per release slice, newest last. Same shape as `PHASE3_APPLY_CHECKLIST.md`.

## R0 + R1 (2026-09-10)

Same shape as `PHASE3_APPLY_CHECKLIST.md`. Migrations are applied through the Supabase
Management API (`POST /v1/projects/{ref}/database/query`), never `db push`. Canonical SQL
lives in `../GMI/sql/` and is mirrored here by `npm run schema:vendor`.

### Migrations, in order

1. `2026-09-10_01_profiles_show_hints.sql`
2. `2026-09-10_02_report_artifacts_report_status.sql`
3. `2026-09-11_01_r1_mine.sql` — `task_instances.assigned_to`, `issue_activity.mentions`,
   `stamp_issue_resolved_at`, `building_members(uuid)` RPC, `notifications` + RLS + realtime.
   Includes the explicit `revoke execute … from anon` (Supabase default privileges grant
   EXECUTE to `anon` directly, so `revoke … from public` alone leaves the RPC callable anonymously).
4. `2026-09-11_02_daily_digest_cron.sql` — substitute `<PROJECT_REF>` and `<DAILY_DIGEST_SECRET>`
   (the value set with `supabase secrets set DAILY_DIGEST_SECRET=…`) before applying.
5. `2026-09-11_03_deactivated_rls_gate.sql` — `is_active_user()`; `is_admin`, `is_admin_or_manager`
   and `can_access_building` return false for a deactivated profile, so a deactivated user's
   still-valid access token loses all data at once instead of at token expiry.

### Edge functions (all of `supabase/functions/*`, JWT settings come from `supabase/config.toml`)

clear-password-gate, daily-digest, delete-account, delete-user, invite-user, notify,
notify-expiring-alerts, notify-form-review, notify-form-submission, notify-signoff-complete,
notify-signoff-request, request-password-reset, set-user-role, set-user-status, signoff-reminders.

### Staging (`vkrihpmjajjcxmzgjqdr`) — DONE 2026-09-10

- [x] Migrations 1–5 applied (all HTTP 201), `DAILY_DIGEST_SECRET` set, cron `daily-digest` scheduled `30 4 * * *`.
- [x] All 15 functions deployed (staging previously lacked `clear-password-gate`, `delete-user`,
      `request-password-reset`, `set-user-status`, `notify`, `daily-digest`, `set-user-role`,
      `invite-user`, `notify-expiring-alerts`, `notify-form-*`).
- [x] `npm run smoke` green end to end (auth, recovery, RLS matrix 417/0, checklist, issue, documents,
      H&S, forms, dashboard, admin-ops 21/0, sign-off, fortress, fortress-pdf) and
      `npm run smoke:notifications` 20/0.
- [x] GitHub secrets `SMOKE_SUPABASE_*` now point at staging (CI RLS job).

Fixes the live run forced, all committed with this checklist:

- `building_members` was executable by `anon` → migration 3 now revokes it explicitly.
- `rls-smoke` still expected any authenticated user to read `contractor-docs/`; reads have been
  admin/manager-only since `2026-08-04_07_storage_read_scoping.sql` → expectation updated.
- `admin-ops-smoke` still asserted the pre-2026-08-05 deactivation contract (assignments wiped,
  re-assign on reactivate). Since `e5978b6` deactivation keeps assignments and revokes sessions →
  smoke updated to that contract, and migration 5 closes the token-until-expiry gap it exposed.
- `fortress-smoke` depended on pre-seeded users/buildings that only ever existed on an older
  staging → now self-provisions and cleans up like every other smoke, and reads the standard
  `SUPABASE_*` env names.
- `fortress-pdf-smoke` hard-coded a production project ref and a path on another machine →
  follows `SUPABASE_URL` (override `FORTRESS_PDF_REF`) and resolves fixtures from `../GMI/fortress`
  (override `FORTRESS_DIR`).

Staging still lacks `RESEND_API_KEY`, `APP_URL` and `EXPIRING_ALERTS_SECRET` (prod has them):
email sending and the expiring-alerts cron are inert there. The smokes opt personas out of email.

### Production (`qdzgkttiosahdfqresvz`) — DONE 2026-09-10

- [x] Migrations 1–5 applied in order through the Management API (all HTTP 201). Verified:
      `show_hints`, `report_status`, `assigned_to`, `notifications` (+ realtime publication) present,
      `building_members` grants = authenticated/postgres/service_role, three helpers gate on `is_active_user`.
- [x] `DAILY_DIGEST_SECRET` set; cron `daily-digest` scheduled `30 4 * * *` (alongside
      `certificate-renewal-tasks` and `expiring-alerts-daily`).
- [x] All 15 functions deployed (`notify`, `daily-digest`, `set-user-role` were new to prod).
- [x] `node scripts/rls-smoke.mjs` against prod: 417 passed, 0 failed, 2 skipped, teardown clean.
      `notifications-smoke` deliberately not run on prod (`SMOKE_ALLOW_PROD=1` guard).
- [x] Types regenerated from prod; the temporary `as never` / `as any` casts in `useBuildingMembers`,
      `useNotifications`, `useMyWork`, `issueActivity`, `IssueDetailDialog` and `ChecklistsTab` dropped
      (typecheck stays at the 64 baseline, 391 tests, build green).
- [ ] `building_type` on the two production buildings (owner decides which type).

### Drift noticed while applying (not changed, worth a decision)

- Prod schedules `expiring-alerts-daily` but not `signoff-reminders-daily`; staging is the reverse.
  Both crons exist in `../GMI/sql/`; whichever is intended should be applied to the other project.
- Staging has no `RESEND_API_KEY` / `APP_URL` / `EXPIRING_ALERTS_SECRET`, so email and the
  expiring-alerts function cannot be exercised there end to end.

## R2a "Shell" (2026-09-10)

Spec `docs/superpowers/specs/2026-09-10-r2-field-design.md` §4–§5; plan `docs/superpowers/plans/2026-09-10-r2a-shell.md`.

### Migration

`2026-09-12_01_r2_field.sql` — `scheduled_due_date`, `generate_scheduled_tasks(p_building, p_template, p_frequency)`,
`mark_overdue_tasks`, `complete_task`, `search_entities` (per-kind limits), `push_subscriptions` + RLS,
`profiles.geotag_photos`, `notifications.kind` gains `task_due_today`, crons `task-generation-daily`
(`0 2 * * *` = 04:00 SAST) and `task-overdue-sweep` (`5 22 * * *` = 00:05 SAST). Idempotent; re-applied on
staging and prod after the per-kind-limit and building-required revisions (GMI `c1873b2`). No edge-function
changes in R2a (push lands in R2c).

### Staging — DONE 2026-09-10

- [x] Applied (HTTP 201 twice); functions, crons and the weekly fixture row verified; staging backlog 0.
- [x] `npm run smoke` green end to end (RLS 432/0 incl. the new RPC/`push_subscriptions` probes, checklist 16/0
      incl. `complete_task` replay and the overdue sweep), `npm run smoke:notifications` 20/0.

### Production — DONE 2026-09-10

- [x] Backlog counted before apply: **101 of 123 pending tasks were already past due**. The first
      `task-overdue-sweep` (00:05 SAST) marks them `overdue`; dashboard/building KPIs will jump accordingly.
      Nothing was flipped manually.
- [x] Applied (HTTP 201, re-applied after the tightening); functions, crons, table, column and grants verified;
      `rls-smoke` on prod 433/0, teardown clean.
- [x] Types regenerated from prod; boundary casts dropped.
- [ ] `building_type` on production buildings that lack it — `generate_scheduled_tasks` only creates tasks from
      type-scoped templates for classified buildings (unscoped templates apply everywhere). Owner decision.

### Notes for R2b/R2c

- Storage: `upsert: true` on an EXISTING object needs the update policy, which is admin/manager-only. The offline
  queue must retry onto a fresh path (or tolerate a duplicate), not overwrite.
- Push needs VAPID keys: `VITE_VAPID_PUBLIC_KEY` (Vercel env) and `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (function
  secrets) on both projects, then redeploy `notify` and `daily-digest` (R2c).

## R2b "Offline writes" (2026-09-10)

Spec `docs/superpowers/specs/2026-09-10-r2-field-design.md` §6; plan `docs/superpowers/plans/2026-09-10-r2b-offline-writes.md`.

### Migration

None new. `2026-09-12_01_r2_field.sql` was revised once more (`complete_task` now raises `42501` and rolls the
completion back when the task update is not permitted; GMI `aec6759`) and re-applied to staging and prod
(HTTP 201 each).

### Staging — DONE 2026-09-10

- [x] `npm run smoke:offline` 21/21 (three ops queued offline with a photo, replayed twice → each row exactly
      once by client id, one storage object, one notification; RLS rejection lands as a failed op).
- [x] `npm run smoke` and `npm run smoke:notifications` green end to end afterwards.

### Production — DONE 2026-09-10

- [x] Revised `complete_task` applied and verified; nothing else to apply. The client change ships with the
      next deploy of the branch.
- [ ] `notify` edge function must stay deployed on both projects (the comment replay calls it).

## R2c "Push" (2026-09-10)

Spec `docs/superpowers/specs/2026-09-10-r2-field-design.md` §7; plan `docs/superpowers/plans/2026-09-10-r2c-push.md`.

### Keys and env — DONE 2026-09-10

- [x] One VAPID pair generated (`web-push generate-vapid-keys`, kept only in a 0600 scratch file during the session);
      `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:notifications@buildingops.app` set as function
      secrets on staging and prod.
- [x] `VITE_VAPID_PUBLIC_KEY` on Vercel: production and preview (`feat/reports-access-hardening`). Other preview
      branches need it added when they exist (the switch hides itself without it).

### Functions — DONE on staging and prod 2026-09-10

`notify`, `daily-digest`, `notify-signoff-request`, `notify-signoff-complete`, `notify-form-review`,
`notify-form-submission`, `signoff-reminders`, `notify-expiring-alerts` (all import the shared sender, which now
fans out push). `npm:web-push@3.6.7` resolves under the edge runtime (first `npm:` specifier in the repo). A malformed
VAPID secret disables push and logs, it no longer breaks the senders.

- [x] Staging: `smoke:notifications` 26/0 (inbox path unaffected by an invalid subscription, `pushed` reported),
      sign-off 8/0, forms 7/0; manual `daily-digest` call returns `pushConsidered/pushed/pushFailed`.
- [x] Prod: functions deployed; `rls-smoke` 435/0. No migration (schema landed in R2a).

### Notes

- Rotating the VAPID keys makes every existing subscription fail with 401/403 (counted, never stamped); users must
  toggle push off and on again.
- Push cannot be smoke-tested end to end without a browser; the first real device is the owner's phone: Profile →
  "Push notifications on this device", then assign yourself a task from another account.

## R3a "Schedule" (2026-09-10)

Spec `docs/superpowers/specs/2026-09-10-r3-plan-design.md` §5.1–§5.4, §6; plan `docs/superpowers/plans/2026-09-10-r3a-schedule.md`.

### Migration

`2026-09-13_01_r3_schedule.sql` (GMI `baff1ad`) — `checklist_templates.recurrence/archived_at/updated_at/version` + validator
`recurrence_is_valid` + trigger deriving the legacy `frequency`; `recurrence_occurrences`; `building_role_assignments`
+ RLS; `generate_scheduled_tasks(p_building, p_template, p_frequency, p_horizon_days)` (old 3-arg signature dropped;
per-unit caps 14/90/365; `assigned_to` from the building's role rule); `reschedule_template`; reviewer role removed from
the `user_roles` check and `building_members` precedence (guarded: raises if any reviewer row exists); cron
`task-generation-daily` now `generate_scheduled_tasks(null, null, null, 90)`. Idempotent; applied three times on staging
as the validator was tightened.

### Staging — DONE 2026-09-10

- [x] The one `reviewer` account (`qa-reviewer@zztest.local`, a QA persona) was moved to `user`, then applied (201).
- [x] Fixture rows verified through `recurrence_occurrences`; empty/non-array `weekdays` rejected.
- [x] `EXPIRING_ALERTS_SECRET` set on staging (was missing); `notify-expiring-alerts` deployed.
- [x] Full battery green: RLS 463/0, checklist 34/0 (horizon, assignment, reschedule, version bump), notifications 34/0
      (incl. `document_expiring` inbox rows, idempotent), offline 21/0, rest unchanged.

### Production — DONE 2026-09-10

- [x] 0 reviewer rows; applied (201); PostgREST reloaded; five functions present, one `generate_scheduled_tasks`
      overload, cron string verified, `user_roles_role_check` = admin/manager/user; `rls-smoke` 463/0.
- [x] `notify-expiring-alerts` deployed (prod already had `EXPIRING_ALERTS_SECRET`).
- [x] Types regenerated; boundary casts dropped.

### Notes

- Legacy templates (`recurrence null`) keep generating one occurrence per period; the 90-day horizon only applies once a
  template is saved through the new dialog (which writes a rule). Dailies are capped at 14 days ahead.
- Rotating a template's rule replaces only untouched future occurrences (pending, no completion, assigned per the rule).
- CI runs on Node 22 now and stubs the Supabase env for tests; the branch's CI is green.

## R3b "Calendar" (2026-09-10)

Spec `docs/superpowers/specs/2026-09-10-r3-plan-design.md` §5.5, §7; plan `docs/superpowers/plans/2026-09-10-r3b-calendar.md`.

### Migration and function

`2026-09-13_02_r3_calendar.sql` (GMI `173bacb`) — `calendar_tokens` (owner-only RLS, building tokens need
`can_access_building`) and `user_can_access_building(p_user, p_building)` (definer, service_role-only) used by the
feed to evaluate the token OWNER's access. Edge function `ics-feed` (`verify_jwt = false`, token in the query
string, identical 404 for missing/revoked/out-of-scope/garbage, `Cache-Control: private`).

### Staging — DONE 2026-09-10

- [x] Applied (201); `ics-feed` deployed; live probe: valid token 200 `text/calendar`, garbage 404, revoked 404,
      `last_used_at` stamped.
- [x] `npm run smoke:calendar` 19/0 (user and building tokens, no cross-building leakage, 404 paths); full battery,
      notifications 34/0, offline 21/0 green.

### Production — DONE 2026-09-10

- [x] Applied (201), PostgREST reloaded, `ics-feed` deployed; `rls-smoke` 475/0. Types regenerated; cast dropped.

### Notes

- A feed link is a bearer secret: rotate from Profile → Calendar subscription (inserts the new token before revoking
  the old). Task events in the feed cover −14/+60 days (pending/overdue only); the rest −90/+180. A truncated task
  source adds a single "Calendar truncated" marker event.
- The Building Details "Maintenance" tab is now "Calendar" (same `?tab=maintenance` deep link).

## R3c "Contractors, PPM, Costs" (2026-09-10)

Spec `docs/superpowers/specs/2026-09-10-r3-plan-design.md` §8; plan `docs/superpowers/plans/2026-09-10-r3c-contractors-ppm-costs.md`.

### Migrations (apply in order; all idempotent)

- `2026-09-13_03_r3_contractors_ppm.sql` (GMI `41afd3b`) — `building_ppm_services` (plan per building, RLS: read
  with building access, write admin/manager), `task_instances.source_ppm_id` (+ partial unique index),
  `generate_ppm_tasks(p_building, p_horizon_days)` + cron `ppm-generation-daily 10 2 * * *` (04:10 SAST, 365 days),
  `ppm_monthly_status` view (derived grid), `ppm_services.plan_service_id/overrides`, contractors
  address/vat_number/default_trade_role, `contractor_documents.notes`, `contractor_ratings` + average trigger,
  `building_month_costs` view, one-shot seed of plan lines from the 698 `ppm_services` rows (all linked by name).
- `2026-09-13_04_ppm_cadence_fix.sql` (GMI `c44fc13`) — re-derives cadences the seed could not read: older rows'
  frequency strings (Trimonthly, Montlhy, Bi-Monthly, 6-monthly, annually…) and report grids with repeated
  evidence (≥ 10/12 months → monthly; ≥ 3 cells with every gap a multiple of 3 or 6 → every 3/6; same month in ≥ 2 years → yearly).
  Single-cell evidence is NOT inferred. Self-heals an earlier looser run (step 0). Re-runnable.
- `2026-09-13_05_r3c_review_fixes.sql` (GMI `c98f0b2`) — review fixes: `cr_insert` requires the issue's own
  contractor and `status = 'resolved'`; `cr_delete` admin only; FKs `issues.contractor_id` and
  `asset_service_history.contractor_id` → contractors (orphans nulled first); SAST month buckets in both views and
  resolved-only issue costs; `updated_at` touch trigger on plan lines; PPM tasks no longer copy plan notes into the
  description; `reschedule_ppm_line(uuid)` + trigger on `is_active`/`recurrence` change (deletes untouched future
  pending occurrences, regenerates when active); `ppm_services.overrides` writable by admin/manager only (42501).

### Staging — DONE 2026-09-10

- [x] `_03` applied (201); `_04` applied twice (loose, then tightened; second run idempotent); `_05` applied twice.
- [x] Plan lines after the seed + fix: 145 active / 519 inactive (272 blank cadence, 247 single report month,
      10 two-month evidence, and Weekly/Adhoc/N-A strings) — each inactive line carries a "Migrated 2026-09-13: …"
      note saying why.
- [x] `smoke:ppm` 33/0 (generation dates, idempotency, inactive line, assigned_to from the contractor role rule,
      missed cell, reschedule/deactivate/reactivate, ratings, cost view, invoker scoping); `rls-smoke` 518/0.

### Production — DONE 2026-09-10

- [x] `_03`, `_04`, `_05` applied (201 each), PostgREST reloaded; plan lines 145 active / 519 inactive (same
      distribution as staging); 0 unlinked `ppm_services` rows; crons `ppm-generation-daily`,
      `task-generation-daily`, `task-overdue-sweep` active. `rls-smoke` 518/0. Types regenerated from prod.

### Owner items

- Review the 519 inactive plan lines per building (Building → PPM tab): set the rule and switch each line on. The
  note on each line says what the migration saw. Active lines start generating occurrences at the next 04:10 run.
- Rating a contractor is offered on resolve when the issue has a contractor; one rating per issue, admin can delete.

## R4a "Snapshots & SLA" (2026-09-10)

Spec `docs/superpowers/specs/2026-09-10-r4-insight-design.md` §5.1–5.6; plan `docs/superpowers/plans/2026-09-10-r4a-snapshots-sla.md`.

### Migration

- `2026-09-14_01_r4_snapshots_sla.sql` (GMI `bfc5f2c`) — idempotent, one transaction, re-appliable (staging received the first
  version `0122069` and then the amended file). Contains the 90-day backfill (`reconstructed = true`); ran in 1.3 s on both
  projects, so the chunked fallback in the plan was not needed.

### Staging — DONE 2026-09-10

- [x] Applied (201) twice (amended file re-applied), PostgREST reloaded; 4277 snapshot rows over 91 days (4230 reconstructed);
      crons `metrics-snapshot-daily 0 3 * * *` and `sla-breach-sweep */15 * * * *` active.
- [x] `notify-expiring-alerts` and `daily-digest` deployed.
- [x] `smoke:snapshot` 44/0 (`snapshot_building_metrics(today, null)` 208 ms for 49 buildings); `rls-smoke` 560/0 (3 skipped:
      the two-role probe — `user_roles` is keyed by `user_id`); `notifications-smoke` 48/0 (expiry milestones, SLA sweep).

### Production — DONE 2026-09-10

- [x] Applied (201), PostgREST reloaded; 4277 rows / 91 days / 4230 reconstructed; both crons active; `organizations.settings`
      is `{}` (defaults apply); every building has `report_types = {ops_monthly,cm_monthly}`.
- [x] `notify-expiring-alerts` and `daily-digest` deployed; the pg_cron jobs that POST to them (`expiring-alerts-daily`,
      `daily-digest`) were already present from R1/R2 — see the cron list recorded below.
- [x] `rls-smoke` 560/0 (3 skipped). Types regenerated from prod; interim casts dropped (close-out commit).
- [ ] Next morning check: `select max(day), bool_or(reconstructed) from building_metrics_daily where day = current_date` →
      today, false.

### Owner items

- Settings → Operations: set SLA hours per priority (defaults 4/24/72/168 h) and the report due day (default 7). New issues
  only; existing issues carry no SLA.
- Reports → coverage grid: per building, untick a report type that does not apply (default OPS + CM; annual is opt-in).
- Feature flags `share_links`, `report_schedules`, `tenant_intake` stay off until R4b/R4c land.
- Archive or delete superseded expired documents: an expired document stays in the alert email and resurfaces in the inbox
  every seventh day.

## R4b "Distribute & Share" (2026-09-11)

Spec `docs/superpowers/specs/2026-09-10-r4-insight-design.md` §5.7–5.9; plan `docs/superpowers/plans/2026-09-10-r4b-distribute-share.md`.

### Migration

- `2026-09-14_02_r4_distribute.sql` (GMI `99bf1b4`) — additive, idempotent, one transaction plus a cron block.
  `report_schedules`, `report_shares` (column-privileged SELECT: `passcode_hash`, `failed_attempts` and
  `locked_until` revoked, with a generated `has_passcode` granted in their place), `report_distributions` plus the
  `sent_once` partial unique index, kinds `report_due_soon` and `report_export_needed`, and an index for the
  reminder dedupe. The `<PROJECT_REF>` and `<REPORT_DISTRIBUTION_SECRET>` placeholders are substituted at apply
  time and never committed.

### Staging — DONE 2026-09-11

- [x] Applied twice (idempotent), PostgREST reloaded; `report-distribution` and `report-share` deployed.
- [x] Secrets `REPORT_DISTRIBUTION_SECRET` and `SHARE_SALT` set.
- [x] `rls-smoke` 737/0; `smoke:distribution` 73/0; `smoke:intake` 31/0; all teardowns clean, no fixtures left.

### Production — DONE 2026-09-11

- [x] Applied, PostgREST reloaded, cron registered with the placeholders substituted.
- [x] `report-distribution` and `report-share` deployed; both answer 404 to an unknown token.
- [x] Secrets set. `rls-smoke` 737/0. `organizations.settings` is `{}`, so every flag is OFF.
- [ ] The morning after the first send day, check `cron.job_run_details` for `report-distribution-daily`.

### Ships live on this deploy, NOT behind a flag

- Approving a report now renders and stores the final unwatermarked PDF automatically. A failure is non-fatal: the
  approval still stands and the toast says to use Export PDF.
- Evidence packs on issues, completed tasks and assets, for any signed-in viewer who can already see the subject,
  and CSV export on twelve grids, registers and lists.

### Owner items

- **Flag `share_links`.** Turning it on reveals Share in the report editor and makes the public link route live. A
  share link is a bearer credential: anyone holding the URL opens the PDF with no sign-in. Set a passcode for
  external recipients. Revocation is one-way and stops every new open, though a PDF opened in the previous ten
  minutes stays open until its signed URL expires. Switching the flag off is a kill switch, not a hide: every
  existing link answers 404.
- **Flag `report_schedules`.** Turning it on reveals the distribution screen AND arms the 07:00 SAST cron. Nothing
  sends until a schedule exists, so build the schedules first, then press Preview run on every one before leaving
  it active. A preview sends nothing and writes nothing. An active schedule sends for real on its send day with no
  further confirmation.
- Confirm the mail provider key is set on the project before switching `report_schedules` on. See the plan's
  follow-ups: a run with no provider currently records the send as successful and cannot be repeated.
- **Flag `tenant_intake`** belongs to R4c.

## R4c "Intake & Forms" (2026-09-11)

Spec `docs/superpowers/specs/2026-09-10-r4-insight-design.md` §5.10–5.11; plan `docs/superpowers/plans/2026-09-10-r4c-intake-forms.md`.

### Migration

- `2026-09-14_03_r4_intake_forms.sql` (GMI `7a1bdda`) — additive, idempotent, one transaction. `intake_tokens`;
  `intake_rate` plus `intake_rate_hit` and `intake_touch` (service-role only, both `anon` and `authenticated`
  revoked); `issues.source`, `reporter` and `reference` with the `issues_intake_guard` trigger and a partial unique
  index on the reference; `form_templates` seeded with the fourteen templates whose ids `form_submissions` already
  holds, plus the version-bump trigger; `form_submissions.template_version` and `fields_snapshot`; a read policy for
  the intake storage prefix and no insert policy, since only the service role writes there; and the notification
  kind check restated as the union of every R4 kind plus `issue_reported`.

### Staging — DONE 2026-09-11

- [x] Applied twice (idempotent), PostgREST reloaded; fourteen templates seeded and active.
- [x] `tenant-intake` deployed and answering 404 to an unknown token; `INTAKE_IP_SALT` set.
- [x] `rls-smoke` 737/0; `smoke:intake` 31/0; teardown clean, no fixtures left.

### Production — DONE 2026-09-11

- [x] Applied, PostgREST reloaded; fourteen templates seeded and active.
- [x] `tenant-intake` deployed and answering 404 to an unknown token; `INTAKE_IP_SALT` set.
- [x] `rls-smoke` 737/0. `organizations.settings` is `{}`, so `tenant_intake` is OFF and the endpoint 404s for every
      token until the owner switches it on.
- [ ] After the first real report: confirm the assignee got the push and that the photo opens from the issue.

### Owner items

- **Flag `tenant_intake`.** Turning it on makes the public intake route live for every building that has an active
  token, and reveals the intake card on Building → Tenants. With it off the endpoint answers 404 to every token, so
  the flag is a kill switch, not a hide.
- **Mint the tokens and print the sheets first.** Nothing is exposed until a building has a link. The link inside
  the QR code is a bearer credential: anyone holding it can file a report in that building, and it is meant to be
  displayed in public, so treat it as posted rather than secret. Rotating stops every printed code, so reprint the
  same day. Disabling stops that building's intake entirely.
- **Decide per centre whether the shop list may carry names.** The endpoint behind the token lists that building's
  shop numbers so a tenant can identify themselves; names are opt-in.
- **Triage.** A report arrives as an issue with a Tenant chip, the reporter's details and a reference the tenant was
  told to quote. It is assigned to the building's issue-rule holder, so set those assignments before switching the
  flag on or reports land unassigned. Every admin and manager is notified; only the assignee is pushed. There is no
  de-duplication, so ten tenants reporting one broken light create ten issues.
- **Rate limits are deliberate and visible to tenants**: a per-building hourly cap and a smaller per-device cap. A
  centre on shared wi-fi will reach the device cap sooner than expected.
- **Settings → Forms (admin).** The fourteen forms are rows now, not code: deactivate one to hide it, edit its
  fields, reorder it. Editing bumps the version, and submissions already filled keep their own field list and print
  unchanged. There is no "create new template" yet.

## Field readiness (S1–S5), 2026-09-12

Spec `docs/superpowers/specs/2026-09-12-field-readiness-design.md` §4–§8; plans
`docs/superpowers/plans/2026-09-12-s1-team-coverage.md` (Task 8), `…-s2-photo-hardening.md` (Task 9),
`…-s3-report-integrity.md` (Task 7), `…-s4-nudges.md` (Task 5), `…-s5-new-issue-mobile.md` (Task 6).
Branch `feat/field-readiness`.

Four migrations, all additive, idempotent, one transaction each; apply through the Management API
(`POST /v1/projects/{ref}/database/query`, never `db push`), staging `vkrihpmjajjcxmzgjqdr` first, then prod
`qdzgkttiosahdfqresvz`. `xuqxnpipetruujcuuflq` is the near-empty Building Ops clone (`supabase/config.toml` line 1,
`scripts/schema-parity-check.mjs`) and is NOT a target. Order: all migrations, then `notify pgrst, 'reload schema'`,
then the edge functions, then the smokes, then (prod only) types. S5 has no migration and no function: it ships with
the Vercel deploy of the branch.

### 1. `2026-09-15_01_team_coverage.sql` (S1 "Team & coverage")

`user_buildings` writes move from `ub_insert_admin` / `ub_update_admin` / `ub_delete_admin` to one `ub_write_managed`
(`for all`: admin, or manager with `can_access_building`; `ub_select` untouched); `assignable_people()` (SECURITY
DEFINER, `is_admin_or_manager()` only, raises `42501` otherwise); `portfolio_coverage()` (SECURITY INVOKER, one row
per building, `completed_yesterday` counts `completed` OR `issue_logged`). Both functions `set search_path = ''`,
granted to `authenticated` + `service_role`, revoked from `anon`.

Verification (run after apply, as service role; same expected results on both projects):

```sql
select count(*) from pg_policies where tablename = 'user_buildings';                                   -- 2
select policyname, cmd from pg_policies where tablename = 'user_buildings' order by 1;                 -- ub_select SELECT, ub_write_managed ALL
select proname, prosecdef from pg_proc where pronamespace = 'public'::regnamespace
   and proname in ('assignable_people','portfolio_coverage') order by 1;                               -- assignable_people t, portfolio_coverage f
select has_function_privilege('anon', 'public.assignable_people()', 'execute'),
       has_function_privilege('anon', 'public.portfolio_coverage()', 'execute');                       -- false, false
select count(*) from public.portfolio_coverage();                                                      -- = select count(*) from public.buildings
select building_name from public.portfolio_coverage() where field_members = 0 order by 1;             -- the "No team" list (most buildings on day one)
```

#### Staging (`vkrihpmjajjcxmzgjqdr`)

- [ ] Applied (HTTP 201), applied a second time (idempotent, 201), `notify pgrst, 'reload schema'`.
- [ ] The six verification queries above return the expected results; record the `field_members = 0` count.
- [ ] `node scripts/rls-smoke.mjs` — previous count + 11 passes, 0 failures (manager `user_buildings` insert now allowed,
      user self-grant still denied, S1 block green), teardown clean. Run AFTER the functions below are deployed.
- [ ] `npm run smoke:notifications` green.

#### Production (`qdzgkttiosahdfqresvz`)

- [ ] Applied (201), applied a second time (201), `notify pgrst, 'reload schema'`.
- [ ] The six verification queries return the expected results; record the `field_members = 0` count (expected to be
      most buildings: production had 0 `user`-role accounts at R3a).
- [ ] `node scripts/rls-smoke.mjs` against prod, 0 failures, teardown clean (after the functions below are deployed).

### 2. `2026-09-15_02_inspection_photo_append.sql` (S2 "Photo pipeline hardening")

`append_inspection_photo(p_inspection, p_template_item, p_path, p_caption, p_section_no)` — SECURITY INVOKER (the
existing `ir_write` policy decides), upserts the `(inspection, template item)` response row and appends
`{ref, caption, path}` to `photo_urls` in one statement under the `ON CONFLICT` row lock, so two rapid adds no longer
orphan the first upload; `ir_photo_urls_array` check (`jsonb_typeof = 'array'`) added `NOT VALID`. Granted to
`authenticated` + `service_role`, revoked from `anon`. No policy change.

Verification (both projects):

```sql
select proname, prosecdef, proconfig from pg_proc
 where pronamespace = 'public'::regnamespace and proname = 'append_inspection_photo';                  -- 1 row; prosecdef = false; proconfig = {search_path=}
select has_function_privilege('anon', 'public.append_inspection_photo(uuid,uuid,text,text,text)', 'execute');          -- false
select has_function_privilege('authenticated', 'public.append_inspection_photo(uuid,uuid,text,text,text)', 'execute'); -- true
select conname, convalidated from pg_constraint
 where conrelid = 'public.inspection_responses'::regclass and conname = 'ir_photo_urls_array';         -- 1 row, convalidated = false
select count(*) from public.inspection_responses where jsonb_typeof(photo_urls) <> 'array';            -- 0 (legacy rows the NOT VALID skipped)
select proname from pg_proc where pronamespace = 'public'::regnamespace
   and proname in ('assignable_people','portfolio_coverage','append_inspection_photo') order by 1;    -- 3 rows (S1 + S2 both applied)
```

#### Staging (`vkrihpmjajjcxmzgjqdr`)

- [ ] Applied (201), applied a second time (201), `notify pgrst, 'reload schema'`.
- [ ] The six verification queries return the expected results. If `jsonb_typeof(photo_urls) <> 'array'` is not 0,
      list those rows before going further — the append treats them as empty and renumbers from `.1`.
- [ ] `node scripts/rls-smoke.mjs` — the S2 block: anon refused, user without access `42501`, admin/manager two appends
      → refs `.1` and `.2` on ONE row; `RLS MATRIX HOLDS`, teardown clean.
- [ ] `npx vite-node scripts/fortress-pdf-smoke.ts` → `OK wrote …/abaqulusi_annual_TEST.pdf`; open it and confirm the
      condition-inspection photo grid renders. If the AbaQulusi annual report is absent on staging the script fails on
      `insp` being undefined — run it once with `FORTRESS_PDF_REF=qdzgkttiosahdfqresvz` instead (read-only; it embeds
      on-disk fixtures, never storage).

#### Production (`qdzgkttiosahdfqresvz`)

- [ ] Applied (201), applied a second time (201), `notify pgrst, 'reload schema'`.
- [ ] The six verification queries return the expected results; record the non-array count.
- [ ] `node scripts/rls-smoke.mjs` against prod: `… S2 photo append …: done`, `RLS MATRIX HOLDS`, teardown clean.
- [ ] `npx vite-node scripts/fortress-pdf-smoke.ts` against prod (read-only) renders the annual PDF with its photo grid.

### 3. `2026-09-15_03_inspection_provenance.sql` (S3 "Report data integrity")

`building_inspections.inspected_by` defaults to `auth.uid()`, `inspection_date` to today in SAST;
`compliance_assessments.assessed_by` defaults to `auth.uid()`; three backfill updates attribute existing rows to the
report's author and creation day (seeded reports with no author keep a null person). The three OHS score views
(`compliance_scores`, `compliance_section_scores`, `compliance_critical_scores`) are re-created with
`and r.response is not null` so a comment-only item is neither a pass nor a fail, and each restates
`with (security_invoker = on)` (a replace resets storage options — the 2026-06-19_02 / A-01 lesson). Columns, order,
grants and the Yarona `ohs_stated_pct` override are unchanged. No new tables, functions, policies or grants.

Verification (both projects; record the `rows_with_author` counts):

```sql
select column_name, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'building_inspections'
   and column_name in ('inspected_by', 'inspection_date') order by 1;
  -- inspected_by | auth.uid()
  -- inspection_date | ((now() AT TIME ZONE 'Africa/Johannesburg'::text))::date   (PG17; older prints (timezone('Africa/Johannesburg'::text, now()))::date)
select column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'compliance_assessments' and column_name = 'assessed_by';   -- auth.uid()
select count(*) filter (where bi.inspected_by is null)    as no_inspector,
       count(*) filter (where bi.inspection_date is null) as no_date,
       count(*)                                           as rows_with_author
  from public.building_inspections bi join public.reports r on r.id = bi.report_id
 where r.author_id is not null;                                                                        -- 0 | 0 | n
select count(*) filter (where bi.inspection_date is null) as no_date_any
  from public.building_inspections bi where bi.report_id is not null;                                  -- 0
select count(*) filter (where ca.assessed_by is null) as no_assessor, count(*) as rows_with_author
  from public.compliance_assessments ca join public.reports r on r.id = ca.report_id
 where r.author_id is not null;                                                                        -- 0 | n
select reloptions from pg_class where relname = 'compliance_scores';                                   -- {security_invoker=on}
select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('compliance_scores','compliance_section_scores','compliance_critical_scores')
 order by 1;                                                                                           -- each {security_invoker=on}
select pg_get_viewdef('public.compliance_scores'::regclass) ~* 'response is not null';                 -- true
select pg_get_viewdef('public.compliance_section_scores'::regclass) ~* 'response is not null';         -- true
select pg_get_viewdef('public.compliance_critical_scores'::regclass) ~* 'response is not null';        -- true
```

#### Staging (`vkrihpmjajjcxmzgjqdr`)

- [ ] Applied (201), applied a second time (the three updates report `UPDATE 0`), `notify pgrst, 'reload schema'`.
- [ ] The verification queries return the expected results; `rows_with_author` inspections <n>, assessments <n> recorded.
- [ ] `node scripts/rls-smoke.mjs` — the R4c count (737/0) unchanged (S3 adds no policies), teardown clean.
- [ ] `node scripts/fortress-smoke.mjs` green; before its teardown,
      `select assessed_by is not null from public.compliance_assessments order by created_at desc limit 1` → true
      (the manager's assessment carries `assessed_by`).
- [ ] `npx vite-node scripts/fortress-pdf-smoke.ts` renders; the condition-inspection section prints the provenance line.

#### Production (`qdzgkttiosahdfqresvz`)

- [ ] Applied (201), applied a second time (`UPDATE 0` ×3), `notify pgrst, 'reload schema'`.
- [ ] Same verification results; `rows_with_author` inspections <n>, assessments <n> recorded (the survey said reports 5 /
      assessments 2 / inspections 4 at `2026-08-04_09`; they have grown since).
- [ ] `node scripts/rls-smoke.mjs` against prod 737/0 (or the S1+S2 count once those blocks are in), teardown clean.
- [ ] `npx vite-node scripts/fortress-pdf-smoke.ts` against prod (read-only) renders.

### 4. `2026-09-15_04_overdue_notify.sql` (S4 "Nudges")

`notifications_kind_check` restated with `task_overdue` appended (the first nineteen kinds copied verbatim from
`2026-09-14_03`); `mark_overdue_tasks()` rewritten in plpgsql with the same name, integer return and service-role-only
grants, so the `task-overdue-sweep` cron line (`5 22 * * *`) is untouched. Each task it flips `pending → overdue` now
writes one inbox row to its assignee (kind `task_overdue`, entity task, url `/my-day`, no actor; deactivated profiles
skipped; unassigned tasks flip silently). No email, no push: `task_overdue` is `DIGEST_ONLY` in
`_shared/notifyRules.ts`. Requires `2026-09-12_01` and `2026-09-14_03` (already on both projects).

Pre-apply count (PROD ONLY, before applying — the first sweep after apply notifies the assignee of every task it flips):

```sql
select jobname, active from cron.job where jobname = 'task-overdue-sweep';                             -- one row, active
select count(*) from public.task_instances
 where status = 'pending' and assigned_to is not null
   and due_date < (now() at time zone 'Africa/Johannesburg')::date;                                    -- expect 0 (or today's few)
```

If the cron is missing or the count is large, STOP and tell the owner how many people would be written to.

Verification (both projects, as service role):

```sql
select pg_get_constraintdef(oid) ~ 'task_overdue' from pg_constraint where conname = 'notifications_kind_check';  -- true
select pg_get_functiondef('public.mark_overdue_tasks()'::regprocedure) ~ 'plpgsql';                   -- true
select prolang::regtype is not null, prosecdef from pg_proc
 where pronamespace = 'public'::regnamespace and proname = 'mark_overdue_tasks';                       -- 1 row, prosecdef = true
select has_function_privilege('anon', 'public.mark_overdue_tasks()', 'execute'),
       has_function_privilege('authenticated', 'public.mark_overdue_tasks()', 'execute'),
       has_function_privilege('service_role', 'public.mark_overdue_tasks()', 'execute');               -- false, false, true
select jobname, schedule, command from cron.job where jobname = 'task-overdue-sweep';                  -- 5 22 * * *, select public.mark_overdue_tasks()
```

#### Staging (`vkrihpmjajjcxmzgjqdr`)

- [ ] Applied (201), applied a second time (201), `notify pgrst, 'reload schema'`.
- [ ] The five verification queries return the expected results.
- [ ] Ten functions redeployed (list below) — bundle parity for `_shared/notifyRules.ts`; `daily-digest` and `notify`
      logs show a clean boot.
- [ ] `node scripts/checklist-smoke.mjs` — the sweep runs on staging; the five S4 sweep lines PASS (one `task_overdue`
      row for the assignee, none for the unassigned task, none added by a second sweep).
- [ ] `node scripts/rls-smoke.mjs` 0 failures; `npm run smoke:notifications` green.

#### Production (`qdzgkttiosahdfqresvz`)

- [ ] Pre-apply count run and recorded: `task-overdue-sweep` active; <n> pending, assigned, past-due tasks.
- [ ] Applied (201), applied a second time (201), `notify pgrst, 'reload schema'`; the five verification queries pass.
- [ ] Same ten functions redeployed.
- [ ] `node scripts/rls-smoke.mjs` against prod, 0 failures. Do NOT set `SMOKE_ALLOW_PROD` — `checklist-smoke` SKIPs the
      sweep on prod by design.
- [ ] Morning after (sweep runs 22:05 UTC = 00:05 SAST):
      `select count(*) from public.notifications where kind = 'task_overdue' and created_at > now() - interval '1 day';`
      → <n>; spot-check one row's `url = '/my-day'` and that only its recipient can read it.

### Edge functions (after all four migrations are applied on that project)

`_shared/notifyRules.ts` changed and Deno bundles it into every function that imports it: `notify` directly, and
through `_shared/notify.ts` (which also pulls `_shared/push.ts`) the other nine. `_shared/calendar.ts` mentions
`notifyRules` only in a comment, so `ics-feed` does not need a redeploy. `invite-user` changed in source (S1: 400 for
`role: "user"` with no building); `daily-digest` changed in source (S1: coverage section) AND is in the parity set.
Eleven deploys per project, staging first:

```bash
for fn in invite-user daily-digest notify notify-expiring-alerts notify-form-review notify-form-submission \
          notify-signoff-complete notify-signoff-request signoff-reminders report-distribution tenant-intake; do
  supabase functions deploy "$fn" --project-ref vkrihpmjajjcxmzgjqdr   # staging
done
# then the same loop with --project-ref qdzgkttiosahdfqresvz          # prod
```

`invite-user` check (as the admin persona; run on each project after its deploy):

```bash
curl -s -o /dev/stderr -w '%{http_code}\n' -X POST "https://<ref>.supabase.co/functions/v1/invite-user" \
  -H "Authorization: Bearer <admin access token>" -H "apikey: <anon key>" -H "Content-Type: application/json" \
  -d '{"email":"zztest-nob@buildingops.app","role":"user","buildingIds":[]}'
# expect 400 and {"error":"Field staff need at least one building"}; nothing is created
```

#### Staging (`vkrihpmjajjcxmzgjqdr`)

- [ ] All eleven functions deployed (JWT settings from `supabase/config.toml`).
- [ ] `invite-user` curl → 400 `Field staff need at least one building`.
- [ ] `daily-digest` triggered once with the secret header: response counts returned and an admin's email carries a
      `Coverage` heading (or none — then `select * from public.portfolio_coverage()` shows no gaps).

#### Production (`qdzgkttiosahdfqresvz`)

- [ ] All eleven functions deployed.
- [ ] `invite-user` curl → 400 `Field staff need at least one building`.
- [ ] `daily-digest` and `notify` logs show a clean boot after deploy; the next 04:30 SAST digest carries the
      `Coverage` section for admins/managers.

### Types (after the prod applies; `fortress-types.ts` is generated from staging by its own header recipe — keep it)

```bash
supabase gen types typescript --project-id qdzgkttiosahdfqresvz > src/integrations/supabase/types.ts
supabase gen types typescript --project-id vkrihpmjajjcxmzgjqdr \
  | sed '/^type DatabaseWithoutInternals = Omit<Database/,$d' | sed 's/export type Database/export type FortressDatabase/' > src/integrations/supabase/fortress-types.ts
```

- [ ] Both files regenerated. S3's column defaults and S4's `kind` (text) produce no TS diff; the expected diff is the
      three new RPCs in `Functions`. Any other diff is drift from another slice — commit it under that slice's name.
- [ ] Boundary casts dropped — each site replaces the cast with a plain `supabase.rpc('<name>')` call and deletes the
      comment (`grep -rn "is not yet in the generated types" src` must print nothing afterwards):
  - [ ] `src/hooks/useAssignablePeople.ts:35` — `assignable_people`
  - [ ] `src/hooks/usePortfolioCoverage.ts:45` — `portfolio_coverage`
  - [ ] `src/components/reports/fortress/sections/ConditionInspectionSection.tsx:60` — `append_inspection_photo`
        (also the two `as never` casts; keep `data as unknown as InspectionResponse` only if the generator emits
        `Returns` as `Json` or a composite record rather than the `inspection_responses` Row — say which in the commit).
- [ ] `npm run test -- src/hooks/useAssignablePeople.test.ts src/hooks/usePortfolioCoverage.test.ts` PASS;
      `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'` ≤ 46 (ratchet `.github/typecheck-baseline.txt`
      down if it fell); `npm run test` green; `npm run build` green.
- [ ] Committed with an explicit pathspec: `types.ts`, `fortress-types.ts`, the three cast sites,
      `.github/typecheck-baseline.txt` if ratcheted.

### Owner items

- [ ] **`completed_yesterday` counts `issue_logged` as done — decision recorded.** `portfolio_coverage()` counts a
      daily task as done when its status is `completed` OR `issue_logged`: a caretaker who logged an issue instead of
      ticking the task was present. The digest's "Nothing was logged yesterday at …" line and the coverage widget
      follow this. Confirm (or say otherwise before the S1 apply; it is one predicate in the migration).
- [ ] **Register `signoff-reminders-daily` on prod** (S4; the drift recorded under R1 still stands). Apply
      `../GMI/sql/2026-06-14_03_signoff_cron.sql` to prod with `<PROJECT_REF>` = `qdzgkttiosahdfqresvz` and
      `<SIGNOFF_REMINDERS_SECRET>` = the value already set as the `signoff-reminders` function secret on prod
      (`supabase secrets list --project-ref qdzgkttiosahdfqresvz` shows the name, not the value — take it from the
      owner's record). Verify `select jobname, schedule from cron.job where jobname = 'signoff-reminders-daily';`
      → one row, `0 7 * * *`; next morning the function log shows a 200 from the cron call. Until then sign-off
      reminders, escalation and expiry do not run on prod.
- [ ] **Existing SVG / WebP organisation logos are omitted from PDFs until replaced** (S2). pdfmake embeds PNG and JPEG
      only; the logo path now rejects anything else and prints the organisation name instead (a DEV warning, no
      broken PDF). Settings no longer offers SVG. Re-upload each org logo as PNG or JPEG:
      `select id, name, logo_url from public.organizations where logo_url ~* '\.(svg|webp)($|\?)';` lists the ones to replace.
- [ ] **The first S4 sweep notifies only that night's newly-overdue tasks.** The sweep already runs nightly on prod, so
      every back-dated task is already `overdue` and will not flip again; nobody receives a backlog. Field users see
      "Overdue: <task>" in the inbox the morning after a task lapses, opening My Day; managers see overdue and silent
      buildings in the digest coverage section, not per task.
- [ ] **Every building will show "No team" until someone is added** (S1). There were no `user`-role accounts in
      production at R3a. Invite field staff (a building is now required) and use Building → Team to add them and set
      the daily-task default; managers can do this now, not only admins. Removing a person unassigns their open tasks
      and says how many first.
- [ ] **S5 device check** (no migration, no function; the Vercel deploy of the branch is the release). On a phone or
      DevTools at iPhone SE, 375 × 667, signed in as a site user with two buildings:
  - [ ] `/my-day`: the round "Report issue" FAB sits bottom-right above the home-indicator area, the last row scrolls
        clear of it, no horizontal scroll bar; the FAB is gone at ≥ 768 px.
  - [ ] `/issues/new` at 375 px: building pre-selected (last used after one submit), photo control directly under it
        with the hint line, every control ≥ 44 px, `document.documentElement.scrollWidth === 375`.
  - [ ] `/issues/new` keyboard vs bar: focus the title, then description, with the on-screen keyboard up — the
        "Cancel / Report Issue" bar stays pinned at the bottom with the safe-area padding, does not cover the focused
        field, and the last field scrolls clear of the bar.
  - [ ] Draft: type a title, add a photo, reload → fields and preview restored with the "Draft restored" bar; Discard
        empties the form and a further reload starts empty. Hints off → the photo hint disappears, the bar does not.
  - [ ] Second user on the same browser → New Issue starts empty (draft cleared with the queue).
  - [ ] iOS standalone (added to Home Screen, Safari): FAB, pinned bar and safe-area padding hold in standalone mode
        with no browser chrome; the install card on My Day says push follows the install.
