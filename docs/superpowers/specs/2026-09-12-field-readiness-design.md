# Field readiness — design

Date 2026-09-12. Branch `feat/field-readiness` off `main` at `77ab35e`. Follows the top-down
field-readiness interrogation of the same day (six audits, all load-bearing claims re-verified in
source). Owner decisions taken 2026-09-12: managers may grant building access scoped to buildings
they can access; one Team tab writes both assignment tables; coverage nudges on the dashboard, the
Buildings list, the invite flow and the admin digest; deploy staging then prod after gates.

## 1. What this changes, in one paragraph

Today a manager cannot link field staff to a building, nothing tells anyone which buildings have
nobody, and a task that lands with no assignee reaches no person through any channel. The report
PDF exporter still trusts whatever a signed URL returns, one annual-inspection write path can lose
a photo, and two report inputs silently discard what the inspector typed. This release gives every
building a Team tab that managers can use, a coverage surface that names the gaps, a nightly and
push nudge that reaches a field user's phone, a report export that cannot be poisoned by a bad
photo, and a New Issue form that a caretaker can finish one-handed without losing a draft.

## 2. Constraints carried forward

- Schema is shared with iOS. Every migration is additive, authored in `../GMI/sql/`, vendored
  with `npm run schema:vendor`, applied staging first through the Management API. No `db push`.
- RLS is the boundary. New tables and functions get policies and grants in the same migration.
  Definer functions gate themselves; invoker functions rely on RLS.
- Coaching copy renders through `<Hint>`; validation, unsaved-work and data-loss cues never do.
- Reviewers read via `git show <sha>:<path>`; implementers get disjoint file lists; anything that
  vendors SQL is serialised.
- Analytics keys are unset in prod. No new PostHog events are load-bearing.

## 3. Five slices, each its own plan section

| # | Slice | Migration | Owner-visible result |
|---|---|---|---|
| S1 | Team & coverage | `2026-09-15_01_team_coverage.sql` | Team tab, coverage widget, "No team" badge, invite fix, digest coverage line |
| S2 | Photo pipeline hardening | `2026-09-15_02_inspection_photo_append.sql` | Report PDF never fails on a bad photo; second photo never orphans the first; oversize source rejected before decode |
| S3 | Report data integrity | `2026-09-15_03_inspection_provenance.sql` | OHS comment always saved; clearing a value saves; inspector, date and assessor recorded; manager names editable |
| S4 | Nudges | `2026-09-15_04_overdue_notify.sql` | Overdue tasks notify the assignee; managers see overdue and silent buildings in the digest; push prompt on My Day |
| S5 | New Issue mobile pass | none | Building pre-selected, photo first, 44 px controls, draft survives the camera |

Order is S1 → S2 → S3 → S4 → S5. S2 and S3 touch disjoint files and may run in parallel after S1.

## 4. S1 — Team & coverage

### 4.1 Schema

**`user_buildings` write policies** (`ub_insert_admin`, `ub_update_admin`, `ub_delete_admin` in
`2026-06-10_01_security_user_roles.sql:83-89`) are replaced by `ub_write_managed`:

```sql
using (public.is_admin() or (public.is_admin_or_manager() and public.can_access_building(building_id)))
with check (same)
```

Today `can_access_building` is true for every building when the caller is a manager, so the
scope clause is a no-op until manager access is ever narrowed. It is written in so the policy
already states the intended rule. Self-grant by a `user` stays impossible. The `rls-smoke`
assertion "user_buildings insert as manager (admin-only)" flips to expect success; the self-grant
assertion stays.

**`assignable_people()`** — `security definer`, `is_admin_or_manager()` only, returns
`(id, full_name, avatar_url, role, deactivated)` for every profile that has a `user_roles` row.
Needed because a manager cannot read every profile through RLS, and the Team tab must offer people
who are not yet members.

**`portfolio_coverage()`** — `security invoker` so RLS scopes it to the caller's buildings, and
the service role sees all. One row per building:

| column | meaning |
|---|---|
| `building_id`, `building_name` | |
| `field_members` | active `user`-role profiles with a `user_buildings` row |
| `role_rules` | rows in `building_role_assignments` |
| `has_user_rule` | a rule exists for label `'user'` |
| `unassigned_open` | `task_instances` pending or overdue with `assigned_to is null` |
| `overdue_open` | `task_instances` in status `overdue` |
| `due_yesterday`, `completed_yesterday` | daily tasks due yesterday (SAST) and how many of those completed |

Grants: `authenticated` and `service_role`. Both functions `set search_path = ''`.

### 4.2 Team tab

New tab `team` on `BuildingDetails` between Checklists and Forms, rendered for admin and manager
only (the trigger is not mounted for `user`). Deep link `?tab=team` works like the others.

`TeamTab` (`src/components/building/team/TeamTab.tsx`) shows:

- **Members**: `building_members(b)` rows. Admins and managers are listed under a "Managers"
  heading with no controls (they see every building). Field members are listed with avatar, name,
  the role labels they hold at this building as chips (from `useBuildingRoleAssignments`), and a
  Remove action.
