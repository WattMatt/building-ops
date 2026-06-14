# Phase 3 (Forms Sign-off) — Owner Apply Checklist

All Phase 3 **code** is written + committed on branch `feat/web-ops-phase3` (NOT merged to `main`, so it can't deploy before the backend exists). gates: tsc 0, 45 vitest tests, build green. Whole-branch code review: approved-with-fixes (C1/I2/I3/I4/I5 applied; see "Known v1 limitations" below).

Apply **staging-first**; do prod only after a green staging smoke.

## Staging (`vkrihpmjajjcxmzgjqdr`)

1. **Migrations** (Management API, in order):
   - `GMI/sql/2026-06-14_01_form_signoff.sql` — tables, state-machine triggers, RLS
   - `GMI/sql/2026-06-14_02_signoff_storage.sql` — `signatures/` storage policies
2. **Secret:** set `SIGNOFF_REMINDERS_SECRET` (a long random string) as a Supabase secret.
3. **Edge functions** (`supabase functions deploy <name> --project-ref vkrihpmjajjcxmzgjqdr`):
   - `notify-signoff-request`, `notify-signoff-complete` (verify_jwt=true), `signoff-reminders` (verify_jwt=false, secret-guarded)
4. **Cron:** fill the `<PROJECT_REF>` + `<SIGNOFF_REMINDERS_SECRET>` placeholders in `GMI/sql/2026-06-14_03_signoff_cron.sql`, ensure `pg_cron`+`pg_net` are enabled, then apply.
5. **Regenerate types:** `npx supabase gen types typescript --project-id vkrihpmjajjcxmzgjqdr > src/integrations/supabase/types.ts` — should match the hand-added types; commit if it differs.
6. **Smoke:** `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... node scripts/signoff-smoke.mjs` → expect `SIGN-OFF JOURNEY HOLDS`. (Or `npm run smoke` for the full chain.)
7. **Manual QA** (staging/preview): assign 2 signers (sequential + parallel), sign drawn (touch) + typed (desktop), see progress update + completion email; let a due request lapse to see the reminder/escalation.

## Production (`qdzgkttiosahdfqresvz`) — only after staging is green + your sign-off

8. Repeat 1–4 on prod (set the prod secret, deploy with `--project-ref qdzgkttiosahdfqresvz`, fill the cron placeholders with the prod ref).
9. Regenerate types from prod; commit.
10. Merge `feat/web-ops-phase3` → `main` and push (Vercel auto-deploys buildingops.app). The sign-off UI then goes live with the schema in place.

## Known v1 limitations (from code review — safe to ship, worth a follow-up)

- **Notifications are client-fired (best-effort).** Sequential step-2+ and the completion email fire from whichever client performed the last action; the daily reminder job is the backstop but only for requests with a `due_at`. Hardening: drive both from a `pg_net` DB trigger on the advance/complete transitions (the cron already establishes the pg_net dependency).
- **Signer self-UPDATE (M2):** the assigned signer can UPDATE their own request row (needed for decline); a malicious signer could set `status='signed'` directly (no `form_signatures` row would be created, but it could advance a sequential chain). Consider a `SECURITY DEFINER` decline RPC and restricting direct UPDATE to admin/manager.
- **Signature image reads (M3):** the `signatures/` storage read policy is bucket-wide to any authenticated user (matches the existing `photos/` convention). The DB `fsig_read` is properly scoped; consider scoping the storage reads to the same audience.
- **`react-signature-canvas` is an alpha** (lockfile-pinned to `1.1.0-alpha.2`). `npm ci` is deterministic; consider hard-pinning in package.json if you ever `npm install`.
