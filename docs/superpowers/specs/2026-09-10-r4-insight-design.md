# R4 "Insight" — design

Date: 2026-09-10 · Parent: `2026-09-10-daily-ops-v2-roadmap-design.md` §5 R4 · Status: DRAFT (applies the roadmap and decisions D1–D11; R0–R3c are live on staging and prod)

Headline: **Every report is on time, trended, shareable, and traceable to the item.**

## 1. What R4 changes, in one paragraph

R3 made next month's work exist. R4 makes the output of all that work visible, on time, and portable. A nightly snapshot per building turns the ~30-query KPI fan-out and the 4N+1 portfolio query into one row per building per day, which gives every building header a sparkline, the portfolio a trend page, and the OPS PDF a trend section. Reports stop piling up in "submitted": a schedule says when each report type is due and to whom it goes, a reminder lands three days before period close, approval produces the final PDF, and distribution emails an expiring share link. External recipients open a share page that serves the exact issued artifact (DRAFT-watermarked unless approved). Any grid, list or register exports to CSV, and an issue or a completed task can be handed over as an evidence pack. Issues get an SLA clock from org defaults, a breach cron and a breach notification. The portfolio reports page answers "did this month land?" per type and per status. Tenants report problems through a per-building QR form without a login. The two hard-coded form catalogues become one `form_templates` table with an admin screen.

## 2. Facts that shape the design (survey of 2026-09-10, live prod counts)

