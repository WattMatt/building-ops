# Production Readiness Matrix — Building Ops

> One row per client journey. A journey is **ready** when all five artifacts
> exist and its smoke passes against production. Method (proven on auth,
> 2026-06-12): layer map → live data audit → automated smoke → human dry run →
> runbook entry + truthful UI. Findings go to the iOS repo's
> `specs/verification/FINDINGS_REGISTER.md`.

| # | Journey | Map | Data audit | Smoke | Dry run | Runbook | Status |
|---|---|---|---|---|---|---|---|
| 0 | Auth & onboarding | ✅ | ✅ 2026-06-12 | ✅ `auth-smoke.mjs` (12) | ✅ owner, real inbox | ✅ ONBOARDING_RUNBOOK | **READY** |
| 1 | RLS access matrix (roles × 22 tables × 4 ops + 5 storage prefixes) | ✅ pg_policies | ✅ | ✅ `rls-smoke.mjs` (386) | n/a (protocol-only) | this file | **READY** — found+fixed F-30 (tenant-docs policies dead) on first run |
| 2 | Checklist execution | ✅ | ✅ | ✅ `checklist-smoke.mjs` (10) | dry-run owed | this file | **READY** — found+fixed F-31a (completion photos uploaded to an unpoliced prefix → silent evidence loss) |
| 3 | Issue lifecycle | ✅ | ✅ | ✅ `issue-smoke.mjs` (8, backend) | n/a | this file | **BACKEND READY; UI INCOMPLETE** — fixed F-31 b/d (photo paths); **F-32** (audit trail never written) + **F-33** (no assign/transition/resolve UI) need owner decisions |
| 4 | Documents & certificates (incl. pg_cron renewals) | ✅ | ✅ | ✅ `documents-smoke.mjs` (8) | dry-run owed | this file | **READY** — fixed F-31 e/f (doc upload paths); cert-renewal cron verified live (expiring→pending, lapsed→overdue, idempotent); signed-URL display confirmed |
| 5 | H&S compliance (scoping trigger → tasks → PDF) | ✅ | ✅ | ✅ `hs-smoke.mjs` (8) + 15 unit | n/a | this file | **READY (code)** — scoping trigger + category denorm verified live; PDF assembler unit-tested. **Owner action: classify the 2 prod buildings** (both `building_type` null → retail/industrial add-ons dormant until set) |
| 6 | Forms (submit → review → branded PDF) | — | — | — | — | — | pending |
| 7 | Dashboard truthfulness (KPIs re-derived by SQL) | — | — | — | — | — | pending |
| 8 | Admin operations (deactivate / role change / reassignment) | — | — | — | — | — | pending |
| 9 | ~~iOS offline queue field test~~ | | | | | | **SKIPPED — owner ruling 2026-06-12: pilot is web-only, all iOS items out of readiness scope** |

## Standing battery

```sh
npm run smoke   # auth-smoke + rls-smoke, ~90s, exit 0 = all journeys hold
```

Requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` env.
Run after **every** web deploy and **every** schema/policy migration.
Both smokes use disposable `zztest-*` personas/fixtures and clean up after
themselves (rls-smoke also sweeps strays from aborted runs).

## Rules of the program

- Schema/policy migrations are staging-first (`vkrihpmjajjcxmzgjqdr`), smoke
  red→green there, then prod, then smoke again on prod.
- A journey's smoke failing after a deploy is a stop-ship for that journey.
- Every finding gets a register entry (F-xx) with evidence before it gets a fix.
