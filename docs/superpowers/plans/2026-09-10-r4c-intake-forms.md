# R4c "Intake & Forms" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenants report problems through a per-building QR code without a login (D5): the report lands as an `issues` row with a `Tenant` chip, the reporter's details, a reference number the tenant keeps, and a notification to the people who act on it. The two hard-coded 14-entry form catalogues (`FormsLibrary.tsx`, `FormsTab.tsx`) and `defaultFormFields` become one `form_templates` table with an admin screen, and every new submission snapshots the fields it was filled against.

**Architecture:** One additive migration: `intake_tokens` (per-building bearer token, admin/manager RLS by building access), `intake_rate` (hourly counters keyed by token id or hashed IP, service-role only, hit through `intake_rate_hit`), three `issues` columns (`source`, `reporter`, `reference`) with a guard trigger so only the service role can mark an issue as tenant-reported, `form_templates` seeded with ids `'1'…'14'` (long names from `FormsLibrary`, icons reconciled, fields from `defaultFormFields`) with a version-bump trigger, two `form_submissions` columns (`template_version`, `fields_snapshot`), a storage read policy for `tenant-documents/intake/<building>/…`, and `issue_reported` in the notification kind check. One public edge function `tenant-intake` (`verify_jwt = false`): `GET ?t=` answers building name + branding + shop list + categories or an identical 404; `POST` multipart validates, rate-limits (20/token/hour, 5/hashed-IP/hour), drops honeypot hits silently, uploads ≤ 3 photos with the service role, inserts the issue with a `FO-XXXXXX` reference, assigns the building's `issue`/`user` role holder, and notifies through `createNotifications` (push to the assignee). Client: `/intake/:token` public page (mobile-first, `PhotoCapture` reuse, success screen), Building → Tenants "Tenant intake" card (create/rotate/disable, QR via `qrcode`, printable A5 sheet, count), `Tenant` chip + reporter block on issues, one `useFormTemplates()` hook feeding the library/tab/dialogs, Settings → Forms admin tab with a field editor.

**Tech Stack:** Postgres (plpgsql, triggers, partial unique index), Supabase JS + Storage, Deno edge function (`std@0.190.0`, `supabase-js@2.49.1`, `crypto.subtle`), React 18 + TS, TanStack Query v5, shadcn/ui, `qrcode` (client-side QR), vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-r4-insight-design.md` §2 (facts), §3 (constraints), §5.10 (tenant intake), §5.11 (form templates), §8 (R4c), §9–11.

**Ground rules for every agent:** never `git stash` / `checkout` / `switch` / `reset` / `worktree`; compare with `git show <sha>:<path>`; edit only the files your task names; commit with an explicit pathspec; retry after 5 s on `index.lock` (other agents — R4a, R4b — commit concurrently on this branch); end commit messages with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; gate = `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E '<your files>'` prints nothing, `npm run test` green, global count ≤ `.github/typecheck-baseline.txt` (51) on a clean tree; new tables/columns/RPCs are not in the generated types until the controller regenerates — cast at the boundary with `// <name> is not yet in the generated types; regenerate after the migration ships.` and the `const db = supabase as unknown as { from: (table: string) => any; rpc: … }` idiom (`useBuildingPpm.ts` at 3d72f18); guardrail copy plain, coaching through `<Hint>`; mobile-first, 44 px targets (`h-11` inputs, `h-12` primary buttons) on the public form; every new function `set search_path = ''`, `revoke all … from public`, `revoke execute … from anon`; Deno functions never log a token, a raw IP, or reporter details — counts and statuses only.

**Facts every task relies on (survey of 2026-09-10, HEAD 21449c7):**
- `src/pages/FormsLibrary.tsx:33` and `src/components/building/FormsTab.tsx:81` each carry a 14-entry `formTemplates` array keyed `'1'…'14'`. They diverge in name (`Key Access / Key Issuance Log` vs `Key Access Log` …), description, category (`14`: `HR/Safety` vs `HR`) and icon (`7`: FileSpreadsheet vs Wrench; `9`: Shield vs Flame; `10`: Flame vs Shield; `11`: FileSpreadsheet vs FileText; `14`: HardHat vs Users). `src/lib/formFields.ts` exports `FormField { label; type: 'text'|'date'|'time'|'signature'|'checkbox'|'textarea'|'select'|'photo'; required?; options?; width?: 'full'|'half'; maxPhotos? }` and `defaultFormFields: Record<string, FormField[]>` (the 14 field lists). `FillableFormDialog` takes `form` + `fields` props and inserts `form_submissions { form_template_id, form_name, building_id, submitted_by, form_data, photo_urls, status: 'submitted' }`; `FormPreviewDialog` and `FormSubmissionsDialog` read `defaultFormFields[form.id]` themselves; `FormsTab.handleDownloadPdf` looks the template up in its own array. `generateFormPdf(form: FormTemplateMeta{id,name,description,category}, fields, branding)` / `generateFilledFormPdf(form, fields, formData, branding, submittedBy, submittedAt)` in `src/lib/pdfGenerator.ts`.
- `form_submissions` columns (generated types): `id, form_template_id text|null, form_name, form_type, building_id, submitted_by, form_data jsonb, photo_urls jsonb, status, reviewed_by, reviewed_at, review_notes, signoff_status, created_at, updated_at`. RLS (`2026-06-10_02`): select/insert by `can_access_building(building_id)`, update/delete `is_admin_or_manager()`.
- `issues` columns: `id, building_id, title, description, priority ('low'|'medium'|'high'|'critical'), status, deadline, corrective_action, reported_by (not null), assigned_to, task_instance_id, photo_urls jsonb, category text|null, responsibility, contractor_id, estimated_cost, actual_cost, sla_target_hours, sla_breached_at, first_response_at, created_at, resolved_at`. RLS: insert/select/update by `can_access_building`, delete admin/manager. `log_issue_activity()` (after insert/update) derives the actor as `coalesce(auth.uid(), new.reported_by)` — a service-role insert logs `created` under `reported_by`'s name. `useIssues.ts` selects a fixed column list and maps to a local `Issue` interface; `Issues.tsx` renders cards (priority + status badges, building/date/deadline line) and `IssueDetailDialog` (its own duplicate `Issue` interface; also fed by `MyDay.tsx`, so new fields must be optional there).
- `notifications.kind` check is restated by whichever migration last touched it (`2026-09-12_01` lists 15 kinds; R4a `_01` adds `issue_sla_breached`, R4b `_02` adds `report_due_soon`, `report_export_needed`). `supabase/functions/_shared/notifyRules.ts`: `NOTIFICATION_KINDS`, exhaustive `governingFlag` switch, `PUSH_KINDS` (4 kinds; `src/lib/notifyRules.test.ts:332` pins the list), `ALLOWED_URL_PREFIXES` (mirrored by `src/lib/pushUrl.ts` with a parity test). `_shared/notify.ts` `createNotifications(admin, input)` reads profiles, inserts inbox rows, pushes to every recipient `shouldPush` allows, then emails; `adminAndManagerIds(admin)`. `_shared/email.ts` `escapeText`, `loadBranding`. `_shared/cors.ts` `corsHeaders(req)` echoes the app origin / localhost / `*.vercel.app` only.
- `ics-feed/index.ts` is the public-function pattern: `verify_jwt = false` in `supabase/config.toml`, `TOKEN_RE = /^[A-Za-z0-9_-]{43}$/`, service-role lookup, identical 404 for missing/revoked/garbage, counts-only `console.log`, `EdgeRuntime.waitUntil` for the `last_used_at` touch. Tokens are minted client-side by `mintToken()` in `src/lib/calendarTokens.ts` (32 random bytes → base64url, 43 chars).
- Storage (`2026-06-11_03`, `2026-08-04_07`): `tenant-documents` reads are prefix-scoped (`documents/<building>`, `tenant-docs/<tenant>`, `photos/<uid>` own-or-admin, `contractor-docs` admin/manager, `signatures/<submission>/<signer>`); inserts likewise; update/delete admin/manager. There is no `intake/` policy — the service role bypasses RLS to write, but signed-in readers (`SignedImage` re-signs the public-style URL) need a select policy. `src/lib/photos.ts`: `PHOTO_BUCKET = 'tenant-documents'`, `uploadPhotos()` stores `getPublicUrl(path).data.publicUrl` in `photo_urls`.
- `PhotoCapture` (`src/components/ui/photo-capture.tsx`) props `maxPhotos, maxSizeMB, photos, onPhotosChange, caption { time?, geotag? }, size, label, required, disabled`; it converts HEIC → JPEG (`heic2any`), compresses via canvas to JPEG (max 1920 px, q 0.8) and burns a time caption; `geotag` defaults to the signed-in user's profile preference (`useGeotagPreference` is `false` when signed out).
- `TenantsTab({ buildingId })` — `BuildingDetails.tsx:353` passes only the id; the tab renders a search + Export/Import/Add header, then the table. `building_tenants(id, building_id, shop_number, shop_name, unit_number, contact_*, is_active boolean|null)`. `building_role_assignments(building_id, role, user_id)` pk `(building_id, role)` (R3a); `FIXED_ROLES = ['user','manager']` in `useBuildingRoleAssignments.ts`.
- `organizations(id, name, email, logo_url, primary_color, created_at, updated_at)` + R4a's `settings jsonb`. `Settings.tsx` is a `Tabs` page (`organization`, admin-only `branding`); `src/components/settings/` does not exist yet (R4a is creating it concurrently). `useAuth()` exposes `isAdmin`, `isAdminOrManager`, `user`. `is_active_user()`, `is_admin()`, `is_admin_or_manager()`, `can_access_building(uuid)` exist (`2026-09-11_03`).
- Smokes: `scripts/calendar-smoke.mjs` (public-function pattern, refuses prod unless `SMOKE_ALLOW_PROD=1`), `scripts/rls-smoke.mjs` (personas `admin/manager/userA/userB`, `probeMatrix`, `canSelect/canInsert/canUpdate/canDelete/rpcCall/storagePut/storageGet`, matrix helpers `adminMgr/adminOnly/anyAuth/nobody/byAccess`, LIFO `cleanup`). `package.json` scripts: `smoke` chain (prod-safe), `smoke:calendar` etc. separate. Canonical SQL lives in `../GMI/sql/`, vendored by `npm run schema:vendor` (copies `*.sql` + writes `.source`). Homebrew `postgresql@17` is installed (`/opt/homebrew/bin/psql`).
- Prod: 0 issues, 1091 `building_tenants`, 1 organization, 15 admin/manager users, `form_submissions.form_template_id` holds `'1'…'14'` strings.

## Depends on (pinned; verify before starting Task 2–4)

| Provided by | What R4c uses | Where |
|---|---|---|
| R4a `2026-09-14_01` §5.2 | `organizations.settings jsonb` with `features.tenant_intake boolean` (default `false`, ships dark). The edge function reads `settings->'features'->>'tenant_intake'` with the service role and answers 404 while it is not `'true'`. | Task 2 |
| R4a client | `useFeature(name: 'tenant_intake') → boolean` exported from `src/hooks/useOrgSettings.ts`. If R4a exports it from another module, change the one import in `TenantIntakeCard.tsx` — nothing else references it. | Task 3 |
| R4a `organization_branding` view | **Not read by R4c.** The public page gets `org { name, logoUrl, primaryColor }` from `GET /tenant-intake` (service-role read of `organizations`), so `/intake/:token` makes no anon table read at all. Pinned here so nobody adds one. | Task 2, 3 |
| R3a `building_role_assignments` | The intake issue's `assigned_to`: the building's rule for role `'issue'` if one exists, else `'user'`, else unassigned. | Task 2 |
| R4a/R4b notification kinds | The `notifications_kind_check` restated in Task 1 is the **union** (15 existing + `issue_sla_breached` + `report_due_soon` + `report_export_needed` + `issue_reported`), because whichever migration applies last wins. `notifyRules.ts` gains only `issue_reported` here; the controller resolves the concurrent edits from R4a/R4b. | Task 1, 2 |

## Contracts (every task codes against these; change here first)

**Columns.**
- `intake_tokens(id uuid pk, building_id uuid not null → buildings cascade, token text not null unique check 43-char base64url, label text, is_active boolean not null default true, created_by uuid → profiles set null, created_at, last_used_at, submissions_count integer not null default 0)`. RLS select/insert/update `is_admin_or_manager() and can_access_building(building_id)`, insert additionally `created_by = auth.uid()`; **no delete policy** (disable, never delete). Rotate = insert a fresh row, then set the old `is_active = false`.
- `intake_rate(bucket text, window_start timestamptz, count integer, pk (bucket, window_start))` — spec §5.10 sketches `token_id uuid`; the per-IP limit needs a second key, so one `bucket` text column carries both: `t:<token id>` and `ip:<32 hex of sha256(INTAKE_IP_SALT ':' ip)>`. RLS on, no policies, revoked from anon/authenticated; only `intake_rate_hit(p_bucket text, p_limit integer) returns boolean` (service_role) touches it. Window = `date_trunc('hour', now())`; rows older than a day are pruned on every hit.
- `issues.source text not null default 'app' check in ('app','tenant_intake')`, `issues.reporter jsonb null` (object: `{ name: string, shop_number: string|null, shop: string|null, unit: string|null, phone: string|null, email: string|null }`), `issues.reference text null` check `^FO-[A-Z2-7]{6}$`, **unique via a partial index** (`where reference is not null`) — app-created issues keep `null`, so uniqueness costs nothing there. Trigger `issues_intake_guard`: a signed-in writer (`auth.uid() is not null`) cannot insert `source <> 'app'`, a `reporter` or a `reference`, nor change any of the three on update (42501). The service role (no `auth.uid()`) can.
- `form_templates(id text pk, name text not null, description text not null default '', category text not null, icon text not null default 'file-text', fields jsonb not null default '[]' check array, is_active boolean not null default true, sort_order integer not null default 0, version integer not null default 1, created_at, updated_at, updated_by uuid → profiles set null)`. RLS select `is_active_user()`, insert/update/delete `is_admin()`. Trigger `form_templates_touch` (before update): `updated_at = now()`, `updated_by = coalesce(auth.uid(), updated_by)`, and `version = old.version + 1` **only when** `fields`, `name`, `description` or `category` changed (an `is_active` or `sort_order` toggle is not a new version); a client-sent `version` is ignored. Icons are lucide kebab names; the client maps them through `FORM_ICONS` with `file-text` as fallback. Seed ids `'1'…'14'` (`on conflict do nothing`), `sort_order` = numeric id. No "create template" in R4c.
- `form_submissions.template_version integer null`, `form_submissions.fields_snapshot jsonb null` (array). Written by `FillableFormDialog` on every new submission; readers use `fields_snapshot ?? template.fields`.
- Storage: policy `"td read intake photos"` — select on `tenant-documents` where `split_part(name,'/',1) = 'intake'` and `can_access_building(split_part(name,'/',2)::uuid)`. No insert policy: only the service role writes `intake/<building_id>/<uuid>.<jpg|png|webp>`. `photo_urls` store the public-style URL (`…/object/public/tenant-documents/intake/…`) exactly like `uploadPhotos`, so `SignedImage` re-signs it.
- `notifications_kind_check` gains `issue_reported`. `notifyRules.ts`: `NOTIFICATION_KINDS` + `issue_reported`; `governingFlag('issue_reported') = 'issue_updates'`; `PUSH_KINDS` + `issue_reported`; not in `CLIENT_KINDS` (server-only). `notify.ts` `CreateNotificationsInput.pushTo?: string[]` — when present, push goes only to those recipients (still gated by `shouldPush`).

**Edge function `tenant-intake`** (`verify_jwt = false`; secrets `INTAKE_IP_SALT` required — the function fails closed with 500 `{ "error": "unavailable" }` and a log line when it is unset).
- `GET /functions/v1/tenant-intake?t=<token>` → `200 application/json` `{ "building": { "name": string }, "org": { "name": string, "logoUrl": string|null, "primaryColor": string }, "shops": [{ "shopNumber": string, "shopName": string }] (≤ 500, active or null `is_active`, by shop number), "categories": string[] }` with `Cache-Control: no-store`; or `404 { "error": "not_found" }` for a malformed, unknown or disabled token, or when `features.tenant_intake` is not `true`. Never the building id, never contacts.
- `POST /functions/v1/tenant-intake` `multipart/form-data`: `t`, `title` (≤ 120, required), `description` (≤ 2000, required), `name` (≤ 80, required), `shop_number` (≤ 20, optional; must match an active tenant's `shop_number` in that building — the row's `shop_name`/`unit_number` become `reporter.shop`/`reporter.unit`), `phone` (≤ 30, optional), `email` (≤ 120, optional, `^[^\s@]+@[^\s@]+\.[^\s@]+$`), `category` (optional, one of `categories` else `null`), `website` (honeypot: any non-empty value → `201 { "reference": "<fresh FO-…>" }` and **nothing stored**, logged as `honeypot: 1`), `photos` (0–3 files, each `image/jpeg|png|webp` ≤ 5 MB; the client already converts HEIC and compresses). Order of checks: method → content-type/`Content-Length` ≤ 16 MB (413) → token regex (404) → token row active + flag on (404) → salt present (500) → rate limits (429 `{ "error": "rate_limited" }`, `Retry-After: 3600`; both buckets are counted before either is checked) → honeypot → validation (400 `{ "error": "invalid", "fields": string[] }`) → photos upload (500 `{ "error": "upload_failed" }`) → issue insert (reference retried ≤ 5× on 23505) → `intake_touch` (waitUntil) → notification (failure logged, never fails the submission) → `201 { "reference": "FO-XXXXXX" }` — nothing else in the body. Issue row: `{ id: randomUUID(), building_id, title, description, category, priority: 'medium', status: 'open', reported_by: token.created_by ?? first admin id, assigned_to: role 'issue' → 'user' → null, source: 'tenant_intake', reporter, reference, photo_urls: string[] | null }`. Notification: kind `issue_reported`, `entityType 'issue'`, `entityId issue.id`, `buildingId`, `actorId null`, `actorName 'Tenant intake'`, title `Tenant reported: <title>`, body `<building> · <shop or 'No shop given'> · <name>`, url `/issues?open=<issue id>`, recipients = admins/managers ∪ assignee, `pushTo = assignee ? [assignee] : admins`. Logs: `tenant-intake: served { method, photos, honeypot, notified: {inserted, pushed, emailed, failed} }` — no token, ip, reference or reporter fields.
- Other: `OPTIONS` → 204; any other method → 405 `Allow: GET, POST, OPTIONS`.

**Reference format.** `FO-` + 6 characters from the RFC 4648 base32 alphabet `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567` (`byte & 31` over 6 random bytes). `REFERENCE_RE = /^FO-[A-Z2-7]{6}$/` (client `src/lib/intakeForm.ts`, function, smoke). Shown to the tenant on the success screen, stored on `issues.reference`, shown on the issue card chip and detail block, searchable on `/issues` (the existing search matches `reference` too).

**Query keys.** `['intake-tokens', buildingId]` (active row for the card), `['building-name', buildingId]` (card header/sheet), `['form-templates']` (every row incl. inactive; consumers filter `is_active`), `['issues']`-style lists are untouched (`useIssues` is `useState`-based). The public page uses plain `fetch` state — nothing is written into the persisted query cache on a tenant's phone.

**URL allowlist rule.** `/intake/` is a **public route outside `ProtectedRoute`** and is **NOT** added to `ALLOWED_URL_PREFIXES` / `PUSH_URL_PREFIXES`: no notification or push ever deep-links to the intake form. `issue_reported` links to `/issues?open=<id>`, which is already allowlisted, so `pushUrl.ts` and the parity test are untouched.

**Rate limits.** 20 POSTs per token per hour, 5 per hashed IP per hour, both windows aligned to the clock hour; the smoke resets `ip:*` rows before it runs (staging only).

**Feature flag.** Everything tenant-facing is dark until `organizations.settings.features.tenant_intake = true`: the function answers 404, the Tenants card is hidden (`useFeature`), and existing tokens simply stop working while the flag is off (nothing is deleted).

---

### Task 1: Migration + intake-smoke + rls-smoke probes + dependencies

**Files:** Create `../GMI/sql/2026-09-14_03_r4_intake_forms.sql` → vendor (`npm run schema:vendor` writes `supabase/schema/2026-09-14_03_r4_intake_forms.sql` + `.source`); create `scripts/intake-smoke.mjs`; modify `scripts/rls-smoke.mjs` (R4c block + header line + teardown for `intake_rate`), `package.json` + `package-lock.json` (`smoke:intake` script; dependencies `qrcode`, dev `@types/qrcode` — installed here so Task 3 never touches `package.json`)

- [ ] **Step 1 — the migration.** Write `../GMI/sql/2026-09-14_03_r4_intake_forms.sql` exactly as below.

