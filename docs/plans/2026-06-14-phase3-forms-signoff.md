# Phase 3 — Forms Full Sign-Off (Multi-Signer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Let an admin/manager request sign-off on a form submission from one or more specific people, notify each signer, capture a real signature (drawn or typed), record who/when/how, and support multiple signers (sequential or parallel) with deadlines, reminders, and escalation.

**Architecture:**
- **State machine lives in a DB trigger** (atomic, race-free): inserting a `form_signatures` row marks that signer's `form_signoff_requests` row `signed`, activates the next sequential signer (or, for parallel, leaves the rest), and when no `pending` requests remain flips `form_submissions.signoff_status` → `complete`. A decline flips it → `rejected`.
- **Client does the data mutations under RLS** (assign requests, upload signature image, insert the signature row). **Edge functions only send email** (Resend) and run the **scheduled reminder** job.
- New tables `form_signoff_requests`, `form_signatures`; new `form_submissions.signoff_status` column; a `signatures/<submission_id>/<signer_id>/` storage prefix + policy; client dep `react-signature-canvas`; a `/my-signoffs` route.

**Tech stack:** React 18 + Vite + TS + Supabase (Postgres + RLS + Storage + Deno edge functions + pg_cron) + Resend + pdfMake + vitest.

**Source spec:** `docs/2026-06-14_WEB_OPS_OVERHAUL_SESSION_PLAN.md` (WS-E). Owner-locked: multiple signers, drawn+typed signatures, deadlines/reminders/escalation in v1.

---

## ⚠️ Cross-repo + execution gating (read first)

- **SQL migrations** live in `/Users/spud/Documents/DEVELOPER/GMI/sql/` (NOT the web repo), named `YYYY-MM-DD_NN_name.sql`, applied via the **Supabase Management API** (PAT in keychain → `/database/query`; see `reference_db_access` memory). Never edit an applied migration.
- **Web code + edge functions** live in this repo (`WEB_REPOS/gmi-operations`). Edge functions deploy with `supabase functions deploy <name> --project-ref <ref>`.
- **Projects:** staging `vkrihpmjajjcxmzgjqdr`, prod `qdzgkttiosahdfqresvz`.
- **GATE:** apply migrations + deploy edge functions to **STAGING first**, validate (smoke), and **do NOT touch prod without explicit owner sign-off**. Build + commit all code regardless; prod application is the only gated step.
- Branch: `feat/web-ops-phase3`. tsc gate = 0; tests via `npx vitest run <file>` (pool forks). eslint binary is currently broken in this env — use tsc + grep for orphan checks.

---

## Task 1: DB migration — tables, trigger, RLS

