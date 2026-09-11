# Building Ops v2 "Daily Ops" — whole-app review and version roadmap

Date: 2026-09-10 · Branch reviewed: `feat/reports-access-hardening` (HEAD 0bbbf94) · Status: DRAFT for Arno's review

Companion artifacts: [Fortress Reporting Review](https://claude.ai/code/artifact/25703d65-0cd0-4aaa-a3af-047dbeddd854) (2026-09-01, findings S/C/D/P/R/E/K), [Fortress Access Control](https://claude.ai/code/artifact/cdac3c1f-2dcc-4ef9-ac2d-a571dabb87a3) (2026-09-01, findings H/M/V/R-5). This document does not repeat those findings; it places their open items inside a version plan.

---

## 1. The one-line diagnosis

Building Ops is a strong **record-and-report** system and a weak **daily-work** system, because nothing in it is addressed to a person.

Evidence, verified in code on 2026-09-10:

- Tasks are assigned to a role string, never a user: `task_instances` has `responsible_role` and no `assigned_to` (`src/integrations/supabase/types.ts:1064`).
- The dashboard is portfolio-wide for every role; no query filters on the signed-in user (`src/hooks/useDashboardStats.ts:71-122`). "Upcoming Tasks" is the top four by due date across all buildings.
- There is no in-app inbox, no bell, no unread badge, no `notifications` table. Six edge functions send email; five of them ignore the user's notification preferences, and three preference toggles (`daily_digest`, `issue_updates`, `task_reminders`) have no consumer at all (`src/pages/Profile.tsx:134-152`, `src/pages/Settings.tsx:118-148`).
- Issues have a server-side activity trail but no way to comment: `activity_type='comment'` exists in the enum and renders, but the web app never inserts one (`src/components/issues/IssueDetailDialog.tsx:88,161`).
- A site user who is never assigned a sign-off receives zero email, ever.
- Checklist task generation is manual and admin-only (`src/components/building/ChecklistsTab.tsx:244-324`). If nobody clicks "Generate", the day is empty. Only certificate renewals have a cron.
- No offline support, no service worker, no manifest, no push. The iOS app was the intended field tool but the pilot ruling is web-only and iOS is frozen relative to the web Fortress build-out (`docs/PRODUCTION_READINESS.md` row 9).

The consequence: people open the app when a report is due, not every morning. Every release below exists to change that.

---

## 2. What is already built (strengths to build on)

| Area | As built | Files |
|---|---|---|
| Fortress reports | 3 report types, 26 section components, 30+ backing tables, scoring views, versioned issued PDFs with supersede chain | `src/components/reports/fortress/**`, `src/lib/reportArtifacts.ts` |
| Forms and sign-off | 14 forms, fill → submit → review, multi-signer sequential/parallel sign-off with drawn/typed signatures, reminders and escalation cron | `src/components/forms/**`, `supabase/schema/2026-06-14_01_form_signoff.sql` |
| Issues | Lifecycle, assignment, photos, DB-trigger audit trail with denormalised author | `2026-06-12_02_issue_activity_trigger.sql` |
| Documents | Unified managed + insight-linker (FDW) register, expiry buckets, COC status | `src/components/building/documents/**` |
| Assets | CRUD, import/export, service history with cost, automatic next-service roll-forward | `src/components/building/AssetsTab.tsx` |
| Map | Mapbox, geocoder search, pin-drop coordinate capture, task/issue counts per marker | `src/components/map/**` |
| Access | Invite-only, role precedence, fail-closed guards, RLS vendored and smoke-tested (386 assertions) | `supabase/schema/`, `scripts/rls-smoke.mjs` |
| Guidance | Toggleable hints layer, honest error states with retry on every dashboard widget | `src/hooks/useHints.tsx` |
| Quality | 21 vitest files, 13 live smokes, CI with typecheck ratchet, staging-first migration rule | `.github/workflows/ci.yml` |

## 3. Schema already paid for, never surfaced

Roughly a third of the roadmap below needs no new tables. These exist in production with no web UI:

| Table / column | What it enables | Roadmap use |
|---|---|---|
| `contractors`, `contractor_documents` (+ storage prefix `contractor-docs/`) | Vendor register with document expiry and rating | R3 Contractors module |
| `issues.contractor_id`, `asset_service_history.contractor_id` | Assign vendors to work | R3 |
| `issues.sla_target_hours`, `sla_breached_at`, `first_response_at`, `resolved_at`, `category`, `responsibility`, `estimated_cost`, `actual_cost` | SLA tracking, cycle time, cost | R1 (resolved_at), R4 (SLA, cost) |
| `building_assets.purchase_price`, `replacement_cost`, `warranty_expiry`, `condition_rating`, `expected_lifespan_years` | Asset lifecycle and capex planning | R3 |
| `task_instances.status = 'overdue'` (check constraint) | Overdue transition | R2 cron |
| `issue_activity.activity_type='comment'`, `issue_activity.photo_urls` | Comment thread with photos | R1 |
| `profiles.daily_digest`, `issue_updates`, `task_reminders` | Notification preferences | R1 |
| `ppm_monthly_status` view | PPM status derived from tasks | R3 PPM unification |
| `audit_logs` | Org activity feed (web removed the Audit Archive tab in WS-C) | R1 activity feed |
| `report_checklist_items` | Ingested answers not in the template (keep as record) | R4 |
| `projects`, `project_ingested_answers` | Newest migration, zero UI | Decision D9 |
| `generated_reports` | Sibling to `report_artifacts` | Decision D9 |

---

## 4. Approaches considered

**A. Person-first (recommended).** Build the personal spine first: assignment to a user, an inbox, a "My Day" landing, preferences honoured by every sender. Then the field loop, then planning, then insight. Reason: offline task queues need tasks assigned to people; scheduled report distribution needs recipients and preferences; a review queue needs "waiting on you". Every later release hangs off this spine, so it goes first.

**B. Field-first.** PWA, offline, push, mobile layout first, because site personnel are the daily users. Rejected as first step: an offline queue for tasks nobody owns just syncs an empty day faster. It becomes R2, immediately after the spine.

**C. Reports-first.** Extend the strength: scheduled distribution, trends, share links. Rejected as first step: it deepens the monthly rhythm rather than creating a daily one. It becomes R4, once there is daily data worth trending.

---

## 5. The roadmap

Five releases. R0 closes what the two September reviews left open and ships the current branch. R1–R4 each carry one theme and one headline behaviour a user can name. Sizing assumes one to two developers and the existing staging-first, smoke-gated release rule.

### R0 — Foundation (2–3 weeks)

Goal: a clean base, nothing new for users.

- Merge `feat/reports-access-hardening` (six commits, not pushed) via PR; deploy the changed edge functions (`set-user-role`, `invite-user`, `notify-signoff-*`).
- Provision staging `SMOKE_SUPABASE_*` secrets so the RLS smoke job actually runs.
- Close the open highs from the reporting review: K1 KPI provenance (`useBuildingKpis.ts:32-37` reads any status), D1 unsaved-edit loss, R1 empty reject note, E1/E2 export completeness and DRAFT watermark, E3 saved-reports error branch. Close M-1 and M-8 from the access review.
- Deploy `notify-expiring-alerts` to prod and set the cron secret (header comment says it is not live).
- Move the hints preference to `profiles.show_hints` (one migration, one file).
- Owner action: set `building_type` on the two prod buildings so retail/industrial H&S add-ons activate.
- Lower the typecheck baseline from 70; add `fortress-smoke` and `fortress-pdf-smoke` to `npm run smoke`.

### R1 — "Mine" (v2.0, 5–6 weeks)

Headline: *Open the app and it tells you what is yours today.*

Schema (staging-first, both teams ack per `SCHEMA_CONTRACT.md`):
- `task_instances.assigned_to uuid` (nullable, FK profiles) + index. `responsible_role` stays as the default-assignment rule input.
- `notifications` table: `id, recipient_id, kind, entity_type, entity_id, building_id, title, body, read_at, created_at`; RLS recipient-only; added to the realtime publication.
- `notification_deliveries` (optional in R1): channel + sent_at per notification, so email/push can be de-duplicated later.
- `issues.resolved_at` written on transition to resolved (trigger).

Product:
- **My Day** page, default landing for `user` and `reviewer` (admin/manager keep the dashboard, with a "My Day" tab). Sections: overdue and due-today tasks assigned to me; issues assigned to me; sign-offs waiting for me; reports returned to me. Every row is actionable inline (complete, comment, sign).
- **Inbox**: bell in the top bar, unread badge, list with mark-read, nav badges on Issues / My Sign-offs / Building Reports. One `notify()` helper on the server side that writes the row and fans out to email according to preferences.
- **Notification preferences** consolidated on Profile; the duplicate block on Settings removed. Every sender reads them.
- **Issue comments** with @mentions and photo attachment (uses `issue_activity.photo_urls`). Mention creates a notification. Assignment creates a notification. Resolution requires a closing note; resolution photo optional (configurable per org in R3).
- **Assign to a person** on tasks (single and bulk) and on issues; assignee picker scoped to users with access to the building.
- **Waiting on you** widget for admin/manager: submitted building reports, submitted form submissions, overdue sign-offs. Closes reporting finding R2.
- **Daily digest** email at 06:00 building-local via pg_cron for users who opted in: your day, your overdue, mentions since yesterday.
- Contacts on Building Details become `tel:` and `mailto:` links.
- Activity feed on the dashboard from `audit_logs` + `issue_activity`, last 7 days, filtered by the buildings the user can access.

Engineering: realtime publication extended to `notifications`, `issues`, `task_instances`; React Query invalidation on realtime events; per-role landing decision recorded in `ProtectedRoute` (closes conformance A1).

Success measures (instrumented in R1, see §7): weekly active users per role; percentage of tasks with an assignee; median time from issue creation to first comment; notification open rate.

### R2 — "Field" (v2.1, 6–8 weeks)

Headline: *The site walk works in a basement with no signal.*

- **PWA**: manifest, service worker, install prompt, offline read cache for the user's assigned buildings (My Day, task detail, issue list, building contacts).
- **Offline write queue** for task completion, issue creation, comments, photos. Client-generated UUIDs already exist in the schema contract for idempotent replay. Queue is per user, survives reload, replays on reconnect, shows a sync status pill.
- **Web push** (VAPID) for assignment, mention, due-today, sign-off request. Honours preferences. Push tap deep-links to the entity.
- **Mobile-first pass** on My Day, task complete, issue create/detail, photo capture, and the 10-tab Building Details (tabs become a scrollable segmented control; overview reordered for phone).
- **Photo pipeline everywhere**: route every capture through `PhotoCapture` (HEIC, compression, cap, remove); closes reporting findings P1–P6. Add capture timestamp and optional geotag as a caption overlay written into the JPEG, since canvas re-encode strips EXIF.
- **Server-side task generation** on pg_cron (daily, per building, per frequency) so a day is never empty; `overdue` transition job at building-local midnight. Removes the admin "Generate" buttons or keeps them as a manual re-run.
- **Quick create** ("+" in the top bar: issue, note, task) and **global search** / command palette over buildings, issues, tenants, documents (`components/ui/command.tsx` exists, unused).

Success measures: percentage of task completions submitted from a mobile viewport; completions synced from offline; same-day completion rate; push opt-in rate.

### R3 — "Plan" (v2.2, 6–8 weeks)

Headline: *Next month's work is already scheduled, owned, and on a calendar.*

- **Scheduling engine**: checklist templates get real recurrence rules (interval + unit, weekday sets, month anchors) replacing the five fixed buckets; a per-building assignment rule maps `responsible_role` to a default person; generation runs server-side (R2 cron) and pre-generates a rolling horizon (for example 90 days) so planning views are populated.
- **Template administration**: checklist templates CRUD with versioning and archive (today templates are read-only in the UI); form templates move from the hardcoded array (`FormsLibrary.tsx:33-132`, duplicated in `FormsTab.tsx:81-97`) into a `form_templates` table with admin CRUD. This matches the iOS repo's own High Priority item and unblocks client-specific forms.
- **Unified calendar**: portfolio and per-building; sources: tasks, asset service dates, document expiry, PPM services, issue deadlines, sign-off due dates. Drag to reschedule tasks. **ICS feed** per user and per building (signed token URL) for Outlook/Google.
- **Contractors module** (web): surface the orphaned register; contractor documents with expiry feeding the alerts digest; assign a contractor to an issue, an asset service record, and a PPM service line; rating on completion. Professional team on the building form becomes picker-with-free-text-fallback over the register.
- **PPM unification**: one model. Proposal: `ppm_services` stays the plan (contractor, cadence, 12-month grid), `task_instances` becomes the execution record, `ppm_monthly_status` derives the grid from execution. The report section reads the derived view; manual cell cycling remains as an override with an audit note.
- **Cost capture**: expose issue estimated/actual cost and asset purchase/replacement/warranty; per-building month cost rollup card; CSV export.
- **Reviewer role decision** (access finding R-5) implemented: either a real review queue on My Day or the role removed.

Success measures: percentage of buildings with a populated 30-day horizon; percentage of tasks generated by the engine versus manually; ICS subscriptions; contractor-assigned issues.

### R4 — "Insight" (v2.3, 6–8 weeks)

Headline: *Every report is on time, trended, shareable, and traceable to the item.*

- **Metric snapshots**: nightly `building_metrics_daily` (compliance %, task completion %, open issues by severity, overdue tasks, expiring docs at 30/60/90, SLA breaches). Powers sparklines in building headers, a portfolio trend view, and a trend page in the OPS PDF. Replaces the N+1 noted in `usePortfolioCompliance.ts:18`.
- **Scheduled distribution**: `report_schedules` (report type, cadence, recipients including external emails, building set); auto-generate on period close where the report is approved; email with an expiring share link; "not approved yet" reminder to the author and reviewer three days before.
- **Share links**: `report_shares` with token, expiry, optional passcode, view count; external viewer page with the DRAFT watermark rule from R0.
- **Structured export**: CSV/XLSX for any section grid, issues, tasks, assets, tenants; item-for-item evidence pack (issue timeline + photos; task completion evidence; asset lifecycle) as PDF and zip.
- **SLA**: per-org defaults by priority written into `sla_target_hours`; breach detection cron; breach notification; SLA column on issues and in the issue report.
- **Coverage and provenance**: per-type, status-aware coverage on the portfolio reports page (closes C2); artifact rows record report status (E2); KPI cards captioned with source report and status (K1).
- **Tenant intake** (decision D5): per-building public request form with QR code that creates an issue tagged to the tenant, no login. Tenant login and portal deferred until intake volume justifies it.

Success measures: report on-time rate; share-link opens by external recipients; SLA breach rate trend; exports per week.

---

## 6. Pillar × release map

| Pillar (from the brief) | R1 Mine | R2 Field | R3 Plan | R4 Insight |
|---|---|---|---|---|
| Daily process, cornerstone habit | My Day, inbox, digest, assignment | Push, offline, quick create | Rolling horizon | SLA, on-time |
| Site and site-personnel interaction | Comments, mentions, tel/mailto | PWA, photo pipeline, mobile | Contractor assignment | Tenant intake |
| Planning | Assign to person | Server-side generation | Scheduling engine, calendar, ICS, PPM | Report schedules |
| Day-to-day review | Waiting on you, activity feed | Sync status | Reviewer queue | Trends, snapshots |
| Overall and item-for-item reporting | resolved_at | Evidence photos with timestamp | Cost rollup | Snapshots, distribution, share, export, evidence packs |
| One-stop shop | Preferences in one place | Global search | Contractors, templates admin, calendar | External sharing, tenant intake |

---

## 7. Cross-cutting engineering (runs alongside R1–R4)

- **Measure engagement before claiming it**: add product analytics (PostHog or equivalent, self-hostable for data residency) and error reporting (Sentry). Today there is none. Define the metric set in R1: WAU by role, tasks assigned %, same-day completion %, time-to-first-comment, notification open rate, report on-time rate.
- **Feature flags** for each release's headline surface (My Day, PWA, calendar) so releases can ship dark and roll out per org.
- **Mobile responsiveness** becomes a review checklist item; `useIsMobile` is used in two files today.
- **Typecheck to zero** across R1–R2; lint from `continue-on-error` to a gate once warnings are cleared.
- **E2E smoke** for My Day and offline replay, added to the existing smoke chain.
- **Types**: `report_artifacts` is absent from generated types; regenerate after each migration.
- **iOS**: keep frozen. Any schema change goes through the contract ack. Revisit iOS only if the PWA fails the R2 field test.

---

## 8. Decisions needed from Arno

| # | Decision | Recommendation |
|---|---|---|
| D1 | Approach A / B / C | A, person-first |
| D2 | Default landing per role | My Day for user and reviewer; dashboard with a My Day tab for admin and manager |
| D3 | Field tool: web PWA vs revive iOS | PWA; iOS stays frozen |
| D4 | Reviewer role: keep with a queue, or remove | Keep only if reviewers exist in the org; otherwise remove in R3 |
| D5 | Tenants: intake form (no login) vs portal | Intake form in R4; portal later |
| D6 | PPM source of truth | `ppm_services` plan, `task_instances` execution, view derives |
| D7 | Push channels | Web push only; WhatsApp/SMS deferred |
| D8 | Analytics and error vendors | PostHog + Sentry, EU/self-hosted if residency matters |
| D9 | `projects` / `project_ingested_answers` / `generated_reports`: surface, or document as data-ops only | Document as data-ops; no UI |
| D10 | K1 behaviour change: KPIs only from approved reports | Yes, with the provenance caption |
| D11 | Sizing assumption: 1–2 developers, roughly 6 months to R4 | Confirm or re-cut |

---

## 9. Risks

- **Schema is shared with iOS.** Every new column needs the contract ack. Mitigation: additive-only migrations; iOS ignores unknown columns.
- **Offline replay conflicts.** Two people completing the same task offline. Mitigation: `task_completions` already has UNIQUE on `task_instance_id`; the second replay resolves to "already completed" with a notification.
- **Notification fatigue.** Mitigation: preferences honoured from day one; digest as the default for low-priority kinds; per-kind toggles.
- **Scope creep in R3.** The scheduling engine and contractors module are each a release on their own in a larger team. Mitigation: ship rolling-horizon generation first, recurrence UI second, calendar third; cut ICS if needed.
- **Engagement not measured.** Without §7 analytics, the roadmap cannot be judged. Ship analytics in R1 week one.

---

## 10. What this document is not

- Not an implementation plan. Each release gets its own spec and plan through the writing-plans flow, starting with R0 and R1.
- Not a re-audit. The reporting and access artifacts remain the authoritative finding lists; their open IDs are referenced above, not restated.