```sql
-- 2026-09-14_03_r4_intake_forms.sql — R4c "Intake & Forms" (spec §5.10, §5.11). Additive, idempotent.
-- Apply order: staging (after 2026-09-14_01 R4a and _02 R4b) -> npm run smoke:intake && node scripts/rls-smoke.mjs -> prod.
-- The client is unaffected until the tenant_intake feature flag is on and the tenant-intake function is deployed.
begin;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- 1) Tenant intake tokens: one bearer secret per building (rotatable), managed by admin/manager
--    with access to the building. Minted client-side like calendar_tokens (32 random bytes,
--    base64url, 43 chars). The tenant-intake function resolves it with the service role.
-- ────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.intake_tokens (
  id                uuid primary key default gen_random_uuid(),
  building_id       uuid not null references public.buildings(id) on delete cascade,
  token             text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  label             text,
  is_active         boolean not null default true,
  created_by        uuid references public.profiles(id) on delete set null,   -- reported_by for intake issues; null once that account is gone
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz,
  submissions_count integer not null default 0
);
create index if not exists intake_tokens_building_active_idx on public.intake_tokens (building_id) where is_active;

alter table public.intake_tokens enable row level security;
revoke all on table public.intake_tokens from anon;
drop policy if exists it_select on public.intake_tokens;
create policy it_select on public.intake_tokens for select
  using (public.is_admin_or_manager() and public.can_access_building(building_id));
drop policy if exists it_insert on public.intake_tokens;
create policy it_insert on public.intake_tokens for insert
  with check (public.is_admin_or_manager() and public.can_access_building(building_id) and created_by = auth.uid());
drop policy if exists it_update on public.intake_tokens;
create policy it_update on public.intake_tokens for update
  using (public.is_admin_or_manager() and public.can_access_building(building_id))
  with check (public.is_admin_or_manager() and public.can_access_building(building_id));
-- No delete policy on purpose: a token is disabled (is_active = false), never deleted — submissions_count is history.

-- ────────────────────────────────────────────────────────────────────────────────────────
-- 2) Rate-limit counters. bucket = 't:<token id>' or 'ip:<hashed ip>' (the function hashes with
--    INTAKE_IP_SALT; no raw IP is ever stored). Service role only, through intake_rate_hit.
-- ────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.intake_rate (
  bucket       text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (bucket, window_start)
);
alter table public.intake_rate enable row level security;   -- no policies: nobody but the service role reads or writes it
revoke all on table public.intake_rate from public, anon, authenticated;

create or replace function public.intake_rate_hit(p_bucket text, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_window timestamptz := date_trunc('hour', now()); v_count integer;
begin
  insert into public.intake_rate (bucket, window_start, count) values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set count = public.intake_rate.count + 1
  returning count into v_count;
  -- Opportunistic prune: a window older than a day can never be read again.
  delete from public.intake_rate where window_start < now() - interval '1 day';
  return v_count <= p_limit;
end $$;
revoke all on function public.intake_rate_hit(text, integer) from public;
revoke execute on function public.intake_rate_hit(text, integer) from anon, authenticated;
grant execute on function public.intake_rate_hit(text, integer) to service_role;

-- Bumps the token's counters after a stored submission (never for honeypot or rejected posts).
create or replace function public.intake_touch(p_token uuid)
returns void language sql security definer set search_path = '' as $$
  update public.intake_tokens
     set last_used_at = now(), submissions_count = submissions_count + 1
   where id = p_token
$$;
revoke all on function public.intake_touch(uuid) from public;
revoke execute on function public.intake_touch(uuid) from anon, authenticated;
grant execute on function public.intake_touch(uuid) to service_role;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- 3) Issues: where it came from, who reported it (no account), and the reference the tenant keeps.
-- ────────────────────────────────────────────────────────────────────────────────────────
alter table public.issues add column if not exists source text not null default 'app';
alter table public.issues drop constraint if exists issues_source_check;
alter table public.issues add constraint issues_source_check check (source in ('app', 'tenant_intake'));
alter table public.issues add column if not exists reporter jsonb;
alter table public.issues drop constraint if exists issues_reporter_object;
alter table public.issues add constraint issues_reporter_object check (reporter is null or jsonb_typeof(reporter) = 'object');
alter table public.issues add column if not exists reference text;
alter table public.issues drop constraint if exists issues_reference_format;
alter table public.issues add constraint issues_reference_format check (reference is null or reference ~ '^FO-[A-Z2-7]{6}$');
-- Unique only where present: app-created issues keep null and never collide.
create unique index if not exists issues_reference_uniq on public.issues (reference) where reference is not null;
create index if not exists issues_source_idx on public.issues (building_id, source) where source <> 'app';

-- Only the service role (no auth.uid()) may mark an issue as tenant-reported or give it a reference:
-- a signed-in client inserting source = 'tenant_intake' would forge the Tenant chip.
create or replace function public.issues_intake_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.source <> 'app' or new.reporter is not null or new.reference is not null then
      raise exception 'issues: source, reporter and reference are set by tenant intake only' using errcode = '42501';
    end if;
  elsif new.source is distinct from old.source or new.reporter is distinct from old.reporter
     or new.reference is distinct from old.reference then
    raise exception 'issues: source, reporter and reference cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.issues_intake_guard() from public;
revoke execute on function public.issues_intake_guard() from anon;
drop trigger if exists trg_issues_intake_guard on public.issues;
create trigger trg_issues_intake_guard before insert or update on public.issues
  for each row execute function public.issues_intake_guard();

-- ────────────────────────────────────────────────────────────────────────────────────────
-- 4) Form templates: the one catalogue. Ids '1'…'14' are what form_submissions.form_template_id
--    already stores. Read by every active user, written by admins; every content edit bumps version.
-- ────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.form_templates (
  id          text primary key,
  name        text not null,
  description text not null default '',
  category    text not null,
  icon        text not null default 'file-text',        -- lucide icon name (kebab-case); the client falls back to file-text
  fields      jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);
alter table public.form_templates enable row level security;
revoke all on table public.form_templates from anon;
drop policy if exists ft_select on public.form_templates;
create policy ft_select on public.form_templates for select using (public.is_active_user());
drop policy if exists ft_insert on public.form_templates;
create policy ft_insert on public.form_templates for insert with check (public.is_admin());
drop policy if exists ft_update on public.form_templates;
create policy ft_update on public.form_templates for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists ft_delete on public.form_templates;
create policy ft_delete on public.form_templates for delete using (public.is_admin());

create or replace function public.form_templates_touch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  -- The client never sets version; a content change (what a snapshot is taken against) bumps it.
  new.version := old.version;
  if new.fields is distinct from old.fields or new.name is distinct from old.name
     or new.description is distinct from old.description or new.category is distinct from old.category then
    new.version := old.version + 1;
  end if;
  return new;
end $$;
revoke all on function public.form_templates_touch() from public;
revoke execute on function public.form_templates_touch() from anon;
drop trigger if exists trg_form_templates_touch on public.form_templates;
create trigger trg_form_templates_touch before update on public.form_templates
  for each row execute function public.form_templates_touch();

-- Seed: names/descriptions/categories from FormsLibrary.tsx (the long form), icons reconciled
-- (7 file-spreadsheet, 9 shield, 10 flame, 11 file-text, 14 hard-hat), fields = src/lib/formFields.ts verbatim.
insert into public.form_templates (id, name, description, category, icon, sort_order, fields) values
('1', 'Key Access / Key Issuance Log', 'Track keys issued/returned, key ID, purpose', 'Security', 'key', 1, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Time","type":"time","required":true,"width":"half"},
 {"label":"Key ID / Number","type":"text","required":true,"width":"half"},
 {"label":"Key Description","type":"text","required":true,"width":"half"},
 {"label":"Issued To (Name)","type":"text","required":true},
 {"label":"Company / Department","type":"text","width":"half"},
 {"label":"Contact Number","type":"text","width":"half"},
 {"label":"Purpose of Issue","type":"textarea","required":true},
 {"label":"Issue Time","type":"time","required":true,"width":"half"},
 {"label":"Return Time","type":"time","width":"half"},
 {"label":"Supporting Photos","type":"photo","maxPhotos":3},
 {"label":"Recipient Signature","type":"signature","required":true},
 {"label":"Issuing Officer Signature","type":"signature","required":true},
 {"label":"Notes / Remarks","type":"textarea"}
]$json$::jsonb),
('2', 'Roof Access Journal', 'Record personnel, time in/out, work reason, permit', 'Maintenance', 'hard-hat', 2, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Permit Number","type":"text","width":"half"},
 {"label":"Personnel Name","type":"text","required":true},
 {"label":"Company","type":"text","required":true,"width":"half"},
 {"label":"ID Number","type":"text","width":"half"},
 {"label":"Time In","type":"time","required":true,"width":"half"},
 {"label":"Time Out","type":"time","width":"half"},
 {"label":"Reason for Access","type":"textarea","required":true},
 {"label":"Equipment Carried","type":"textarea"},
 {"label":"Safety Briefing Completed","type":"checkbox","required":true},
 {"label":"PPE Worn","type":"checkbox","required":true},
 {"label":"Supporting Photos","type":"photo","maxPhotos":5},
 {"label":"Authorised By","type":"text","required":true},
 {"label":"Authoriser Signature","type":"signature","required":true},
 {"label":"Personnel Signature","type":"signature","required":true}
]$json$::jsonb),
('3', 'Daily Site Handover Log', 'Shift notes, outstanding tasks, incidents', 'Operations', 'clipboard-list', 3, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Shift","type":"select","options":["Day Shift","Night Shift"],"required":true,"width":"half"},
 {"label":"Outgoing Officer Name","type":"text","required":true,"width":"half"},
 {"label":"Incoming Officer Name","type":"text","required":true,"width":"half"},
 {"label":"Handover Time","type":"time","required":true},
 {"label":"Outstanding Tasks","type":"textarea","required":true},
 {"label":"Incidents During Shift","type":"textarea"},
 {"label":"Equipment Status","type":"textarea"},
 {"label":"Key Items Handed Over","type":"textarea"},
 {"label":"Special Instructions","type":"textarea"},
 {"label":"Supporting Photos","type":"photo","maxPhotos":5},
 {"label":"Outgoing Officer Signature","type":"signature","required":true},
 {"label":"Incoming Officer Signature","type":"signature","required":true}
]$json$::jsonb),
('4', 'Asset Inspection Report', 'Condition checks for HVAC, lifts, escalators', 'Maintenance', 'wrench', 4, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Asset ID","type":"text","required":true,"width":"half"},
 {"label":"Asset Type","type":"select","options":["HVAC","Lift","Escalator","Generator","Fire System","Other"],"required":true},
 {"label":"Location","type":"text","required":true},
 {"label":"Inspector Name","type":"text","required":true},
 {"label":"Visual Condition","type":"select","options":["Good","Fair","Poor","Critical"],"required":true,"width":"half"},
 {"label":"Operational Status","type":"select","options":["Operational","Degraded","Non-Operational"],"required":true,"width":"half"},
 {"label":"Last Service Date","type":"date","width":"half"},
 {"label":"Next Service Due","type":"date","width":"half"},
 {"label":"Findings / Observations","type":"textarea","required":true},
 {"label":"Recommended Actions","type":"textarea"},
 {"label":"Evidence Photos","type":"photo","maxPhotos":5},
 {"label":"Inspector Signature","type":"signature","required":true}
]$json$::jsonb),
('5', 'Cleaning & Hygiene Log', 'Restroom checks, consumables restocked, deep-clean notes', 'Cleaning', 'clipboard-list', 5, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Time","type":"time","required":true,"width":"half"},
 {"label":"Area / Location","type":"text","required":true},
 {"label":"Cleaning Type","type":"select","options":["Routine","Deep Clean","Spot Clean","Sanitisation"],"required":true},
 {"label":"Cleaner Name","type":"text","required":true},
 {"label":"Floors Mopped","type":"checkbox"},
 {"label":"Surfaces Wiped","type":"checkbox"},
 {"label":"Bins Emptied","type":"checkbox"},
 {"label":"Consumables Restocked","type":"checkbox"},
 {"label":"Consumables Notes","type":"textarea"},
 {"label":"Issues Found","type":"textarea"},
 {"label":"Completion Photos","type":"photo","maxPhotos":5},
 {"label":"Supervisor Check","type":"checkbox"},
 {"label":"Cleaner Signature","type":"signature","required":true},
 {"label":"Supervisor Signature","type":"signature"}
]$json$::jsonb),
('6', 'Access Control / Visitor Log', 'Visitor name, company, host, ID, badge issued', 'Security', 'users', 6, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Time In","type":"time","required":true,"width":"half"},
 {"label":"Visitor Name","type":"text","required":true},
 {"label":"Company / Organisation","type":"text","required":true},
 {"label":"ID Type","type":"select","options":["ID Card","Passport","Driver's License","Other"],"required":true,"width":"half"},
 {"label":"ID Number","type":"text","required":true,"width":"half"},
 {"label":"Host Name","type":"text","required":true},
 {"label":"Host Department","type":"text","width":"half"},
 {"label":"Host Contact","type":"text","width":"half"},
 {"label":"Purpose of Visit","type":"textarea","required":true},
 {"label":"Badge Number Issued","type":"text","required":true},
 {"label":"Time Out","type":"time"},
 {"label":"Badge Returned","type":"checkbox"},
 {"label":"ID Photo / Supporting Documents","type":"photo","maxPhotos":3},
 {"label":"Visitor Signature","type":"signature","required":true},
 {"label":"Security Officer","type":"text","required":true}
]$json$::jsonb),
('7', 'Work Order / Job Card', 'Request, scope, cost, vendor, completion evidence', 'Operations', 'file-spreadsheet', 7, $json$[
 {"label":"Work Order Number","type":"text","required":true,"width":"half"},
 {"label":"Date Raised","type":"date","required":true,"width":"half"},
 {"label":"Requested By","type":"text","required":true},
 {"label":"Priority","type":"select","options":["Low","Medium","High","Emergency"],"required":true},
 {"label":"Location","type":"text","required":true},
 {"label":"Description of Work","type":"textarea","required":true},
 {"label":"Assigned Vendor / Technician","type":"text"},
 {"label":"Estimated Cost","type":"text","width":"half"},
 {"label":"Actual Cost","type":"text","width":"half"},
 {"label":"Start Date","type":"date","width":"half"},
 {"label":"Completion Date","type":"date","width":"half"},
 {"label":"Work Performed","type":"textarea"},
 {"label":"Materials Used","type":"textarea"},
 {"label":"Before / After Photos","type":"photo","maxPhotos":10},
 {"label":"Completion Evidence Attached","type":"checkbox"},
 {"label":"Technician Signature","type":"signature"},
 {"label":"Approved By Signature","type":"signature"}
]$json$::jsonb),
('8', 'Incident / Near-miss Report', 'Safety incidents, photos, corrective actions', 'Safety', 'alert-triangle', 8, $json$[
 {"label":"Date of Incident","type":"date","required":true,"width":"half"},
 {"label":"Time of Incident","type":"time","required":true,"width":"half"},
 {"label":"Location","type":"text","required":true},
 {"label":"Incident Type","type":"select","options":["Injury","Near Miss","Property Damage","Environmental","Security"],"required":true},
 {"label":"Severity","type":"select","options":["Minor","Moderate","Serious","Critical"],"required":true},
 {"label":"Persons Involved","type":"textarea","required":true},
 {"label":"Witnesses","type":"textarea"},
 {"label":"Description of Incident","type":"textarea","required":true},
 {"label":"Immediate Actions Taken","type":"textarea","required":true},
 {"label":"Root Cause Analysis","type":"textarea"},
 {"label":"Corrective Actions Required","type":"textarea","required":true},
 {"label":"Incident Photos","type":"photo","required":true,"maxPhotos":10},
 {"label":"First Aid Administered","type":"checkbox"},
 {"label":"Emergency Services Called","type":"checkbox"},
 {"label":"Reporter Name","type":"text","required":true},
 {"label":"Reporter Signature","type":"signature","required":true},
 {"label":"Manager Review Signature","type":"signature"}
]$json$::jsonb),
('9', 'Evacuation Drill Record', 'Drill date, attendance, timing, lessons learned', 'Safety', 'shield', 9, $json$[
 {"label":"Drill Date","type":"date","required":true,"width":"half"},
 {"label":"Drill Time","type":"time","required":true,"width":"half"},
 {"label":"Drill Type","type":"select","options":["Fire","Earthquake","Bomb Threat","General Emergency"],"required":true},
 {"label":"Building / Zone","type":"text","required":true},
 {"label":"Total Occupants","type":"text","required":true,"width":"half"},
 {"label":"Evacuation Time (minutes)","type":"text","required":true,"width":"half"},
 {"label":"Assembly Point Used","type":"text","required":true},
 {"label":"All Areas Cleared","type":"checkbox","required":true},
 {"label":"Roll Call Completed","type":"checkbox","required":true},
 {"label":"Fire Wardens Present","type":"textarea"},
 {"label":"Issues Identified","type":"textarea"},
 {"label":"Lessons Learned","type":"textarea"},
 {"label":"Recommendations","type":"textarea"},
 {"label":"Drill Photos","type":"photo","maxPhotos":5},
 {"label":"Drill Coordinator","type":"text","required":true},
 {"label":"Coordinator Signature","type":"signature","required":true}
]$json$::jsonb),
('10', 'Permit to Work / Hot Work Permit', 'Authorisation for hazardous tasks, controls', 'Safety', 'flame', 10, $json$[
 {"label":"Permit Number","type":"text","required":true,"width":"half"},
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Work Type","type":"select","options":["Hot Work","Confined Space","Working at Height","Electrical","Excavation"],"required":true},
 {"label":"Location","type":"text","required":true},
 {"label":"Contractor Name","type":"text","required":true},
 {"label":"Company","type":"text","required":true},
 {"label":"Description of Work","type":"textarea","required":true},
 {"label":"Start Time","type":"time","required":true,"width":"half"},
 {"label":"End Time","type":"time","required":true,"width":"half"},
 {"label":"Hazards Identified","type":"textarea","required":true},
 {"label":"Control Measures","type":"textarea","required":true},
 {"label":"Fire Extinguisher Available","type":"checkbox","required":true},
 {"label":"Fire Watch Required","type":"checkbox"},
 {"label":"Area Isolated","type":"checkbox"},
 {"label":"PPE Requirements","type":"textarea","required":true},
 {"label":"Site Condition Photos","type":"photo","maxPhotos":5},
 {"label":"Contractor Signature","type":"signature","required":true},
 {"label":"Authorising Officer","type":"text","required":true},
 {"label":"Authoriser Signature","type":"signature","required":true},
 {"label":"Permit Closed","type":"checkbox"},
 {"label":"Close-out Time","type":"time"},
 {"label":"Close-out Signature","type":"signature"}
]$json$::jsonb),
('11', 'Certificate Register', 'Statutory certificates, issuer, expiry, renewal actions', 'Compliance', 'file-text', 11, $json$[
 {"label":"Certificate Type","type":"text","required":true},
 {"label":"Certificate Number","type":"text","required":true},
 {"label":"Asset / Equipment","type":"text","required":true},
 {"label":"Location","type":"text","required":true},
 {"label":"Issuing Authority","type":"text","required":true},
 {"label":"Issue Date","type":"date","required":true,"width":"half"},
 {"label":"Expiry Date","type":"date","required":true,"width":"half"},
 {"label":"Renewal Lead Time (days)","type":"text","width":"half"},
 {"label":"Responsible Person","type":"text","required":true},
 {"label":"Renewal Status","type":"select","options":["Current","Due Soon","Expired","Renewed"],"required":true},
 {"label":"Notes / Actions","type":"textarea"},
 {"label":"Certificate Photos","type":"photo","maxPhotos":5},
 {"label":"Document Attached","type":"checkbox"}
]$json$::jsonb),
('12', 'Pest Control & Waste Log', 'Treatments, locations, hazardous waste disposals', 'Operations', 'clipboard-list', 12, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Type","type":"select","options":["Pest Control","Waste Disposal","Hazardous Waste"],"required":true,"width":"half"},
 {"label":"Location / Area","type":"text","required":true},
 {"label":"Contractor / Company","type":"text","required":true},
 {"label":"Technician Name","type":"text","required":true},
 {"label":"Treatment / Service Type","type":"textarea","required":true},
 {"label":"Chemicals / Materials Used","type":"textarea"},
 {"label":"Quantity Disposed (if waste)","type":"text"},
 {"label":"Disposal Method","type":"text"},
 {"label":"Findings / Observations","type":"textarea"},
 {"label":"Service Photos","type":"photo","maxPhotos":5},
 {"label":"Follow-up Required","type":"checkbox"},
 {"label":"Next Service Date","type":"date"},
 {"label":"Technician Signature","type":"signature","required":true},
 {"label":"FM Officer Signature","type":"signature"}
]$json$::jsonb),
('13', 'Parking & Vehicle Incident Log', 'Accidents, oil spills, tow actions', 'Security', 'truck', 13, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Time","type":"time","required":true,"width":"half"},
 {"label":"Incident Type","type":"select","options":["Accident","Oil Spill","Unauthorised Parking","Tow Required","Vandalism","Other"],"required":true},
 {"label":"Location / Bay Number","type":"text","required":true},
 {"label":"Vehicle Registration","type":"text","required":true},
 {"label":"Vehicle Make / Model","type":"text"},
 {"label":"Owner / Driver Name","type":"text"},
 {"label":"Contact Number","type":"text"},
 {"label":"Description of Incident","type":"textarea","required":true},
 {"label":"Actions Taken","type":"textarea","required":true},
 {"label":"Tow Company Called","type":"checkbox"},
 {"label":"Tow Company Name","type":"text"},
 {"label":"Incident Photos","type":"photo","maxPhotos":5},
 {"label":"Police Report Number","type":"text"},
 {"label":"Reporting Officer","type":"text","required":true},
 {"label":"Officer Signature","type":"signature","required":true}
]$json$::jsonb),
('14', 'Training & PPE Issuance Record', 'Attendance, issued PPE, refresher dates', 'HR/Safety', 'hard-hat', 14, $json$[
 {"label":"Date","type":"date","required":true,"width":"half"},
 {"label":"Type","type":"select","options":["Training","PPE Issuance","Both"],"required":true,"width":"half"},
 {"label":"Employee Name","type":"text","required":true},
 {"label":"Employee ID","type":"text","required":true,"width":"half"},
 {"label":"Department","type":"text","width":"half"},
 {"label":"Training Topic","type":"text"},
 {"label":"Training Duration (hours)","type":"text"},
 {"label":"Trainer Name","type":"text"},
 {"label":"PPE Items Issued","type":"textarea"},
 {"label":"PPE Size / Specifications","type":"textarea"},
 {"label":"Training / PPE Photos","type":"photo","maxPhotos":5},
 {"label":"Competency Assessment Passed","type":"checkbox"},
 {"label":"Refresher Due Date","type":"date"},
 {"label":"Employee Acknowledgement","type":"checkbox","required":true},
 {"label":"Employee Signature","type":"signature","required":true},
 {"label":"Issuing Officer","type":"text","required":true},
 {"label":"Officer Signature","type":"signature","required":true}
]$json$::jsonb)
on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- 5) Submissions remember what they were filled against (old rows stay null → the client
--    falls back to the template's current fields, as it does today).
-- ────────────────────────────────────────────────────────────────────────────────────────
alter table public.form_submissions add column if not exists template_version integer;
alter table public.form_submissions add column if not exists fields_snapshot jsonb;
alter table public.form_submissions drop constraint if exists form_submissions_fields_snapshot_array;
alter table public.form_submissions add constraint form_submissions_fields_snapshot_array
  check (fields_snapshot is null or jsonb_typeof(fields_snapshot) = 'array');

-- ────────────────────────────────────────────────────────────────────────────────────────
-- 6) Storage: intake photos are written by the service role under intake/<building_id>/…;
--    signed-in readers need building access (SignedImage re-signs the stored public-style URL).
--    No insert policy: a signed-in client must never write this prefix.
-- ────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists "td read intake photos" on storage.objects;
create policy "td read intake photos" on storage.objects for select using (
  bucket_id = 'tenant-documents'
  and split_part(name, '/', 1) = 'intake'
  and public.can_access_building(nullif(split_part(name, '/', 2), '')::uuid)
);

-- ────────────────────────────────────────────────────────────────────────────────────────
-- 7) Notification kind. Restated as the UNION of every kind the R4 slices add, because the
--    last migration to touch the constraint wins (R4a _01: issue_sla_breached; R4b _02:
--    report_due_soon, report_export_needed). Mirror: supabase/functions/_shared/notifyRules.ts.
-- ────────────────────────────────────────────────────────────────────────────────────────
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'task_assigned','issue_assigned','issue_comment','issue_mention',
  'report_submitted','report_returned','report_approved',
  'form_submitted','form_reviewed','signoff_requested','signoff_complete','signoff_overdue',
  'document_expiring','asset_service_due','task_due_today',
  'issue_sla_breached',
  'report_due_soon','report_export_needed',
  'issue_reported'));

commit;

-- Verify (staging, after apply):
--   select count(*) from public.form_templates;                                   -- 14
--   select id, version, jsonb_array_length(fields) from public.form_templates order by sort_order;
--   select policyname, cmd from pg_policies where tablename in ('intake_tokens','form_templates') order by 1;
--     -> ft_delete DELETE, ft_insert INSERT, ft_select SELECT, ft_update UPDATE, it_insert INSERT, it_select SELECT, it_update UPDATE
--   select has_function_privilege('anon', 'public.intake_rate_hit(text,integer)', 'execute'),
--          has_function_privilege('authenticated', 'public.intake_rate_hit(text,integer)', 'execute'),
--          has_function_privilege('service_role', 'public.intake_rate_hit(text,integer)', 'execute');   -- f, f, t
--   select policyname from pg_policies where tablename = 'objects' and policyname = 'td read intake photos';
--   select conname from pg_constraint where conname in ('issues_source_check','issues_reference_format','notifications_kind_check');
```