**File:** Create `/Users/spud/Documents/DEVELOPER/GMI/sql/2026-06-14_01_form_signoff.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 2026-06-14_01_form_signoff.sql
-- Multi-signer sign-off for form submissions: request → notify → sign → record.

-- form_submissions gains an overall sign-off state
alter table public.form_submissions
  add column if not exists signoff_status text not null default 'none'
    check (signoff_status in ('none','pending','complete','rejected'));

-- one row per (submission, signer) assignment
create table if not exists public.form_signoff_requests (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references public.form_submissions(id) on delete cascade,
  assigned_to     uuid not null references public.profiles(id),
  assigned_by     uuid references public.profiles(id),
  sequence_order  int  not null default 1,
  mode            text not null default 'sequential' check (mode in ('sequential','parallel')),
  status          text not null default 'pending'   check (status in ('pending','signed','declined','expired')),
  active          boolean not null default false,   -- is it this signer's turn? (managed on assign + by trigger)
  due_at          timestamptz,
  instructions    text,
  decline_reason  text,
  reminded_at     timestamptz,                      -- last reminder sent (reminder job de-dupes on this)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists fsr_submission_idx on public.form_signoff_requests (submission_id);
create index if not exists fsr_assignee_active_idx on public.form_signoff_requests (assigned_to) where active and status = 'pending';

-- immutable audit trail of captured signatures
create table if not exists public.form_signatures (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references public.form_signoff_requests(id) on delete cascade,
  submission_id    uuid not null references public.form_submissions(id) on delete cascade,
  signer_id        uuid not null references public.profiles(id),
  method           text not null check (method in ('drawn','typed')),
  signature_url    text,           -- storage path for drawn signatures
  typed_name       text,           -- for typed signatures
  confirmation_text text not null, -- the legal statement shown at signing time
  notes            text,
  ip_address       text,
  user_agent       text,
  signed_at        timestamptz not null default now()
);
create index if not exists fsig_submission_idx on public.form_signatures (submission_id);

-- ── state machine: advance on signature insert ──
create or replace function public.advance_form_signoff() returns trigger
language plpgsql security definer set search_path = public as $$
declare req record; remaining int;
begin
  update public.form_signoff_requests
     set status = 'signed', active = false, updated_at = now()
   where id = NEW.request_id;

  select * into req from public.form_signoff_requests where id = NEW.request_id;

  -- sequential: activate the next-lowest pending step
  if req.mode = 'sequential' then
    update public.form_signoff_requests
       set active = true, updated_at = now()
     where submission_id = req.submission_id
       and status = 'pending'
       and sequence_order = (
         select min(sequence_order) from public.form_signoff_requests
          where submission_id = req.submission_id and status = 'pending'
       );
  end if;

  select count(*) into remaining from public.form_signoff_requests
   where submission_id = req.submission_id and status = 'pending';
  if remaining = 0 then
    update public.form_submissions set signoff_status = 'complete', updated_at = now()
     where id = req.submission_id;
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_advance_form_signoff on public.form_signatures;
create trigger trg_advance_form_signoff after insert on public.form_signatures
  for each row execute function public.advance_form_signoff();

-- ── decline → submission rejected ──
create or replace function public.handle_signoff_decline() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'declined' and coalesce(OLD.status,'') <> 'declined' then
    update public.form_submissions set signoff_status = 'rejected', updated_at = now()
     where id = NEW.submission_id;
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_signoff_decline on public.form_signoff_requests;
create trigger trg_signoff_decline after update on public.form_signoff_requests
  for each row execute function public.handle_signoff_decline();

-- ── RLS ──
alter table public.form_signoff_requests enable row level security;
alter table public.form_signatures       enable row level security;

drop policy if exists fsr_read on public.form_signoff_requests;
create policy fsr_read on public.form_signoff_requests for select using (
  is_admin_or_manager()
  or assigned_to = auth.uid()
  or exists (select 1 from public.form_submissions s
             where s.id = submission_id
               and (s.submitted_by = auth.uid() or can_access_building(s.building_id)))
);

-- assign / manage: admin or manager
drop policy if exists fsr_write on public.form_signoff_requests;
create policy fsr_write on public.form_signoff_requests for insert with check ( is_admin_or_manager() );

-- update: admin/manager OR the assigned signer (e.g. to decline their own active request)
drop policy if exists fsr_update on public.form_signoff_requests;
create policy fsr_update on public.form_signoff_requests for update
  using ( is_admin_or_manager() or assigned_to = auth.uid() )
  with check ( is_admin_or_manager() or assigned_to = auth.uid() );

-- signatures: only the assigned signer may insert, only for THEIR active pending request
drop policy if exists fsig_insert on public.form_signatures;
create policy fsig_insert on public.form_signatures for insert with check (
  signer_id = auth.uid()
  and exists (select 1 from public.form_signoff_requests r
              where r.id = request_id and r.assigned_to = auth.uid()
                and r.active and r.status = 'pending')
);
drop policy if exists fsig_read on public.form_signatures;
create policy fsig_read on public.form_signatures for select using (
  is_admin_or_manager()
  or signer_id = auth.uid()
  or exists (select 1 from public.form_submissions s
             where s.id = submission_id
               and (s.submitted_by = auth.uid() or can_access_building(s.building_id)))
);
```

- [ ] **Step 2: Apply to STAGING only** (`vkrihpmjajjcxmzgjqdr`) via the Management API (per `reference_db_access`). Verify: the two tables exist, the trigger exists, `\d form_signoff_requests` shows the columns. **Do NOT apply to prod.**

- [ ] **Step 3: Sanity-check the state machine on staging** with throwaway rows: insert a submission + 2 sequential requests (active on order 1) → insert a signature for request 1 → confirm request 1 = `signed`, request 2 = `active`; insert a signature for request 2 → confirm submission `signoff_status` = `complete`. Roll back the test rows.

---

## Task 2: Storage policy migration (signatures prefix)

**File:** Create `/Users/spud/Documents/DEVELOPER/GMI/sql/2026-06-14_02_signoff_storage.sql`

- [ ] **Step 1: Write it** (mirrors `2026-06-11_03_storage_scoping.sql`; path = `signatures/<submission_id>/<signer_id>/<file>`):