- Prod: 72 reports — 66 `submitted`, 4 `approved`, 2 `draft`; 37 `ops_monthly`, 32 `cm_monthly`, 3 `annual_inspection`. 0 `report_artifacts`. 0 issues. 123 pending task instances. 1091 `building_tenants`. 1 organization (7 columns, no settings). 15 users, admin/manager only.
- KPIs: `useBuildingKpis` runs ~30 queries per building; `usePortfolioCompliance` runs 4N+1 for 47 buildings. K1 already reads approved reports only (D10 done); `report_artifacts.report_status` exists (E2 done); coverage on `/reports/fortress` is building-level and status-blind (C2 open). `recharts` is a dependency used in one file; no sparkline primitive.
- PDFs are generated only in the browser (`pdfmake`, `generateReportPdf`) and saved as `report_artifacts` in the private `generated-reports` bucket by `saveReportArtifact` (fail-closed, versioned, supersede). `watermarkFor(status)` prints DRAFT unless approved. There is no server-side PDF path.
- SLA: `issues.sla_target_hours`, `sla_breached_at`, `first_response_at` exist and nothing reads or writes them. `issues.priority` ∈ low/medium/high/critical; no `severity`; no `tenant_id`; timeline is `issue_activity` (comment/status_change/assignment/contractor_assignment, photos in `photo_urls`).
- Task evidence lives twice: `task_completions` (written by `complete_task`) and denormalised onto `task_instances`; the H&S PDF reads the latter. Geotags are burned into pixels (POPIA opt-in), not columns.
- Expiry alerts (`notify-expiring-alerts`, `GlobalAlertsWidget`) cover only `building_documents.expiry_date` (30 days) and `building_assets.next_service_date`; `tenant_documents`, `contractor_documents`, `warranty_expiry` are never alerted on.
- Public surfaces: only `ics-feed` (token, service-role lookup, owner's access re-checked, identical 404s, row caps, no rate limit). `organizations` is the only anon-readable table (login branding). No share/schedule/intake tables; no `qrcode` or zip library.
- Forms: `form_templates` does not exist anywhere. `FormsLibrary.tsx` and `FormsTab.tsx` still carry two divergent 14-entry arrays keyed `'1'…'14'`; `defaultFormFields` holds the fields; `form_submissions.form_template_id` stores those string ids. The R3 de-dup never landed.
- Latent defects found by the survey: `is_admin()`/`is_admin_or_manager()` use a bare scalar subquery over `user_roles` (one row per user per building) and would raise `21000` for the first multi-building user; `media_attachments` (0 rows, unused) is readable by any signed-in user; `building_assets` purchase/warranty/lifespan columns exist on prod but in no vendored migration; `reportArtifacts.ts` still hand-rolls a client "because types lack the table" although the types have it; `task-generation-daily` is defined twice in the vendored SQL.

## 3. Decisions applied and constraints

- D10 (KPIs from approved reports, provenance caption) stays; snapshots read the same approved-only sources so cards and sparklines agree.
- D5: tenant intake form without login; no tenant portal.
- D8: PostHog/Sentry stay keyless until the owner sets the POPIA basis; R4 adds nothing that needs them.
- Additive schema only (iOS shares it). New tables get RLS in the same migration; new functions `set search_path = ''`, revoke from `public` and explicitly from `anon`; public edge functions look rows up with the service role and re-check the owner's access.
- Server-side PDF generation is out of scope: **approval generates the final PDF in the browser** and saves it as the artifact; distribution and sharing always serve an existing artifact. A schedule that finds an approved report without an artifact notifies the author to export (one click) rather than guessing.
- Share links, intake tokens and schedules are org-level admin/manager features; all are behind `organizations.settings.features` flags so they can ship dark (roadmap §7).
- Timezone: `Africa/Johannesburg` everywhere a day boundary matters (snapshots, reminders, SLA display).
- Hint rule unchanged; mobile-first for the intake form (it is used on a phone) and the issue SLA chip.

## 4. Three slices, each its own plan

| Slice | Theme | Depends on |
|---|---|---|
| R4a Snapshots & SLA | `building_metrics_daily` + snapshot cron, portfolio/building trend surfaces, OPS PDF trend section, SLA defaults/breach cron/notification/column, per-type status-aware coverage + discard draft, expiry alerts widened to 30/60/90 across four tables, feature flags, latent-defect fixes | R3c live |
| R4b Distribute & Share | approval → final artifact, `report_schedules` + reminder/distribution cron function, `report_shares` + public share page, CSV everywhere, evidence packs (PDF + zip) | R4a flags + snapshots (trend section) |
| R4c Intake & Forms | per-building intake tokens + QR + public intake form + `tenant-intake` function, `form_templates` table + seed + admin screen + one catalogue | R4a flags; R4b share-page pattern |

## 5. Schema (R4a `2026-09-14_01_r4_snapshots_sla.sql`; R4b `_02_r4_distribute.sql`; R4c `_03_r4_intake_forms.sql`)

### 5.1 Fixes and reconciliation (R4a, first in the file)

- `is_admin()` / `is_admin_or_manager()`: replace the bare scalar subquery with `exists (select 1 from public.user_roles where user_id = auth.uid() and role = …)`; `app_role()` gains the deactivation gate and picks the most-privileged role with `order by … limit 1`. Smoke: a user with two role rows can still read.
- `building_assets`: `add column if not exists` for `purchase_date date, purchase_price numeric, replacement_cost numeric, warranty_expiry date, warranty_provider text, expected_lifespan_years integer` so the vendored schema matches prod.
- `media_attachments`: policies replaced with admin-only read/write (0 rows, no client) and a comment marking it data-ops only (D9 spirit).
- `reportArtifacts.ts` hand-rolled client removed in R4b (typed client is enough).

### 5.2 Org settings and feature flags (R4a)

- `organizations.settings jsonb not null default '{}'` with a CHECK that it is an object. Keys used by R4: `sla_hours` `{critical:4, high:24, medium:72, low:168}`, `features` `{share_links:false, report_schedules:false, tenant_intake:false}`, `report_due_day` (integer 1–28, default 7: the day of the following month by which a monthly report must be approved), `distribution_from` (email display name, optional).
- Anon read of `organizations` continues for branding only: a new view `organization_branding (id, name, logo_url, primary_color)` gets the anon grant and the base table loses it (settings must not be public). Login screen and `useOrganization` for anon switch to the view; signed-in users read the table.
- Client: `useOrgSettings()` (typed accessor with defaults), `useFeature(name)`.

### 5.3 Metric snapshots (R4a)

```
building_metrics_daily (
  building_id uuid references buildings on delete cascade,
  day date,
  compliance_pct numeric, critical_pct numeric, inspection_pass_pct numeric,   -- latest approved report at day
  ppm_done_pct numeric,                    -- month-to-date from ppm_monthly_status
  task_completion_30d_pct numeric, tasks_overdue int, tasks_due_7d int,
  issues_open int, issues_open_by_priority jsonb, issues_breached int, issues_resolved_30d int,
  docs_expiring_30 int, docs_expiring_60 int, docs_expiring_90 int, docs_expired int,   -- four expiry tables
  assets_overdue int,
  report_state jsonb,                      -- {ops_monthly:{period,status}, cm_monthly:{…}, annual_inspection:{…}} for the current period
  computed_at timestamptz default now(),
  primary key (building_id, day)
)
```
- `snapshot_building_metrics(p_day date default today SAST, p_building uuid default null) returns integer` (definer, `search_path ''`, admin/manager or cron): upserts one row per active building; idempotent for a day. Sources: `compliance_scores` via `compliance_assessments` → latest **approved** report; `ppm_monthly_status`; `task_instances`/`task_completions`; `issues`; `building_documents`, `tenant_documents` (via `building_tenants`), `contractor_documents` (via issues/PPM lines/service history linking the contractor to the building, or org-wide counted once on every building? — **decision: contractor documents are org-level and are counted on the portfolio row only**, not per building), `building_assets.next_service_date` and `warranty_expiry`; `reports` for the current period.
- Cron `metrics-snapshot-daily` at `0 3 * * *` UTC (05:00 SAST, after generation 04:00/04:10 and the overdue sweep). Backfill on first apply: 90 days computed from the data as it is today for the report/expiry columns (they are point-in-time), task/issue columns computed historically where the data allows (`completed_at`, `resolved_at`, `created_at`), documented as "reconstructed" in `computed_at`.
- `portfolio_metrics_daily` view: sums/averages across the buildings the caller can access (`security_invoker`), plus `contractor_docs_expiring_30/60/90` computed directly.
- RLS: select via `can_access_building(building_id)`; no client writes. Revokes as usual.
- Retention: 400 days, pruned by the snapshot function.

### 5.4 SLA (R4a)

- Trigger `issues_sla_defaults` before insert: `sla_target_hours := coalesce(sla_target_hours, settings.sla_hours[priority])`. Priority change on an open issue re-derives the target only when the row still carries the default for the old priority.
- `first_response_at`: trigger on `issue_activity` insert sets `issues.first_response_at = created_at` when null and `user_id <> issues.reported_by` (comment/assignment/status_change).
- `mark_sla_breaches() returns integer`: `update issues set sla_breached_at = now() where status in ('open','in_progress','escalated') and sla_breached_at is null and sla_target_hours is not null and created_at + sla_target_hours * interval '1 hour' < now()`; for each newly breached row inserts inbox notifications kind `issue_sla_breached` for the assignee (if any) and admins/managers, via the existing `notifications` table shape (title, body, url `/issues?issue=<id>`), and returns the count. Cron `sla-breach-sweep` every 15 minutes. Resolving clears nothing (breach history is a fact); `sla_breached_at` stays.
- `NOTIFICATION_KINDS` gains `issue_sla_breached` (DB check restated; `notifyRules.ts` mirror; push kind: yes for the assignee).
- Client: `Issue` type and `useIssues` select `sla_target_hours, sla_breached_at, first_response_at, created_at, resolved_at`; `slaState(issue, now)` pure helper → `{ due: Date, remainingMs, breached, label }`; SLA chip on issue cards and detail ("Due in 3 h", "Breached 2 d ago", "Met"); Settings → "Issue SLA" card editing `settings.sla_hours` (admin). The OPS report has no issues section today; the issues CSV export (R4b) carries the SLA columns, and `building_metrics_daily.issues_breached` feeds the trend page.

### 5.5 Coverage and discard (R4a)

- `/reports/fortress` gains a coverage grid for the selected period: rows = buildings the caller can access, columns = report types, cell = status chip (`missing`, `draft`, `submitted`, `reviewed`, `approved`, `rejected`) with a link; header counts per type ("OPS: 31 approved · 4 submitted · 12 missing"). Buildings can opt out of a type: `buildings.report_types text[] not null default '{ops_monthly,cm_monthly}'` (annual added by the owner per building) so "missing" is honest. Default period = previous month.
- `delete_empty_report(p_report uuid)` (definer, admin only): deletes a `draft` report only when every section table has zero rows for it (the same table list as `useReportSectionCounts`), else raises. "Discard draft" button in the editor and on the coverage grid for admins.

### 5.6 Expiry alerts widened (R4a)

- One SQL function `expiring_items(p_days integer) returns table (kind, entity_id, building_id, name, expiry_date, days_left)` over `building_documents`, `tenant_documents`, `contractor_documents`, `building_assets.warranty_expiry`, `building_assets.next_service_date` (invoker, so RLS applies). `notify-expiring-alerts` and `GlobalAlertsWidget` both read it; the function is also what the snapshot uses. Buckets 30/60/90 in the widget; the daily alert keeps 30 for inbox rows (`document_expiring` with `entity_type` `document` for the three document tables; `asset_service_due` for assets) and adds one line per bucket to the digest email.

### 5.7 Distribution (R4b)

```
report_schedules (
  id uuid pk, report_type text check (…), building_ids uuid[] null,          -- null = every building with the type enabled
  recipients jsonb not null,            -- [{email, name?, user_id?}] internal users by id, external by email
  send_day integer not null default 7 check (1..28),   -- day of the following month
  remind_days_before integer not null default 3,
  is_active boolean not null default true, created_by uuid, created_at, updated_at,
  last_run_on date, last_result jsonb
)
report_distributions (id, schedule_id, report_id, artifact_id, share_id, sent_to jsonb, sent_at, status text check ('sent','skipped_no_artifact','skipped_not_approved','failed'), error text)
```
- Edge function `report-distribution` (secret header, cron `report-distribution-daily` at `0 5 * * *` UTC = 07:00 SAST): for each active schedule whose `send_day` is today (SAST) → for each target building → the report for the previous period: approved with an issued artifact → create a `report_shares` row (expiry 30 days, no passcode by default) → one email per recipient with the share link and a one-paragraph summary (building, period, status, compliance % from the snapshot); approved without artifact → `skipped_no_artifact` + inbox `report_export_needed` to the author; not approved → `skipped_not_approved`. Reminders: `remind_days_before` days before `send_day`, every target report not yet approved → inbox + email `report_due_soon` to the author and admins/managers (one per report per day). Both kinds join `NOTIFICATION_KINDS`.
- Approval generates the final artifact: `useReportLifecycle.transition('approved')` runs `generateReportPdf` + `saveReportArtifact` first (no watermark because status is approved at generation time — the transition writes status, then generates, then saves; a failed save rolls the toast to "Approved; export failed — open the report and Export"), so every approved report has a current artifact.
- Settings → "Report distribution" (admin/manager, flag `report_schedules`): schedule list, create/edit dialog (type, buildings multi-select or all, recipients with an email validator and a user picker, send day, reminder days), last run and per-building result table, "Run now" (calls the function with `{scheduleId, dryRun}` and shows what would be sent).

### 5.8 Share links (R4b)

```
report_shares (
  id uuid pk, report_id uuid not null references reports on delete cascade,
  artifact_id uuid not null references report_artifacts,          -- pinned: the recipient sees exactly this PDF
  token text not null unique,                                     -- 43-char base64url, minted client-side like calendar_tokens
  created_by uuid not null, created_at, expires_at timestamptz not null,
  passcode_hash text null,                                        -- sha256(passcode || token) computed in the function on create
  view_count integer not null default 0, last_viewed_at timestamptz, revoked_at timestamptz,
  failed_attempts integer not null default 0, locked_until timestamptz
)
```
- RLS: read/create/revoke by admin/manager with building access; never anon. Public access only through edge function `report-share` (`verify_jwt = false`): `GET ?t=` → 200 JSON `{building, period, type, reportStatus, issuedAt, needsPasscode}` or identical 404 for missing/expired/revoked/garbage; `POST` `{t, passcode?}` → checks `locked_until`, verifies the hash, increments `view_count`, returns a 10-minute signed URL for the artifact (service role); 10 failures lock for 15 minutes. All errors 404 except the lock (429). Logs counts only.
- Client: `/share/:token` public route (outside `ProtectedRoute`) renders branding from `organization_branding`, the report card, a passcode field when needed, and "Open PDF" (opens the signed URL); the PDF already carries DRAFT unless approved. Editor → "Share" button (flag `share_links`, admin/manager): creates a link for the current artifact (expiry 7/30/90 days, optional passcode), copy, list of active links with views, revoke. `ReportSavedVersions` rows gain "Share this version".

### 5.9 Structured export and evidence packs (R4b)

- CSV: `EditableGrid` and every report section grid get "Export CSV" (columns from the grid definition); issues list, checklists tab (task instances for the visible range), documents tab, service history, contractor register and documents, PPM derived grid, coverage grid. All through `exportCsv`. XLSX writers stay for the two importers; the three XLSX exporters are replaced by CSV (keeps `xlsx` only for import).
- Evidence packs (client-side `pdfmake`, one `buildEvidencePack(kind, id)`): **issue pack** = header (building, title, priority, SLA state, contractor, costs), timeline from `issue_activity`, every photo with its caption/time, resolution note, rating; **task pack** = instance + completion (`task_completions` is the source of truth; `task_instances` denormalised copy only as fallback) with photos and the burned-in caption, signature confirmation; **asset pack** = lifecycle (purchase/warranty/services/costs). Download as PDF; "with originals" adds a zip (`fflate`, ~8 kB) of the original photos + the PDF. Buttons on the issue detail, task completion dialog/history, asset sheet.

### 5.10 Tenant intake (R4c)

```
intake_tokens (id, building_id not null, token text unique, label text, is_active boolean default true, created_by, created_at, last_used_at, submissions_count int default 0)
intake_rate (token_id uuid, window_start timestamptz, count int, primary key (token_id, window_start))
issues + source text not null default 'app' check ('app','tenant_intake'), reporter jsonb null   -- {name, shop, unit, phone, email}
```
- Edge function `tenant-intake` (`verify_jwt = false`): `GET ?t=` → `{building name, shop list (shop_name + unit_number only, no contacts), categories}` or 404; `POST` multipart `{t, title, description, shop_number?, name, phone?, email?, honeypot, photos[] ≤ 3 × 5 MB}` → rate limit 20 per token per hour and 5 per IP-hash per hour (hash with a server salt; no raw IPs stored), uploads photos to `tenant-documents/intake/<building>/<uuid>.jpg` with the service role, inserts the issue with `reported_by` = token creator, `source = 'tenant_intake'`, `reporter` jsonb, `priority 'medium'`, `photo_urls`; notifies admins/managers + the building's `issue` role assignee (`building_role_assignments` role `'user'` fallback) with kind `issue_reported`; returns a reference number (`FO-<6 chars>`) and nothing else.
- Client: `/intake/:token` public route: building name + branding, the form (mobile-first, 44 px, camera capture via the existing `PhotoCapture` pipeline), success screen with the reference. Building → Tenants tab "Tenant intake" card (flag `tenant_intake`, admin/manager): create/rotate/disable the token, QR code (client-side `qrcode` package, ~30 kB) with a printable A5 sheet ("Report a problem in <building>"), submissions count. Issue cards show a "Tenant" chip and the reporter details on the detail dialog.

### 5.11 Form templates (R4c)

```
form_templates (id text pk, name text, description text, category text, icon text, fields jsonb not null, is_active boolean default true, sort_order int, version int default 1, updated_at, updated_by)
```
- Seeded once from the merged arrays (long names from `FormsLibrary`, icons reconciled, fields from `defaultFormFields`), ids `'1'…'14'` preserved so `form_submissions.form_template_id` keeps meaning. RLS: read all authenticated; write admin.
- Client: one `useFormTemplates()` hook feeds `FormsLibrary`, `FormsTab`, `FillableFormDialog`, `FormPreviewDialog`; the two arrays and `defaultFormFields` are deleted. Settings → "Forms" (admin): list, activate/deactivate, edit name/description/category, a field editor (label, type from the existing `FormField.type` union, required, options, width, maxPhotos), reorder; every save bumps `version`. Submissions store `template_version` from now on (new column) so old submissions render with the fields they were filled against (`fields` snapshot stored on the submission: `form_submissions.fields_snapshot jsonb`).

## 6. R4a — Snapshots & SLA

- Migration §5.1–5.6. `snapshot-smoke`: run the snapshot for a fixture building, assert every column, run twice (idempotent), backfill window present, RLS read scoping, anon denied; `rls-smoke` gains `organizations.settings` (anon cannot read the table; view readable), `building_metrics_daily`, `delete_empty_report` gates, two-role user still passes `is_admin_or_manager`.
- Client: `Sparkline` (tiny SVG, no recharts) + `useBuildingTrend(buildingId, days)`; building header shows compliance and task-completion sparklines with the latest value; buildings list column; `/trends` page (admin/manager): portfolio lines for compliance, open issues, overdue tasks, expiring documents over 30/90/365 days (recharts, one file), building leaderboard by change; OPS PDF gains a "Trend" section (12 monthly points from snapshots, rendered as a small table + bar strip, no chart lib in pdfmake). `usePortfolioCompliance` and `useBuildingScore` read the latest snapshot row (fallback to live queries only when no snapshot exists for the building).
- SLA client per §5.4; coverage + discard per §5.5; alerts per §5.6; `useOrgSettings`/`useFeature`; Settings cards for SLA hours, report due day, and feature flags (admin).

## 7. R4b — Distribute & Share

- Migration §5.7–5.8; functions `report-distribution` and `report-share` (+ `cors.ts` allowlist entries, secrets `REPORT_DISTRIBUTION_SECRET`, `SHARE_SALT`); `distribution-smoke` (schedule → dry run → reminder rows → distribution rows; share GET/POST paths incl. passcode lock; anon cannot read the tables).
- Client per §5.7–5.9; `reportArtifacts.ts` moves to the typed client; approval auto-export; `/share/:token` page; Settings → Report distribution; CSV everywhere; evidence packs.

## 8. R4c — Intake & Forms

- Migration §5.10–5.11; function `tenant-intake`; `intake-smoke` (token → GET → POST with photo → issue row + notification → rate limit 429 → disabled token 404); `rls-smoke` gains `form_templates`, `intake_tokens`.
- Client per §5.10–5.11.

## 9. Testing

- Unit: snapshot column math mirrored in TS for the fixture (`docs/fixtures/metrics-snapshot.json` pinned against SQL by the controller's staging query, like recurrence); `slaState`; coverage grid derivation; schedule due-day math (SAST, month ends); share token/passcode client helpers; evidence pack doc builders (pure); intake form validation; form template field editor reducer; `useFormTemplates` mapping.
- Smokes: `snapshot-smoke`, `distribution-smoke`, `intake-smoke`; `rls-smoke` matrices for every new table; `notifications-smoke` asserts the three new kinds land in the inbox and are pushed where declared.
- Load: the snapshot function on staging over all buildings must finish under 30 s (measured in the smoke and recorded in the apply record).

## 10. Risks and mitigations

- **Snapshot drift vs live cards.** Cards keep reading live data; the sparkline caption says "as of 05:00". Backfilled rows are marked and the trend page shows the reconstruction boundary.
- **Approval auto-export fails** (photo embedding, branding). Status is written first; the failure toast names the fix; the distribution function reports `skipped_no_artifact` with an inbox nudge, never a silent skip.
- **Share links are bearer secrets.** Pinned artifact, expiry, optional passcode, lockout, revoke, view count, identical 404s, no raw IP retained. Flag off until the owner enables it.
- **Intake abuse.** Token per building (rotatable), honeypot, rate limits per token and per hashed IP, 3 photos, service-role upload path outside user prefixes, issues land as `medium` for triage. Flag off by default.
- **Multi-role fix touches every RLS check.** Applied first in the migration, proved by the two-role probe in `rls-smoke` on staging before prod.
- **Form template migration.** Ids preserved; `fields_snapshot` on submissions protects old data from later edits.

## 11. Owner actions this release needs

Apply three migrations staging → prod; deploy `report-distribution`, `report-share`, `tenant-intake`, the retrofitted `notify-expiring-alerts` and `daily-digest`; set `REPORT_DISTRIBUTION_SECRET` and `SHARE_SALT`; add the three cron jobs; decide SLA hours and the report due day in Settings; enable `share_links`, `report_schedules`, `tenant_intake` per org when ready; per building, mark which report types apply; print the intake QR sheets; POPIA basis before PostHog/Sentry keys.