- [ ] **Step 2 — local Postgres 17 check (before staging).** The file must run twice against a scratch database without error. Stub what it references (the scratch prelude lives in the scratchpad, never in the repo):

```bash
SCRATCH=/private/tmp/claude-501/-Volumes-Extreme-SSD-DEVELOPER-APPS-FORTRESS-OPPS/8f1b4a69-7aa0-4cda-b7d3-bf70020ac665/scratchpad
mkdir -p "$SCRATCH"
cat > "$SCRATCH/r4c_prelude.sql" <<'SQL'
create schema if not exists auth; create schema if not exists storage;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create table if not exists public.profiles (id uuid primary key, full_name text, email text, deactivated boolean default false);
create table if not exists public.buildings (id uuid primary key default gen_random_uuid(), name text);
create table if not exists public.issues (id uuid primary key default gen_random_uuid(), building_id uuid references public.buildings(id), title text, description text, priority text default 'medium', status text default 'open', reported_by uuid, assigned_to uuid, category text, photo_urls jsonb, created_at timestamptz default now());
create table if not exists public.notifications (id uuid primary key default gen_random_uuid(), kind text not null);
create table if not exists public.form_submissions (id uuid primary key default gen_random_uuid(), building_id uuid, form_template_id text, form_name text, form_data jsonb);
create or replace function public.can_access_building(b uuid) returns boolean language sql stable as $$ select true $$;
create or replace function public.is_admin() returns boolean language sql stable as $$ select true $$;
create or replace function public.is_admin_or_manager() returns boolean language sql stable as $$ select true $$;
create or replace function public.is_active_user() returns boolean language sql stable as $$ select true $$;
SQL
dropdb --if-exists r4c_check && createdb r4c_check
psql -d r4c_check -v ON_ERROR_STOP=1 -q -f "$SCRATCH/r4c_prelude.sql"
psql -d r4c_check -v ON_ERROR_STOP=1 -q -f ../GMI/sql/2026-09-14_03_r4_intake_forms.sql
psql -d r4c_check -v ON_ERROR_STOP=1 -q -f ../GMI/sql/2026-09-14_03_r4_intake_forms.sql   # idempotent: second run is clean
psql -d r4c_check -At -c "select count(*) from public.form_templates" | grep -qx 14
psql -d r4c_check -At -c "select public.intake_rate_hit('t:x', 2), public.intake_rate_hit('t:x', 2), public.intake_rate_hit('t:x', 2)" | grep -qx 't|t|f'
psql -d r4c_check -At -c "update public.form_templates set is_active = false where id = '1' returning version" | grep -qx 1
psql -d r4c_check -At -c "update public.form_templates set name = 'x' where id = '1' returning version" | grep -qx 2
psql -d r4c_check -At -c "insert into public.buildings (name) values ('b')" >/dev/null
psql -d r4c_check -At -c "insert into public.issues (building_id, title, description, reported_by, source, reporter, reference) select id, 't', 'd', gen_random_uuid(), 'tenant_intake', '{\"name\":\"T\"}', 'FO-ABC234' from public.buildings limit 1 returning reference" | grep -qx 'FO-ABC234'
psql -d r4c_check -At -c "insert into public.issues (building_id, title, description, reported_by, reference) select id, 't', 'd', gen_random_uuid(), 'FO-ABC234' from public.buildings limit 1" 2>&1 | grep -q 'duplicate key'   # partial unique index holds
psql -d r4c_check -At -c "insert into public.issues (building_id, title, description, reported_by, reference) select id, 't', 'd', gen_random_uuid(), 'fo-abc234' from public.buildings limit 1" 2>&1 | grep -q 'issues_reference_format'   # format check holds
dropdb r4c_check
```
(`auth.uid()` is null in the scratch db, so the intake guard lets the reference insert through — that is the service-role path. The guard's signed-in branch is proved by `rls-smoke` on staging.)

- [ ] **Step 3 — vendor.** `npm run schema:vendor` → `git status` shows only `supabase/schema/2026-09-14_03_r4_intake_forms.sql` (new) and `supabase/schema/.source` (updated). Do not commit any other vendored diff you did not author (R4a/R4b may have vendored theirs first; if `.source` conflicts on commit, re-run the vendor step after theirs lands).

- [ ] **Step 4 — dependencies + script.** `npm install qrcode@^1.5.4 && npm install -D @types/qrcode@^1.5.5` (exact resolved versions land in `package-lock.json`). Add to `package.json` `scripts`, after `"smoke:calendar"`: `"smoke:intake": "node scripts/intake-smoke.mjs"`. `smoke:intake` is NOT added to the `smoke` chain: it needs the deployed function and, like `calendar-smoke`, refuses production.

- [ ] **Step 5 — `scripts/intake-smoke.mjs`.** Write it exactly as below.

```js
#!/usr/bin/env node
/**
 * Tenant intake smoke (R4c, spec §5.10) — the `tenant-intake` edge function end to end against
 * the live backend, with disposable fixtures it cleans up:
 *
 *   building + admin persona + site user assigned to it (the 'user' role rule → assignee)
 *   + one active tenant (shop 12) + an intake token (inserted with the service role exactly as
 *   the app's `intake_tokens` insert would) + the org flag features.tenant_intake switched ON
 *   →  GET /functions/v1/tenant-intake?t=<token> with NO credential (the way a phone opens the
 *   QR link)  →  POST multipart with one photo  →  issue row (source, reporter, reference,
 *   assigned_to, photo under intake/<building>/)  →  storage object exists  →  inbox rows kind
 *   issue_reported for the admin and the assignee  →  token counters  →  validation 400s
 *   →  honeypot 201 that stores nothing  →  429 on the 6th post from this IP  →  429 on the
 *   21st post for the token  →  recovery after the counters are cleared  →  disabled token 404
 *   →  flag off 404  →  405 for PUT.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... node scripts/intake-smoke.mjs
 *
 * The function must be deployed with INTAKE_IP_SALT set. The smoke resets the `ip:*` counters
 * before it starts (a re-run inside the hour would otherwise open on a 429), which is one more
 * reason it refuses production (SUPABASE_URL containing qdzgkttiosahdfqresvz) unless
 * SMOKE_ALLOW_PROD=1 — the same guard as calendar-smoke. It also flips the org's
 * features.tenant_intake flag on and restores the previous settings afterwards.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}
const PROD_REF = 'qdzgkttiosahdfqresvz';
if (URL_BASE.includes(PROD_REF) && process.env.SMOKE_ALLOW_PROD !== '1') {
  console.error(`Refusing to run against production (SUPABASE_URL contains ${PROD_REF}): this smoke creates users, flips the org feature flag and clears rate counters. Set SMOKE_ALLOW_PROD=1 to override.`);
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Intake-Smoke-${RUN}!`;
const SVC = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const FN = `${URL_BASE}/functions/v1/tenant-intake`;
const REFERENCE_RE = /^FO-[A-Z2-7]{6}$/;
// A 1×1 JPEG. The function checks content type and size, not pixels; this keeps the upload real.
const JPEG_1PX = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==', 'base64');

let pass = 0, failures = 0;
const fails = [];
const ok = (n) => { pass++; console.log(`  PASS  ${n}`); };
const fail = (n, d) => { failures++; fails.push(`${n} — ${d}`); console.error(`  FAIL  ${n} — ${d}`); };
const assert = (n, cond, d) => (cond ? ok(n) : fail(n, d));

async function svcInsert(table, row) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}`, { method: 'POST', headers: { ...SVC, Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!res.ok) throw new Error(`fixture ${table}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}
async function svcSelect(table, filter) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { headers: SVC });
  if (!res.ok) throw new Error(`select ${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
async function svcPatch(table, filter, patch) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { method: 'PATCH', headers: { ...SVC, Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(`patch ${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
async function svcUpsert(table, row, onConflict) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?on_conflict=${onConflict}`, { method: 'POST', headers: { ...SVC, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row) });
  if (!res.ok) throw new Error(`upsert ${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
async function svcDelete(table, filter) {
  await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: SVC });
}

const cleanup = [];   // [table, filter] LIFO
const userIds = [];
async function persona(tag, role, buildingId) {
  const email = `zztest-intake-${tag}-${RUN}@buildingops.app`;
  let res = await fetch(`${URL_BASE}/auth/v1/admin/users`, { method: 'POST', headers: SVC, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }) });
  const id = (await res.json()).id;
  if (!id) throw new Error(`persona ${tag} create failed`);
  userIds.push(id);
  await fetch(`${URL_BASE}/rest/v1/user_roles?on_conflict=user_id`, { method: 'POST', headers: { ...SVC, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: id, role }) });
  if (buildingId) await svcInsert('user_buildings', { user_id: id, building_id: buildingId });
  return { id, email };
}
const mintToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const hourStart = () => { const d = new Date(); d.setUTCMinutes(0, 0, 0); return d.toISOString(); };

/** Exactly what the public page sends: multipart, no apikey, no Authorization. */
function formData(token, over = {}, photos = []) {
  const fd = new FormData();
  const fields = { t: token, title: `ZZTEST intake ${RUN}`, description: 'The light in the passage is out', name: 'Thandi Tenant', shop_number: '12', phone: '0821234567', email: 'thandi@example.com', category: 'Lighting', website: '', ...over };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, String(v));
  for (const p of photos) fd.append('photos', new Blob([p.bytes], { type: p.type }), p.name);
  return fd;
}
async function get(token) {
  const res = await fetch(`${FN}?t=${encodeURIComponent(token)}`);
  return { status: res.status, headers: res.headers, body: await res.text() };
}
async function post(fd) {
  const res = await fetch(FN, { method: 'POST', body: fd });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, headers: res.headers, text, json };
}

let orgId = null, orgSettingsBefore = null, building = null;
try {
  console.log(`intake-smoke vs ${URL_BASE} (run ${RUN})`);

  // ── setup ──
  await svcDelete('intake_rate', 'bucket=like.ip:*');   // a re-run inside the hour must not open on a 429
  building = (await svcInsert('buildings', { name: `ZZTEST-INTAKE-${RUN}` })).id;
  cleanup.push(['buildings', `id=eq.${building}`]);
  const admin = await persona('admin', 'admin');
  const site = await persona('site', 'user', building);
  await svcInsert('building_role_assignments', { building_id: building, role: 'user', user_id: site.id });
  const tenant = await svcInsert('building_tenants', { building_id: building, shop_number: '12', shop_name: `ZZTEST Shop ${RUN}`, unit_number: 'G12', is_active: true });
  cleanup.unshift(['building_tenants', `id=eq.${tenant.id}`]);
  const tokenRow = await svcInsert('intake_tokens', { building_id: building, token: mintToken(), created_by: admin.id, label: `ZZTEST ${RUN}` });
  cleanup.unshift(['intake_tokens', `id=eq.${tokenRow.id}`]);
  const orgs = await svcSelect('organizations', 'select=id,settings&limit=1');
  if (!orgs[0] || !('settings' in orgs[0])) throw new Error('organizations.settings is missing — apply the R4a migration (2026-09-14_01) first');
  orgId = orgs[0].id; orgSettingsBefore = orgs[0].settings ?? {};
  const withFlag = (on) => ({ ...orgSettingsBefore, features: { ...(orgSettingsBefore.features ?? {}), tenant_intake: on } });
  await svcPatch('organizations', `id=eq.${orgId}`, { settings: withFlag(true) });
  ok('fixtures: building, admin, site user (role rule "user"), tenant 12, token, flag on');

  // ── 1. GET ──
  let r = await get('');
  assert('GET without token: 404', r.status === 404, `HTTP ${r.status}`);
  r = await get('garbage');
  assert('GET malformed token: 404', r.status === 404, `HTTP ${r.status}`);
  const unknown = await get(mintToken());
  assert('GET unknown token: 404 identical to malformed', unknown.status === 404 && unknown.body === r.body, `${unknown.status}/${unknown.body}`);
  r = await get(tokenRow.token);
  assert('GET good token: 200 JSON', r.status === 200 && (r.headers.get('content-type') ?? '').includes('application/json'), `HTTP ${r.status} ${r.body.slice(0, 120)}`);
  assert('GET: no-store', (r.headers.get('cache-control') ?? '').includes('no-store'), r.headers.get('cache-control'));
  const info = JSON.parse(r.body || '{}');
  assert('GET: building name, org branding, categories', info.building?.name === `ZZTEST-INTAKE-${RUN}` && typeof info.org?.name === 'string' && Array.isArray(info.categories) && info.categories.includes('Lighting'), JSON.stringify(info).slice(0, 200));
  assert('GET: shop 12 listed by number and name only', info.shops?.some((s) => s.shopNumber === '12' && s.shopName === `ZZTEST Shop ${RUN}`) && !JSON.stringify(info).includes(building), JSON.stringify(info.shops ?? []).slice(0, 200));

  // ── 2. POST with a photo ──
  let p = await post(formData(tokenRow.token, {}, [{ bytes: JPEG_1PX, type: 'image/jpeg', name: 'light.jpg' }]));
  assert('POST: 201', p.status === 201, `HTTP ${p.status} ${p.text.slice(0, 200)}`);
  const reference = p.json?.reference;
  assert('POST: reference FO-XXXXXX and nothing else', REFERENCE_RE.test(reference ?? '') && Object.keys(p.json ?? {}).length === 1, p.text.slice(0, 120));
  const issues = await svcSelect('issues', `reference=eq.${reference}&select=*`);
  const issue = issues[0];
  cleanup.unshift(['issues', `reference=eq.${reference}`]);
  assert('issue row: source tenant_intake, medium, open, category', issue && issue.source === 'tenant_intake' && issue.priority === 'medium' && issue.status === 'open' && issue.category === 'Lighting', JSON.stringify(issue ?? null).slice(0, 200));
  assert('issue row: reporter jsonb (name, shop from the tenant row, unit, phone, email)', issue?.reporter?.name === 'Thandi Tenant' && issue.reporter.shop === `ZZTEST Shop ${RUN}` && issue.reporter.shop_number === '12' && issue.reporter.unit === 'G12' && issue.reporter.phone === '0821234567' && issue.reporter.email === 'thandi@example.com', JSON.stringify(issue?.reporter));
  assert('issue row: reported_by = token creator, assigned_to = the building\'s "user" rule', issue?.reported_by === admin.id && issue?.assigned_to === site.id, `reported_by=${issue?.reported_by} assigned_to=${issue?.assigned_to}`);
  const photoUrl = issue?.photo_urls?.[0] ?? '';
  const photoPath = photoUrl.split('/object/public/tenant-documents/')[1] ?? '';
  assert('issue row: one photo under intake/<building>/', issue?.photo_urls?.length === 1 && photoPath.startsWith(`intake/${building}/`), photoUrl);
  const obj = await fetch(`${URL_BASE}/storage/v1/object/tenant-documents/${photoPath}`, { headers: SVC });
  assert('storage: the object exists', obj.ok && (obj.headers.get('content-type') ?? '').startsWith('image/jpeg'), `HTTP ${obj.status}`);
  const notes = await svcSelect('notifications', `entity_id=eq.${issue?.id}&kind=eq.issue_reported&select=recipient_id,url,title`);
  cleanup.unshift(['notifications', `entity_id=eq.${issue?.id}`]);
  const recipients = new Set(notes.map((n) => n.recipient_id));
  assert('notifications: issue_reported for the admin and the assignee, url /issues?open=<id>', recipients.has(admin.id) && recipients.has(site.id) && notes.every((n) => n.url === `/issues?open=${issue?.id}`), JSON.stringify(notes).slice(0, 200));
  const tok = (await svcSelect('intake_tokens', `id=eq.${tokenRow.id}&select=submissions_count,last_used_at`))[0];
  assert('token: submissions_count 1, last_used_at set', tok?.submissions_count === 1 && !!tok?.last_used_at, JSON.stringify(tok));

  // ── 3. validation (these count against the limits: 2, 3, 4 of 5 for this IP) ──
  p = await post(formData(tokenRow.token, { title: '' }));
  assert('POST missing title: 400 invalid[title]', p.status === 400 && p.json?.error === 'invalid' && p.json.fields?.includes('title'), `HTTP ${p.status} ${p.text.slice(0, 120)}`);
  p = await post(formData(tokenRow.token, { shop_number: '999' }));
  assert('POST unknown shop: 400 invalid[shop_number]', p.status === 400 && p.json?.fields?.includes('shop_number'), `HTTP ${p.status} ${p.text.slice(0, 120)}`);
  p = await post(formData(tokenRow.token, {}, Array.from({ length: 4 }, (_, i) => ({ bytes: JPEG_1PX, type: 'image/jpeg', name: `p${i}.jpg` }))));
  assert('POST four photos: 400 invalid[photos]', p.status === 400 && p.json?.fields?.includes('photos'), `HTTP ${p.status} ${p.text.slice(0, 120)}`);

  // ── 4. honeypot (5 of 5) ──
  p = await post(formData(tokenRow.token, { website: 'http://spam.example' }));
  assert('honeypot: 201 with a reference', p.status === 201 && REFERENCE_RE.test(p.json?.reference ?? ''), `HTTP ${p.status} ${p.text.slice(0, 120)}`);
  assert('honeypot: nothing stored', (await svcSelect('issues', `reference=eq.${p.json?.reference}&select=id`)).length === 0, 'an issue row exists for the honeypot reference');
  assert('honeypot: token counter untouched', (await svcSelect('intake_tokens', `id=eq.${tokenRow.id}&select=submissions_count`))[0]?.submissions_count === 1, 'submissions_count moved');

  // ── 5. per-IP limit: the 6th post this hour ──
  p = await post(formData(tokenRow.token));
  assert('6th POST from this IP: 429 rate_limited + Retry-After', p.status === 429 && p.json?.error === 'rate_limited' && !!p.headers.get('retry-after'), `HTTP ${p.status} ${p.text.slice(0, 120)}`);

  // ── 6. per-token limit: counter forced to 20, ip counters cleared ──
  await svcDelete('intake_rate', 'bucket=like.ip:*');
  await svcUpsert('intake_rate', { bucket: `t:${tokenRow.id}`, window_start: hourStart(), count: 20 }, 'bucket,window_start');
  p = await post(formData(tokenRow.token));
  assert('21st POST for the token: 429', p.status === 429 && p.json?.error === 'rate_limited', `HTTP ${p.status} ${p.text.slice(0, 120)}`);
  await svcDelete('intake_rate', `bucket=eq.t:${tokenRow.id}`);
  p = await post(formData(tokenRow.token, { title: `ZZTEST second ${RUN}` }));
  assert('after clearing the counters: 201 again (no photo → photo_urls null)', p.status === 201 && REFERENCE_RE.test(p.json?.reference ?? ''), `HTTP ${p.status} ${p.text.slice(0, 120)}`);
  if (p.json?.reference) {
    cleanup.unshift(['issues', `reference=eq.${p.json.reference}`]);
    const second = (await svcSelect('issues', `reference=eq.${p.json.reference}&select=photo_urls,reference`))[0];
    assert('second issue: photo_urls null, distinct reference', second?.photo_urls === null && second.reference !== reference, JSON.stringify(second));
  }

  // ── 7. disabled token, flag off, method ──
  await svcPatch('intake_tokens', `id=eq.${tokenRow.id}`, { is_active: false });
  r = await get(tokenRow.token);
  assert('disabled token: GET 404', r.status === 404, `HTTP ${r.status}`);
  p = await post(formData(tokenRow.token));
  assert('disabled token: POST 404', p.status === 404, `HTTP ${p.status}`);
  await svcPatch('intake_tokens', `id=eq.${tokenRow.id}`, { is_active: true });
  await svcPatch('organizations', `id=eq.${orgId}`, { settings: withFlag(false) });
  r = await get(tokenRow.token);
  assert('flag off: GET 404 even for an active token', r.status === 404, `HTTP ${r.status}`);
  await svcPatch('organizations', `id=eq.${orgId}`, { settings: withFlag(true) });
  const put = await fetch(FN, { method: 'PUT' });
  assert('PUT: 405 with Allow', put.status === 405 && (put.headers.get('allow') ?? '').includes('POST'), `HTTP ${put.status}`);
} catch (e) {
  fail('smoke run', e.message);
} finally {
  // storage objects for the fixture building
  const listed = await fetch(`${URL_BASE}/storage/v1/object/list/tenant-documents`, { method: 'POST', headers: SVC, body: JSON.stringify({ prefix: `intake/${building}`, limit: 100 }) }).then((r) => r.ok ? r.json() : []).catch(() => []);
  for (const o of listed ?? []) await fetch(`${URL_BASE}/storage/v1/object/tenant-documents/intake/${building}/${o.name}`, { method: 'DELETE', headers: SVC });
  for (const [table, filter] of cleanup) await svcDelete(table, filter);
  await svcDelete('intake_rate', 'bucket=like.ip:*');
  if (orgId && orgSettingsBefore !== null) await svcPatch('organizations', `id=eq.${orgId}`, { settings: orgSettingsBefore }).catch(() => {});
  for (const id of userIds) {
    await svcDelete('notifications', `recipient_id=eq.${id}`);
    await svcDelete('user_buildings', `user_id=eq.${id}`);
    await svcDelete('user_roles', `user_id=eq.${id}`);
    await fetch(`${URL_BASE}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: SVC });
  }
  const left = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-INTAKE-*&select=id`, { headers: SVC })).json();
  console.log((left.length ?? 0) === 0 ? '  teardown: clean' : `  WARN  ${left.length} ZZTEST-INTAKE buildings left`);
}