```sql
-- 2026-06-14_02_signoff_storage.sql — scoped policies for drawn signature images
create policy "td read signatures" on storage.objects for select using (
  bucket_id = 'tenant-documents'
  and split_part(name, '/', 1) = 'signatures'
  and auth.uid() is not null
);
create policy "td write own signatures" on storage.objects for insert with check (
  bucket_id = 'tenant-documents'
  and split_part(name, '/', 1) = 'signatures'
  and split_part(name, '/', 3) = auth.uid()::text   -- signatures/<submission>/<signer>/...
);
create policy "td delete signatures admin" on storage.objects for delete using (
  bucket_id = 'tenant-documents'
  and split_part(name, '/', 1) = 'signatures'
  and public.is_admin_or_manager()
);
```

- [ ] **Step 2: Apply to STAGING only.** Verify by signing a URL / uploading a test object under `signatures/<x>/<auth.uid>/test` as a normal user (should succeed) and under another user's prefix (should fail). **Do NOT apply to prod.**

---

## Task 3: Regenerate types + add signature dependency

**Files:** `src/integrations/supabase/types.ts` (regenerated), `package.json`/lockfile

- [ ] **Step 1:** Regenerate Supabase types from **staging** so the new tables/column are typed:
  `npx supabase gen types typescript --project-id vkrihpmjajjcxmzgjqdr > src/integrations/supabase/types.ts`
  (Staging mirrors prod schema; once prod is applied this stays valid.) Confirm `form_signoff_requests`, `form_signatures`, and `form_submissions.signoff_status` appear.
- [ ] **Step 2:** `npm install react-signature-canvas` and `npm install -D @types/react-signature-canvas`.
- [ ] **Step 3:** `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 0. Commit (`feat: signoff schema types + signature-canvas dep`).

---

## Task 4: Notification edge functions (request + complete)

**Files:** Create `supabase/functions/notify-signoff-request/index.ts`, `supabase/functions/notify-signoff-complete/index.ts`; add `[functions.*] verify_jwt = false` blocks to `supabase/config.toml`.

Both mirror `supabase/functions/notify-form-review/index.ts` exactly (Deno `serve`, service-role `createClient`, `corsHeaders`, the `sendEmail` Resend helper, the branded HTML shell). Differences:

- [ ] **`notify-signoff-request`** — body `{ requestId }`. Load the request + its submission + the assignee profile (email, full_name) + assigner name. Email the **assignee**: subject `Sign-off requested: <formName>`, body states who asked, the building, the due date, instructions, and a link to `https://buildingops.app/my-signoffs`. Return `{ success, notified }`.
- [ ] **`notify-signoff-complete`** — body `{ submissionId }`. Load submission + submitter profile + assigner. Email the **submitter (and assigner)**: subject `Sign-off complete: <formName>`. Reuse the green "approved" styling from notify-form-review.
- [ ] **config.toml:** add
  ```toml
  [functions.notify-signoff-request]
  verify_jwt = false
  [functions.notify-signoff-complete]
  verify_jwt = false
  ```
- [ ] **Deploy to STAGING** (`--project-ref vkrihpmjajjcxmzgjqdr`); curl a test invoke. Commit. **Prod deploy gated.**

(These read DB-derived recipient addresses via the service role — same trust model as the existing notify-form-* functions.)

---

## Task 5: Scheduled reminders + escalation edge function

**Files:** Create `supabase/functions/signoff-reminders/index.ts`; migration `/Users/spud/Documents/DEVELOPER/GMI/sql/2026-06-14_03_signoff_cron.sql`.

- [ ] **Step 1: Edge function** — mirrors the notify pattern but **guards with a shared secret** (avoids the F-42 unauthenticated-trigger class): require header `x-signoff-secret` to equal `Deno.env.get('SIGNOFF_REMINDERS_SECRET')`, else 401. Logic (service role):
  - **Reminder:** active+pending requests with `due_at` within the next 48h and `reminded_at` null (or > 24h ago) → email the assignee (reuse notify-signoff-request copy, "reminder" tone) → set `reminded_at = now()`.
  - **Escalate + expire:** active+pending with `due_at < now()` → email all admins/managers (escalation) and set `status = 'expired', active = false`; if that leaves the submission with no pending requests, set `form_submissions.signoff_status` per existing rows (it stays `pending` with an expired item — surface in UI; do NOT auto-complete).
  - Return `{ reminded, escalated, expired }`.