- **Add person**: a picker of `assignable_people()` minus current members and minus
  admin/manager roles. Choosing one inserts `user_buildings` and, if the building has no `'user'`
  rule yet, offers "Also make them the default for daily tasks" as a checked-by-default checkbox
  which writes the `'user'` rule. One action, both tables.
- **Role chips**: tapping a chip on a member sets that label's rule to this member (a rule holds
  one person, so the chip moves). Uses `useBuildingRoleAssignments.setRule`.
- **Remove**: confirm dialog stating how many pending tasks at this building are assigned to them.
  On confirm: delete their rules here, set `assigned_to = null` on their pending tasks here, delete
  the `user_buildings` row. Zero-row checks on each step; a failure after the first step is
  reported with what was and was not undone.
- **Apply to existing pending tasks** stays, moved from the Checklists tab panel into this tab.

`RoleAssignmentsPanel` on the Checklists tab is reduced to a read-only summary line ("Daily tasks:
Thandi · Issues: Nobody") with a link to the Team tab. When no `'user'` rule exists and pending
tasks exist, the line is a guardrail warning, not a `<Hint>`: "Nobody is assigned to daily tasks
here. New tasks land with no owner."

### 4.3 Coverage surfaces

- **Dashboard** (`CoverageWidget`, admin and manager, beside `WaitingOnYouWidget`): "Buildings
  needing a team" listing buildings where `field_members = 0` or `has_user_rule = false`, each
  linking to `/buildings/:id?tab=team`, plus one line "N open tasks have nobody assigned". Honest
  loading, error-with-retry and empty states like the other widgets.
- **Buildings list**: a destructive-variant "No team" badge on a card when `field_members = 0`,
  admin and manager only.
- **Invite flow**: when `inviteRole === 'user'`, at least one building is required and the button
  is disabled until one is ticked. Help text becomes: "Field staff only see the buildings ticked
  here. Managers and admins see every building." After a successful field-staff invite the toast
  offers "Set what they do at each building" linking to the first ticked building's Team tab.
- **`invite-user`** edge function: rejects `role = 'user'` with empty `buildingIds` (400,
  `error: "Field staff need at least one building"`), so a stale client cannot create a zombie.

### 4.4 Digest

`daily-digest` calls `portfolio_coverage()` as service role once per run and, for admins and
managers only, adds a "Coverage" section: buildings with no field team (up to `SECTION_MAX`),
count of open tasks with nobody assigned, buildings with daily tasks due yesterday and zero
completions ("Nothing was logged yesterday at …"). `DigestInput` gains `coverage?: CoverageSummary
| null`; `composeDigest` stays pure and tested.

### 4.5 Tests

- `rls-smoke`: manager insert into `user_buildings` succeeds; `user` self-grant fails;
  `assignable_people` as `user` errors; `portfolio_coverage` as `userA` returns only their
  buildings and as admin returns all.
- Unit: `TeamTab` (add, chip move, remove with task count, error states), `CoverageWidget`,
  `Buildings` badge, invite validation, `composeDigest` coverage section, `RoleAssignmentsPanel`
  warning variant.
- Migration verified on the throwaway Postgres 17 before staging.

## 5. S2 — Photo pipeline hardening

### 5.1 One image fetch

`src/lib/imageFetch.ts` exports `fetchImageBlob(signedUrl): Promise<Blob>` that throws unless
`res.ok` and `content-type` starts with `image/`, and `bitmapFromBlob(blob)` that calls
`createImageBitmap(blob, { imageOrientation: 'from-image' })`. `evidencePackData.fetchOne` and
`fortressReportPdf.embedPhoto` both use it. `embedPhoto` returns `null` on any failure; the
`blobToDataUrl` fallback is deleted. The org logo path uses the same fetch and additionally skips
`image/svg+xml` (pdfmake cannot embed it) and logs a DEV warning. `Settings` stops recommending SVG
and the accept list drops it; existing SVG logos keep working in the app and are simply omitted
from PDFs.

`fortressReportDoc` guards `p.dataUrl` truthiness like the evidence pack does.

### 5.2 Source size gate

`PhotoCapture` rejects a source file larger than `MAX_SOURCE_BYTES` (40 MB) before HEIC
conversion or canvas work, with a toast naming the limit. Files are still processed one at a time.

### 5.3 Atomic photo append

Migration adds `append_inspection_photo(p_inspection uuid, p_template_item uuid, p_path text,
p_caption text, p_section_no text) returns inspection_responses` — `security invoker`, upserts the
response row on `(inspection_id, template_item_id)` and appends
`{ref: '<section_no>.<n+1>', caption, path}` with `n = jsonb_array_length(photo_urls)` in one
statement. `ConditionInspectionSection.addPhoto` calls it and writes the returned row into the
React Query cache with `setQueryData` before invalidating. Two rapid adds now produce two refs and
two paths; nothing is rebuilt from a stale cache.

### 5.4 Patch semantics

`useInspectionSection.setResponse` treats a key absent from the patch as unchanged and a key
present with `null` as clear (`'capex_estimate' in patch ? patch.capex_estimate : existing…`).
`InspectionResponsePatch` becomes `Partial<…>` with explicit `| null` members.

### 5.5 Tests

`imageFetch.test.ts` (non-2xx, wrong content type, SVG skip), `fortressReportPdf` embed test with
a mocked fetch returning JSON, `photo-capture.test.tsx` (HEIC by extension with empty MIME, size
gate), `useInspectionSection.test.ts` (null clears, undefined keeps), SQL for `append_inspection_
photo` on the throwaway Postgres (two appends → refs `.1` and `.2`), `rls-smoke` (a `user` with no
access to the building gets 42501).

## 6. S3 — Report data integrity

- **OHS comment**: `useComplianceSection.setResponse(itemId, response: YesNoNa | null, comment?)`
  accepts `null` (column is nullable, check allows null). `ComplianceSection` saves the comment on
  blur even when no answer is picked; the answer toggle sends the current comment. A guardrail
  line under an item with a comment and no answer reads "Answer needed".
- **Provenance**: migration sets defaults `building_inspections.inspected_by default auth.uid()`,
  `inspection_date default (now() at time zone 'Africa/Johannesburg')::date`,
  `compliance_assessments.assessed_by default auth.uid()`, and backfills nulls from
  `reports.author_id` and `reports.created_at`. The report PDF prints "Inspected by … on …" in the
  annual inspection header when present.
- **Manager names**: `FortressReportEditor` header gains three inputs beside "Prepared for"
  (Asset manager, Operations manager, Centre manager), same save-on-blur and toast pattern,
  writing `reports.asset_manager / ops_manager / centre_manager`. The PDF signature block already
  reads them.
- **Deferred, recorded here so it is not lost**: in-form signature fields still write a text
  string; `form_signatures.request_id` is `not null`, so wiring them needs a schema decision.
  `tenant_shop_spec.effective_from` and in-place versioning likewise.

Tests: `useComplianceSection.test.ts` (null response with comment), `ComplianceSection` render
test, editor header inputs, SQL default check on the throwaway Postgres.

## 7. S4 — Nudges

- **Overdue notifies**: `mark_overdue_tasks()` becomes plpgsql. For each task it flips, it inserts
  one `notifications` row (`kind = 'task_overdue'`, `url = /my-day`) for the assignee when one
  exists, in the `mark_sla_breaches` style. `notifications_kind_check` gains `task_overdue`;
  `notifyRules.ts` lists it as `DIGEST_ONLY` (inbox now, the morning push carries the count).
  Managers are not spammed per task: the digest coverage section (§4.4) carries overdue and silent
  buildings.
- **Push prompt on My Day**: `PushPromptCard` above the week strip when `PUSH_ENABLED`, status is
  `off`, and the card was not dismissed on this device (`localStorage`
  `fortress.pushPrompt.dismissed.<uid>`). Body copy is a `<Hint>`; the switch (reusing
  `usePushSubscription`) and Dismiss stay visible regardless. On iOS not installed, `InstallCard`
  already covers it and now mentions notifications in its copy.
- **Sign-off reminders prod cron**: owner action, unchanged; listed in the apply checklist.

Tests: SQL on the throwaway Postgres (a flipped task with an assignee yields one row, without an
assignee yields none, a second run yields none), `PushPromptCard` test (hidden when on, dismissed,
or disabled), `notifyRules` table test.

## 8. S5 — New Issue mobile pass

- **Building**: order of precedence `?building=` → the user's only building → last used building
  (`localStorage` `fortress.lastBuilding.<uid>`, written on every successful submit) → empty.
- **Layout**: photo capture moves directly under the building; title and description keep their
  required status (the column is `not null` and the description is the audit text). All controls
  `min-h-11` below `sm`. A fixed bottom action bar on phones holds "Report issue".
- **Quick capture**: My Day gains a floating "Report issue" button on phones (thumb zone), linking
  to `/issues/new`.
- **Draft**: `useIssueDraft(uid)` stores `{ title, description, buildingId, priority, photos }` in
  an `idb-keyval` store `bo-drafts-<uid>` (photos as `File`s, already-processed JPEGs), debounced
  400 ms. On mount with a draft: restore, recreate previews, show a guardrail bar "Draft restored"
  with Discard. Cleared on submit or discard. The store is cleared with the queue on user change.
- **Hints**: one `<Hint>` under the photo control ("One clear photo of the fault is worth more
  than a paragraph").

Tests: precedence of building selection, draft save/restore/discard with `fake-indexeddb`, 375 px
render without horizontal scroll, FAB present on mobile only.

## 9. Deploy

Per slice, after two-stage review and green gates (typecheck at baseline, tests, build): apply the
migration to staging, deploy changed functions, run `rls-smoke` and the relevant smoke, then prod
the same way, then regenerate types from prod. `APPLY_CHECKLIST.md` gains a section per migration
with the verification queries. If the Management API token is unavailable to this session, stop at
a written checklist and say so.

## 10. Out of scope

Per-building "my work here" view for field users, WhatsApp channel, Won't-do outcome, time
windows on checklists, form signature table wiring, shop-spec versioning, escalation teams. Each is
recorded in the field-readiness memory note as a candidate for the next roadmap.