console.log(`\n${pass} passed, ${failures} failed`);
if (fails.length) for (const f of fails) console.log(`  - ${f}`);
console.log(failures === 0 ? 'TENANT INTAKE HOLDS' : 'TENANT INTAKE BROKEN');
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 6 — `scripts/rls-smoke.mjs` probes.** Add to the header comment, after the R3c line: ` *   R4c "Intake"   → intake_tokens select/insert/update admin+manager by building access (insert: created_by = caller), no delete, never anon; intake_rate + intake_rate_hit/intake_touch service-role only; issues.source/reporter/reference refused for signed-in writers; form_templates select any active user, write admin, version bumps on content only; form_submissions snapshot columns follow fs_insert; storage intake/<building> read by access, never written by a session`. Insert the block below immediately before the line `} catch (e) {` that follows the R3c `console.log(...)`, and add `await fetch(\`${URL_BASE}/rest/v1/intake_rate?bucket=like.zz:${RUN}*\`, { method: 'DELETE', headers: SVC });` to the teardown right after the `task_instances` sweep.

```js
  // ── R4c "Intake & Forms": intake_tokens, intake_rate + RPCs, issues intake guard, form_templates, snapshot columns, storage intake/ ──
  const IT = 'intake_tokens';
  const mintIntake = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const itA = (await svcInsert(IT, { building_id: A, token: mintIntake(), created_by: personas.admin.id, label: `ZZTEST-RLS-${RUN}` })).id;
  cleanup.push([IT, itA]);
  await probeMatrix(`${IT}(A) select`, adminMgr(), (jwt) => canSelect(jwt, IT, itA));
  await probeMatrix(`${IT}(A) insert own`, adminMgr(), (jwt, who) => canInsert(jwt, IT, { building_id: A, token: mintIntake(), created_by: personas[who].id }));
  assert(`${IT} insert with a foreign created_by as admin`, (await canInsert(personas.admin.jwt, IT, { building_id: A, token: mintIntake(), created_by: personas.manager.id })) === false, 'created_by must be the caller');
  assert(`${IT} insert a 10-char token as admin`, (await canInsert(personas.admin.jwt, IT, { building_id: A, token: 'tooshort', created_by: personas.admin.id })) === false, 'the token format check did not hold');
  await probeMatrix(`${IT}(A) disable`, adminMgr(), (jwt) => canUpdate(jwt, IT, itA, { is_active: false }));
  await probeMatrix(`${IT}(A) delete`, nobody(), (jwt) => canDelete(jwt, IT, itA));
  {
    const anonRes = await fetch(`${URL_BASE}/rest/v1/${IT}?select=id&limit=1`, { headers: { apikey: ANON } });
    assert(`${IT} not readable by anon`, !anonRes.ok, `HTTP ${anonRes.status}`);
    const rateRes = await fetch(`${URL_BASE}/rest/v1/intake_rate?select=bucket&limit=1`, { headers: authed(personas.admin.jwt) });
    assert('intake_rate not readable by authenticated (admin)', !rateRes.ok, `HTTP ${rateRes.status}`);
    for (const [fn, args] of [['intake_rate_hit', { p_bucket: `zz:${RUN}`, p_limit: 1 }], ['intake_touch', { p_token: itA }]]) {
      const anonR = await rpcCall(null, fn, args);
      assert(`${fn} not executable by anon`, anonR.status === 401 || anonR.status === 403, `HTTP ${anonR.status}`);
      const authR = await rpcCall(personas.admin.jwt, fn, args);
      assert(`${fn} not executable by authenticated (admin)`, authR.status === 403, `HTTP ${authR.status}`);
    }
  }
  // The Tenant chip cannot be forged: a session may not write source/reporter/reference, nor change them.
  assert('issues insert with source tenant_intake as admin', (await canInsert(personas.admin.jwt, 'issues', { building_id: A, title: `ZZTEST-RLS-${RUN}`, description: 'x', reported_by: personas.admin.id, source: 'tenant_intake' })) === false, 'a signed-in writer forged a tenant-reported issue');
  assert('issues insert with a reference as admin', (await canInsert(personas.admin.jwt, 'issues', { building_id: A, title: `ZZTEST-RLS-${RUN}`, description: 'x', reported_by: personas.admin.id, reference: 'FO-ABC234' })) === false, 'a signed-in writer set a reference');
  {
    const intakeIssue = (await svcInsert('issues', { building_id: A, title: `ZZTEST-RLS-${RUN}`, description: 'x', reported_by: personas.admin.id, source: 'tenant_intake', reporter: { name: 'T' }, reference: `FO-${RUN.toUpperCase().replace(/[^A-Z2-7]/g, 'A').slice(0, 6).padEnd(6, 'A')}` })).id;
    cleanup.push(['issues', intakeIssue]);
    assert('issues: admin may still change status on a tenant-reported issue', (await canUpdate(personas.admin.jwt, 'issues', intakeIssue, { status: 'in_progress' })) === true, 'the guard blocked an ordinary update');
    assert('issues: admin may not clear the reference', (await canUpdate(personas.admin.jwt, 'issues', intakeIssue, { reference: null })) === false, 'the guard let the reference change');
    assert('issues: admin may not flip source back to app', (await canUpdate(personas.admin.jwt, 'issues', intakeIssue, { source: 'app' })) === false, 'the guard let source change');
  }
  const FT = 'form_templates';
  const ftId = `zztest-rls-${RUN}`;
  await svcInsert(FT, { id: ftId, name: `ZZTEST-RLS-${RUN}`, category: 'Test', fields: [{ label: 'A', type: 'text' }] });
  cleanup.push([FT, ftId]);
  await probeMatrix(`${FT} select`, anyAuth(), (jwt) => canSelect(jwt, FT, ftId));
  await probeMatrix(`${FT} insert`, adminOnly(), (jwt, who) => canInsert(jwt, FT, { id: `zztest-rls-ins-${RUN}-${who}`, name: 'x', category: 'Test' }));
  await probeMatrix(`${FT} update (description)`, adminOnly(), (jwt) => canUpdate(jwt, FT, ftId, { description: 'changed' }));
  {
    const after = await (await fetch(`${URL_BASE}/rest/v1/${FT}?id=eq.${ftId}&select=version`, { headers: SVC })).json();
    assert(`${FT} version bumped by the admin's description edit`, after[0]?.version === 2, `version=${after[0]?.version}`);
    await canUpdate(personas.admin.jwt, FT, ftId, { is_active: false });
    const after2 = await (await fetch(`${URL_BASE}/rest/v1/${FT}?id=eq.${ftId}&select=version`, { headers: SVC })).json();
    assert(`${FT} version NOT bumped by an is_active toggle`, after2[0]?.version === 2, `version=${after2[0]?.version}`);
    await canUpdate(personas.admin.jwt, FT, ftId, { version: 99 });
    const after3 = await (await fetch(`${URL_BASE}/rest/v1/${FT}?id=eq.${ftId}&select=version`, { headers: SVC })).json();
    assert(`${FT} client-sent version ignored`, after3[0]?.version === 2, `version=${after3[0]?.version}`);
    const anonFt = await fetch(`${URL_BASE}/rest/v1/${FT}?select=id&limit=1`, { headers: { apikey: ANON } });
    assert(`${FT} not readable by anon`, !anonFt.ok, `HTTP ${anonFt.status}`);
  }
  await probeMatrix(`${FT} delete`, adminOnly(), (jwt) => canDelete(jwt, FT, ftId));
  // Snapshot columns ride the existing fs_insert policy.
  await probeMatrix('form_submissions insert with template_version + fields_snapshot (A)', byAccess('A'), (jwt, who) =>
    canInsert(jwt, 'form_submissions', { building_id: A, form_name: `ZZTEST-RLS-${RUN}`, form_template_id: '1', submitted_by: personas[who].id, template_version: 1, fields_snapshot: [{ label: 'A', type: 'text' }] }));
  // Storage: intake/<building>/… is written only by the service role; read follows building access.
  await probeMatrix('storage intake/<A> write', nobody(), (jwt) => storagePut(jwt, 'tenant-documents', `intake/${A}/zztest-${RUN}.txt`));
  {
    const path = `intake/${A}/zztest-svc-${RUN}.txt`;
    const up = await fetch(`${URL_BASE}/storage/v1/object/tenant-documents/${path}`, { method: 'POST', headers: { ...SVC, 'Content-Type': 'text/plain' }, body: 'rls-smoke' });
    if (up.ok) {
      storageCleanup.push(['tenant-documents', path]);
      await probeMatrix('storage intake/<A> read', byAccess('A'), (jwt) => storageGet(jwt, 'tenant-documents', path));
    } else {
      skip('storage intake/<A> read', `service-role upload failed: HTTP ${up.status}`);
    }
  }
  console.log('  R4c intake & forms (intake_tokens, intake_rate + RPCs, issues guard, form_templates, snapshot columns, storage intake/): done');
```
(Deletes under `intake/` are covered by the existing `td delete admin` policy and are not re-probed here.)

- [ ] **Step 7 — tests + commit.** `node --check scripts/intake-smoke.mjs && node --check scripts/rls-smoke.mjs`; `npm run test` (unchanged: no TS touched). Commit: `git add ../GMI/sql/2026-09-14_03_r4_intake_forms.sql` is in the GMI repo — commit it THERE (`git -C ../GMI add sql/2026-09-14_03_r4_intake_forms.sql && git -C ../GMI commit -m "R4c: intake tokens, rate limits, issue source/reporter/reference, form_templates + seed, snapshot columns"`), then here: `git add supabase/schema/2026-09-14_03_r4_intake_forms.sql supabase/schema/.source scripts/intake-smoke.mjs scripts/rls-smoke.mjs package.json package-lock.json && git commit -m "R4c: intake & form-template migration, intake smoke, RLS probes, qrcode dependency"`.

**Controller after Task 1:** apply `_03` on staging **after** `_01` and `_02`; run the verify block; `node scripts/rls-smoke.mjs` (new R4c lines green); deploy Task 2's function before `npm run smoke:intake`.

---

### Task 2: `tenant-intake` edge function

**Files:** Create `supabase/functions/tenant-intake/index.ts`; modify `supabase/config.toml` (`[functions.tenant-intake] verify_jwt = false`), `supabase/functions/_shared/notifyRules.ts` (`issue_reported`), `supabase/functions/_shared/notify.ts` (`pushTo`), `src/lib/notifyRules.test.ts`. **Unchanged on purpose:** `_shared/cors.ts` (the public page is served from the app origin, which `corsHeaders` already echoes; the smoke and a phone browser send no `Origin` that needs allowing), `src/lib/pushUrl.ts` + `pushUrl.test.ts` (`/issues?open=` is already allowlisted; `/intake/` must never be).

- [ ] **Step 1 — `notifyRules.ts`.** Add `'issue_reported'` to `NOTIFICATION_KINDS` (after `'task_due_today'`), to `PUSH_KINDS`, and a `case 'issue_reported':` under the `issue_updates` group in `governingFlag`. Update the comment above `PUSH_KINDS`: "…a tenant's report needs the person who will act on it now (`issue_reported` is pushed to the assignee only — see `pushTo` in notify.ts)". It stays out of `CLIENT_KINDS`.

- [ ] **Step 2 — `notify.ts`.** Extend the input and the push filter:

```ts
export interface CreateNotificationsInput extends InboxInput {
  /** Email subject; defaults to the title. */
  subject?: string;
  /** Explanatory HTML above the body line (already escaped by the caller). */
  detailHtml?: string;
  /**
   * Names what `body` is in the email — "Reviewer notes", "Instructions" — so a free-text
   * paragraph arriving under the explanation reads as quoted input rather than more prose.
   * The inbox row keeps the plain, unlabelled body.
   */
  bodyLabel?: string;
  ctaText?: string;
  /**
   * Restrict the push (not the inbox row, not the email) to these recipients. `issue_reported`
   * goes to every admin/manager plus the assignee, but only the assignee's phone should buzz.
   */
  pushTo?: string[];
}
// in createNotifications, replace the existing pushRecipients computation (the three lines that
// filter `rows` by shouldPush and map to recipient_id) with:
  const pushAllowed = input.pushTo ? new Set(input.pushTo) : null;
  const pushRecipients = rows
    .filter((row) => (!pushAllowed || pushAllowed.has(row.recipient_id)) && shouldPush(input.kind, byId.get(row.recipient_id)!))
    .map((row) => row.recipient_id);
```

- [ ] **Step 3 — `src/lib/notifyRules.test.ts`.** `TABLE` gains `issue_reported: 'issue_updates'`; the push test becomes `it('pushes only the five urgent kinds', () => { expect([...PUSH_KINDS].sort()).toEqual(['issue_mention', 'issue_reported', 'signoff_requested', 'task_assigned', 'task_due_today']); })`; add `it('issue_reported is server-only', () => { expect(CLIENT_KINDS.has('issue_reported')).toBe(false); expect(parseNotifyBody({ ...validBody, kind: 'issue_reported' }).ok).toBe(false); })` using whatever valid-body fixture the file already builds for `parseNotifyBody`. (R4a adds `issue_sla_breached` to the same table/list concurrently; if their edit landed first, add yours alongside — the controller reconciles.)

- [ ] **Step 4 — `supabase/config.toml`.** Append:

```toml
# Public tenant intake (no user JWT — the tenant has no account). The per-building token from
# the QR code is the credential, resolved with the service role; unknown/disabled/flag-off → 404;
# rate-limited per token and per hashed IP (INTAKE_IP_SALT). Client: /intake/:token.
[functions.tenant-intake]
verify_jwt = false
```

- [ ] **Step 5 — `supabase/functions/tenant-intake/index.ts`.** Write it exactly as below.

```ts
// tenant-intake — the public "report a problem" endpoint behind a per-building QR token (spec §5.10,
// R4c Task 2). The tenant has no account: the token IS the credential (`verify_jwt = false`). It is
// resolved with the service role; a malformed, unknown or disabled token — or the org's
// features.tenant_intake flag being off — answers the same 404. POST is rate-limited per token and
// per hashed IP, drops honeypot hits without storing anything, uploads at most three photos under
// intake/<building>/ (a prefix no session can write), inserts the issue with a reference the tenant
// keeps, and notifies the admins/managers plus the building's assignee. Nothing here logs a token,
// an IP, a reference or a reporter field — counts and statuses only.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { escapeText } from "../_shared/email.ts";
import { adminAndManagerIds, createNotifications } from "../_shared/notify.ts";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const BUCKET = "tenant-documents";
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const TOKEN_LIMIT_PER_HOUR = 20;
const IP_LIMIT_PER_HOUR = 5;
const SHOP_CAP = 500;
const REFERENCE_ATTEMPTS = 5;
const PHOTO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REFERENCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const LIMITS = { title: 120, description: 2000, name: 80, shop_number: 20, phone: 30, email: 120 } as const;

