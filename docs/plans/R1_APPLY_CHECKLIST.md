# R0 + R1 apply checklist (2026-09-10)

Same shape as `PHASE3_APPLY_CHECKLIST.md`. Migrations are applied through the Supabase
Management API (`POST /v1/projects/{ref}/database/query`), never `db push`. Canonical SQL
lives in `../GMI/sql/` and is mirrored here by `npm run schema:vendor`.

## Migrations, in order

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

## Edge functions (all of `supabase/functions/*`, JWT settings come from `supabase/config.toml`)

clear-password-gate, daily-digest, delete-account, delete-user, invite-user, notify,
notify-expiring-alerts, notify-form-review, notify-form-submission, notify-signoff-complete,
notify-signoff-request, request-password-reset, set-user-role, set-user-status, signoff-reminders.

## Staging (`vkrihpmjajjcxmzgjqdr`) — DONE 2026-09-10

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

## Production (`qdzgkttiosahdfqresvz`) — DONE 2026-09-10

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

## Drift noticed while applying (not changed, worth a decision)

- Prod schedules `expiring-alerts-daily` but not `signoff-reminders-daily`; staging is the reverse.
  Both crons exist in `../GMI/sql/`; whichever is intended should be applied to the other project.
- Staging has no `RESEND_API_KEY` / `APP_URL` / `EXPIRING_ALERTS_SECRET`, so email and the
  expiring-alerts function cannot be exercised there end to end.
