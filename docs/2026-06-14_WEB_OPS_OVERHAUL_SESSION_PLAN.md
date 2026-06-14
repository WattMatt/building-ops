# Web Ops Overhaul — Session Plan

**Date:** 2026-06-14
**Repo:** `WEB_REPOS/gmi-operations` (React 18 + Vite + TypeScript + Supabase)
**Status:** Design approved — pending spec review, then per-workstream implementation plans
**Author:** Brainstorming session (arno@watsonmattheus.com)

---

## 1. Purpose & Scope

Five operator-reported items in the **web app**, plus one prerequisite. The user has approved doing **all** of them. This document is the master session plan: it scopes, sequences, and sets the quality bar for each workstream. Forms sign-off (WS-E) is large enough that it spawns its own detailed sub-spec before implementation.

| ID | Workstream | Size | Phase |
|----|-----------|------|-------|
| WS-0 | Environment & test baseline | S | 0 (gate) |
| WS-A | Building logo de-duplication | S | 1 |
| WS-C | Remove Audit Archive tab | S | 1 |
| WS-D | Checklist preview | S | 1 |
| WS-B | Reports ring-fenced per building + portfolio rollup | M | 2 |
| WS-E | Forms full sign-off (multi-signer, drawn+typed, reminders) | L | 3 |

**Locked decisions (from brainstorming):**
- Detail-view logo: keep the **positioned overlay**, delete the duplicate avatar.
- Reports: **per-building + an admin-only portfolio rollup**.
- Signatures: **drawn + typed fallback**.
- Sign-off routing: **multiple signers**.
- Reminders/deadlines/escalation: **included in v1**.

---

## 2. Cross-Cutting Standards

Every workstream must satisfy these (they are the "bullet-proof testing / coding analysis" bar the user asked for):

1. **Investigation-protocol compliant.** Root cause stated with evidence (done below). Diagnostics ship in the *first* deploy — never retrofitted. Two-strike rule: two non-converging iterations on the same symptom → stop and re-question the design.
2. **Test pyramid per item:**
   - **Unit** (`vitest` + `@testing-library/react`) for components/logic.
   - **Integration / smoke** — extend the existing `npm run smoke` suite (`scripts/*-smoke.mjs`, which hit the real backend) with a scenario per workstream.
   - **Permission/RLS test** — every data path verified for `admin / manager / user / reviewer`.
   - **Manual-QA checklist** — written, step-by-step, in the per-WS sub-section.
   - **Regression note** — what existing behaviour must remain intact.