/** What a tenant can pick; stored on issues.category. Mirrored nowhere — the page reads it from GET. */
const INTAKE_CATEGORIES = [
  "Electrical", "Plumbing", "Air-conditioning / HVAC", "Lighting", "Doors, locks & shopfront",
  "Roof & leaks", "Cleaning & waste", "Pests", "Security", "Parking", "Other",
] as const;

type Json = Record<string, unknown>;
function json(status: number, body: Json, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
/** Malformed, unknown, disabled, and flag-off all look identical from outside. */
const notFound = (cors: Record<string, string>) => json(404, { error: "not_found" }, cors);

/** `FO-` + 6 base32 characters (RFC 4648 alphabet, `byte & 31`). */
function mintReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = "";
  for (const b of bytes) s += REFERENCE_ALPHABET[b & 31];
  return `FO-${s}`;
}

/** 32 hex chars of sha256(salt ':' ip). The raw address never leaves this function. */
async function ipBucket(req: Request, salt: string): Promise<string> {
  // Supabase's gateway sets x-forwarded-for; x-real-ip is the fallback for a local `functions serve`.
  // A request with neither shares one "unknown" bucket — logged once so it is never a silent 5/hour cap.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip")?.trim() || "";
  if (!ip) console.warn("tenant-intake: no client address header; using the shared bucket");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip || "unknown"}`));
  return "ip:" + Array.from(new Uint8Array(digest)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const clean = (v: FormDataEntryValue | null, max: number): string =>
  (typeof v === "string" ? v : "").replace(/\s+/g, " ").trim().slice(0, max);

type TokenRow = { id: string; building_id: string; is_active: boolean; created_by: string | null };
type Resolved = { token: TokenRow; buildingName: string };

// deno-lint-ignore no-explicit-any
type Admin = ReturnType<typeof createClient<any>>;

/** Token row + flag + building name, or null for every reason the caller must not learn. */
async function resolve(admin: Admin, token: string): Promise<Resolved | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data: row, error } = await admin
    .from("intake_tokens")
    .select("id, building_id, is_active, created_by")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  const t = row as TokenRow | null;
  if (!t || !t.is_active) return null;
  // Ship dark until the owner switches the flag on (organizations.settings is R4a's column).
  const { data: org, error: orgErr } = await admin.from("organizations").select("settings").limit(1).maybeSingle();
  if (orgErr) throw orgErr;
  const flag = (org as { settings?: { features?: { tenant_intake?: unknown } } } | null)?.settings?.features?.tenant_intake;
  if (flag !== true) return null;
  const { data: b, error: bErr } = await admin.from("buildings").select("name").eq("id", t.building_id).maybeSingle();
  if (bErr) throw bErr;
  if (!b) return null;
  return { token: t, buildingName: (b as { name: string | null }).name ?? "Building" };
}

async function handleGet(admin: Admin, resolved: Resolved, cors: Record<string, string>): Promise<Response> {
  const [{ data: shops, error: shopErr }, { data: org, error: orgErr }] = await Promise.all([
    admin
      .from("building_tenants")
      .select("shop_number, shop_name")
      .eq("building_id", resolved.token.building_id)
      .or("is_active.is.null,is_active.eq.true")
      .not("shop_number", "is", null)
      .order("shop_number")
      .limit(SHOP_CAP),
    admin.from("organizations").select("name, logo_url, primary_color").limit(1).maybeSingle(),
  ]);
  if (shopErr) throw shopErr;
  if (orgErr) throw orgErr;
  const o = (org ?? {}) as { name?: string | null; logo_url?: string | null; primary_color?: string | null };
  const color = typeof o.primary_color === "string" && /^#?[0-9a-f]{6}$/i.test(o.primary_color)
    ? (o.primary_color.startsWith("#") ? o.primary_color : `#${o.primary_color}`)
    : "#2563eb";
  console.log("tenant-intake: served", { method: "GET", shops: shops?.length ?? 0 });
  return json(200, {
    building: { name: resolved.buildingName },
    org: { name: o.name?.trim() || "Building Ops", logoUrl: o.logo_url ?? null, primaryColor: color },
    shops: ((shops ?? []) as { shop_number: string; shop_name: string | null }[]).map((s) => ({
      shopNumber: s.shop_number,
      shopName: s.shop_name ?? "",
    })),
    categories: INTAKE_CATEGORIES,
  }, cors);
}

async function handlePost(req: Request, admin: Admin, cors: Record<string, string>): Promise<Response> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("multipart/form-data")) {
    return json(400, { error: "invalid", fields: ["body"] }, cors);
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json(413, { error: "too_large" }, cors);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "invalid", fields: ["body"] }, cors);
  }

  const resolved = await resolve(admin, clean(form.get("t"), 64));
  if (!resolved) return notFound(cors);
  const { token, buildingName } = resolved;

  const salt = Deno.env.get("INTAKE_IP_SALT");
  if (!salt) {
    console.error("tenant-intake: INTAKE_IP_SALT is not set; refusing to accept submissions");
    return json(500, { error: "unavailable" }, cors);
  }

  // Both buckets are counted before either verdict is read: a burst that trips one limit still
  // burns the other, so alternating tokens from one address does not double the allowance.
  const [tokOk, ipOk] = await Promise.all([
    admin.rpc("intake_rate_hit", { p_bucket: `t:${token.id}`, p_limit: TOKEN_LIMIT_PER_HOUR }),
    admin.rpc("intake_rate_hit", { p_bucket: await ipBucket(req, salt), p_limit: IP_LIMIT_PER_HOUR }),
  ]);
  if (tokOk.error) throw tokOk.error;
  if (ipOk.error) throw ipOk.error;
  if (tokOk.data !== true || ipOk.data !== true) {
    console.log("tenant-intake: rate limited", { token: tokOk.data !== true, ip: ipOk.data !== true });
    return json(429, { error: "rate_limited" }, { ...cors, "Retry-After": "3600" });
  }

  // Honeypot: a filled hidden field is a bot. Answer like a success (a fresh, unstored reference)
  // so the sender learns nothing, and store nothing.
  if (clean(form.get("website"), 10)) {
    console.log("tenant-intake: served", { method: "POST", honeypot: 1 });
    return json(201, { reference: mintReference() }, cors);
  }

  const title = clean(form.get("title"), LIMITS.title);
  const description = clean(form.get("description"), LIMITS.description);
  const name = clean(form.get("name"), LIMITS.name);
  const shopNumber = clean(form.get("shop_number"), LIMITS.shop_number);
  const phone = clean(form.get("phone"), LIMITS.phone);
  const email = clean(form.get("email"), LIMITS.email).toLowerCase();
  const categoryRaw = clean(form.get("category"), 64);
  const category = (INTAKE_CATEGORIES as readonly string[]).includes(categoryRaw) ? categoryRaw : null;
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);

  const invalid: string[] = [];
  if (!title) invalid.push("title");
  if (!description) invalid.push("description");
  if (!name) invalid.push("name");
  if (email && !EMAIL_RE.test(email)) invalid.push("email");
  if (files.length > MAX_PHOTOS || files.some((f) => !PHOTO_EXT[f.type] || f.size > MAX_PHOTO_BYTES)) invalid.push("photos");

  // A shop number is optional, but one that is given must be a real shop in this building; the
  // tenant row's name and unit go onto the issue so the team knows where to go.
  let shop: string | null = null;
  let unit: string | null = null;
  if (shopNumber) {
    const { data: tenant, error } = await admin
      .from("building_tenants")
      .select("shop_name, unit_number")
      .eq("building_id", token.building_id)
      .eq("shop_number", shopNumber)
      .or("is_active.is.null,is_active.eq.true")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!tenant) invalid.push("shop_number");
    else {
      shop = (tenant as { shop_name: string | null }).shop_name ?? null;
      unit = (tenant as { unit_number: string | null }).unit_number ?? null;
    }
  }
  if (invalid.length) return json(400, { error: "invalid", fields: invalid }, cors);

  // Photos: service-role upload under the intake prefix. The stored value is the public-style
  // URL, the same shape src/lib/photos.ts writes, so SignedImage re-signs it on read.
  const photoUrls: string[] = [];
  for (const f of files) {
    const path = `intake/${token.building_id}/${crypto.randomUUID()}.${PHOTO_EXT[f.type]}`;
    const { error } = await admin.storage.from(BUCKET).upload(path, await f.arrayBuffer(), { contentType: f.type, upsert: false });
    if (error) {
      console.error("tenant-intake: upload failed:", error.message ?? error);
      return json(500, { error: "upload_failed" }, cors);
    }
    photoUrls.push(admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
  }

  // Who acts on it: the building's 'issue' rule, else its 'user' rule, else nobody.
  const { data: rules, error: rulesErr } = await admin
    .from("building_role_assignments")
    .select("role, user_id")
    .eq("building_id", token.building_id)
    .in("role", ["issue", "user"]);
  if (rulesErr) throw rulesErr;
  const ruleFor = (role: string) => ((rules ?? []) as { role: string; user_id: string }[]).find((r) => r.role === role)?.user_id ?? null;
  const assignee = ruleFor("issue") ?? ruleFor("user");

  // reported_by is not null on issues: the token creator, or the first admin if that account is gone.
  const admins = await adminAndManagerIds(admin);
  let reportedBy = token.created_by;
  if (!reportedBy) {
    const { data } = await admin.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
    reportedBy = (data as { user_id: string } | null)?.user_id ?? admins[0] ?? null;
  }
  if (!reportedBy) {
    console.error("tenant-intake: no account to report under");
    return json(500, { error: "unavailable" }, cors);
  }

  const reporter = { name, shop_number: shopNumber || null, shop, unit, phone: phone || null, email: email || null };
  const issueId = crypto.randomUUID();
  let reference = "";
  for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt++) {
    reference = mintReference();
    const { error } = await admin.from("issues").insert({
      id: issueId,
      building_id: token.building_id,
      title,
      description,
      category,
      priority: "medium",
      status: "open",
      reported_by: reportedBy,
      assigned_to: assignee,
      source: "tenant_intake",
      reporter,
      reference,
      photo_urls: photoUrls.length ? photoUrls : null,
    });
    if (!error) break;
    // 23505 on the reference's partial unique index → mint another; anything else is fatal.
    if (error.code !== "23505" || attempt === REFERENCE_ATTEMPTS - 1) throw error;
    reference = "";
  }

  // Counters ride after the response (the same waitUntil pattern as ics-feed's last_used_at).
  const touch = admin.rpc("intake_touch", { p_token: token.id }).then(({ error }: { error: { message?: string } | null }) => {
    if (error) console.warn("tenant-intake: intake_touch failed:", error.message ?? error);
  });
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  runtime?.waitUntil?.(touch);

  // The issue is stored by now, so a notification failure is logged, never surfaced to the tenant.
  let notified: Record<string, number> = {};
  try {
    const recipients = Array.from(new Set([...admins, ...(assignee ? [assignee] : [])]));
    const shopLabel = shop ? `${shop} (${shopNumber})` : shopNumber ? `Shop ${shopNumber}` : "No shop given";
    const result = await createNotifications(admin, {
      recipients,
      actorId: null,
      actorName: "Tenant intake",
      kind: "issue_reported",
      entityType: "issue",
      entityId: issueId,
      buildingId: token.building_id,
      title: `Tenant reported: ${title}`,
      body: `${buildingName} · ${shopLabel} · ${name}`,
      url: `/issues?open=${issueId}`,
      subject: `Tenant report in ${buildingName}: ${title}`,
      detailHtml: `<p style="margin:0 0 12px;">A tenant reported a problem in <strong>${escapeText(buildingName)}</strong> through the intake form (reference ${escapeText(reference)}).${assignee ? "" : " Nobody is assigned yet."}</p>`,
      bodyLabel: "Where and who",
      ctaText: "Open the issue",
      pushTo: assignee ? [assignee] : admins,
    });
    notified = { inserted: result.inserted, pushed: result.pushed, emailed: result.emailed, failed: result.failed };
  } catch (e) {
    console.error("tenant-intake: notify failed:", e instanceof Error ? e.message : e);
  }

  console.log("tenant-intake: served", { method: "POST", photos: photoUrls.length, assigned: assignee ? 1 : 0, notified });
  return json(201, { reference }, cors);
}

serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET" && req.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, { ...cors, Allow: "GET, POST, OPTIONS" });
  }
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (req.method === "GET") {
      const resolved = await resolve(admin, new URL(req.url).searchParams.get("t") ?? "");
      if (!resolved) return notFound(cors);
      return await handleGet(admin, resolved, cors);
    }
    return await handlePost(req, admin, cors);
  } catch (error) {
    // The message may name a table or column, never the token or the tenant (neither is interpolated).
    console.error("tenant-intake error:", error instanceof Error ? error.message : error);
    return json(500, { error: "unavailable" }, cors);
  }
});
```

- [ ] **Step 6 — verify locally, deploy to staging, smoke.** `deno check supabase/functions/tenant-intake/index.ts` (or `supabase functions serve tenant-intake --no-verify-jwt --env-file <staging env>` and `curl -i "http://localhost:54321/functions/v1/tenant-intake?t=garbage"` → 404 JSON). `npm run test` green (notifyRules tests). Deploy: `supabase secrets set INTAKE_IP_SALT="$(openssl rand -base64 32)" --project-ref vkrihpmjajjcxmzgjqdr && supabase functions deploy tenant-intake --project-ref vkrihpmjajjcxmzgjqdr` (staging ref; the controller does prod). Then `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=… npm run smoke:intake` → `TENANT INTAKE HOLDS`. Commit: `git add supabase/functions/tenant-intake/index.ts supabase/config.toml supabase/functions/_shared/notifyRules.ts supabase/functions/_shared/notify.ts src/lib/notifyRules.test.ts && git commit -m "R4c: tenant-intake public function (token GET, multipart POST, rate limits, honeypot, reference, issue_reported)"`.

---

### Task 3: Client intake — public page, Tenants card, Tenant chip

**Files:** Create `src/lib/intakeForm.ts` (+ `intakeForm.test.ts`), `src/lib/issueSource.ts` (+ test), `src/lib/intakeSheet.ts` (+ test), `src/hooks/useIntakeTokens.ts` (+ test), `src/components/building/TenantIntakeCard.tsx` (+ test), `src/pages/IntakePage.tsx` (+ test); modify `src/App.tsx` (public route `/intake/:token`), `src/components/building/TenantsTab.tsx` (mount the card), `src/hooks/useIssues.ts` (`source`, `reporter`, `reference`), `src/pages/Issues.tsx` (Tenant chip + search), `src/components/issues/IssueDetailDialog.tsx` + `IssueDetailDialog.test.tsx` (reporter block). `qrcode` is already installed by Task 1.

- [ ] **Step 1 — `src/lib/issueSource.ts`.**

```ts
/**
 * Where an issue came from (R4c, spec §5.10). `issues.source` is 'app' for everything the app
 * creates and 'tenant_intake' for reports through the public QR form; only the tenant-intake
 * function (service role) may write the latter — a DB trigger refuses it from any session.
 */
export const TENANT_SOURCE = 'tenant_intake' as const;
export type IssueSource = 'app' | typeof TENANT_SOURCE;

/** `issues.reporter` — the person who reported through the intake form (no account). */
export interface IssueReporter {
  name: string;
  shop_number: string | null;
  shop: string | null;
  unit: string | null;
  phone: string | null;
  email: string | null;
}

export function isTenantIssue(issue: { source?: IssueSource | string | null }): boolean {
  return issue.source === TENANT_SOURCE;
}

/** jsonb → typed, tolerating anything the column might hold. */
export function parseReporter(value: unknown): IssueReporter | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const str = (k: string) => (typeof v[k] === 'string' && (v[k] as string).trim() ? (v[k] as string).trim() : null);
  const name = str('name');
  if (!name) return null;
  return { name, shop_number: str('shop_number'), shop: str('shop'), unit: str('unit'), phone: str('phone'), email: str('email') };
}

/** "Thandi Tenant · Kool Kids (Shop 12) · Unit G12" — for cards and the detail header. */
export function reporterSummary(r: IssueReporter | null | undefined): string {
  if (!r) return 'Tenant';
  const parts = [r.name];
  if (r.shop && r.shop_number) parts.push(`${r.shop} (Shop ${r.shop_number})`);
  else if (r.shop) parts.push(r.shop);
  else if (r.shop_number) parts.push(`Shop ${r.shop_number}`);
  if (r.unit) parts.push(`Unit ${r.unit}`);
  return parts.join(' · ');
}
```

- [ ] **Step 2 — `src/lib/intakeForm.ts`.**

```ts
/**
 * The public tenant intake form (spec §5.10): limits, validation, the multipart request the
 * tenant-intake function accepts, and the two fetch wrappers. No Supabase client on purpose —
 * the page is public, the token is the credential, and nothing it fetches may land in the
 * persisted query cache on a tenant's phone.
 */
export const INTAKE_LIMITS = {
  title: 120, description: 2000, name: 80, shopNumber: 20, phone: 30, email: 120, photos: 3, photoMB: 5,
} as const;
export const REFERENCE_RE = /^FO-[A-Z2-7]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What `GET /tenant-intake?t=` answers (see plan Contracts). */
export interface IntakeInfo {
  building: { name: string };
  org: { name: string; logoUrl: string | null; primaryColor: string };
  shops: { shopNumber: string; shopName: string }[];
  categories: string[];
}

export interface IntakeValues {
  title: string; description: string; name: string; shopNumber: string; phone: string; email: string; category: string;
}
export type IntakeField = keyof IntakeValues;
export type IntakeErrors = Partial<Record<IntakeField, string>>;
export const EMPTY_INTAKE: IntakeValues = { title: '', description: '', name: '', shopNumber: '', phone: '', email: '', category: '' };

/** Plain guardrail copy (never through <Hint>): what stops a submission. */
export function validateIntake(v: IntakeValues): IntakeErrors {
  const e: IntakeErrors = {};
  const title = v.title.trim(), description = v.description.trim(), name = v.name.trim(), email = v.email.trim();
  if (!title) e.title = 'Tell us what the problem is';
  else if (title.length > INTAKE_LIMITS.title) e.title = `Keep the summary under ${INTAKE_LIMITS.title} characters`;
  if (!description) e.description = 'Describe the problem and where it is';
  else if (description.length > INTAKE_LIMITS.description) e.description = `Keep the description under ${INTAKE_LIMITS.description} characters`;
  if (!name) e.name = 'Your name lets the team follow up';
  else if (name.length > INTAKE_LIMITS.name) e.name = `Keep your name under ${INTAKE_LIMITS.name} characters`;
  if (email && !EMAIL_RE.test(email)) e.email = 'That email address does not look right';
  if (v.phone.trim().length > INTAKE_LIMITS.phone) e.phone = `Keep the phone number under ${INTAKE_LIMITS.phone} characters`;
  return e;
}

/** The link the QR code carries; the route is public (outside ProtectedRoute). */
export function intakeUrl(token: string, origin: string = window.location.origin): string {
  return `${origin}/intake/${token}`;
}

