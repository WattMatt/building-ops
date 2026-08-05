# Onboarding Standard Conformance — gmi-operations

Tracks this app against `ONBOARDING-STANDARD/STANDARD.md` (WM Onboarding Standard v1).
Status: ✓ conformant · partial · — not implemented · n.a. not applicable.
Last updated: 2026-08-05 (Phase 2 standardization). Update in the same PR as any auth change.

Stack profile: **S** (Supabase SPA). Schema of record: prod DDL pull
`ONBOARDING-STANDARD/ddl/qdzgkttiosahdfqresvz/`; migrations live in `../GMI/sql/` (repo convention).

## A. Entry & authentication

| # | Status | Evidence |
|---|---|---|
| A1 | partial | Session+role triage via `src/components/ProtectedRoute.tsx`; all roles land on `/` (no per-role landing surface) |
| A2 | ✓ | `src/pages/Auth.tsx` brands from `useOrganization` (name/logo, safe pre-auth read) |
| A3 | ✓ | `signUp` stub throws in `src/contexts/AuthContext.tsx`; provider `disable_signup` verified in portfolio audit |
| A4 | — | Password login only; no magic-link/OTP option (SHOULD) |
| A5 | ✓ | `src/lib/password-strength.ts` (kit-style scorer — zxcvbn not a dep — + HIBP k-anonymity, Add-Padding, fail-open) + `PasswordStrengthMeter` on all three set surfaces (`SetPassword`, `ResetPassword` recovery, `Profile` change); submit gated at score ≥2 and not-breached via `gatePassword`; min-8 retained; unit-tested (`src/lib/password-strength.test.ts`) |
| A6 | partial | `request-password-reset` answers uniformly (enumeration-safe); no 1.0–1.3 s timing pad |
| A7 | partial | Deep-link restore via `location.state.from` validated `startsWith('/') && !startsWith('//')` (`src/pages/Auth.tsx`); no `?next` allow-list/normalisation module or unit tests |
| A8 | — | No captcha slot |
| A9 | ✓ | Fail-closed guard: null/unknown/error role ⇒ deny on role-gated routes (`src/components/ProtectedRoute.tsx` + `authError` in `src/contexts/AuthContext.tsx`) |
| A10 | n.a./partial | SPA — RLS is the documented hard boundary (see `GMI/sql/2026-08-04_*` hardening + `2026-08-05_06` trigger) |
| A11 | ✓ | `src/components/ProtectedRoute.test.tsx` — 10 cases: loading, session missing → `/auth`, null-role/authError/role-mismatch on role-gated routes deny (fail closed), allowed role renders, `must_set_password` → `/set-password` (before onboarding gate), `!onboarding_completed` → `/onboarding`, session-only route documented |
| A12 | — | No auto-logout/idle monitor |
| A13 | partial | Recovery marker `#type=recovery` re-arms consumed links (`AuthContext`/`ResetPassword`); OTP-first email template not adopted |
| A14 | — | No MFA (MAY for S profile) |

## B. Invitations

| # | Status | Evidence |
|---|---|---|
| B1 | ✓ | `src/pages/UserManagement.tsx` invite dialog: email, name, role, building scope, delivery-mode toggle |
| B2 | ✓ | `supabase/functions/invite-user` — JWT verified, admin checked against DB, input validated |
| B3 | ✓ | Invite path writes `user_roles` + `user_buildings` at invite time |
| B4 | ✓ | Branded HTML via `_shared/email.ts`; CSPRNG temp password relayed once, paired with server-set gate flag |
| B5 | ✓ | Copy-link fallback when the mailer fails ("onboarding must never block on email") |
| B6 | ✓ | Resend with fresh link / degrade to recovery for confirmed users (`handleResend`) |
| B7 | ✓ | `getStatus` derives status from `email_confirmed` / `last_sign_in_at`, not a spoofable flag |
| B8 | ✓ | `src/pages/SetPassword.tsx` offers a fresh link inline on expired/pre-consumed links |
| B9 | n.a. | No bespoke invite table (GoTrue links) |

## C. Provisioning & database

| # | Status | Evidence |
|---|---|---|
| C1 | partial | Schema versioned out-of-repo in `GMI/sql/` by project convention; prod DDL pull captured 2026-08-05; gate trigger + onboarding flag added in `GMI/sql/2026-08-05_06_phase2_onboarding_standard.sql` |
| C2 | ✓ | `handle_new_user` creates profile + default 'user' role; role/scope logic lives in the invite path |
| C3 | partial | Separate `user_roles` (PK user_id) but role is plain **text** — no enum in prod; `AppRole` union documented as single source in `src/lib/constants.ts` |
| C4 | ✓ | `is_admin()` / `is_admin_or_manager()` / `app_role()` SECURITY DEFINER, `search_path` pinned, used by RLS |
| C5 | ✓ | Gate flag server-set with read-back (invite-user); self-clear now blocked by `trg_profiles_protect_flags` (2026-08-05_06); clear routed via `clear-password-gate` edge fn with verified write |
| C6 | ✓ | `set-user-status` ban-based reversible deactivation, last-admin + self-action guards; `deactivated` flag now trigger-protected |
| C7 | partial | `audit_logs` (no FK to users) + client logger with localStorage retry queue (`src/lib/auth-audit.ts`) covering login/logout/role change; invite + (de)activate audited server-side; failed logins & password changes not yet audited |
| C8 | ✓ | `delete_own_account` RPC + `delete-account`/`delete-user` fns; UI copy matches cascade behaviour |
| C9 | ✓ | `profiles.onboarding_completed` + backfill (existing users where `must_set_password = false`) in 2026-08-05_06 |
| C10 | ✓ | No service-role keys in client artifacts; privileged work in edge functions only |
| C11 | partial | Default-deny posture per `GMI/sql/2026-08-04_01..04` hardening; not re-audited this phase |

## D. First-run experience

| # | Status | Evidence |
|---|---|---|
| D1 | ✓ | 3-step wizard (Welcome w/ org branding → Profile prefill → Role overview) with progress bar: `src/pages/Onboarding.tsx` (photo step omitted by design — avatars editable in My Profile) |
| D2 | ✓ | Redirect-style dedicated `/onboarding` route, non-dismissable; `ProtectedRoute` gates on the DB flag (set-password first, then onboarding) |
| D3 | ✓ | Role overview step uses `ROLE_LABELS` + per-role descriptions, with a "Pending" fallback |
| D4 | ✓ | Completion **upserts** the profile row and read-back-verifies `onboarding_completed` (missing row is created, never silently skipped) |
| D5 | — | No product tours (MAY) |
| D6 | — | No PWA install helper (MAY) |

## E. Cross-cutting security

| # | Status | Evidence |
|---|---|---|
| E1 | n.a. | No cookie-authenticated mutations (S profile, bearer tokens) |
| E2 | partial | Provider limits only; no captcha (S-profile SHOULD) |
| E3 | ✓ | `queryClient.clear()` on signOut (`src/contexts/AuthContext.tsx` + shared client in `src/lib/queryClient.ts`); no offline queues in this app |
| E4 | ✓ | Password change re-authenticates with the current password before `updateUser` (`src/pages/Profile.tsx`); min length aligned to 8 |
| E5 | partial | This file added 2026-08-05; older doc claims not re-verified this phase |
| E6 | partial | 18 vitest files (124 tests) green in CI incl. guard-unit + password-strength suites; live smoke suites (`npm run smoke`) complement; invite→accept→login CI test still missing |