3. **Supabase discipline.**
   - New tables get RLS migrations from day one (every table is RLS'd in this project).
   - **Signature images are a new storage path → require a storage-policy migration.** No new bucket prefixes without a policy (project rule).
   - Migrations named `sql/YYYY-MM-DD_NN_name.sql`, **staging-first** (`GMI-staging`), never edit an applied migration.
4. **Prod is live.** Validate on staging; prod changes are rollback-wrapped. State deploy cost before each deploy.
5. **No new TypeScript errors.** Code added by a workstream must not increase the `tsc --noEmit` error count over the WS-0 baseline.

---

## 3. WS-0 — Environment & Test Baseline (Phase 0 gate)

**Goal:** A working dev server + green-enough test runner so every later test claim is real.

**Coding analysis / tasks:**
- **Resolve package-manager ambiguity:** both `bun.lockb` and `package-lock.json` exist. Pick one (recommend **npm**, since `scripts` are node/npm-style and the smoke suite uses `node`), delete the other lockfile, document the choice.
- `npm install` → confirm `npm run dev` (Vite) serves.
- Capture baselines: `npm run test` (vitest), `npm run smoke` (backend smoke — needs env/creds), and `npx tsc --noEmit` **error count** (memory: ~140 on `main`). Record the number; the rule is *no new errors*, not *fix all 140 now*.
- Confirm/commit CI (`ci.yml` was noted as uncommitted) so the pyramid runs on push.

**Test plan:** the baseline *is* the test — record pass/fail counts and the tsc number in the PR description.

**Risk:** smoke scripts need real Supabase creds; if unavailable in this environment, mark smoke as "run locally by owner" and rely on vitest + manual QA for those items.

---

## 4. WS-A — Building Logo De-duplication (Phase 1)

**Goal:** One logo per building, in both the list and the detail header.

**Root cause (evidence):**
- **Detail view** renders `building.logo_url` **twice**: an absolute-positioned floating `<img>` at `src/pages/BuildingDetails.tsx:100-115`, *and* `<BuildingAvatar>` at `:123-129`. They overlap.
- **List view**: the "second logo top-right" is actually a `<Badge>` literally labelled "Logo" at `src/pages/Buildings.tsx:198-215`, layered over the real `BuildingAvatar`. It's a dev-style indicator, not a logo.

**Change set:**
- `BuildingDetails.tsx` — **delete the `BuildingAvatar`** (`:123-129`); keep the positioned overlay (`:100-115`). Verify spacing where the avatar used to sit next to the back button.
- `Buildings.tsx` — **remove the `<Badge>` "Logo" indicator** (`:198-215`). Leave the `logo_position`-driven `BuildingAvatar` rendering intact.

**Visual guide:** Figure 1 — [logo before/after, both views](figures/fig1-logo-before-after.svg).

**Test plan:**
- Unit: render `BuildingDetails` with a building that has a `logo_url` → assert exactly **one** logo `<img>` in the header; render without `logo_url` → assert the initials fallback, no broken image.
- Unit: `Buildings` card → assert no element with the "Logo" badge text.
- Visual regression / manual QA: top-left, top-center, top-right `logo_position` values each show a single, correctly-placed logo; long building names don't collide with the overlay.
- Regression: cards without coordinates still fall back to logo→initials correctly.

**Risk/rollback:** Pure view change, trivial revert. No data/deploy risk.

---

## 5. WS-C — Remove Audit Archive Tab (Phase 1)

**Goal:** Surgically remove the Audit Archive page/tab. Keep all audit-*logging* infrastructure.

**Root cause / map:** It's a standalone read-only page over `audit_logs`. Four touch-points:
- `src/App.tsx:27` — `import AuditArchive ...` (delete)
- `src/App.tsx:110` — the `/audit` `<Route>` (delete)
- `src/components/layout/DashboardLayout.tsx:90` — nav item in `reportsNavItems` (delete)
- `src/pages/AuditArchive.tsx` — the page file (delete)

**Keep (do NOT touch):** the `audit_logs` table + its types (`integrations/supabase/types.ts`, `fortress-types.ts`), all code that *writes* audit logs, and the "Audit Compliance Pack" report which reads `audit_logs`.

**Test plan:**
- Unit/route: navigating to `/audit` renders `NotFound` (route gone), no console error.
- Build: `tsc`/`eslint` clean — no dangling import.
- Smoke regression: audit-log *writing* still occurs (extend an existing smoke if one covers it; otherwise manual QA — complete a task, confirm an `audit_logs` row is written).
- Manual QA: nav menu no longer lists "Audit Archive"; the Audit Compliance Pack report still generates.

**Risk/rollback:** Low. Risk is over-deletion — mitigated by the explicit keep-list above.

---

## 6. WS-D — Checklist Preview (Phase 1)

**Goal:** A read-only way to view a checklist template's items *without* starting, applying, or editing it.

**Root cause:** `src/pages/Checklists.tsx` template cards (`:249-305`) offer only Add Task / Apply / Edit / Delete; the items table (`:359-438`) is admin-oriented. No read-only preview exists.

**Change set:**
- New component `src/components/checklists/PreviewTemplateDialog.tsx` — mirrors the existing `FormPreviewDialog` pattern; lists the template's items read-only (name, description, responsible party, photo/signature requirement badges, category), grouped as they'd appear on execution.
- `Checklists.tsx` — add a **"Preview"** action (card dropdown + a visible button next to "Apply"), wire `previewTemplate` state + `previewDialogOpen`.
- Available to **all roles** (read-only, non-destructive).

**Visual guide:** Figure 3 (preview dialog mockup).

**Test plan:**
- Unit: open preview for a template → assert all its items render, in order, with correct requirement badges; assert no edit/delete/apply controls are present.
- Unit: preview is reachable for a `user` role (not gated).
- Manual QA: preview matches what actually gets created on "Apply" (parity check against `ApplyTemplateDialog` output).
- Regression: Add/Apply/Edit/Delete unaffected.

**Risk/rollback:** Low, additive.

---

## 7. WS-B — Reports Ring-Fenced Per Building + Portfolio Rollup (Phase 2)

**Goal:** Generate reports *inside* each building (ring-fenced to that building), and keep an **admin-only org-wide portfolio rollup** centrally. Kill the dead buttons.

**Root cause / current state:**
- Standalone `src/pages/Reports.tsx` "Generate New Report" (`:246-249`) has **no `onClick`** — inert. PDF/CSV buttons (`:336`, `:340`) likewise.
- **Per-building infra already exists**: `BuildingDetails` → Reports tab → `src/components/building/ReportsTab.tsx`. A working per-building **H&S Compliance PDF** generator exists at `src/lib/pdfGenerator.ts:611-784` (`generateHsCompliancePdf`, pdfMake). Fortress OPS/CM/Annual reports are DB-authored per building (no PDF export yet).
- **No org-wide portfolio rollup exists** anywhere.

**Change set:**
- **Per-building (ring-fence):** surface report generation inside `ReportsTab` — a "Generate Report" action that runs `generateHsCompliancePdf(buildingId, …)` (already building-scoped) and, where applicable, exports the Fortress report PDF. Ensure all queries are filtered by `buildingId` (no org-wide leakage).
- **Portfolio rollup:** repurpose the standalone Reports page into an **admin/manager-only "Portfolio Reports"** view: an org-wide compliance + performance summary (per-building completion %, open issues, expiring docs) → one rollup PDF. Replace the dead buttons with real handlers. Gate the nav entry on `isAdminOrManager`.
- Remove/replace the other inert buttons (`:336`, `:340`) — either wire them or delete.

**Visual guide:** Figure 2 (reports placement map: building Reports tab vs admin Portfolio Reports).

**Test plan:**
- Unit: clicking per-building "Generate Report" calls the generator with the correct `buildingId`; the handler is no longer undefined.
- Integration/smoke: extend `hs-smoke.mjs` (or add `reports-smoke.mjs`) — generate a per-building PDF and assert a non-empty file/blob; generate the portfolio rollup and assert it includes >1 building.
- Permission: site-restricted `user`/`reviewer` see only their building's report and **cannot** reach Portfolio Reports; admin/manager can.
- Regression: existing H&S dialog path still works; Fortress authoring unaffected.
- Manual QA: a building with no data generates a valid (empty-state) PDF rather than failing silently — *diagnostics/error surfacing required* (the original sin was a silent dead button).

**Risk/rollback:** Medium. Watch for org-wide queries inside a "per-building" report (data-leak / RLS). Rollback = revert the page repurpose; per-building additions are isolated.

---

## 8. WS-E — Forms Full Sign-Off (Phase 3) — spawns its own sub-spec

**Goal:** A complete, compliance-grade loop: **request specific signer(s) → notify them → they sign (drawn or typed) → record who/when/how**, with **multiple signers**, **deadlines + reminders + escalation**.

**Current state (works today):** browse (`FormsLibrary.tsx`) → fill (`components/forms/FillableFormDialog.tsx`, photos to storage) → submit (`form_submissions` insert, `status='submitted'`) → `notify-form-submission` edge fn emails *all* managers → admin/manager review (`FormSubmissionsDialog` / `SubmissionDetailView` / `ReviewActionDialog`) → approve/reject/mark-reviewed → records `reviewed_by/at`, `review_notes` → `notify-form-review` emails submitter.

**Missing for full sign-off:** assignment to a *specific* signer; targeted notification; real signature capture; multi-signer routing; a per-user sign-off queue; deadlines/reminders/escalation; a signature audit trail.

### 8.1 Data model (new — staging-first migrations)

**`form_signoff_requests`**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| submission_id | uuid fk → form_submissions | |
| assigned_to | uuid fk → profiles | the signer |
| assigned_by | uuid fk → profiles | requester |
| sequence_order | int | step index for sequential mode |
| mode | text | `sequential` \| `parallel` |
| status | text | `pending` \| `signed` \| `declined` \| `expired` |
| due_at | timestamptz | drives reminders/escalation |
| instructions | text | optional |
| created_at / updated_at | timestamptz | |

**`form_signatures`** (immutable audit trail)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| submission_id | uuid fk | |
| signoff_request_id | uuid fk | |
| signer_id | uuid fk → profiles | |
| signed_at | timestamptz | |
| method | text | `drawn` \| `typed` |
| signature_image_url | text | storage path (drawn) |
| typed_name | text | typed fallback |
| confirmation_text | text | the legal statement shown |
| ip_address / user_agent | text | identity evidence |
| notes | text | optional |
| sequence_order | int | |

**`form_submissions`** — add `signoff_status` (`none`\|`pending`\|`complete`\|`rejected`) and optionally a current-step pointer.

**Storage:** signature images → **new prefix `signatures/<submission_id>/…`** in the private `tenant-documents` bucket → **MUST add a storage-policy migration** (read = assigned signer + admin/manager; write = the signer; delete = admin/manager).

**RLS:** signer can read submissions/requests assigned to them and insert their own `form_signatures` row only; admin/manager full; sequential mode blocks signing out of turn.

### 8.2 State machine (multi-signer)

```
submitted
   │  (admin/manager assigns N signers; mode = sequential | parallel)
   ▼
signoff_status = pending
   ├─ parallel:   all N notified at once; each signs independently
   └─ sequential: step k notified only after step k-1 = signed
   │
   ├─ a signer declines ───────────────► signoff_status = rejected (notify requester + submitter)
   ├─ due_at passes, still pending ────► reminder → escalation → status = expired
   └─ all required signers = signed ───► signoff_status = complete (notify requester + submitter)
```

### 8.3 Edge functions (Deno + Resend, reuse existing pattern)
- **`assign-form-for-signoff`** — create `form_signoff_requests`, send targeted email to the active step's signer(s) with a deep link + due date.
- **`record-signature`** — validate (signer == assigned, correct turn for sequential), persist signature, advance the state machine, notify next signer or completion.
- **`signoff-reminders`** — **scheduled** (pg_cron / Supabase scheduled fn): pre-due reminder, post-due escalation to supervisor, mark `expired`.

### 8.4 UI components
- `SignoffRequestDialog` — assign signer(s), order, mode, due date, instructions (admin/manager, from `SubmissionDetailView`).
- `SignatureCaptureWidget` — **drawn** (new dep: `react-signature-canvas`) with **typed-name + legal-confirmation fallback**; uploads drawn image to scoped storage.
- `MySignoffs` route/page + nav entry — the signer's pending queue, sorted by `due_at`; uses the so-far-unused **`reviewer`** role.
- Sign-off progress indicator in `SubmissionDetailView` (who signed / pending / sequence, with timestamps and method).
- Hooks: `useMySignoffQueue`, `useSignoffHistory`.

**Visual guide:** Figure 4 — [multi-signer sign-off flow](figures/fig4-signoff-flow.svg) (sequence/parallel routing detailed in §8.2).

### 8.5 Test plan (the heaviest)
- **Unit:** state-machine transitions — sequential ordering, parallel completion, decline → rejected, expiry; signature validation (drawn present XOR typed present); turn enforcement.
- **Integration/smoke:** new `signoff-smoke.mjs` — assign → notify → sign (drawn) → sign (typed) → advance → complete; reject path; sequential out-of-turn attempt blocked; parallel all-sign.
- **Permission/RLS:** only the assigned signer can sign their step; non-assigned blocked at the DB; admin can reassign; signer cannot read other buildings' submissions.
- **Storage policy:** signer can write only under `signatures/<their submission>/`; cannot read others'.
- **Scheduled job:** reminder fires before due, escalation after, status flips to `expired`.
- **Regression:** existing submit → review → approve/reject flow and its two notify functions remain intact.
- **Manual QA checklist:** end-to-end across two real accounts (requester + two signers), drawn on touch + typed on desktop, deadline reminder received.

**Risk/rollback:** Highest. New tables/migrations/storage policy + a scheduled job. Mitigations: staging-first; feature-flag the sign-off UI; the legacy review flow stays as the fallback; migrations are additive (no destructive changes to `form_submissions`).

---

## 9. Sequencing & Dependencies

```
WS-0 (env baseline) ──► Phase 1: WS-A, WS-C, WS-D (parallel, independent)
                          └──► Phase 2: WS-B (reports)
                                 └──► Phase 3: WS-E (forms sign-off — own sub-spec)
```
- WS-0 gates everything (no real tests otherwise).
- Phase 1 items are independent and can be done/merged in any order.
- WS-B depends only on WS-0.
- WS-E depends on WS-0; benefits from WS-B patterns (per-building scoping) but is otherwise standalone. It gets a dedicated implementation plan before code.

---

## 10. Risk Register

| Risk | WS | Severity | Mitigation |
|---|---|---|---|
| Smoke suite needs live Supabase creds | WS-0 | Med | Owner runs locally; vitest + manual QA cover the gap |
| Over-deletion removes audit *logging* | WS-C | Med | Explicit keep-list; smoke-test that logs still write |
| "Per-building" report leaks org-wide data | WS-B | Med | RLS + filtered queries + permission tests |
| Signature storage prefix without policy | WS-E | High | Storage-policy migration is a checklist gate |
| Multi-signer race / out-of-turn signing | WS-E | High | DB-enforced turn check + state-machine unit tests |
| Scheduled reminder job misconfig | WS-E | Med | Staging dry-run; idempotent job design |
| ~140 pre-existing tsc errors mask new ones | all | Med | Baseline count + "no new errors" rule |

---

## 11. Open Items / Spawned Sub-Specs

- **WS-E sub-spec** — full implementation plan (migrations, edge functions, components, flag rollout) to be written via the writing-plans flow before any WS-E code.
- **Visual guides** — Figure 1 (logo) and Figure 4 (sign-off flow) produced and linked under `docs/figures/`. Figure 2 (reports placement) and Figure 3 (checklist preview) to be produced with their workstream plans.
- **Portfolio rollup content** — exact metric set for the org-wide PDF to be finalised in the WS-B plan (proposed: per-building completion %, open issues by severity, expiring docs in 30/60/90 days).