export function intakeFunctionUrl(): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tenant-intake`;
}

/** Field names are the function's contract; `website` is the honeypot the page keeps empty. */
export function buildIntakeFormData(token: string, v: IntakeValues, photos: File[], honeypot = ''): FormData {
  const fd = new FormData();
  fd.append('t', token);
  fd.append('title', v.title.trim());
  fd.append('description', v.description.trim());
  fd.append('name', v.name.trim());
  if (v.shopNumber.trim()) fd.append('shop_number', v.shopNumber.trim());
  if (v.phone.trim()) fd.append('phone', v.phone.trim());
  if (v.email.trim()) fd.append('email', v.email.trim());
  if (v.category) fd.append('category', v.category);
  fd.append('website', honeypot);
  for (const f of photos.slice(0, INTAKE_LIMITS.photos)) fd.append('photos', f, f.name || 'photo.jpg');
  return fd;
}

export type IntakeSubmitResult =
  | { ok: true; reference: string }
  | { ok: false; kind: 'invalid' | 'rate_limited' | 'not_found' | 'too_large' | 'failed'; fields: string[] };

/** 404 → null (the page shows "this link is not active"); network/5xx → throws. */
export async function fetchIntakeInfo(token: string, fetchImpl: typeof fetch = fetch): Promise<IntakeInfo | null> {
  const res = await fetchImpl(`${intakeFunctionUrl()}?t=${encodeURIComponent(token)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Intake info failed: HTTP ${res.status}`);
  return (await res.json()) as IntakeInfo;
}

export async function submitIntake(fd: FormData, fetchImpl: typeof fetch = fetch): Promise<IntakeSubmitResult> {
  let res: Response;
  try {
    res = await fetchImpl(intakeFunctionUrl(), { method: 'POST', body: fd });
  } catch {
    return { ok: false, kind: 'failed', fields: [] };
  }
  const body = (await res.json().catch(() => ({}))) as { reference?: string; error?: string; fields?: string[] };
  if (res.status === 201 && typeof body.reference === 'string' && REFERENCE_RE.test(body.reference)) {
    return { ok: true, reference: body.reference };
  }
  if (res.status === 400) return { ok: false, kind: 'invalid', fields: Array.isArray(body.fields) ? body.fields : [] };
  if (res.status === 404) return { ok: false, kind: 'not_found', fields: [] };
  if (res.status === 413) return { ok: false, kind: 'too_large', fields: [] };
  if (res.status === 429) return { ok: false, kind: 'rate_limited', fields: [] };
  return { ok: false, kind: 'failed', fields: [] };
}

/** Server-side field rejections → the field on the page and plain copy for it. */
export function serverFieldError(field: string): { field: IntakeField | 'photos'; message: string } | null {
  switch (field) {
    case 'title': return { field: 'title', message: 'Tell us what the problem is' };
    case 'description': return { field: 'description', message: 'Describe the problem and where it is' };
    case 'name': return { field: 'name', message: 'Your name lets the team follow up' };
    case 'email': return { field: 'email', message: 'That email address does not look right' };
    case 'shop_number': return { field: 'shopNumber', message: 'Pick your shop from the list' };
    case 'photos': return { field: 'photos', message: `Up to ${INTAKE_LIMITS.photos} photos of ${INTAKE_LIMITS.photoMB} MB each` };
    default: return null;
  }
}

export const SUBMIT_ERROR_COPY: Record<Exclude<IntakeSubmitResult, { ok: true }>['kind'], string> = {
  invalid: 'Please check the highlighted fields.',
  rate_limited: 'Too many reports from this phone or this link in the last hour. Please try again later.',
  not_found: 'This link is no longer active. Ask the building team for the current QR code.',
  too_large: 'The photos are too large to send. Remove one and try again.',
  failed: 'Could not send your report. Check your connection and try again.',
};
```

- [ ] **Step 3 — `src/lib/intakeSheet.ts`.**

```ts
/**
 * The printable A5 sheet for a building's intake QR code ("Report a problem in <building>").
 * Pure HTML so it is unit-tested; TenantIntakeCard opens it in a new window and prints.
 */
export interface IntakeSheetInput {
  buildingName: string;
  orgName: string;
  url: string;
  /** `qrcode.toDataURL` output (PNG data URL). */
  qrDataUrl: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function intakeSheetHtml(i: IntakeSheetInput): string {
  const building = escapeHtml(i.buildingName);
  const org = escapeHtml(i.orgName);
  const url = escapeHtml(i.url);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Report a problem — ${building}</title>
<style>
  @page { size: A5 portrait; margin: 12mm; }
  html, body { margin: 0; font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; }
  .sheet { width: 124mm; margin: 0 auto; text-align: center; }
  h1 { font-size: 22pt; margin: 0 0 4mm; }
  .building { font-size: 14pt; margin: 0 0 8mm; color: #333; }
  .qr { width: 80mm; height: 80mm; }
  .url { font-size: 9pt; word-break: break-all; color: #444; margin: 6mm 0 8mm; }
  ol { text-align: left; font-size: 11pt; padding-left: 8mm; margin: 0 0 8mm; }
  li { margin-bottom: 2mm; }
  .org { font-size: 9pt; color: #666; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style></head>
<body><div class="sheet">
  <h1>Report a problem</h1>
  <p class="building">${building}</p>
  <img class="qr" src="${i.qrDataUrl}" alt="QR code linking to the report form">
  <p class="url">${url}</p>
  <ol>
    <li>Scan the code with your phone camera.</li>
    <li>Describe the problem and add a photo.</li>
    <li>Keep the reference number you are given.</li>
  </ol>
  <p class="org">${org}</p>
</div>
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 150); });</script>
</body></html>`;
}

/** Opens the sheet in a new window (the PWA may block popups: returns false so the caller can say so). */
export function openPrintWindow(html: string): boolean {
  const w = window.open('', '_blank', 'noopener,width=600,height=850');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
```

- [ ] **Step 4 — `src/hooks/useIntakeTokens.ts`.**

```ts
/**
 * A building's tenant-intake link (spec §5.10). One ACTIVE row per building; the token is a
 * bearer secret minted client-side exactly like calendar tokens (32 random bytes, base64url) and
 * stored plain under admin/manager-by-building RLS. Rotating inserts the new row first and then
 * disables the old one, so a failed insert leaves the old link working rather than none. Nothing
 * is ever deleted: `submissions_count` is history.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { mintToken } from '@/lib/calendarTokens';
import { intakeUrl } from '@/lib/intakeForm';

export const intakeTokensKey = (buildingId: string | undefined) => ['intake-tokens', buildingId] as const;

/** Plain guardrail copy for a write RLS refused or filtered to nothing. */
export const INTAKE_PERMISSION_MESSAGE = "Only admins and managers can manage this building's intake link.";

// intake_tokens is not yet in the generated types; regenerate after the migration ships.
export interface IntakeToken {
  id: string;
  building_id: string;
  token: string;
  label: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  submissions_count: number;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any };

interface PgError { code?: string; message?: string }
function assertWrote(error: PgError | null, rows: unknown[] | null | undefined): void {
  if (error) {
    if (error.code === '42501' || error.code === 'PGRST116') throw new Error(INTAKE_PERMISSION_MESSAGE);
    throw error;
  }
  if (!rows || rows.length === 0) throw new Error(INTAKE_PERMISSION_MESSAGE);
}

export async function readActiveToken(buildingId: string): Promise<IntakeToken | null> {
  const { data, error } = await db
    .from('intake_tokens')
    .select('id, building_id, token, label, is_active, created_by, created_at, last_used_at, submissions_count')
    .eq('building_id', buildingId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as IntakeToken | null) ?? null;
}

async function insertToken(uid: string, buildingId: string, label: string): Promise<IntakeToken> {
  const { data, error } = await db
    .from('intake_tokens')
    .insert({ building_id: buildingId, token: mintToken(), label, created_by: uid })
    .select('id, building_id, token, label, is_active, created_by, created_at, last_used_at, submissions_count');
  assertWrote(error, data);
  return (data as IntakeToken[])[0];
}

async function disableToken(id: string): Promise<void> {
  const { data, error } = await db.from('intake_tokens').update({ is_active: false }).eq('id', id).select('id');
  assertWrote(error, data);
}

export interface IntakeTokensState {
  /** The active token row, or null when the building has no live link (or while loading). */
  token: IntakeToken | null;
  /** `intakeUrl(token)`, or null. */
  url: string | null;
  isLoading: boolean;
  isError: boolean;
  isMutating: boolean;
  create: () => Promise<void>;
  rotate: () => Promise<void>;
  disable: () => Promise<void>;
}

export function useIntakeTokens(buildingId: string | undefined, label = 'Tenant intake'): IntakeTokensState {
  const { user } = useAuth();
  const uid = user?.id;
  const qc = useQueryClient();
  const queryKey = intakeTokensKey(buildingId);

  const query = useQuery({
    queryKey,
    enabled: !!buildingId && !!uid,
    staleTime: 60_000,
    queryFn: () => readActiveToken(buildingId!),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey });

  const create = useMutation({
    mutationFn: async () => { await insertToken(uid!, buildingId!, label); },
    onSuccess: invalidate,
  });
  const rotate = useMutation({
    mutationFn: async () => {
      const old = query.data ?? null;
      await insertToken(uid!, buildingId!, label);     // new link first …
      if (old) await disableToken(old.id);              // … then the old one stops working
    },
    onSuccess: invalidate,
  });
  const disable = useMutation({
    mutationFn: async () => { if (query.data) await disableToken(query.data.id); },
    onSuccess: invalidate,
  });

  const token = query.data ?? null;
  return {
    token,
    url: token ? intakeUrl(token.token) : null,
    isLoading: query.isLoading,
    isError: query.isError,
    isMutating: create.isPending || rotate.isPending || disable.isPending,
    create: async () => { await create.mutateAsync(); },
    rotate: async () => { await rotate.mutateAsync(); },
    disable: async () => { await disable.mutateAsync(); },
  };
}
```

- [ ] **Step 5 — `src/components/building/TenantIntakeCard.tsx`.**

```tsx
/**
 * Building → Tenants: the tenant intake link (spec §5.10). Hidden until the org's tenant_intake
 * feature flag is on and only for admin/manager. Shows the live link with its QR code, prints
 * the A5 sheet, and rotates/disables the token. The card body is a separate component so the
 * flag/role gate can return early without breaking the rules of hooks.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toDataURL } from 'qrcode';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Copy, Printer, QrCode, RefreshCw, Ban, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useFeature } from '@/hooks/useOrgSettings';
import { useOrganization } from '@/hooks/useOrganization';
import { useIntakeTokens } from '@/hooks/useIntakeTokens';
import { intakeSheetHtml, openPrintWindow } from '@/lib/intakeSheet';
import { formatBuildingName } from '@/lib/buildingName';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Hint } from '@/components/ui/hint';

interface Props { buildingId: string }

export function TenantIntakeCard({ buildingId }: Props) {
  const enabled = useFeature('tenant_intake');
  const { isAdminOrManager } = useAuth();
  if (!enabled || !isAdminOrManager) return null;
  return <IntakeCardBody buildingId={buildingId} />;
}

function IntakeCardBody({ buildingId }: Props) {
  const { token, url, isLoading, isError, isMutating, create, rotate, disable } = useIntakeTokens(buildingId);
  const { organization } = useOrganization();
  const { data: buildingName } = useQuery({
    queryKey: ['building-name', buildingId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('buildings').select('name').eq('id', buildingId).maybeSingle();
      if (error) throw error;
      return formatBuildingName(data?.name ?? null) || 'this building';
    },
  });
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!url) { setQr(null); return; }
    toDataURL(url, { width: 256, margin: 1, errorCorrectionLevel: 'M' })
      .then((d) => { if (!cancelled) setQr(d); })
      .catch(() => { if (!cancelled) setQr(null); });
    return () => { cancelled = true; };
  }, [url]);

  const run = async (fn: () => Promise<void>, done: string) => {
    try { await fn(); toast.success(done); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong'); }
  };
  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); toast.success('Link copied'); }
    catch { toast.error('Could not copy — select the link and copy it by hand'); }
  };
  const print = () => {
    if (!url || !qr) return;
    const html = intakeSheetHtml({ buildingName: buildingName ?? 'this building', orgName: organization?.name ?? 'Building Ops', url, qrDataUrl: qr });
    if (!openPrintWindow(html)) toast.error('Your browser blocked the print window. Allow pop-ups for this site and try again.');
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><QrCode className="h-4 w-4" />Tenant intake</CardTitle>
        <CardDescription>A QR code tenants scan to report a problem in {buildingName ?? 'this building'} — no login needed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : isError ? (
          <p className="text-sm text-destructive">Could not load the intake link.</p>
        ) : !token ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No intake link yet.</p>
            <Button className="h-11" onClick={() => run(create, 'Intake link created')} disabled={isMutating}>Create link</Button>
            <Hint>Create the link, print the sheet, and put it where tenants will see it — the centre entrance, the loading bay, the notice board</Hint>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="shrink-0 self-center sm:self-start">
              {qr ? <img src={qr} alt="QR code for the tenant report form" className="h-40 w-40 rounded-md border bg-white" /> : <div className="h-40 w-40 rounded-md border bg-muted" />}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{token.submissions_count} report{token.submissions_count === 1 ? '' : 's'}</Badge>
                <span className="text-muted-foreground">{token.last_used_at ? `Last used ${format(new Date(token.last_used_at), 'd MMM yyyy')}` : 'Not used yet'}</span>
              </div>
              <code className="block break-all rounded bg-muted px-2 py-1.5 text-xs" aria-label="Intake link">{url}</code>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="h-11" onClick={copy}><Copy className="mr-2 h-4 w-4" />Copy link</Button>
                <Button variant="outline" className="h-11" onClick={print} disabled={!qr}><Printer className="mr-2 h-4 w-4" />Print QR sheet</Button>
                <Button variant="outline" className="h-11" disabled={isMutating}
                  onClick={() => { if (confirm('Rotate the link? The printed QR codes stop working and you will need to print new ones.')) void run(rotate, 'Intake link rotated — print the new sheet'); }}>
                  <RefreshCw className="mr-2 h-4 w-4" />Rotate
                </Button>
                <Button variant="ghost" className="h-11 text-destructive" disabled={isMutating}
                  onClick={() => { if (confirm('Disable tenant intake for this building? Scanning the QR code will show "link not active".')) void run(disable, 'Intake link disabled'); }}>
                  <Ban className="mr-2 h-4 w-4" />Disable
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Anyone with this link can report a problem in this building. Rotate it if it leaks.</p>
              <Hint>Reports arrive on the Issues page with a Tenant chip and go to the building's assignee; each tenant gets a reference number to quote</Hint>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6 — `src/pages/IntakePage.tsx`** (public; no `DashboardLayout`, no Supabase client).

```tsx
/**
 * /intake/:token — the tenant's "report a problem" form (spec §5.10). Public: outside
 * ProtectedRoute, nothing from the signed-in app shell, no Supabase client. The token in the URL
 * is the credential; GET answers branding + shop list or 404. Mobile-first: one column, 44 px
 * controls, camera capture through the same PhotoCapture pipeline the app uses (HEIC → JPEG,
 * compression, time caption; never a geotag from a tenant's phone).
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PhotoCapture, type PhotoFile } from '@/components/ui/photo-capture';
import {
  EMPTY_INTAKE, INTAKE_LIMITS, SUBMIT_ERROR_COPY, buildIntakeFormData, fetchIntakeInfo, serverFieldError,
  submitIntake, validateIntake, type IntakeErrors, type IntakeInfo, type IntakeValues,
} from '@/lib/intakeForm';

type LoadState = { kind: 'loading' } | { kind: 'inactive' } | { kind: 'error' } | { kind: 'ready'; info: IntakeInfo };

export default function IntakePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [values, setValues] = useState<IntakeValues>(EMPTY_INTAKE);
  const [errors, setErrors] = useState<IntakeErrors & { photos?: string }>({});
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [honeypot, setHoneypot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    fetchIntakeInfo(token)
      .then((info) => { if (!cancelled) setLoad(info ? { kind: 'ready', info } : { kind: 'inactive' }); })
      .catch(() => { if (!cancelled) setLoad({ kind: 'error' }); });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (load.kind === 'ready') document.title = `Report a problem — ${load.info.building.name}`;
  }, [load]);

  const set = (field: keyof IntakeValues) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateIntake(values);
    setErrors(found);
    setSubmitError(null);
    if (Object.values(found).some(Boolean)) return;
    setSubmitting(true);
    try {
      const fd = buildIntakeFormData(token, values, photos.map((p) => p.file), honeypot);
      const result = await submitIntake(fd);
      if (result.ok) {
        photos.forEach((p) => URL.revokeObjectURL(p.preview));
        setReference(result.reference);
        window.scrollTo({ top: 0 });
        return;
      }
      if (result.kind === 'invalid') {
        const next: IntakeErrors & { photos?: string } = {};
        for (const f of result.fields) { const m = serverFieldError(f); if (m) next[m.field] = m.message; }
        setErrors(next);
      }
      if (result.kind === 'not_found') setLoad({ kind: 'inactive' });
      setSubmitError(SUBMIT_ERROR_COPY[result.kind]);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setValues((v) => ({ ...EMPTY_INTAKE, name: v.name, shopNumber: v.shopNumber, phone: v.phone, email: v.email }));
    setPhotos([]);
    setErrors({});
    setSubmitError(null);
    setReference(null);
  };

  if (load.kind === 'loading') {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (load.kind !== 'ready') {
    return (
      <main className="mx-auto max-w-md p-6 text-center space-y-3">
        <AlertTriangle className="mx-auto h-8 w-8 text-warning" />
        <h1 className="text-xl font-semibold">{load.kind === 'inactive' ? 'This link is not active' : 'Could not load the form'}</h1>
        <p className="text-sm text-muted-foreground">
          {load.kind === 'inactive' ? 'Ask the building team for the current QR code.' : 'Check your connection and try again.'}
        </p>
        {load.kind === 'error' && <Button className="h-12" onClick={() => window.location.reload()}>Try again</Button>}
      </main>
    );
  }

  const { info } = load;
  const brand = info.org.primaryColor;

  return (
    <main className="mx-auto max-w-md pb-12">
      <header className="flex items-center gap-3 border-b-4 px-4 py-3" style={{ borderColor: brand }}>
        {info.org.logoUrl ? (
          <img src={info.org.logoUrl} alt={info.org.name} className="h-10 w-10 rounded-lg object-contain" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: brand }}><ClipboardCheck className="h-5 w-5 text-white" /></div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" style={{ color: brand }}>{info.org.name}</p>
          <p className="truncate text-xs text-muted-foreground">{info.building.name}</p>
        </div>
      </header>

      {reference ? (
        <section className="space-y-4 p-4 text-center" aria-live="polite">
          <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
          <h1 className="text-2xl font-bold">Thank you — we have your report</h1>
          <p className="text-sm text-muted-foreground">Your reference number</p>
          <p className="font-mono text-3xl font-bold tracking-widest" data-testid="reference">{reference}</p>
          <p className="text-sm text-muted-foreground">Keep it: the building team will quote it when they follow up.</p>
          <Button className="h-12 w-full" variant="outline" onClick={reset}>Report another problem</Button>
        </section>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5 p-4">
          <h1 className="text-2xl font-bold">Report a problem</h1>
          <p className="text-sm text-muted-foreground">Tell us what is wrong in {info.building.name}. A photo helps.</p>

          <div className="space-y-1.5">
            <Label htmlFor="intake-title">What is the problem? *</Label>
            <Input id="intake-title" className="h-11" maxLength={INTAKE_LIMITS.title} value={values.title} onChange={(e) => set('title')(e.target.value)} placeholder="e.g. Light out in the passage" aria-invalid={!!errors.title} />
            {errors.title && <p className="text-sm text-destructive">{errors.title}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="intake-description">Where is it and what happened? *</Label>
            <Textarea id="intake-description" rows={4} maxLength={INTAKE_LIMITS.description} value={values.description} onChange={(e) => set('description')(e.target.value)} aria-invalid={!!errors.description} />
            {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="intake-category">Type of problem</Label>
            <select id="intake-category" className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={values.category} onChange={(e) => set('category')(e.target.value)}>
              <option value="">Choose…</option>
              {info.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="intake-shop">Your shop</Label>
            <select id="intake-shop" className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={values.shopNumber} onChange={(e) => set('shopNumber')(e.target.value)} aria-invalid={!!errors.shopNumber}>
              <option value="">Not a shop / not listed</option>
              {info.shops.map((s) => <option key={s.shopNumber} value={s.shopNumber}>{s.shopNumber}{s.shopName ? ` — ${s.shopName}` : ''}</option>)}
            </select>
            {errors.shopNumber && <p className="text-sm text-destructive">{errors.shopNumber}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="intake-name">Your name *</Label>
            <Input id="intake-name" className="h-11" autoComplete="name" maxLength={INTAKE_LIMITS.name} value={values.name} onChange={(e) => set('name')(e.target.value)} aria-invalid={!!errors.name} />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="intake-phone">Phone</Label>
              <Input id="intake-phone" className="h-11" type="tel" inputMode="tel" autoComplete="tel" maxLength={INTAKE_LIMITS.phone} value={values.phone} onChange={(e) => set('phone')(e.target.value)} aria-invalid={!!errors.phone} />
              {errors.phone && <p className="text-sm text-destructive">{errors.phone}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intake-email">Email</Label>
              <Input id="intake-email" className="h-11" type="email" inputMode="email" autoComplete="email" maxLength={INTAKE_LIMITS.email} value={values.email} onChange={(e) => set('email')(e.target.value)} aria-invalid={!!errors.email} />
              {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <PhotoCapture
              label="Photos"
              photos={photos}
              onPhotosChange={(p) => { setPhotos(p); setErrors((e) => ({ ...e, photos: undefined })); }}
              maxPhotos={INTAKE_LIMITS.photos}
              maxSizeMB={INTAKE_LIMITS.photoMB}
              caption={{ time: true, geotag: false }}
              size="lg"
              disabled={submitting}
            />
            {errors.photos && <p className="text-sm text-destructive">{errors.photos}</p>}
          </div>

          {/* Honeypot: off-screen, never labelled, ignored by people, filled by bots. */}
          <div className="absolute left-[-9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden="true">
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
          </div>

          {submitError && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{submitError}</p>}

          <Button type="submit" className="h-12 w-full text-base" style={{ backgroundColor: brand }} disabled={submitting}>
            {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</>) : 'Send report'}
          </Button>
          <p className="text-center text-xs text-muted-foreground">Your name and contact details go to the building team only.</p>
        </form>
      )}
    </main>
  );
}
```

- [ ] **Step 7 — routes and mounts.** `src/App.tsx`: add `const IntakePage = lazy(() => import("./pages/IntakePage"));` next to the other lazy pages and, in the public block after `/reset`:
```tsx
              {/* Tenant intake (R4c): public by design — the token in the URL is the credential and
                  the tenant has no account. Never add /intake/ to the notification/push URL allowlists. */}
              <Route path="/intake/:token" element={<IntakePage />} />