- [ ] **Step 2: config.toml:** `[functions.signoff-reminders] verify_jwt = false`.
- [ ] **Step 3: Cron migration** (`2026-06-14_03_signoff_cron.sql`) — schedule a daily call via pg_cron + `net.http_post` to the function URL with the `x-signoff-secret` header (mirror any existing pg_cron usage; if none exists, document that the owner sets `SIGNOFF_REMINDERS_SECRET` as a Supabase secret and that the cron must send it). Example:
  ```sql
  select cron.schedule('signoff-reminders-daily', '0 7 * * *', $$
    select net.http_post(
      url := 'https://<ref>.supabase.co/functions/v1/signoff-reminders',
      headers := jsonb_build_object('x-signoff-secret', '<from vault>', 'Content-Type','application/json'),
      body := '{}'::jsonb
    );
  $$);
  ```
- [ ] **Step 4:** Deploy fn + apply cron to **STAGING**; manually invoke with the secret header and confirm `{reminded,...}`. Commit. **Prod gated** (and the owner must set `SIGNOFF_REMINDERS_SECRET` before prod cron).

---

## Task 6: SignatureCaptureWidget (drawn + typed), test-first

**Files:** Create `src/components/forms/SignatureCaptureWidget.tsx` + `.test.tsx`.

- [ ] **Step 1: Failing test** for a pure helper `validateSignature` (export from the widget):
  ```tsx
  import { describe, it, expect } from 'vitest';
  import { validateSignature } from './SignatureCaptureWidget';
  describe('validateSignature', () => {
    it('requires confirmation regardless of method', () => {
      expect(validateSignature({ method: 'typed', typedName: 'A Smith', drawn: null, confirmed: false }).ok).toBe(false);
    });
    it('typed needs a non-empty name', () => {
      expect(validateSignature({ method: 'typed', typedName: '  ', drawn: null, confirmed: true }).ok).toBe(false);
      expect(validateSignature({ method: 'typed', typedName: 'A Smith', drawn: null, confirmed: true }).ok).toBe(true);
    });
    it('drawn needs a non-empty data URL', () => {
      expect(validateSignature({ method: 'drawn', typedName: '', drawn: null, confirmed: true }).ok).toBe(false);
      expect(validateSignature({ method: 'drawn', typedName: '', drawn: 'data:image/png;base64,x', confirmed: true }).ok).toBe(true);
    });
  });
  ```
- [ ] **Step 2:** Run it → fails (module/export missing).
- [ ] **Step 3: Implement.** Export `interface SignatureState { method:'drawn'|'typed'; typedName:string; drawn:string|null; confirmed:boolean }` and `validateSignature(s): {ok:boolean; reason?:string}`. The component: a method toggle; **drawn** = `react-signature-canvas` (`<SignatureCanvas>`, a Clear button, read `toDataURL('image/png')`); **typed** = a name `Input`; both show the confirmation `Checkbox` + legal statement text; a "Sign" button disabled until `validateSignature(...).ok`. Props: `{ confirmationText: string; onSign: (s: SignatureState) => Promise<void>; submitting: boolean }`.
- [ ] **Step 4:** Run test → pass. tsc 0. Commit (`feat: SignatureCaptureWidget (drawn+typed) with tests`).

---

## Task 7: SignoffRequestDialog (assign signers)

**Files:** Create `src/components/forms/SignoffRequestDialog.tsx`. Admin/manager-only.

- [ ] Props `{ submissionId: string; buildingId: string | null; open; onOpenChange; onAssigned: () => void }`. UI: a multi-select of users (query `profiles` joined to roles, or `user_roles`+`profiles`; reuse the user-list query pattern), an ordered list when **sequential** (drag or numeric order; numeric `sequence_order` inputs are fine for v1), a **mode** toggle (sequential/parallel), a **due date**, and **instructions**.
- [ ] On submit: insert N `form_signoff_requests` rows (`assigned_by = auth.uid()`, `mode`, `due_at`, `instructions`, `sequence_order` per row; `active` = `mode==='parallel' ? true : sequence_order === 1`); update `form_submissions.signoff_status = 'pending'`; for each currently-active request invoke `notify-signoff-request` (fire-and-forget). Then `onAssigned()`.
- [ ] tsc 0. Commit (`feat: SignoffRequestDialog`).

---

## Task 8: Sign-off progress + Sign action in the submission detail

**Files:** Modify `src/components/forms/SubmissionDetailView.tsx` (and/or `FormSubmissionsDialog.tsx` detail view — apply to whichever renders the submission detail; per the audit both share the action-button region).