```
`src/components/building/TenantsTab.tsx`: `import { TenantIntakeCard } from './TenantIntakeCard';` and, as the first child of the returned `<div className="space-y-4">` (before the header row): `<TenantIntakeCard buildingId={buildingId} />` (the card gates itself on the flag and the role).

- [ ] **Step 8 — issues surfaces.** `src/hooks/useIssues.ts`: `import { parseReporter, type IssueReporter, type IssueSource } from '@/lib/issueSource';` the `Issue` interface gains `source: IssueSource; reporter: IssueReporter | null; reference: string | null;` and is `export`ed. The select string gains `source, reporter, reference,` — run that one query through the untyped boundary (`// issues.source / reporter / reference are not yet in the generated types; regenerate after the migration ships.` + `const db = supabase as unknown as { from: (table: string) => any };`), map `source: (issue.source as IssueSource) ?? 'app', reporter: parseReporter(issue.reporter), reference: issue.reference ?? null`. `createIssue`'s `Omit<…>` also omits the three fields (they are server-set).
  `src/pages/Issues.tsx`: `import { isTenantIssue } from '@/lib/issueSource';` `matchesFilters`'s parameter type gains `reference?: string | null; reporter?: { name: string } | null` and the search also matches `(issue.reference ?? '').toLowerCase()` and `(issue.reporter?.name ?? '').toLowerCase()`. In the card's meta row (the `flex items-center gap-4 mt-3` div), after the deadline span:
```tsx
                        {isTenantIssue(issue) && (
                          <Badge variant="outline" className="border-info text-info" data-testid="tenant-chip">
                            Tenant{issue.reference ? ` · ${issue.reference}` : ''}
                          </Badge>
                        )}
```
  `src/components/issues/IssueDetailDialog.tsx`: the local `Issue` interface gains **optional** `source?: IssueSource; reporter?: IssueReporter | null; reference?: string | null;` (MyDay still passes its own shape); import `isTenantIssue, reporterSummary` and render, directly under the description paragraph:
```tsx
          {isTenantIssue(issue) && (
            <div className="rounded-lg border p-3 text-sm space-y-1" data-testid="tenant-report">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-info text-info">Tenant report</Badge>
                {issue.reference && <span className="font-mono text-xs">{issue.reference}</span>}
              </div>
              <p>{reporterSummary(issue.reporter)}</p>
              <p className="flex flex-wrap gap-3 text-xs">
                {issue.reporter?.phone && <a className="underline" href={`tel:${issue.reporter.phone}`}>{issue.reporter.phone}</a>}
                {issue.reporter?.email && <a className="underline" href={`mailto:${issue.reporter.email}`}>{issue.reporter.email}</a>}
              </p>
            </div>
          )}
```
  Test (`IssueDetailDialog.test.tsx`): one new `it` rendering `{ ...issue, source: 'tenant_intake', reference: 'FO-ABC234', reporter: { name: 'Thandi', shop: 'Kool Kids', shop_number: '12', unit: null, phone: '0821234567', email: null } }` and asserting `Tenant report`, `FO-ABC234`, `Thandi · Kool Kids (Shop 12)` and a `tel:0821234567` link; and one asserting the block is absent for the default fixture.

- [ ] **Step 9 — tests.** Write them with the repo's mock patterns (`useContractors.test.ts` chain recorder for the hook; `vi.stubGlobal('fetch', …)` for the page and lib).
  - `src/lib/intakeForm.test.ts`: `validateIntake` (empty → title/description/name; over-long title; bad email; good values → `{}`); `buildIntakeFormData` (field names, optional fields omitted when blank, `website` always present, photos capped at 3, `t` first); `intakeUrl('abc', 'https://x.app')` → `https://x.app/intake/abc`; `submitIntake` mapping for 201 (valid reference), 201 with a malformed reference → `failed`, 400 with fields, 404, 413, 429, 500, thrown fetch → `failed`; `fetchIntakeInfo` 404 → null, 500 → throws, 200 → parsed; `serverFieldError('shop_number')` → `shopNumber`.
  - `src/lib/issueSource.test.ts`: `parseReporter` (null/array/no name → null; trims; missing keys → null fields); `reporterSummary` variants; `isTenantIssue`.
  - `src/lib/intakeSheet.test.ts`: escapes `<` in the building name, contains the QR `src`, the URL, `size: A5`, and a `window.print` call; `openPrintWindow` returns false when `window.open` yields null.
  - `src/hooks/useIntakeTokens.test.ts`: `readActiveToken` chain (`eq building_id`, `eq is_active true`, `order created_at desc`, `limit 1`, `maybeSingle`); `create` inserts `{ building_id, token: 43 chars, label, created_by: uid }` and selects columns back; `rotate` inserts before updating the old row's `is_active`; a zero-row insert throws `INTAKE_PERMISSION_MESSAGE`; `disable` with no token is a no-op.
  - `src/components/building/TenantIntakeCard.test.tsx`: mock `@/hooks/useOrgSettings` (`useFeature`), `@/contexts/AuthContext`, `@/hooks/useIntakeTokens`, `qrcode` (`toDataURL` → `data:image/png;base64,QQ==`), `@/lib/intakeSheet` (`openPrintWindow`); flag off → renders nothing; role user → nothing; no token → "Create link" calls `create`; with a token → shows the URL, `3 reports`, Copy writes the clipboard, Print calls `openPrintWindow` with HTML containing the building name, Rotate (with `confirm` stubbed true) calls `rotate`.
  - `src/pages/IntakePage.test.tsx`: mock `@/components/ui/photo-capture` (`PhotoCapture: () => null`) and `fetch`; `MemoryRouter initialEntries={['/intake/tok']}` + `Routes`; 404 → "This link is not active"; 200 → heading "Report a problem", the shop option `12 — Kool Kids`, the categories; submit empty → three validation messages and no POST; filled + 201 `{ reference: 'FO-ABC234' }` → the reference is shown (`data-testid="reference"`) and the POST body is a `FormData` whose `t` is `tok` and `website` is `''`; 429 → the rate-limit copy; controls have `h-11`/`h-12` classes (44 px+).

- [ ] **Step 10 — gate + commit.** `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'intakeForm|issueSource|intakeSheet|useIntakeTokens|TenantIntakeCard|IntakePage|TenantsTab|useIssues|Issues.tsx|IssueDetailDialog|App.tsx'` prints nothing; `npm run test`; `npm run build` (the intake chunk must not pull `DashboardLayout`; check `dist/assets` for an `IntakePage-*.js` chunk). Commit: `git add src/lib/intakeForm.ts src/lib/intakeForm.test.ts src/lib/issueSource.ts src/lib/issueSource.test.ts src/lib/intakeSheet.ts src/lib/intakeSheet.test.ts src/hooks/useIntakeTokens.ts src/hooks/useIntakeTokens.test.ts src/components/building/TenantIntakeCard.tsx src/components/building/TenantIntakeCard.test.tsx src/pages/IntakePage.tsx src/pages/IntakePage.test.tsx src/App.tsx src/components/building/TenantsTab.tsx src/hooks/useIssues.ts src/pages/Issues.tsx src/components/issues/IssueDetailDialog.tsx src/components/issues/IssueDetailDialog.test.tsx && git commit -m "R4c: public tenant intake page, Tenants intake card with QR sheet, Tenant chip and reporter details on issues"`.

---

### Task 4: Client forms — one catalogue, snapshots, Settings → Forms admin

**Files:** Create `src/hooks/useFormTemplates.ts` (+ test), `src/components/forms/FormIcon.tsx`, `src/lib/formTemplateEditor.ts` (+ test), `src/components/settings/FormFieldEditor.tsx` (+ test), `src/components/settings/FormsAdminCard.tsx` (+ test), `src/components/forms/FillableFormDialog.test.tsx`; modify `src/lib/formFields.ts` (delete `defaultFormFields`, add the type unions), `src/pages/FormsLibrary.tsx`, `src/components/building/FormsTab.tsx`, `src/components/forms/FillableFormDialog.tsx`, `src/components/forms/FormPreviewDialog.tsx`, `src/components/forms/FormSubmissionsDialog.tsx`, `src/pages/Settings.tsx` (a "Forms" tab, admin only — two short insertions: a `TabsTrigger` and a `TabsContent`). **Decision:** the Forms admin is a card mounted inside `Settings.tsx`, NOT a `/settings/forms` route — `App.tsx` stays Task 3's alone, and R4a's concurrent card list in `Settings.tsx` is untouched (a new tab adds lines at the end of the tab list and the end of the content; if R4a has restructured the page by the time you get there, make the same two insertions wherever the tabs now live). `src/lib/reportDocs.ts` and `src/lib/pdfGenerator.ts` import only the `FormField` type and need no change.

- [ ] **Step 1 — `src/lib/formFields.ts`.** Keep `FormField`; delete `defaultFormFields` (the seed in the migration is the same data); add the unions the editor needs:

```ts
export const FORM_FIELD_TYPES = ['text', 'date', 'time', 'signature', 'checkbox', 'textarea', 'select', 'photo'] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];
export const FORM_FIELD_WIDTHS = ['full', 'half'] as const;

export interface FormField {
  label: string;
  type: FormFieldType;
  required?: boolean;
  options?: string[];
  width?: (typeof FORM_FIELD_WIDTHS)[number];
  maxPhotos?: number;
}

export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: 'Text', date: 'Date', time: 'Time', signature: 'Signature', checkbox: 'Checkbox', textarea: 'Paragraph', select: 'Dropdown', photo: 'Photos',
};
```

- [ ] **Step 2 — `src/components/forms/FormIcon.tsx`.**

```tsx
/** `form_templates.icon` (a lucide kebab name) → the icon; anything unknown renders as a document. */
import { AlertTriangle, ClipboardList, FileSpreadsheet, FileText, Flame, HardHat, Key, Shield, Truck, Users, Wrench, type LucideIcon } from 'lucide-react';

export const FORM_ICONS: Record<string, LucideIcon> = {
  'key': Key, 'hard-hat': HardHat, 'clipboard-list': ClipboardList, 'wrench': Wrench, 'users': Users,
  'file-spreadsheet': FileSpreadsheet, 'alert-triangle': AlertTriangle, 'shield': Shield, 'flame': Flame,
  'file-text': FileText, 'truck': Truck,
};
export const FORM_ICON_NAMES = Object.keys(FORM_ICONS);

export function FormIcon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const Icon = FORM_ICONS[name] ?? FileText;
  return <Icon className={className} aria-hidden="true" />;
}
```

- [ ] **Step 3 — `src/hooks/useFormTemplates.ts`.**

```ts
/**
 * The one form catalogue (spec §5.11). `form_templates` replaces the two hard-coded arrays and
 * `defaultFormFields`; ids '1'…'14' are what form_submissions.form_template_id already stores.
 * Readers filter `is_active`; the Settings admin sees every row. Every content save bumps
 * `version` server-side (trigger), and new submissions snapshot `fields` + `version`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { FormField } from '@/lib/formFields';

export const FORM_TEMPLATES_KEY = ['form-templates'] as const;

/** Plain guardrail copy for a write RLS refused or filtered to nothing. */
export const FORM_TEMPLATE_PERMISSION_MESSAGE = 'Only admins can change form templates.';

// form_templates is not yet in the generated types; regenerate after the migration ships.
export interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  fields: FormField[];
  is_active: boolean;
  sort_order: number;
  version: number;
  updated_at: string;
}
export type FormTemplatePatch = Partial<Pick<FormTemplate, 'name' | 'description' | 'category' | 'icon' | 'fields' | 'is_active' | 'sort_order'>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any };
const COLUMNS = 'id, name, description, category, icon, fields, is_active, sort_order, version, updated_at';

/** jsonb → FormField[]; a malformed row renders as an empty form rather than crashing the page. */
export function parseFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) return [];
  return value.filter((f): f is FormField => !!f && typeof f === 'object' && typeof (f as FormField).label === 'string' && typeof (f as FormField).type === 'string');
}

export function mapTemplate(row: Record<string, unknown>): FormTemplate {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    category: String(row.category ?? ''),
    icon: String(row.icon ?? 'file-text'),
    fields: parseFields(row.fields),
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order ?? 0),
    version: Number(row.version ?? 1),
    updated_at: String(row.updated_at ?? ''),
  };
}

export async function fetchFormTemplates(): Promise<FormTemplate[]> {
  const { data, error } = await db.from('form_templates').select(COLUMNS).order('sort_order', { ascending: true }).order('id', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapTemplate);
}

/** Every template, cached 5 min. `templates` is the active list; `all` includes inactive rows (admin). */
export function useFormTemplates() {
  const query = useQuery({ queryKey: FORM_TEMPLATES_KEY, staleTime: 5 * 60_000, queryFn: fetchFormTemplates });
  const all = query.data ?? [];
  return {
    all,
    templates: all.filter((t) => t.is_active),
    byId: (id: string | null | undefined) => (id ? all.find((t) => t.id === id) ?? null : null),
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** Admin writes. Each selects the row back: zero rows = RLS filtered it = permission failure. */
export function useFormTemplateMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: FORM_TEMPLATES_KEY });
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: FormTemplatePatch }): Promise<FormTemplate> => {
      const { data, error } = await db.from('form_templates').update(patch).eq('id', id).select(COLUMNS);
      if (error) { if (error.code === '42501') throw new Error(FORM_TEMPLATE_PERMISSION_MESSAGE); throw error; }
      if (!data?.length) throw new Error(FORM_TEMPLATE_PERMISSION_MESSAGE);
      return mapTemplate(data[0]);
    },
    onSuccess: invalidate,
  });
  const reorder = useMutation({
    // One update per moved row; sort_order = position. Small list (14), so no RPC.
    mutationFn: async (orderedIds: string[]) => {
      for (let i = 0; i < orderedIds.length; i++) {
        const { data, error } = await db.from('form_templates').update({ sort_order: i + 1 }).eq('id', orderedIds[i]).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error(FORM_TEMPLATE_PERMISSION_MESSAGE);
      }
    },
    onSuccess: invalidate,
  });
  return {
    update: (id: string, patch: FormTemplatePatch) => update.mutateAsync({ id, patch }),
    setActive: (id: string, is_active: boolean) => update.mutateAsync({ id, patch: { is_active } }),
    reorder: (orderedIds: string[]) => reorder.mutateAsync(orderedIds),
    isPending: update.isPending || reorder.isPending,
  };
}

/** Category badge colour, one map for the library and the tab (was two divergent maps). */
export function formCategoryClass(category: string): string {
  switch (category) {
    case 'Security': return 'bg-primary text-primary-foreground';
    case 'Maintenance': return 'bg-accent text-accent-foreground';
    case 'Operations': return 'bg-info text-info-foreground';
    case 'Cleaning': return 'bg-success text-success-foreground';
    case 'Safety': return 'bg-warning text-warning-foreground';
    case 'Compliance': return 'bg-destructive/80 text-destructive-foreground';
    default: return 'bg-muted text-muted-foreground';
  }
}
```

- [ ] **Step 4 — `src/lib/formTemplateEditor.ts`** (pure; the field editor's state and its guardrails).

```ts
/**
 * Field-editor state for a form template (spec §5.11): a reducer over FormField[] and the
 * validation that gates Save. Pure, so the whole editor contract is unit-tested.
 */
import { FORM_FIELD_TYPES, type FormField, type FormFieldType } from '@/lib/formFields';

export const MAX_FIELDS = 60;
export const MAX_OPTIONS = 20;
export const MAX_PHOTOS_PER_FIELD = 10;

export type EditorAction =
  | { type: 'add'; fieldType?: FormFieldType }
  | { type: 'remove'; index: number }
  | { type: 'move'; index: number; direction: -1 | 1 }
  | { type: 'update'; index: number; patch: Partial<FormField> }
  | { type: 'setOptions'; index: number; text: string }   // one option per line
  | { type: 'reset'; fields: FormField[] };

export function newField(fieldType: FormFieldType = 'text'): FormField {
  const f: FormField = { label: '', type: fieldType };
  if (fieldType === 'select') f.options = [];
  if (fieldType === 'photo') f.maxPhotos = 5;
  return f;
}

/** Strip keys that do not apply to the type, so a saved row never carries stale options/maxPhotos. */
export function normaliseField(f: FormField): FormField {
  const out: FormField = { label: f.label.trim(), type: f.type };
  if (f.required) out.required = true;
  if (f.width === 'half') out.width = 'half';
  if (f.type === 'select') out.options = (f.options ?? []).map((o) => o.trim()).filter(Boolean).slice(0, MAX_OPTIONS);
  if (f.type === 'photo') out.maxPhotos = Math.min(MAX_PHOTOS_PER_FIELD, Math.max(1, Math.round(f.maxPhotos ?? 5)));
  return out;
}

export function editorReducer(state: FormField[], action: EditorAction): FormField[] {
  switch (action.type) {
    case 'reset': return action.fields.map((f) => ({ ...f, options: f.options ? [...f.options] : undefined }));
    case 'add': return state.length >= MAX_FIELDS ? state : [...state, newField(action.fieldType)];
    case 'remove': return state.filter((_, i) => i !== action.index);
    case 'move': {
      const j = action.index + action.direction;
      if (action.index < 0 || action.index >= state.length || j < 0 || j >= state.length) return state;
      const next = [...state];
      [next[action.index], next[j]] = [next[j], next[action.index]];
      return next;
    }
    case 'update': return state.map((f, i) => {
      if (i !== action.index) return f;
      const merged = { ...f, ...action.patch };
      // Changing the type resets type-specific keys the way newField sets them.
      if (action.patch.type && action.patch.type !== f.type) {
        const fresh = newField(action.patch.type);
        return { ...fresh, label: merged.label, required: merged.required, width: merged.width };
      }
      return merged;
    });
    case 'setOptions': return state.map((f, i) => (i === action.index ? { ...f, options: action.text.split('\n').map((o) => o.trim()).filter(Boolean) } : f));
    default: return state;
  }
}

export interface FieldError { index: number; message: string }

/** Plain guardrail copy: what stops Save. */
export function validateFields(fields: FormField[]): FieldError[] {
  const errors: FieldError[] = [];
  const seen = new Map<string, number>();
  fields.forEach((f, index) => {
    const label = f.label.trim();
    if (!label) errors.push({ index, message: 'Every field needs a label' });
    else if (label.length > 120) errors.push({ index, message: 'Labels must be 120 characters or fewer' });
    else if (seen.has(label.toLowerCase())) errors.push({ index, message: `"${label}" is used twice — labels are the keys submissions are stored under` });
    else seen.set(label.toLowerCase(), index);
    if (!(FORM_FIELD_TYPES as readonly string[]).includes(f.type)) errors.push({ index, message: 'Unknown field type' });
    if (f.type === 'select' && !(f.options ?? []).some((o) => o.trim())) errors.push({ index, message: 'A dropdown needs at least one option' });
    if (f.type === 'photo' && f.maxPhotos !== undefined && (f.maxPhotos < 1 || f.maxPhotos > MAX_PHOTOS_PER_FIELD)) errors.push({ index, message: `Photos: between 1 and ${MAX_PHOTOS_PER_FIELD}` });
  });
  if (fields.length === 0) errors.push({ index: -1, message: 'A form needs at least one field' });
  return errors;
}

/** True when a save would change the stored fields (ignores ordering of keys and untrimmed labels). */
export function fieldsChanged(a: FormField[], b: FormField[]): boolean {
  return JSON.stringify(a.map(normaliseField)) !== JSON.stringify(b.map(normaliseField));
}
```

- [ ] **Step 5 — `src/components/settings/FormFieldEditor.tsx`.**

```tsx
/** The field list editor inside the Forms admin: label, type, required, options, width, photos; reorder. */
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Hint } from '@/components/ui/hint';
import { FIELD_TYPE_LABELS, FORM_FIELD_TYPES, type FormField, type FormFieldType } from '@/lib/formFields';
import { MAX_FIELDS, MAX_PHOTOS_PER_FIELD, type EditorAction, type FieldError } from '@/lib/formTemplateEditor';

interface Props {
  fields: FormField[];
  errors: FieldError[];
  dispatch: (action: EditorAction) => void;
  disabled?: boolean;
}

export function FormFieldEditor({ fields, errors, dispatch, disabled }: Props) {
  const errorsFor = (i: number) => errors.filter((e) => e.index === i).map((e) => e.message);
  return (
    <div className="space-y-3">
      <Hint>Labels are the keys answers are stored under — renaming one hides old answers on that form's PDFs; add a new field instead</Hint>
      {fields.map((f, i) => (
        <div key={i} className="rounded-lg border p-3 space-y-3" data-testid={`field-${i}`}>
          <div className="flex items-start gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor={`f-${i}-label`} className="text-xs">Label</Label>
              <Input id={`f-${i}-label`} className="h-11" value={f.label} maxLength={120} disabled={disabled}
                onChange={(e) => dispatch({ type: 'update', index: i, patch: { label: e.target.value } })} />
            </div>
            <div className="w-40 space-y-1.5">
              <Label htmlFor={`f-${i}-type`} className="text-xs">Type</Label>
              <select id={`f-${i}-type`} className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm" value={f.type} disabled={disabled}
                onChange={(e) => dispatch({ type: 'update', index: i, patch: { type: e.target.value as FormFieldType } })}>
                {FORM_FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><Checkbox checked={!!f.required} disabled={disabled} onCheckedChange={(c) => dispatch({ type: 'update', index: i, patch: { required: c === true } })} />Required</label>
            <label className="flex items-center gap-2"><Checkbox checked={f.width === 'half'} disabled={disabled} onCheckedChange={(c) => dispatch({ type: 'update', index: i, patch: { width: c === true ? 'half' : 'full' } })} />Half width</label>
            {f.type === 'photo' && (
              <label className="flex items-center gap-2">Max photos
                <Input type="number" className="h-9 w-20" min={1} max={MAX_PHOTOS_PER_FIELD} value={f.maxPhotos ?? 5} disabled={disabled}
                  onChange={(e) => dispatch({ type: 'update', index: i, patch: { maxPhotos: Number(e.target.value) } })} aria-label={`Max photos for ${f.label || `field ${i + 1}`}`} />
              </label>
            )}
            <span className="ml-auto flex gap-1">
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={disabled || i === 0} aria-label="Move up" onClick={() => dispatch({ type: 'move', index: i, direction: -1 })}><ArrowUp className="h-4 w-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={disabled || i === fields.length - 1} aria-label="Move down" onClick={() => dispatch({ type: 'move', index: i, direction: 1 })}><ArrowDown className="h-4 w-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive" disabled={disabled} aria-label="Remove field" onClick={() => dispatch({ type: 'remove', index: i })}><Trash2 className="h-4 w-4" /></Button>
            </span>
          </div>
          {f.type === 'select' && (
            <div className="space-y-1.5">
              <Label htmlFor={`f-${i}-options`} className="text-xs">Options (one per line)</Label>
              <Textarea id={`f-${i}-options`} rows={3} value={(f.options ?? []).join('\n')} disabled={disabled}
                onChange={(e) => dispatch({ type: 'setOptions', index: i, text: e.target.value })} />
            </div>
          )}
          {errorsFor(i).map((m) => <p key={m} className="text-sm text-destructive">{m}</p>)}
        </div>
      ))}
      {errors.filter((e) => e.index === -1).map((e) => <p key={e.message} className="text-sm text-destructive">{e.message}</p>)}
      <Button type="button" variant="outline" className="h-11" disabled={disabled || fields.length >= MAX_FIELDS} onClick={() => dispatch({ type: 'add' })}>
        <Plus className="mr-2 h-4 w-4" />Add field
      </Button>
    </div>
  );
}
```

- [ ] **Step 6 — `src/components/settings/FormsAdminCard.tsx`.**

```tsx
/**
 * Settings → Forms (admin): the form_templates catalogue — activate/deactivate, reorder, and
 * edit name/description/category/icon and the fields. Every content save bumps `version` on the
 * server; existing submissions keep their own snapshot so nothing already filled in changes.
 */
import { useEffect, useReducer, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Loader2, Pencil } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogHeader, ResponsiveDialogTitle } from '@/components/ui/responsive-dialog';
import { Hint } from '@/components/ui/hint';
import { FormIcon, FORM_ICON_NAMES } from '@/components/forms/FormIcon';
import { formCategoryClass, useFormTemplateMutations, useFormTemplates, type FormTemplate } from '@/hooks/useFormTemplates';
import { editorReducer, fieldsChanged, normaliseField, validateFields } from '@/lib/formTemplateEditor';
import { FormFieldEditor } from './FormFieldEditor';

export function FormsAdminCard() {
  const { all, isLoading, isError } = useFormTemplates();
  const { setActive, reorder, isPending } = useFormTemplateMutations();
  const [editing, setEditing] = useState<FormTemplate | null>(null);

  const move = async (index: number, direction: -1 | 1) => {
    const ids = all.map((t) => t.id);
    const j = index + direction;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    try { await reorder(ids); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not reorder'); }
  };
  const toggle = async (t: FormTemplate, on: boolean) => {
    try { await setActive(t.id, on); toast.success(on ? `${t.name} is available again` : `${t.name} hidden from the library`); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update'); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forms</CardTitle>
        <CardDescription>The forms available in the library and on every building's Forms tab.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          : isError ? <p className="text-sm text-destructive">Could not load the form templates.</p>
          : all.length === 0 ? <p className="text-sm text-muted-foreground">No form templates. Apply the R4c migration to seed the 14 standard forms.</p>
          : (
            <ul className="divide-y rounded-lg border">
              {all.map((t, i) => (
                <li key={t.id} className="flex items-center gap-3 p-3" data-testid={`template-${t.id}`}>
                  <span className="text-primary"><FormIcon name={t.icon} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{t.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{t.fields.length} fields · v{t.version}</p>
                  </div>
                  <Badge variant="secondary" className={formCategoryClass(t.category)}>{t.category}</Badge>
                  <Switch checked={t.is_active} disabled={isPending} onCheckedChange={(on) => void toggle(t, on)} aria-label={`${t.name} active`} />
                  <Button variant="ghost" size="icon" className="h-9 w-9" disabled={isPending || i === 0} aria-label={`Move ${t.name} up`} onClick={() => void move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9" disabled={isPending || i === all.length - 1} aria-label={`Move ${t.name} down`} onClick={() => void move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" className="h-9" onClick={() => setEditing(t)}><Pencil className="mr-1 h-4 w-4" />Edit</Button>
                </li>
              ))}
            </ul>
          )}
        <Hint>Switch a form off to hide it without losing its submissions; reorder to put the forms your teams use most at the top</Hint>
      </CardContent>
      {editing && <FormTemplateEditorDialog template={editing} open onOpenChange={(o) => { if (!o) setEditing(null); }} />}
    </Card>
  );
}

interface EditorProps { template: FormTemplate; open: boolean; onOpenChange: (open: boolean) => void }

export function FormTemplateEditorDialog({ template, open, onOpenChange }: EditorProps) {
  const { update, isPending } = useFormTemplateMutations();
  const [meta, setMeta] = useState({ name: template.name, description: template.description, category: template.category, icon: template.icon });
  const [fields, dispatch] = useReducer(editorReducer, template.fields, (f) => editorReducer([], { type: 'reset', fields: f }));
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    setMeta({ name: template.name, description: template.description, category: template.category, icon: template.icon });
    dispatch({ type: 'reset', fields: template.fields });
    setAttempted(false);
  }, [template]);

  const errors = validateFields(fields);
  const metaError = !meta.name.trim() ? 'The form needs a name' : !meta.category.trim() ? 'The form needs a category' : null;
  const dirty = fieldsChanged(template.fields, fields) || meta.name !== template.name || meta.description !== template.description || meta.category !== template.category || meta.icon !== template.icon;

  const save = async () => {
    setAttempted(true);
    if (errors.length || metaError) return;
    try {
      const saved = await update(template.id, {
        name: meta.name.trim(), description: meta.description.trim(), category: meta.category.trim(), icon: meta.icon,
        fields: fields.map(normaliseField),
      });
      toast.success(saved.version > template.version ? `${saved.name} saved as version ${saved.version}` : `${saved.name} saved`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the form');
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Edit form — {template.name}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Version {template.version}. Saving a change to the name, description, category or fields creates version {template.version + 1}; submissions already made keep the fields they were filled against.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ft-name">Name</Label>
              <Input id="ft-name" className="h-11" value={meta.name} maxLength={120} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ft-description">Description</Label>
              <Textarea id="ft-description" rows={2} value={meta.description} maxLength={300} onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ft-category">Category</Label>
              <Input id="ft-category" className="h-11" value={meta.category} maxLength={40} list="ft-categories" onChange={(e) => setMeta((m) => ({ ...m, category: e.target.value }))} />
              <datalist id="ft-categories">{['Security', 'Maintenance', 'Operations', 'Cleaning', 'Safety', 'Compliance', 'HR/Safety'].map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ft-icon">Icon</Label>
              <div className="flex items-center gap-2">
                <span className="text-primary"><FormIcon name={meta.icon} /></span>
                <select id="ft-icon" className="h-11 flex-1 rounded-md border border-input bg-background px-2 text-sm" value={meta.icon} onChange={(e) => setMeta((m) => ({ ...m, icon: e.target.value }))}>
                  {FORM_ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          </div>
          {attempted && metaError && <p className="text-sm text-destructive">{metaError}</p>}
          <FormFieldEditor fields={fields} errors={attempted ? errors : []} dispatch={dispatch} disabled={isPending} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
            <Button className="h-11" onClick={() => void save()} disabled={isPending || !dirty}>
              {isPending ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>) : 'Save'}
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
```

- [ ] **Step 7 — `src/pages/Settings.tsx`.** `import { FormsAdminCard } from '@/components/settings/FormsAdminCard';` and `import { FileText } from 'lucide-react'` (add to the existing lucide import). After the branding `TabsTrigger`:
```tsx
          {isAdmin && (
            <TabsTrigger value="forms">
              <FileText className="h-4 w-4 mr-2" />
              Forms
            </TabsTrigger>
          )}
```
and after the branding `TabsContent`:
```tsx
        {isAdmin && (
          <TabsContent value="forms">
            <FormsAdminCard />
          </TabsContent>
        )}
```

- [ ] **Step 8 — consumers switch to the hook.** In all four files the local `interface FormTemplate { …; icon: React.ReactNode }` is deleted in favour of `import { useFormTemplates, formCategoryClass, type FormTemplate } from '@/hooks/useFormTemplates'` and `import { FormIcon } from '@/components/forms/FormIcon'`; every `{form.icon}` becomes `<FormIcon name={form.icon} />`; every `defaultFormFields[form.id] || []` becomes `form.fields`; the `formTemplates` arrays and the two `categoryColors` maps are deleted.
  - `FormsLibrary.tsx`: `const { templates, isLoading, isError } = useFormTemplates();` renders a spinner / "Could not load the forms library." / the grid over `templates`; the `FillableFormDialog` no longer receives a `fields` prop.
  - `FormsTab.tsx`: same for the "Fill Forms" grid; `handleDownloadPdf` resolves `const form = byId(submission.form_template_id)` and uses `parseFields(submission.fields_snapshot) .length ? that : form.fields` (import `parseFields`); `SubmissionDetails` gains `template_version?: number | null; fields_snapshot?: unknown` and the select adds `template_version, fields_snapshot`. A submission whose template is unknown (deleted id) still downloads when it has a snapshot: `form ?? { id: submission.form_template_id ?? '', name: submission.form_name, description: '', category: '' }`.
  - `FillableFormDialog.tsx`: props become `{ form: FormTemplate | null; open; onOpenChange; onSubmitSuccess?; preselectedBuildingId?; preselectedBuildingName? }` (`fields` prop removed; `const fields = form?.fields ?? []` after the null guard). The insert gains the snapshot — through the boundary cast until the types are regenerated:
```ts
      // template_version / fields_snapshot are not yet in the generated types; regenerate after the migration ships.
      const row = {
        form_template_id: form.id, form_name: form.name, building_id: selectedBuilding || null, submitted_by: user.id,
        form_data: finalFormData, photo_urls: photoUrls, status: 'submitted',
        template_version: form.version, fields_snapshot: form.fields,
      };
      const { error } = await supabase.from('form_submissions').insert(row as unknown as TablesInsert<'form_submissions'>);
```
  - `FormPreviewDialog.tsx`: `const fields = form.fields;` (the `defaultFormFields` import goes); `generateFormHtml` unchanged otherwise.
  - `FormSubmissionsDialog.tsx`: select adds `template_version, fields_snapshot`; `handleDownloadPdf` uses `parseFields(submission.fields_snapshot)` when non-empty, else `form.fields`; the detail view shows `v{template_version}` next to the date when present.

- [ ] **Step 9 — tests.**
  - `src/hooks/useFormTemplates.test.ts` (chain recorder as in `useContractors.test.ts`): `fetchFormTemplates` orders by `sort_order` then `id`; `mapTemplate` defaults (`fields` not an array → `[]`, missing `icon` → `file-text`, `is_active` null → true); `useFormTemplates().templates` excludes inactive rows while `all` keeps them; `byId('3')`; `update` sends the patch, selects the columns back, throws `FORM_TEMPLATE_PERMISSION_MESSAGE` on zero rows and on `42501`; `reorder(['2','1'])` issues two updates with `sort_order` 1 and 2; `formCategoryClass('Nope')` → muted.
  - `src/lib/formTemplateEditor.test.ts`: `editorReducer` add (caps at `MAX_FIELDS`), remove, move (bounds), update (type change resets options/maxPhotos, keeps label/required/width), setOptions splits lines and drops blanks, reset clones; `normaliseField` strips foreign keys and clamps `maxPhotos`; `validateFields` (blank label, duplicate labels case-insensitively, select without options, photo range, empty list); `fieldsChanged` is false for whitespace-only differences.
  - `src/components/settings/FormFieldEditor.test.tsx`: renders one block per field with its label/type; Add dispatches `add`; Move up disabled on the first row; select type shows the options textarea; errors for index `i` render under field `i`.
  - `src/components/settings/FormsAdminCard.test.tsx`: mock `@/hooks/useFormTemplates` (`useFormTemplates` → two rows, `useFormTemplateMutations` → spies); list shows both, the inactive one's switch off; toggling calls `setActive(id, false)`; Move down on the first calls `reorder(['2','1'])`; Edit opens the dialog with the name prefilled; Save with a blank label shows "Every field needs a label" and does not call `update`; a valid save calls `update('1', { name, description, category, icon, fields: normalised })`.
  - `src/components/forms/FillableFormDialog.test.tsx` (new; chain recorder + mocked `useAuth`, `useOrganization`, `PhotoCapture`, `uploadPhotos`): filling the required fields of a two-field template and submitting inserts `form_submissions` with `template_version: 3` and `fields_snapshot` equal to the template's fields, `status: 'submitted'`.
  - Remove nothing else: no existing test imported `defaultFormFields` (verified by `grep -rl defaultFormFields src` → only the five source files in this task).

- [ ] **Step 10 — gate + commit.** `grep -rn "defaultFormFields\|formTemplates: FormTemplate\[\]" src` prints nothing; `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'formFields|useFormTemplates|FormIcon|formTemplateEditor|FormFieldEditor|FormsAdminCard|FormsLibrary|FormsTab|FillableFormDialog|FormPreviewDialog|FormSubmissionsDialog|Settings.tsx'` prints nothing; `npm run test` green. Commit: `git add src/lib/formFields.ts src/hooks/useFormTemplates.ts src/hooks/useFormTemplates.test.ts src/components/forms/FormIcon.tsx src/lib/formTemplateEditor.ts src/lib/formTemplateEditor.test.ts src/components/settings/FormFieldEditor.tsx src/components/settings/FormFieldEditor.test.tsx src/components/settings/FormsAdminCard.tsx src/components/settings/FormsAdminCard.test.tsx src/components/forms/FillableFormDialog.tsx src/components/forms/FillableFormDialog.test.tsx src/components/forms/FormPreviewDialog.tsx src/components/forms/FormSubmissionsDialog.tsx src/pages/FormsLibrary.tsx src/components/building/FormsTab.tsx src/pages/Settings.tsx && git commit -m "R4c: one form_templates catalogue (hook, library, tab, dialogs), submission snapshots, Settings → Forms admin with field editor"`.

---

### Task 5 (controller): apply, deploy, verify, regenerate, record

- [ ] Staging: apply `2026-09-14_03` after `_01`/`_02`; run the verify block; `supabase secrets set INTAKE_IP_SALT=… --project-ref vkrihpmjajjcxmzgjqdr`; deploy `tenant-intake`; `node scripts/rls-smoke.mjs` (R4c lines), `npm run smoke:intake`, `npm run smoke:notifications` (inbox row for `issue_reported` when that smoke gains the kind), `npm run smoke` (prod-safe chain incl. `forms-smoke` — the submission journey must still pass with the new columns), `npm run smoke:offline`, `npm run smoke:calendar`.
- [ ] Reconcile the concurrent R4a/R4b edits to `notifyRules.ts`, `notifyRules.test.ts` and `Settings.tsx` (the union of kinds; the Forms tab beside R4a's cards); re-run `npm run test`.
- [ ] Manual staging pass on a phone: enable `features.tenant_intake` for the org; Building → Tenants → Create link → Print QR sheet (A5, prints); scan → form → photo → reference; Issues shows the Tenant chip and the reporter block; the assignee received a push; rotate → the old QR shows "This link is not active"; Settings → Forms: deactivate a form (gone from `/forms`), edit a label → version bumps, an older submission's PDF still shows its old fields.
- [ ] Prod: apply `_03`; deploy `tenant-intake` (`--project-ref qdzgkttiosahdfqresvz`) with `INTAKE_IP_SALT`; `node scripts/rls-smoke.mjs` against prod (the R4c probes are fixture-scoped); leave `tenant_intake` OFF until the owner prints the sheets (spec §11).
- [ ] Regenerate `src/integrations/supabase/types.ts` from prod; drop the four boundary casts (`useIntakeTokens.ts`, `useIssues.ts`, `useFormTemplates.ts`, `FillableFormDialog.tsx`) — the `db` idiom and the `as unknown as TablesInsert` — and the "not yet in the generated types" comments; `tsc` global count ≤ 51.
- [ ] Whole-slice review (superpowers:code-reviewer) against this plan and spec §5.10–5.11; Status block below; `APPLY_CHECKLIST.md` entry for R4c (secrets, function, flag, QR sheets); memory note (`fortress-daily-ops-roadmap.md`: R4c shipped, decisions); push; PR body.

---

## Status — shipped 2026-09-11 (range 5a925cd..HEAD)

**Shipped.** `2026-09-14_03_r4_intake_forms.sql` (GMI `7a1bdda`): `intake_tokens` (one active bearer token per
building, admin or manager by building access, insert pinned to the creator, no delete policy); `intake_rate` plus
`intake_rate_hit` and `intake_touch`, service-role only; `issues.source`, `reporter` and `reference` with
`issues_intake_guard`, so no signed-in session can forge a tenant report or alter one; `form_templates` seeded
`'1'`–`'14'` with field lists byte-identical to the retired hard-coded ones, plus a version-bump trigger the client
cannot drive; `form_submissions.template_version` and `fields_snapshot`; a read policy for the intake storage prefix
and deliberately no insert policy, so only the service role writes there; kind `issue_reported`. Function
`tenant-intake` (unauthenticated): GET answers building name, branding, shop list and categories or an identical 404;
POST validates, rate-limits, drops honeypot hits without storing anything, uploads at most three photos with the
service role, mints an `FO-XXXXXX` reference, assigns the building's issue-rule holder and notifies with the push
narrowed to the assignee. Client: public intake route, Building → Tenants intake card (create, rotate, disable, QR,
printable sheet), the Tenant chip and reporter block on issues, one catalogue hook behind the forms library, the
building tab and all three dialogs, and Settings → Forms admin with a field editor. Staging: access control 737,
intake 31. Production: access control 737, fourteen templates active, flag off.

**Decisions taken.** The token is semi-public by design, because it is printed on a poster, so rotation rather than
secrecy is the control and every refusal returns the same 404. The template ids stay `'1'`–`'14'` and there is no
"create template", so no live submission can render against a different field set; a submission without a snapshot
falls back to the template's current fields, exactly as it rendered before. The version is server-set, and an
activation or reorder does not bump it.

**Follow-ups.** Landing now, before the flag: redact the intake token in the analytics scrubber, which covered the
share route only; resolve the token and charge the rate buckets before parsing the request body; take the last
forwarded-for hop; charge the token bucket only on a stored submission, so junk posts cannot silence a building for
an hour; rate-limit the GET and default its shop list to numbers without names. Still open afterwards: a failed
insert leaves orphan uploads, and the created-by line on a tenant report reads as the token's creator.


(Filled in by the controller: shipped range, decisions taken, follow-ups. Known follow-ups already: no "create template" in the Forms admin (ids stay `'1'…'14'`); `INTAKE_CATEGORIES` lives only in the function (the page reads it from GET); the `issue_activity` `created` row for an intake issue is logged under the token creator's name (`log_issue_activity` uses `reported_by` when there is no session) — the Tenant chip and reporter block are the honest source.)