- [ ] **Progress section** (everyone who can read the submission): fetch `form_signoff_requests` (+ joined assignee name) and `form_signatures` for the submission; render a list — signer, status badge (pending/signed/declined/expired), signed-at + method. Show overall `signoff_status`.
- [ ] **"Request sign-off" button** (admin/manager, when `signoff_status` ∈ {none, rejected}): opens `SignoffRequestDialog`.
- [ ] **"Sign" / "Decline" actions** (only when the current user has an `active && pending` request on this submission): "Sign" opens `SignatureCaptureWidget`; on sign → if drawn, upload the PNG to `signatures/<submissionId>/<auth.uid>/<ts>.png` (via the storage client, mirror `FillableFormDialog` photo upload) → insert a `form_signatures` row (`request_id`, `submission_id`, `signer_id`, `method`, `signature_url`|`typed_name`, `confirmation_text`) → the trigger advances state → if the submission's `signoff_status` became `complete`, invoke `notify-signoff-complete`. "Decline" sets the request `status='declined'` (+ `decline_reason`).
- [ ] tsc 0. Commit (`feat: sign-off progress + sign/decline in submission detail`).

---

## Task 9: "My Sign-offs" queue page + route + nav + hook

**Files:** Create `src/pages/MySignoffs.tsx`, `src/hooks/useMySignoffs.ts`; modify `src/App.tsx`, `src/components/layout/DashboardLayout.tsx`.

- [ ] **Hook `useMySignoffs`:** query `form_signoff_requests` where `assigned_to = auth.uid()`, `active`, `status='pending'`, joined to `form_submissions` (form_name, building) — ordered by `due_at` nulls last.
- [ ] **Page:** a list/table of pending sign-offs (form, building, requested-by, due date with overdue styling) → row click opens the submission detail/sign flow (reuse the detail view + `SignatureCaptureWidget`).
- [ ] **Route:** `<Route path="/my-signoffs" element={<ProtectedRoute><DashboardLayout><MySignoffs/></DashboardLayout></ProtectedRoute>} />` (all authenticated users — anyone can be a signer).
- [ ] **Nav:** add `{ title: 'My Sign-offs', href: '/my-signoffs', icon: <PenLine className="w-4 h-4" /> }` to `mainNavItems` (ungated). Optionally show a count badge from `useMySignoffs`.
- [ ] tsc 0. Commit (`feat: My Sign-offs queue page + nav`).

---

## Task 10: Smoke test + verification

**Files:** Create `scripts/signoff-smoke.mjs` (mirror `scripts/forms-smoke.mjs`).

- [ ] **Smoke (against STAGING)** with disposable personas: submitter creates a submission; manager assigns 2 **sequential** signers; assert RLS — a non-assigned user cannot insert a signature; signer 1 signs (typed) → request1 `signed`, request2 `active`; signer 2 (out of turn earlier) was blocked, now signs (drawn → storage upload) → submission `signoff_status='complete'`; a parallel-mode submission where both must sign; a decline path → `rejected`. Clean up rows + storage + personas in `finally`. Add to the `smoke` script chain.
- [ ] **Unit/tsc/build:** `npm run test` (incl. `validateSignature`), `npx tsc --noEmit` = 0, `npm run build` succeeds.
- [ ] **Manual QA (owner, browser):** request sign-off (2 signers) → each gets an email → signer signs drawn on touch + typed on desktop → progress updates → completion email → reminder fires for an overdue request. Verify on staging/preview before any prod push.

---

## Execution order & gating

1. Tasks 1–2 (staging migrations) → 3 (types+dep) → 6 (widget, pure) can proceed immediately.
2. Tasks 4–5 (edge fns) deploy to **staging**.
3. Tasks 7–9 (UI) depend on 1/3.
4. Task 10 validates on **staging**.
5. **PROD application (migrations + edge fn deploys + cron + `SIGNOFF_REMINDERS_SECRET`) is gated on explicit owner sign-off** and a green staging smoke. The web feature can ship behind the existing nav once prod schema is applied.

---

## Self-Review (during authoring)

- **WS-E coverage:** assignment → Task 7; targeted notification → Task 4; signature capture (drawn+typed) → Task 6; recording/audit trail → Tasks 1 (`form_signatures`) + 8; multi-signer (sequential/parallel) → Task 1 trigger + Task 7; signer queue → Task 9; deadlines/reminders/escalation → Task 5.
- **Race safety:** state advancement is a single `security definer` trigger, not client logic.
- **Security:** signatures insert is RLS-locked to the assigned signer's active turn; storage prefix is per-signer; the reminder job is shared-secret guarded (not the F-42 unauthenticated pattern).
- **Tested:** `validateSignature` (unit) + `signoff-smoke.mjs` (RLS + state machine end-to-end on staging). PDF/email/IO follow the repo's no-unit-test-for-IO grain.
- **Gating honored:** every backend step says staging-first; prod is explicitly owner-gated.
