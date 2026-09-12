# S3 "Report data integrity" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three report inputs stop losing what the inspector typed or never recording who did the work. (1) An OHS comment saves on blur whether or not the item has an answer, the answer toggle carries the comment as typed, and an item with a comment but no answer shows a plain "Answer needed" line. (2) `building_inspections.inspected_by` / `inspection_date` and `compliance_assessments.assessed_by` — never written by the app, so every inspection on both projects has no author and no date — get column defaults (`auth.uid()`, today in SAST) and a backfill from the report's author and creation day; the annual PDF prints "Inspected by … on …". (3) The report header gains Asset / Operations / Centre manager inputs that save on blur like "Prepared for", so the names the PDF signature block already reads can actually be entered.

**Architecture:** One additive migration `2026-09-15_03_inspection_provenance.sql` (canonical in `../GMI/sql`, vendored here): two `alter column … set default`, three backfill `update … from public.reports`. No new tables, functions, policies or grants — the columns, their FKs (`on delete set null` since `2026-08-04_09`) and RLS already exist. Client: `useComplianceSection.setResponse` widens `response` to `YesNoNa | null`; `ComplianceSection` keeps a per-item comment draft so blur and toggle both send the live text; `FortressReportEditor` adds three header inputs mirroring `prepared_for`; `fortressReportPdf` reads `inspected_by, inspection_date` off the winning `building_inspections` row and resolves the name through the `building_members` RPC (profiles are not readable across users); `fortressReportDoc` prints the provenance line under the Condition Inspection heading. Nothing in `useInspectionSection.ts` changes — the new defaults apply because its insert never names those columns.

**Tech Stack:** Postgres 17 (column defaults, `auth.uid()`), Supabase JS v2, React 18 + TS, TanStack Query v5, shadcn/ui (Input, Label, ToggleGroup), pdfmake, vitest 3 + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-12-field-readiness-design.md` §6 (S3), §2 (constraints), §9 (deploy). The "Deferred" paragraph of §6 (form signatures, shop-spec versioning) is NOT in this plan. Format model: `docs/superpowers/plans/2026-09-10-r4a-snapshots-sla.md`.

**Branch:** `feat/field-readiness` (HEAD `4df8a6b`, clean). Timezone `Africa/Johannesburg` wherever a day boundary matters.

**Ground rules for every agent:** never `git stash` / `checkout` / `switch` / `reset` / `worktree`; compare with `git show <sha>:<path>`; edit only the files your task names; commit with an explicit pathspec; retry after 5 s on `index.lock` (other agents commit concurrently); end commit messages with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; gate = `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E '<your files>'` prints nothing, `npm run test` green, the global `error TS` count ≤ `.github/typecheck-baseline.txt` (46) measured on a clean tree (`tsconfig.app.json` includes `src`, so test files are typechecked too); guardrail copy plain (`text-destructive` / plain `<p>`), coaching through `<Hint>` only; the SQL file is edited in `../GMI/sql/` and vendored with `npm run schema:vendor`, staging only the new file and `supabase/schema/.source` (S1 and S2 vendor their own files — anything that vendors SQL is serialised; if `git status` after vendoring shows a file you did not write, stop and tell the controller); SQL agents verify on a throwaway local Postgres 17 before handing over; do NOT touch `src/hooks/useInspectionSection.ts`, `src/lib/imageFetch.ts`, `src/lib/evidencePackData.ts` or `src/components/ui/photo-capture.tsx` (S2's files). **Shared-file caveat:** spec §3 says S2 and S3 touch disjoint files, but §5.1 (S2) and §6 (S3) both name `src/lib/fortressReportPdf.ts` and `src/lib/fortressReportDoc.ts` (S2: `embedPhoto` at the top of the PDF file and the `p.dataUrl` guard in the doc; S3 Task 6: the annual branch of the PDF loader and the annual heading of the doc). The regions do not overlap, but the controller must run Task 6 AFTER S2's PDF commits are on the branch (or serialise the two agents on those two files) so neither agent edits a stale copy.

**Facts every task relies on (from the code as of `4df8a6b`):**
- `compliance_responses` (`supabase/schema/2026-06-13_02_fortress_compliance.sql:54-66`): `response text check (response in ('yes','no','na'))` — nullable, CHECK constrains only non-null values; `comment text`; `unique (assessment_id, template_item_id)`. Score trigger `compute_compliance_score` (`:71-81`): `new.score := case when new.response = 'yes' then coalesce(w,0) when new.response = 'no' then 0 else null end` — a null response lands in `else null`, so a comment-only row scores nothing. `compliance_scores` view (`:88-99`) sums only `'yes'`/`'no'`, so a null-response row is invisible to the percentage. Generated types already say `response: string | null` on Row/Insert/Update (`src/integrations/supabase/fortress-types.ts`).
- `compliance_assessments` (`:42-52`): `assessed_by uuid references profiles(id)` (nullable, FK `on delete set null` since `2026-08-04_09:45-48`), `assessed_at timestamptz default now()`, `unique (report_id)`. Created by `useComplianceSection` (`src/hooks/useComplianceSection.ts:68-72`) with `{ id, report_id, building_id, template_id }` — `assessed_by` never named, so a column default applies.
- `building_inspections` (`supabase/schema/2026-06-13_03_fortress_inspections.sql:37-48`): `inspected_by uuid references profiles(id)` (FK `on delete set null` since `2026-08-04_09:50-53`), `inspection_date date`, both nullable, no defaults. Created by `useInspectionSection` (`src/hooks/useInspectionSection.ts:78-86`) with `{ id, report_id, building_id, template_id }` — again never naming the two columns. `report_id` is NOT unique (one row per template version), which is why both PDF branches fetch a list and take the newest row that holds responses.
- `reports` (`2026-06-13_01_fortress_reports_core.sql:20-40`): `author_id uuid references profiles(id)` (the author column — not `created_by`), `author_name text` (denormalised, "RLS hides profiles"), `created_at timestamptz`, `asset_manager / ops_manager / centre_manager text` (R-11 promoted header fields), `prepared_for text`. All present in `fortress-types.ts` `reports.Row` and in `types.ts:3240-3260`. Seeded reports (`2026-06-13_10`, `2026-06-19_01`) have `author_id` null.
- `auth.uid()` is NOT defined anywhere in the vendored schema (`grep -rn 'function auth.uid' supabase/schema` prints nothing — it is Supabase's own); the throwaway Postgres needs the stub from the R4a plan (`create schema auth; create function auth.uid() … current_setting('app.uid', true)`).
- `profiles` RLS (`2026-06-10_02_rls_redesign.sql:184`): `p_select` = `id = auth.uid() or is_admin_or_manager()`. A `user`-role exporter cannot read another person's `full_name`. The sanctioned cross-user name path is the `building_members(b uuid)` RPC (`2026-09-13_01_r3_schedule.sql:355-384`: security definer, `can_access_building(b)`, returns `(id, full_name, avatar_url, role)` for active admins/managers and the building's assigned users; in `types.ts` Functions at `:4696`), already used by `src/hooks/useBuildingMembers.ts:31` and `src/lib/evidencePackData.ts:219-225` (`memberNames`, private to that file — S2's file, do not import from it).
- Submit gate (`src/components/reports/fortress/FortressReportEditor.tsx:244-265`) counts rows in `REQUIRED_SECTION_TABLE[k]` by `report_id`; for `ohs_compliance` that table is `compliance_assessments` (`src/lib/fortressReports.ts:55-70`), NOT `compliance_responses`. Section counts for the navigator (`src/hooks/useReportSectionCounts.ts`, `SECTION_SOURCE.ohs_compliance` → `compliance_responses` via the assessment) count every response row regardless of `response`.
- Editor header: state at `:65-74` (`preparedFor`), sync effect `:100`, `savePreparedFor` `:117-129` (trim → null, no-op when unchanged, `fdb.from('reports').update(...).eq('id', id)`, `toast.error('Could not save “Prepared for”.')` + reset on error, invalidate `['fortress-reports']`), JSX `:302-321` (editable: Label + Input h-8 + `<Hint icon={false}>`; read-only: `<p className="mt-1 text-sm text-muted-foreground">Prepared for {…}</p>`). No test for the editor exists (`grep -rl FortressReportEditor src --include='*.test.tsx'` prints nothing).
- PDF: `generateReportPdf` (`src/lib/fortressReportPdf.ts:136-`) reads the report at `:145-148` (`managers = [asset_manager, ops_manager, centre_manager].filter(Boolean)`), the annual branch at `:547-626` selects `id,template_id` from `building_inspections`, loops newest-first, `break`s on the first row with responses after setting `data.annualSections/annualFlagged/annualCapexTotal/annualPhotosTotal/annualPhotosOmitted`. `buildReportDoc(report, data, opts)` (`src/lib/fortressReportDoc.ts:159`) prints managers and `Prepared for` on the cover (`:187-194`) and the annual section at `:503-515` (`section('Condition Inspection')`, a summary line, the photos-omitted note, then the sections). `ReportData` annual fields at `:117-127`. `fortressReportDoc.test.ts` walks the doc tree with `collect(doc)` → `{ images, text }`.
- Tests: vitest (`vitest.config.ts`: jsdom, globals, `src/test/setup.ts` stubs the Supabase env and localStorage), chain-mock pattern in `src/hooks/useBuildingScore.test.ts:1-45` and `src/lib/fortressReportPdf.test.ts:1-30`; component pattern with hook mocks in `src/components/reports/fortress/sections/PpmSection.test.tsx:1-70` (`vi.mock('@/hooks/useHints', …)` because `SectionCard` → `<Hint>` → `useHints` → `useAuth`); page pattern mocking `react-router-dom` + `@/contexts/AuthContext` in `src/pages/NewIssue.test.tsx:1-20`. Radix `ToggleGroup type="single"` items render with `role="radio"`.
- Smokes: `scripts/rls-smoke.mjs` (last recorded 737/0 on both projects, R4c), `scripts/fortress-smoke.mjs` (manager authors a compliance assessment and runs a report draft → approved; self-provisioning, teardown cascades). Management-API refs: staging `vkrihpmjajjcxmzgjqdr`, prod `qdzgkttiosahdfqresvz`.

---

## Contracts (pinned; every task codes against these names — do not rename)

**Migration file:** `../GMI/sql/2026-09-15_03_inspection_provenance.sql` → vendored as `supabase/schema/2026-09-15_03_inspection_provenance.sql`.

| object | change |
|---|---|
| `building_inspections.inspected_by` | `default auth.uid()`; backfill `= reports.author_id` where null and the report has an author |
| `building_inspections.inspection_date` | `default (now() at time zone 'Africa/Johannesburg')::date`; backfill `= (reports.created_at at time zone 'Africa/Johannesburg')::date` where null |
| `compliance_assessments.assessed_by` | `default auth.uid()`; backfill `= reports.author_id` where null and the report has an author |

**Hook:** `useComplianceSection(reportId, buildingId, readOnly).setResponse(templateItemId: string, response: YesNoNa | null, comment?: string): Promise<void>` — upserts `{ id, assessment_id, template_item_id, response, comment: comment ?? existing?.comment ?? null }` on `assessment_id,template_item_id`. `answered` counts only non-null responses (unchanged).

**Section:** `ComplianceSection` — controlled comment per item (`drafts: Record<itemId, string>`); blur saves when the text differs from the saved comment, with `current ?? null`; the toggle sends the live comment; `needsAnswer = comment.trim() !== '' && !current` renders `<p className="mt-1 text-xs text-destructive">Answer needed</p>` in both modes.

**Editor header:** `MANAGER_FIELDS = [{ key: 'asset_manager', id: 'asset-manager', label: 'Asset manager' }, { key: 'ops_manager', id: 'ops-manager', label: 'Operations manager' }, { key: 'centre_manager', id: 'centre-manager', label: 'Centre manager' }]`; toast on failure `Could not save “<label>”.`; read-only line `<label>: <value>` for each set field, above "Prepared for".

**PDF:** `ReportData.annualInspectedBy?: string | null`, `ReportData.annualInspectionDate?: string | null` (YYYY-MM-DD); `export function inspectionProvenance(by, date): string | null` in `fortressReportDoc.ts` → `Inspected by <name> on <12 September 2026>` / `Inspected by <name>` / `Inspected on <date>` / `null`; printed directly under the Condition Inspection summary line. Loader helper `inspectorName(buildingId, userId, fallback)` in `fortressReportPdf.ts` — `building_members` RPC, non-fatal, falls back to `reports.author_name` when `inspected_by === author_id`.

**Query keys:** `['fortress-compliance', reportId, readOnly]` (unchanged), `['fortress-reports']` (invalidated by the header saves, unchanged).

---

### Task 1: Migration + local verification + vendor

**Files:**
- Create: `../GMI/sql/2026-09-15_03_inspection_provenance.sql` (then `npm run schema:vendor` → `supabase/schema/2026-09-15_03_inspection_provenance.sql` + `supabase/schema/.source`)
- Scratch only (not committed): `<scratchpad>/s3-local-stub.sql`, `<scratchpad>/s3-local-verify.sql`

- [ ] **Step 1: Write the migration** at `../GMI/sql/2026-09-15_03_inspection_provenance.sql`:

```sql
-- 2026-09-15_03_inspection_provenance.sql — S3 "Report data integrity" (spec 2026-09-12-field-readiness-design.md §6).
-- Additive, idempotent, one transaction. Requires 2026-06-13_02 (compliance_assessments), 2026-06-13_03
-- (building_inspections) and 2026-08-04_09 (both FKs to profiles are already ON DELETE SET NULL, so a
-- populated inspected_by / assessed_by never blocks account deletion).
--
-- Why: the app creates a building_inspections row the first time the inspection tab of a report is opened
-- (useInspectionSection) and a compliance_assessments row the first time the OHS tab is opened
-- (useComplianceSection). Neither insert names inspected_by, inspection_date or assessed_by, and no other
-- code path writes them, so every inspection and assessment on staging and prod has no author and no date.
-- Column defaults record provenance at insert time for every client (web and iOS) without a client change:
-- auth.uid() is the signed-in user behind the PostgREST request (null for the service role, which is fine —
-- the columns stay nullable). The backfill attributes existing rows to the report's author and to the
-- report's creation day in SAST — the best evidence on file. Seeded reports with no author keep a null
-- inspector / assessor; their inspection_date is still filled from created_at.
begin;

alter table public.building_inspections
  alter column inspected_by    set default auth.uid(),
  alter column inspection_date set default (now() at time zone 'Africa/Johannesburg')::date;

alter table public.compliance_assessments
  alter column assessed_by set default auth.uid();

update public.building_inspections bi
   set inspected_by = r.author_id
  from public.reports r
 where r.id = bi.report_id
   and bi.inspected_by is null
   and r.author_id is not null;

update public.building_inspections bi
   set inspection_date = (r.created_at at time zone 'Africa/Johannesburg')::date
  from public.reports r
 where r.id = bi.report_id
   and bi.inspection_date is null;

update public.compliance_assessments ca
   set assessed_by = r.author_id
  from public.reports r
 where r.id = ca.report_id
   and ca.assessed_by is null
   and r.author_id is not null;

commit;

-- Verify (run after applying, staging then prod):
--   select column_name, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'building_inspections'
--      and column_name in ('inspected_by', 'inspection_date') order by 1;
--     -- inspected_by     | auth.uid()
--     -- inspection_date  | (timezone('Africa/Johannesburg'::text, now()))::date
--   select column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'compliance_assessments' and column_name = 'assessed_by';
--     -- auth.uid()
--   select count(*) filter (where bi.inspected_by is null)    as no_inspector,
--          count(*) filter (where bi.inspection_date is null) as no_date,
--          count(*)                                           as rows_with_author
--     from public.building_inspections bi join public.reports r on r.id = bi.report_id
--    where r.author_id is not null;                                   -- 0 | 0 | n
--   select count(*) filter (where bi.inspection_date is null) as no_date_any
--     from public.building_inspections bi where bi.report_id is not null;   -- 0
--   select count(*) filter (where ca.assessed_by is null) as no_assessor, count(*) as rows_with_author
--     from public.compliance_assessments ca join public.reports r on r.id = ca.report_id
--    where r.author_id is not null;                                   -- 0 | n
--   Then: node scripts/rls-smoke.mjs; node scripts/fortress-smoke.mjs.
```

- [ ] **Step 2: Verify on a throwaway local Postgres 17.** Supabase's `auth` schema and the base tables are not in the vendored migrations, so stand up stubs with exactly the columns the migration touches, seed the "no provenance" state prod is in today, apply the real file twice, then assert the backfill and the defaults. Write `<scratchpad>/s3-local-stub.sql`:

```sql
-- Throwaway stub of the surface 2026-09-15_03 depends on. Never applied anywhere real.
-- auth.uid() is Supabase's; locally it reads a session setting so a "signed-in" insert can be simulated.
create extension if not exists pgcrypto;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;

create table public.profiles (id uuid primary key, full_name text);
create table public.buildings (id uuid primary key default gen_random_uuid(), name text not null);
create table public.reports (
  id            uuid primary key default gen_random_uuid(),
  building_id   uuid not null references public.buildings(id) on delete cascade,
  report_type   text not null,
  report_period date not null,
  status        text not null default 'draft',
  title         text,
  author_id     uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create table public.compliance_templates (id uuid primary key default gen_random_uuid(), name text);
create table public.compliance_assessments (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.reports(id) on delete cascade,
  building_id  uuid not null references public.buildings(id) on delete cascade,
  template_id  uuid not null references public.compliance_templates(id),
  assessed_by  uuid references public.profiles(id) on delete set null,
  assessed_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (report_id)
);
create table public.inspection_templates (id uuid primary key default gen_random_uuid(), cadence text);
create table public.building_inspections (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid references public.reports(id) on delete cascade,
  building_id     uuid not null references public.buildings(id) on delete cascade,
  template_id     uuid references public.inspection_templates(id),
  inspected_by    uuid references public.profiles(id) on delete set null,
  inspection_date date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The state prod is in today: rows with no provenance at all.
insert into public.profiles (id, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Thandi Author'),
  ('00000000-0000-0000-0000-0000000000a2', 'Sipho Second');
insert into public.buildings (id, name) values ('00000000-0000-0000-0000-00000000b001', 'ZZTEST S3');
insert into public.compliance_templates (id, name) values ('00000000-0000-0000-0000-0000000000c0', 'OHS Act Report');
insert into public.inspection_templates (id, cadence) values ('00000000-0000-0000-0000-0000000000d0', 'annual');
-- e1: authored, created 23:30 UTC on 31 Aug = 01:30 SAST on 1 Sep (the SAST day boundary matters).
-- e2: seeded report, no author.  e3: authored, used for the default-check inserts below.
insert into public.reports (id, building_id, report_type, report_period, title, author_id, created_at) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000b001', 'annual_inspection', '2026-09-01', 'ZZTEST e1', '00000000-0000-0000-0000-0000000000a1', '2026-08-31 23:30:00+00'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000b001', 'ops_monthly',       '2026-07-01', 'ZZTEST e2', null,                                   '2026-07-15 08:00:00+00'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000b001', 'ops_monthly',       '2026-08-01', 'ZZTEST e3', '00000000-0000-0000-0000-0000000000a1', '2026-08-03 08:00:00+00');
insert into public.building_inspections (id, report_id, building_id, template_id) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000d0'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000d0');
insert into public.compliance_assessments (id, report_id, building_id, template_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000c0'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000c0');
```

Write `<scratchpad>/s3-local-verify.sql`:

```sql
-- 1) Backfill: authored reports get the author and the SAST creation day; authorless keep a null person.
do $$ begin
  if (select inspected_by from public.building_inspections where id = '00000000-0000-0000-0000-0000000000f1')
     is distinct from '00000000-0000-0000-0000-0000000000a1' then raise exception 'backfill inspected_by (f1)'; end if;
  if (select inspection_date from public.building_inspections where id = '00000000-0000-0000-0000-0000000000f1')
     is distinct from date '2026-09-01' then raise exception 'backfill inspection_date must be the SAST day (f1): %',
       (select inspection_date from public.building_inspections where id = '00000000-0000-0000-0000-0000000000f1'); end if;
  if (select inspected_by from public.building_inspections where id = '00000000-0000-0000-0000-0000000000f2')
     is not null then raise exception 'authorless report must keep a null inspector (f2)'; end if;
  if (select inspection_date from public.building_inspections where id = '00000000-0000-0000-0000-0000000000f2')
     is distinct from date '2026-07-15' then raise exception 'backfill inspection_date (f2)'; end if;
  if (select assessed_by from public.compliance_assessments where id = '00000000-0000-0000-0000-0000000000c1')
     is distinct from '00000000-0000-0000-0000-0000000000a1' then raise exception 'backfill assessed_by (c1)'; end if;
  if (select assessed_by from public.compliance_assessments where id = '00000000-0000-0000-0000-0000000000c2')
     is not null then raise exception 'authorless report must keep a null assessor (c2)'; end if;
  raise notice 'backfill ok';
end $$;

-- 2) Defaults as a signed-in user: an insert that names neither column (exactly what the hooks send).
begin;
select set_config('app.uid', '00000000-0000-0000-0000-0000000000a2', true);
insert into public.building_inspections (id, report_id, building_id, template_id) values
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000d0');
insert into public.compliance_assessments (id, report_id, building_id, template_id) values
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000c0');
do $$ begin
  if (select inspected_by from public.building_inspections where id = '00000000-0000-0000-0000-0000000000f3')
     is distinct from '00000000-0000-0000-0000-0000000000a2' then raise exception 'default inspected_by'; end if;
  if (select inspection_date from public.building_inspections where id = '00000000-0000-0000-0000-0000000000f3')
     is distinct from (now() at time zone 'Africa/Johannesburg')::date then raise exception 'default inspection_date'; end if;
  if (select assessed_by from public.compliance_assessments where id = '00000000-0000-0000-0000-0000000000c3')
     is distinct from '00000000-0000-0000-0000-0000000000a2' then raise exception 'default assessed_by'; end if;
  raise notice 'defaults ok';
end $$;
commit;

-- 3) No JWT (service role, cron): the person stays null, the date is still stamped.
insert into public.building_inspections (id, report_id, building_id, template_id) values
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000d0');
do $$ begin
  if (select inspected_by from public.building_inspections where id = '00000000-0000-0000-0000-0000000000f4')
     is not null then raise exception 'no-jwt inspected_by must be null'; end if;
  if (select inspection_date from public.building_inspections where id = '00000000-0000-0000-0000-0000000000f4')
     is null then raise exception 'no-jwt inspection_date must still default'; end if;
  raise notice 'no-jwt ok';
end $$;

-- 4) The verify queries from the migration's tail, on the stub.
select column_name, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'building_inspections' and column_name in ('inspected_by', 'inspection_date') order by 1;
select 'ALL LOCAL CHECKS PASSED' as result;
```

Run:
```bash
docker run --rm -d --name s3-pg -e POSTGRES_PASSWORD=pg -p 55433:5432 postgres:17
until docker exec s3-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
PGPASSWORD=pg psql -h localhost -p 55433 -U postgres -v ON_ERROR_STOP=1 -f "<scratchpad>/s3-local-stub.sql"
PGPASSWORD=pg psql -h localhost -p 55433 -U postgres -v ON_ERROR_STOP=1 -f "../GMI/sql/2026-09-15_03_inspection_provenance.sql"
PGPASSWORD=pg psql -h localhost -p 55433 -U postgres -v ON_ERROR_STOP=1 -f "../GMI/sql/2026-09-15_03_inspection_provenance.sql"   # idempotency: must apply twice
PGPASSWORD=pg psql -h localhost -p 55433 -U postgres -v ON_ERROR_STOP=1 -f "<scratchpad>/s3-local-verify.sql"
docker rm -f s3-pg
```
Expected: the first migration apply prints `BEGIN`, `ALTER TABLE`, `ALTER TABLE`, `UPDATE 1` (f1 — f2's report has no author), `UPDATE 2` (both dates), `UPDATE 1` (c1), `COMMIT`; the second apply prints `UPDATE 0` three times. The verify prints `NOTICE:  backfill ok`, `NOTICE:  defaults ok`, `NOTICE:  no-jwt ok`, the two-row `column_default` table (`auth.uid()` and `(timezone('Africa/Johannesburg'::text, now()))::date`) and `ALL LOCAL CHECKS PASSED`. If `psql` is not on PATH use `docker exec -i s3-pg psql -U postgres -v ON_ERROR_STOP=1 < file`. Fix the migration until both applies and the verify pass.

- [ ] **Step 3: Commit the canonical SQL in GMI**, then vendor:

```bash
cd ../GMI && git add sql/2026-09-15_03_inspection_provenance.sql && git commit -m "S3: inspection provenance defaults + backfill (2026-09-15_03)" && cd -
npm run schema:vendor
git status --short supabase/schema
git add supabase/schema/2026-09-15_03_inspection_provenance.sql supabase/schema/.source
git commit -m "Vendor the S3 inspection provenance migration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
(`schema:vendor` deletes and re-copies every `.sql`; `git status` must show only the new file and `.source` as changed. If `2026-09-15_01_…` or `_02_…` appear because S1/S2 landed in GMI but are not yet vendored here, or any other vendored file differs, stop and tell the controller — do not stage them.)

---

### Task 2: `useComplianceSection.setResponse` accepts a null response

**Files:**
- Modify: `src/hooks/useComplianceSection.ts` (`setResponse` signature + comment at `:95-118`; header comment)
- Create: `src/hooks/useComplianceSection.test.ts`

- [x] **Step 1: Write the failing test** at `src/hooks/useComplianceSection.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Postgrest-like chain (same shape as useBuildingScore.test.ts): every builder method records
// itself and returns the chain; the chain is thenable so the hook can `await` it. Results are
// chosen per table, and for compliance_responses by whether the chain carried an upsert.
interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: { message: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & {
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
};

const state = vi.hoisted(() => ({
  queries: [] as { table: string; calls: RecordedCall[] }[],
  responses: [] as Record<string, unknown>[],
  upsertError: null as { message: string } | null,
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/integrations/supabase/fortress-db', () => {
  const METHODS = ['select', 'eq', 'order', 'limit', 'maybeSingle', 'single', 'insert', 'upsert'];
  const result = (table: string, calls: RecordedCall[]): QueryResult => {
    if (table === 'compliance_templates') return { data: { id: 'tpl1', name: 'OHS Act Report', active: true, version: 3 }, error: null };
    if (table === 'compliance_template_items') {
      return { data: [{ id: 'i1', template_id: 'tpl1', item_no: '1.1', prompt: 'Fire extinguishers serviced', section_no: '1', section_title: 'Fire', is_scored: true, is_critical: false, group_code: 'A', group_weight: 1, weight: 1, sort_order: 1 }], error: null };
    }
    if (table === 'compliance_assessments') return { data: { id: 'as1', report_id: 'rep1', building_id: 'b1', template_id: 'tpl1' }, error: null };
    if (table === 'compliance_responses') {
      if (calls.some((c) => c.method === 'upsert')) return { data: null, error: state.upsertError };
      return { data: state.responses, error: null };
    }
    return { data: [], error: null };
  };
  const from = (table: string): Chain => {
    const own: RecordedCall[] = [];
    const chain = {} as Chain;
    for (const method of METHODS) chain[method] = (...args: unknown[]) => { own.push({ table, method, args }); return chain; };
    chain.then = (resolve, reject) => {
      state.queries.push({ table, calls: own });
      return Promise.resolve(result(table, own)).then(resolve, reject);
    };
    return chain;
  };
  return { fdb: { from } };
});

import { useComplianceSection } from './useComplianceSection';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

/** The payload + options of the one upsert the hook sent to compliance_responses. */
function upsertSent(): { payload: Record<string, unknown>; opts: unknown } {
  const q = state.queries.find((x) => x.table === 'compliance_responses' && x.calls.some((c) => c.method === 'upsert'));
  expect(q, 'an upsert to compliance_responses').toBeDefined();
  const call = q!.calls.find((c) => c.method === 'upsert')!;
  return { payload: call.args[0] as Record<string, unknown>, opts: call.args[1] };
}

beforeEach(() => {
  state.queries = [];
  state.responses = [];
  state.upsertError = null;
});

describe('useComplianceSection.setResponse', () => {
  it('writes a comment with no answer as a row whose response is null', async () => {
    const { result } = renderHook(() => useComplianceSection('rep1', 'b1'), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => { await result.current.setResponse('i1', null, 'Extinguisher tag missing'); });

    const { payload, opts } = upsertSent();
    expect(payload).toMatchObject({ assessment_id: 'as1', template_item_id: 'i1', response: null, comment: 'Extinguisher tag missing' });
    expect(typeof payload.id).toBe('string');
    expect(opts).toEqual({ onConflict: 'assessment_id,template_item_id' });
  });

  it('keeps the saved comment when an answer arrives without one, and never counted the comment-only row as answered', async () => {
    state.responses = [{ id: 'resp1', assessment_id: 'as1', template_item_id: 'i1', response: null, comment: 'Tag missing', score: null }];
    const { result } = renderHook(() => useComplianceSection('rep1', 'b1'), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.answered).toBe(0);
    expect(result.current.responseMap.i1).toBeUndefined();

    await act(async () => { await result.current.setResponse('i1', 'yes'); });

    const { payload } = upsertSent();
    expect(payload).toMatchObject({ id: 'resp1', response: 'yes', comment: 'Tag missing' });
  });
});
```

Run:
```bash
npx vitest run src/hooks/useComplianceSection.test.ts
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'useComplianceSection'
```
Expected: vitest reports **2 passed** — at runtime the current code already forwards whatever `response` it is handed, so the behaviour is not what is red here; the contract is. `tsc` prints `src/hooks/useComplianceSection.test.ts(…): error TS2345: Argument of type 'null' is not assignable to parameter of type 'YesNoNa'.` — that line is the failing check for this task, and it must be gone after Step 2.

- [x] **Step 2: Widen the hook.** In `src/hooks/useComplianceSection.ts` replace the header comment (`:1-7`) with:

```ts
/**
 * OHS Act compliance section: template-driven (zero hardcoded questions).
 * Loads the active OHS template + items, ensures one assessment per report, tracks
 * per-item responses, and computes the live building % using the group-weighted,
 * N/A-is-pass model (11_MARKING_AND_PERCENTAGES.md) so the score updates as the user
 * answers — the persisted compliance_scores view is the source of truth on reload.
 *
 * A response row may carry a comment and no answer (S3): `response` is nullable and its
 * CHECK only constrains non-null values, the score trigger maps null to a null score, and
 * the compliance_scores view sums only 'yes'/'no' — so a comment-only row is stored,
 * never scored, and never counted as answered.
 */
```

and replace `setResponse` (`:95-118`) with:

```ts
  const setResponse = useCallback(
    async (templateItemId: string, response: YesNoNa | null, comment?: string) => {
      const assessmentId = query.data?.assessmentId;
      if (!assessmentId) return;
      const existing = query.data?.responses[templateItemId];
      // `response` null is a legal row: a comment typed before (or without) an answer is
      // saved instead of thrown away. An undefined `comment` keeps whatever is saved.
      const { error } = await fdb.from('compliance_responses').upsert(
        {
          id: existing?.id ?? crypto.randomUUID(),
          assessment_id: assessmentId,
          template_item_id: templateItemId,
          response,
          comment: comment ?? existing?.comment ?? null,
        },
        { onConflict: 'assessment_id,template_item_id' },
      );
      if (error) {
        if (import.meta.env.DEV) console.error('setResponse failed:', error);
        toast.error('Could not save that answer.');
        return;
      }
      qc.invalidateQueries({ queryKey: key });
    },
    [query.data, qc, key],
  );
```

`responseMap` (`:120-126`) and `answered` (`:133`) stay as they are — `(v.response as YesNoNa | null) ?? undefined` already turns a null response into "unanswered", and `.filter(Boolean)` excludes it; the second test pins that.

- [x] **Step 3: Gate.**
```bash
npx vitest run src/hooks/useComplianceSection.test.ts
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'useComplianceSection|ComplianceSection'
```
Expected: 2 passed; the grep prints nothing (note `ComplianceSection.tsx` still compiles — it passes `current` of type `YesNoNa | undefined` only when truthy, so no new error there).

- [x] **Step 4: Commit.** (`e521f94`)
```bash
git add src/hooks/useComplianceSection.ts src/hooks/useComplianceSection.test.ts
git commit -m "Let an OHS comment be saved without an answer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `ComplianceSection` — comment saves without an answer, toggle carries the live comment, "Answer needed"

**Files:**
- Modify: `src/components/reports/fortress/sections/ComplianceSection.tsx` (whole file replaced below)
- Create: `src/components/reports/fortress/sections/ComplianceSection.test.tsx`
- Wait for: Task 2's commit (`until git log --oneline -- src/hooks/useComplianceSection.test.ts | grep -q .; do sleep 30; done`) — the hook signature this component calls with `null`.

- [x] **Step 1: Write the failing test** at `src/components/reports/fortress/sections/ComplianceSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const state = vi.hoisted(() => ({
  responses: {} as Record<string, { id: string; comment: string | null; response: string | null }>,
  responseMap: {} as Record<string, 'yes' | 'no' | 'na' | undefined>,
  setResponse: vi.fn(async () => {}),
  item: { id: 'i1', template_id: 'tpl1', item_no: '1.1', prompt: 'Fire extinguishers serviced', section_no: '1', section_title: 'Fire', is_scored: true, is_critical: false, group_code: 'A', group_weight: 1, weight: 1, sort_order: 1 },
}));

// SectionCard renders its hint through <Hint> → useHints → useAuth; none of that is under test.
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));
vi.mock('@/hooks/useComplianceSection', () => ({
  useComplianceSection: () => ({
    template: null,
    items: [state.item],
    responses: state.responses,
    responseMap: state.responseMap,
    isLoading: false,
    setResponse: state.setResponse,
    liveBuildingPct: null,
    answered: Object.values(state.responseMap).filter(Boolean).length,
    scoredTotal: 1,
  }),
}));

import ComplianceSection from './ComplianceSection';

const renderSection = (readOnly = false) =>
  render(<ComplianceSection reportId="rep1" buildingId="b1" readOnly={readOnly} />);
const commentBox = () => screen.getByPlaceholderText('Comment (optional)') as HTMLInputElement;

beforeEach(() => {
  state.responses = {};
  state.responseMap = {};
  state.setResponse.mockClear();
});

describe('ComplianceSection — comment without an answer', () => {
  it('saves the comment on blur before any answer is picked, and asks for the answer', () => {
    renderSection();
    fireEvent.change(commentBox(), { target: { value: 'Extinguisher tag missing' } });
    expect(screen.getByText('Answer needed')).toBeInTheDocument();
    fireEvent.blur(commentBox());
    expect(state.setResponse).toHaveBeenCalledTimes(1);
    expect(state.setResponse).toHaveBeenCalledWith('i1', null, 'Extinguisher tag missing');
  });

  it('the answer toggle sends the comment as typed, not the last saved one', () => {
    state.responses = { i1: { id: 'r1', comment: 'old note', response: null } };
    renderSection();
    expect(commentBox()).toHaveValue('old note');
    fireEvent.change(commentBox(), { target: { value: 'new note' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(state.setResponse).toHaveBeenCalledWith('i1', 'yes', 'new note');
  });

  it('does not rewrite an unchanged comment, and drops the line once the item is answered', () => {
    state.responses = { i1: { id: 'r1', comment: 'kept', response: 'yes' } };
    state.responseMap = { i1: 'yes' };
    renderSection();
    fireEvent.blur(commentBox());
    expect(state.setResponse).not.toHaveBeenCalled();
    expect(screen.queryByText('Answer needed')).toBeNull();
  });

  it('read-only: never writes, but still names the missing answer', () => {
    state.responses = { i1: { id: 'r1', comment: 'noted on site', response: null } };
    renderSection(true);
    expect(commentBox()).toBeDisabled();
    fireEvent.blur(commentBox());
    expect(state.setResponse).not.toHaveBeenCalled();
    expect(screen.getByText('Answer needed')).toBeInTheDocument();
  });
});
```

Run `npx vitest run src/components/reports/fortress/sections/ComplianceSection.test.tsx`. Expected: **3 failed, 1 passed** — test 1 fails at `getByText('Answer needed')` (`TestingLibraryElementError: Unable to find an element with the text: Answer needed`), test 2 fails with `expected "spy" to be called with arguments: [ 'i1', 'yes', 'new note' ] … Received: [ 'i1', 'yes', 'old note' ]` (the toggle sends the stale saved comment), test 4 fails at `getByText('Answer needed')`; test 3 passes today.

- [x] **Step 2: Replace `src/components/reports/fortress/sections/ComplianceSection.tsx`** with:

```tsx
/** OHS Act Compliance — rendered entirely from compliance_templates (no hardcoded
 *  questions). Live building % updates as items are answered; N/A counts as a pass.
 *  A comment saves on blur whether or not the item is answered (S3): the row is upserted
 *  with a null response, and a plain guardrail line names the missing answer. */
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SectionCard } from '../SectionCard';
import { useComplianceSection } from '@/hooks/useComplianceSection';
import { formatPct } from '@/lib/fortressReports';
import type { YesNoNa, ComplianceTemplateItem } from '@/integrations/supabase/fortress-db';
import type { SectionProps } from './types';

export default function ComplianceSection({ reportId, buildingId, readOnly }: SectionProps) {
  const { items, responses, responseMap, isLoading, setResponse, liveBuildingPct, answered, scoredTotal } =
    useComplianceSection(reportId, buildingId, readOnly);

  // Comment text as typed, per item, until it is saved. Controlled rather than defaultValue so
  // the answer toggle can send what is in the box right now: with an uncontrolled input, picking
  // an answer after typing a comment sent the last SAVED comment and overwrote the new one.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const grouped = useMemo(() => {
    const map = new Map<string, ComplianceTemplateItem[]>();
    for (const it of items) {
      const k = `${it.section_no ?? ''} ${it.section_title ?? ''}`.trim();
      const arr = map.get(k) ?? [];
      arr.push(it);
      map.set(k, arr);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <SectionCard
      title="OHS Act Compliance"
      hint="Weighted compliance scored live from the active template. N/A counts as compliant. Answers and comments save automatically — there is no Save button here."
      headerAccessory={
        <div className="text-right">
          <Badge variant={liveBuildingPct != null && liveBuildingPct >= 90 ? 'default' : 'secondary'} className="text-sm">
            {formatPct(liveBuildingPct)}
          </Badge>
          <p className="mt-1 text-xs text-muted-foreground">Target 100%</p>
          <p className="text-xs text-muted-foreground">{answered}/{scoredTotal} scored answered</p>
        </div>
      }
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading template…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active OHS template found.</p>
      ) : (
        <div className="space-y-6">
          {grouped.map(([section, secItems]) => (
            <div key={section} className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground">{section}</h4>
              {secItems.map((it) => {
                const current = responseMap[it.id];
                const saved = responses[it.id]?.comment ?? '';
                const comment = drafts[it.id] ?? saved;
                const needsAnswer = comment.trim() !== '' && !current;
                return (
                  <div key={it.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm">
                        <span className="text-muted-foreground">{it.item_no}</span> {it.prompt}
                        {it.is_critical && <Badge variant="outline" className="ml-2 text-[10px]">critical</Badge>}
                        {!it.is_scored && <Badge variant="outline" className="ml-2 text-[10px]">info</Badge>}
                      </div>
                      <ToggleGroup
                        type="single"
                        value={current ?? ''}
                        onValueChange={(v) => v && !readOnly && setResponse(it.id, v as YesNoNa, comment)}
                        disabled={readOnly}
                        className="shrink-0"
                      >
                        <ToggleGroupItem value="yes" className="h-8 px-3 text-xs">Yes</ToggleGroupItem>
                        <ToggleGroupItem value="no" className="h-8 px-3 text-xs">No</ToggleGroupItem>
                        <ToggleGroupItem value="na" className="h-8 px-3 text-xs">N/A</ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                    <Input
                      className="mt-2 h-8"
                      placeholder="Comment (optional)"
                      value={comment}
                      disabled={readOnly}
                      onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
                      onBlur={() => {
                        if (readOnly || comment === saved) return;
                        // No answer yet is fine: the row is written with a null response so the
                        // comment survives, and the line below says an answer is still owed.
                        setResponse(it.id, current ?? null, comment);
                      }}
                    />
                    {/* Guardrail, not coaching — never routed through <Hint>, visible with hints off. */}
                    {needsAnswer && <p className="mt-1 text-xs text-destructive">Answer needed</p>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
```

- [x] **Step 3: Gate.**
```bash
npx vitest run src/components/reports/fortress/sections/ComplianceSection.test.tsx src/hooks/useComplianceSection.test.ts
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'ComplianceSection'
```
Expected: 6 passed; the grep prints nothing.

- [x] **Step 4: Commit.** (`43a3a66`)
```bash
git add src/components/reports/fortress/sections/ComplianceSection.tsx src/components/reports/fortress/sections/ComplianceSection.test.tsx
git commit -m "OHS section: save the comment on blur without an answer, send the live comment with the toggle, name the missing answer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Submit gate — audited, no change

**Files:** none modified. This task is a decision record; there is nothing to test or commit.

- [x] **Step 1: Confirm what the gate counts.** — AUDITED 2026-09-12 at `43a3a66`: `REQUIRED_SECTION_TABLE.ohs_compliance` is `'compliance_assessments'` (`fortressReports.ts:63-67`), its only consumer is `FortressReportEditor.validateAndSubmit` (`:254-259`), which does `select('id', { count: 'exact', head: true }).eq('report_id', id)` on that parent table and never reads `compliance_responses`. The brief's condition ("counts compliance rows regardless of response") is NOT met; no code changed. `SECTION_SOURCE.ohs_compliance` (`fortressReports.ts:95`) → `compliance_responses` via the assessment, so a comment-only row now counts toward the navigator badge, as intended. `src/lib/fortressReports.ts:55-70`:

```ts
/** Sections that must have at least one saved row before a report can be submitted. */
export const REQUIRED_SECTIONS: Record<ReportType, string[]> = {
  ops_monthly: ['ohs_compliance'],
  cm_monthly: ['turnover'],
  annual_inspection: ['condition_inspection'],
};

/** Report-scoped backing table per gated section — submit checks ≥1 row exists. */
export const REQUIRED_SECTION_TABLE: Record<string, string> = {
  ohs_compliance: 'compliance_assessments',
  turnover: 'tenant_turnover',
  condition_inspection: 'building_inspections',
};
```

and its one consumer, `FortressReportEditor.validateAndSubmit` (`:254-259`):

```ts
      for (const k of REQUIRED_SECTIONS[report.report_type as keyof typeof REQUIRED_SECTIONS] ?? []) {
        const table = REQUIRED_SECTION_TABLE[k];
        if (!table) continue;
        const { count } = await (fdb as unknown as SectionCountClient).from(table).select('id', { count: 'exact', head: true }).eq('report_id', id);
        if (!count) missing.push(metas.find((s) => s.key === k)?.label ?? k);
      }
```

**Decision:** the gate counts `compliance_assessments` rows by `report_id` — the parent row, created the first time an editable viewer opens the OHS tab — and never looks at `compliance_responses` at all. A comment-only row (`response is null`) therefore cannot change what the gate does, and the condition in the brief ("if it counts compliance rows regardless of response") is not met. No change is made to `fortressReports.ts` or the editor. `useReportSectionCounts` (`SECTION_SOURCE.ohs_compliance` → `compliance_responses`) WILL now count a comment-only row as section content; that is correct — the comment is content the inspector typed, and the navigator badge should say so.

**Recorded, not planned (outside spec §6):** the gate is weak independently of S3 — an editable report passes it with zero answers because the assessment row exists. Tightening it to `compliance_responses where response is not null` via the assessment id is a one-line `SECTION_SOURCE`-style change plus a test; it is listed under open questions for the owner, not done here.

---

### Task 5: Report header — Asset / Operations / Centre manager inputs

**Files:**
- Modify: `src/components/reports/fortress/FortressReportEditor.tsx` (constants above the component; state at `:65-74`; sync effect at `:100`; new `saveManager` after `savePreparedFor` `:117-129`; header JSX `:302-321`)
- Create: `src/components/reports/fortress/FortressReportEditor.test.tsx`

- [x] **Step 1: Write the failing test** at `src/components/reports/fortress/FortressReportEditor.test.tsx`: (observed 6 failed / 0 passed — the read-only case is one `it` and fails at its first assertion before reaching the "Prepared for" line; every failure point matched the ones named below)

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Report } from '@/integrations/supabase/fortress-db';

const state = vi.hoisted(() => ({
  report: null as Record<string, unknown> | null,
  /** Every reports.update the header sent: payload + the .eq filters it chained. */
  updates: [] as { table: string; payload: Record<string, unknown>; filters: unknown[][] }[],
  updateError: null as { message: string } | null,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock('sonner', () => ({ toast }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useParams: () => ({ id: 'rep1' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isAdmin: false, isAdminOrManager: true }) }));
vi.mock('@/hooks/useOrganization', () => ({
  useOrganization: () => ({ organization: { id: 'o1', name: 'Acme', primary_color: '#2563eb', logo_url: null }, loading: false }),
}));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));
vi.mock('@/hooks/useOrgSettings', () => ({ useFeature: () => false }));
vi.mock('@/hooks/useReportSectionCounts', () => ({ useReportSectionCounts: () => ({ data: undefined }) }));
vi.mock('@/hooks/useFortressReports', () => ({
  useFortressReport: () => ({ data: state.report, isLoading: false }),
  useReportLifecycle: () => ({ mutate: vi.fn(), isPending: false }),
  useDiscardDraft: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/reportArtifacts', () => ({
  listReportArtifactsForSource: async () => ({ data: [], error: null }),
  saveReportArtifact: vi.fn(),
}));
// pdfmake is dragged in at import time by the PDF module; the header saves never reach it.
vi.mock('@/lib/fortressReportPdf', () => ({ generateReportPdf: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/components/reports/fortress/ReportSavedVersions', () => ({ ReportSavedVersions: () => null }));
vi.mock('@/components/reports/fortress/ShareReportDialog', () => ({ ShareReportDialog: () => null }));
vi.mock('@/components/reports/fortress/DiscardDraftDialog', () => ({ DiscardDraftDialog: () => null }));
vi.mock('./sections/registry', () => ({ getSectionComponent: () => undefined }));
// fdb is the same client re-typed, so mocking the client covers fdb.from('reports').update(...).eq(...).
vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => ({
    update: (payload: Record<string, unknown>) => {
      const filters: unknown[][] = [];
      const chain = {
        eq: (...args: unknown[]) => { filters.push(args); return chain; },
        then: (resolve: (r: { error: { message: string } | null }) => unknown) => {
          state.updates.push({ table, payload, filters });
          return Promise.resolve({ error: state.updateError }).then(resolve);
        },
      };
      return chain;
    },
  });
  return { supabase: { from } };
});

import FortressReportEditor from './FortressReportEditor';

const report = (over: Partial<Report> = {}): Report => ({
  id: 'rep1', building_id: 'b1', organization_id: 'o1', report_type: 'ops_monthly', report_period: '2026-09-01',
  title: 'Ops — Test', status: 'draft', author_id: 'u1', author_name: 'Thandi', prepared_for: null,
  asset_manager: null, ops_manager: null, centre_manager: null, cloned_from_report_id: null, inspection_date: null,
  meta: {}, review_notes: null, reviewed_by: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  ...over,
});

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><FortressReportEditor /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.report = report();
  state.updates = [];
  state.updateError = null;
  toast.error.mockClear();
});

describe('FortressReportEditor — manager names in the header', () => {
  it.each([
    ['Asset manager', 'asset_manager'],
    ['Operations manager', 'ops_manager'],
    ['Centre manager', 'centre_manager'],
  ])('saves "%s" on blur as reports.%s, trimmed', async (label, column) => {
    renderEditor();
    const input = screen.getByLabelText(label);
    fireEvent.change(input, { target: { value: '  Naledi Dlamini ' } });
    fireEvent.blur(input);
    await waitFor(() => expect(state.updates).toHaveLength(1));
    expect(state.updates[0]).toEqual({ table: 'reports', payload: { [column]: 'Naledi Dlamini' }, filters: [['id', 'rep1']] });
  });

  it('does not write when the value is unchanged, and writes null when cleared', async () => {
    state.report = report({ asset_manager: 'Thandi M.' });
    renderEditor();
    const input = screen.getByLabelText('Asset manager');
    expect(input).toHaveValue('Thandi M.');
    fireEvent.blur(input);
    expect(state.updates).toHaveLength(0);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    await waitFor(() => expect(state.updates).toHaveLength(1));
    expect(state.updates[0].payload).toEqual({ asset_manager: null });
  });

  it('names the field in the failure toast and restores the saved value', async () => {
    state.report = report({ ops_manager: 'Sipho' });
    state.updateError = { message: 'permission denied' };
    renderEditor();
    const input = screen.getByLabelText('Operations manager');
    fireEvent.change(input, { target: { value: 'Someone Else' } });
    fireEvent.blur(input);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not save “Operations manager”.'));
    await waitFor(() => expect(input).toHaveValue('Sipho'));
  });

  it('prints the names read-only on a locked report, only the ones that are set', () => {
    state.report = report({ status: 'approved', asset_manager: 'Thandi M.', ops_manager: null, centre_manager: 'Naledi', prepared_for: 'Capital Propfund' });
    renderEditor();
    expect(screen.queryByLabelText('Asset manager')).toBeNull();
    expect(screen.getByText('Asset manager: Thandi M.')).toBeInTheDocument();
    expect(screen.getByText('Centre manager: Naledi')).toBeInTheDocument();
    expect(screen.queryByText(/Operations manager/)).toBeNull();
    expect(screen.getByText('Prepared for Capital Propfund')).toBeInTheDocument();
  });
});
```

Run `npx vitest run src/components/reports/fortress/FortressReportEditor.test.tsx`. Expected: **5 failed, 1 passed** — the three `it.each` cases and the unchanged/cleared case fail with `TestingLibraryElementError: Unable to find a label with the text of: Asset manager` (resp. `Operations manager`, `Centre manager`); the toast case fails the same way; the read-only case fails at `getByText('Asset manager: Thandi M.')`. (If `Prepared for Capital Propfund` is the one that passes, the pre-existing read-only line is intact.)

- [x] **Step 2: Add the constants** in `src/components/reports/fortress/FortressReportEditor.tsx`, directly below the `SectionCountClient` interface (`:36-40`) and above `export default function FortressReportEditor()`:

```ts
/** Header fields that print on the PDF cover (the signature block already reads them). */
type ManagerField = 'asset_manager' | 'ops_manager' | 'centre_manager';
const MANAGER_FIELDS: { key: ManagerField; id: string; label: string }[] = [
  { key: 'asset_manager', id: 'asset-manager', label: 'Asset manager' },
  { key: 'ops_manager', id: 'ops-manager', label: 'Operations manager' },
  { key: 'centre_manager', id: 'centre-manager', label: 'Centre manager' },
];
const EMPTY_MANAGERS: Record<ManagerField, string> = { asset_manager: '', ops_manager: '', centre_manager: '' };
```

- [x] **Step 3: State + sync.** After `const [preparedFor, setPreparedFor] = useState('');` (`:66`) add:

```ts
  const [managers, setManagers] = useState<Record<ManagerField, string>>(EMPTY_MANAGERS);
```

and replace the sync effect at `:100` (`useEffect(() => { setPreparedFor(report?.prepared_for ?? ''); }, [report?.prepared_for]);`) with:

```ts
  useEffect(() => { setPreparedFor(report?.prepared_for ?? ''); }, [report?.prepared_for]);
  useEffect(() => {
    setManagers({
      asset_manager: report?.asset_manager ?? '',
      ops_manager: report?.ops_manager ?? '',
      centre_manager: report?.centre_manager ?? '',
    });
  }, [report?.asset_manager, report?.ops_manager, report?.centre_manager]);
```

- [x] **Step 4: Save on blur.** Directly after `savePreparedFor` (`:117-129`) add:

```ts
  /** Same contract as savePreparedFor: trim → null, no write when unchanged, named toast + restore on failure. */
  const saveManager = async (field: ManagerField) => {
    if (!id || !report) return;
    const label = MANAGER_FIELDS.find((f) => f.key === field)?.label ?? field;
    const next = managers[field].trim() || null;
    if (next === (report[field] ?? null)) return;
    const patch: Partial<Pick<Report, ManagerField>> = {};
    patch[field] = next;
    const { error } = await fdb.from('reports').update(patch).eq('id', id);
    if (error) {
      if (import.meta.env.DEV) console.error(`Update ${field} failed:`, error);
      toast.error(`Could not save “${label}”.`);
      setManagers((m) => ({ ...m, [field]: report[field] ?? '' }));
      return;
    }
    qc.invalidateQueries({ queryKey: ['fortress-reports'] });
  };
```

and extend the `fortress-db` import at `:27` to include the `Report` type:

```ts
import { fdb, REPORT_TYPE_LABELS, type Report, type ReportStatus, type ReportType } from '@/integrations/supabase/fortress-db';
```

- [x] **Step 5: Header JSX.** Replace `:302-321` (from `{editable ? (` through the closing `)}` of the read-only branch) with:

```tsx
          {editable ? (
            <div className="mt-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="prepared-for" className="text-xs text-muted-foreground">Prepared for</Label>
                  <Input
                    id="prepared-for"
                    className="h-8 w-56"
                    placeholder="e.g. Capital Propfund"
                    value={preparedFor}
                    onChange={(e) => setPreparedFor(e.target.value)}
                    onBlur={savePreparedFor}
                  />
                </div>
                {MANAGER_FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <Label htmlFor={f.id} className="text-xs text-muted-foreground">{f.label}</Label>
                    <Input
                      id={f.id}
                      className="h-8 w-44"
                      value={managers[f.key]}
                      onChange={(e) => setManagers((m) => ({ ...m, [f.key]: e.target.value }))}
                      onBlur={() => saveManager(f.key)}
                    />
                  </div>
                ))}
              </div>
              <Hint icon={false} className="mt-1">The manager names print on the PDF cover, with “Prepared for” under them.</Hint>
            </div>
          ) : (
            <>
              {MANAGER_FIELDS.filter((f) => report[f.key]).map((f) => (
                <p key={f.key} className="mt-1 text-sm text-muted-foreground">{f.label}: {report[f.key]}</p>
              ))}
              {report.prepared_for && (
                <p className="mt-1 text-sm text-muted-foreground">Prepared for {report.prepared_for}</p>
              )}
            </>
          )}
```

(Inputs stay `h-8` like "Prepared for": the editor header is the desktop authoring surface, not a field flow; the 44 px rule applies to the phone-first screens.)

- [x] **Step 6: Gate.**
```bash
npx vitest run src/components/reports/fortress/FortressReportEditor.test.tsx
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'FortressReportEditor'
```
Expected: 6 passed; the grep prints nothing.

- [x] **Step 7: Commit.**
```bash
git add src/components/reports/fortress/FortressReportEditor.tsx src/components/reports/fortress/FortressReportEditor.test.tsx
git commit -m "Report header: Asset, Operations and Centre manager inputs that save on blur

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Annual PDF prints "Inspected by … on …"

**Files:**
- Modify: `src/lib/fortressReportDoc.ts` (`ReportData` annual fields at `:117-127`; a helper + export near `MARK` at `:154`; the annual heading block at `:503-510`)
- Modify: `src/lib/fortressReportPdf.ts` (a helper below `embedPhoto`; the annual branch `:552-553` select and the `break` block `:620-626`)
- Modify: `src/lib/fortressReportDoc.test.ts` (new `describe` appended)
- Wait for: the controller's go-ahead that S2's commits to `fortressReportPdf.ts` / `fortressReportDoc.ts` are on the branch (see the shared-file caveat in the header). Re-read both files at their current HEAD before editing; the line numbers above are from `4df8a6b` and shift after S2.

- [x] **Step 1: Write the failing test.** Append to `src/lib/fortressReportDoc.test.ts` (after the last `describe`), adding `inspectionProvenance` to the import at line 2 (`import { buildReportDoc, inspectionProvenance, type ReportData } from './fortressReportDoc';`):

```ts
describe('buildReportDoc — inspection provenance (S3)', () => {
  const base: ReportData = {
    annualSections: [{ title: 'Roof', items: [{ label: 'Gutters', rating: 'good', applicable: true, photos: [] }] }],
    annualFlagged: 0,
  };
  const build = (extra: Partial<ReportData>) =>
    collect(buildReportDoc({ title: 'Annual — Test', report_period: '2026-09-01', report_type: 'annual_inspection' }, { ...base, ...extra }, { color: '#123456', orgName: 'Acme' }));

  it('prints who inspected and when, directly under the Condition Inspection heading', () => {
    const { text } = build({ annualInspectedBy: 'Thandi Mokoena', annualInspectionDate: '2026-09-12' });
    expect(text).toContain('Inspected by Thandi Mokoena on 12 September 2026');
    expect(text.indexOf('Condition Inspection')).toBeLessThan(text.indexOf('Inspected by Thandi Mokoena'));
    expect(text.indexOf('Inspected by Thandi Mokoena')).toBeLessThan(text.indexOf('Roof'));
  });

  it('prints the date alone when the inspector is not on record, and nothing when neither is', () => {
    expect(build({ annualInspectionDate: '2026-09-12' }).text).toContain('Inspected on 12 September 2026');
    expect(build({}).text).not.toMatch(/Inspected (by|on)/);
  });

  it('inspectionProvenance covers every combination', () => {
    expect(inspectionProvenance('Thandi', '2026-09-12')).toBe('Inspected by Thandi on 12 September 2026');
    expect(inspectionProvenance('Thandi', null)).toBe('Inspected by Thandi');
    expect(inspectionProvenance('  ', '2026-09-12')).toBe('Inspected on 12 September 2026');
    expect(inspectionProvenance('Thandi', 'not-a-date')).toBe('Inspected by Thandi on not-a-date');
    expect(inspectionProvenance(null, undefined)).toBeNull();
  });
});
```

Run `npx vitest run src/lib/fortressReportDoc.test.ts`. Expected: **3 failed** in the new block, every pre-existing test still passing — the first with `AssertionError: expected '…' to contain 'Inspected by Thandi Mokoena on 12 September 2026'` (the fields are ignored by the builder), the second with the same shape for `'Inspected on 12 September 2026'`, the third with `TypeError: inspectionProvenance is not a function` (vite-node resolves a missing named export to `undefined`, not a link error).

- [x] **Step 2: Doc builder.** In `src/lib/fortressReportDoc.ts`, add to `ReportData` directly after `annualPhotosOmitted?: number;` (`:127`):

```ts
  /** Who carried out the condition inspection (building_inspections.inspected_by, resolved to a name). */
  annualInspectedBy?: string | null;
  /** building_inspections.inspection_date as YYYY-MM-DD. */
  annualInspectionDate?: string | null;
```

Below `export const MARK …` (`:154`) add:

```ts
/** "12 September 2026" from a YYYY-MM-DD date; the raw string when it does not parse. */
function formatDayLabel(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Provenance line for the condition inspection: "Inspected by <name> on <date>", or whichever
 * half is on record, or null when neither is. Exported so the wording is pinned by a test.
 */
export function inspectionProvenance(by: string | null | undefined, date: string | null | undefined): string | null {
  const name = by?.trim() || null;
  const day = date ? formatDayLabel(date) : null;
  if (name && day) return `Inspected by ${name} on ${day}`;
  if (name) return `Inspected by ${name}`;
  if (day) return `Inspected on ${day}`;
  return null;
}
```

In the annual branch, directly after the summary line push (`content.push({ text: summary.join('  ·  '), fontSize: 10, color: '#6b7280', margin: [0, 0, 0, 8] });` at `:510`) add:

```ts
    // Provenance is report content: a condition report with no inspector or date on it cannot
    // be relied on later. Printed only when the row carries it (rows older than the S3 backfill
    // that had no report author still print without a name).
    const provenance = inspectionProvenance(data.annualInspectedBy, data.annualInspectionDate);
    if (provenance) content.push({ text: provenance, fontSize: 9, color: '#6b7280', margin: [0, 0, 0, 8] });
```

- [x] **Step 3: Loader.** In `src/lib/fortressReportPdf.ts`, add below `embedPhoto` (after its closing brace, before `downscaleToDataUrl`):

```ts
/**
 * Display name for the inspector. `profiles` is readable only by the person themselves and by
 * admins/managers (p_select), so a field user exporting a colleague's inspection would read
 * nothing from the table; the `building_members` RPC (security definer, scoped by
 * can_access_building) is the path the evidence pack already uses for names. Non-fatal — the
 * name is provenance, not the inspection itself: on any failure, or an inspector no longer a
 * member of the building, fall back to the denormalised report author name when the ids match,
 * else null (the doc then prints the date alone).
 */
async function inspectorName(buildingId: string, userId: string, fallback: string | null): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('building_members', { b: buildingId });
    if (error) throw error;
    const row = ((data ?? []) as { id: string; full_name: string | null }[]).find((m) => m.id === userId);
    const name = row?.full_name?.trim();
    if (name) return name;
  } catch (e) {
    if (import.meta.env.DEV) console.warn('Inspector name lookup failed:', e);
  }
  return fallback?.trim() || null;
}
```

In the annual branch change the select (`:552-553`) from `select('id,template_id')` to:

```ts
    const inspRows = unwrap(await fdb.from('building_inspections').select('id,template_id,inspected_by,inspection_date')
      .eq('report_id', reportId).order('created_at', { ascending: false }), 'the building inspection') ?? [];
```

and replace the tail of the loop body (`:620-626`, from `data.annualSections = …` through `break;`) with:

```ts
      data.annualSections = [...sectionMap.entries()].map(([title, its]) => ({ title, items: its }));
      data.annualFlagged = flagged;
      data.annualCapexTotal = capexTotal || null;
      data.annualPhotosTotal = totalPhotoRefs;
      if (totalPhotoRefs > embedded) data.annualPhotosOmitted = totalPhotoRefs - embedded;
      // Provenance off the winning row (S3): defaults stamp both columns at insert; the backfill
      // attributed older rows to the report author, so author_name is the right fallback when the ids match.
      data.annualInspectionDate = insp.inspection_date ?? null;
      data.annualInspectedBy = insp.inspected_by
        ? await inspectorName(report.building_id, insp.inspected_by, insp.inspected_by === report.author_id ? report.author_name : null)
        : null;
      break;
```

- [x] **Step 4: Gate.**
```bash
npx vitest run src/lib/fortressReportDoc.test.ts src/lib/fortressReportPdf.test.ts
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E 'fortressReportDoc|fortressReportPdf'
```
Expected: every test in both files passes (the PDF test's `supabase` mock has no `rpc`, which `inspectorName` swallows — no annual export is exercised there anyway); the grep prints nothing.

- [x] **Step 5: Commit.**
```bash
git add src/lib/fortressReportDoc.ts src/lib/fortressReportDoc.test.ts src/lib/fortressReportPdf.ts
git commit -m "Annual PDF: print who inspected and when under the Condition Inspection heading

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7 (controller): apply, verify, smoke, regenerate, record

**Files:** `docs/plans/APPLY_CHECKLIST.md` (new `## S3 "Report data integrity" (2026-09-12)` section), `src/integrations/supabase/types.ts` and `src/integrations/supabase/fortress-types.ts` (regenerated — expected no diff for the three columns, see Step 4), this plan (Status section), memory `fortress-field-readiness-review.md`.

- [ ] **Step 1: Whole-slice gate on the clean tree.** `npm run test` green (1404 + the new files: `useComplianceSection.test.ts` 2, `ComplianceSection.test.tsx` 4, `FortressReportEditor.test.tsx` 6, `fortressReportDoc.test.ts` +3); `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c 'error TS'` ≤ 46; `npm run build`.

- [ ] **Step 2: Staging apply.** With the scratch Management-API runner (`supa.mjs`, ref `vkrihpmjajjcxmzgjqdr`): apply `../GMI/sql/2026-09-15_03_inspection_provenance.sql` (expect 201), apply it a second time (idempotent: the three updates report 0 rows), reload PostgREST (`notify pgrst, 'reload schema'`), then run every `-- Verify:` query from the file's tail and paste the results into the apply record. Then `node scripts/rls-smoke.mjs` (expect the R4c count, 737/0, unchanged — S3 adds no policies) and `node scripts/fortress-smoke.mjs` (green; the manager's assessment now carries `assessed_by = manager uid` — confirm with `select assessed_by is not null from public.compliance_assessments order by created_at desc limit 1` before the smoke's teardown, or by re-running the query the smoke logs). Any failure returns to the owning task (phase 1 of the investigation protocol; never patch the patch).

- [ ] **Step 3: Prod apply.** Same file, ref `qdzgkttiosahdfqresvz`; same verify queries (record the `rows_with_author` counts — the survey said reports 5 / assessments 2 / inspections 4 at `2026-08-04_09`, they have grown since); `node scripts/rls-smoke.mjs` on prod (737/0). No edge function changes in this slice.

- [ ] **Step 4: Regenerate types.** `npx supabase gen types typescript --project-id qdzgkttiosahdfqresvz --schema public > src/integrations/supabase/types.ts` and the `fortress-types.ts` pipeline from its header (`--project-id vkrihpmjajjcxmzgjqdr | sed … FortressDatabase`). Column defaults do not change the generated TS (`inspected_by?`, `inspection_date?`, `assessed_by?` are already optional on `Insert`), so `git diff --stat src/integrations/supabase/` is expected to be empty for these tables; commit only if the diff is non-empty and consists of drift you can name, otherwise leave the files untouched and say so in the apply record.

- [ ] **Step 5: Whole-slice review** (superpowers:requesting-code-review with the slice range `<first S3 commit>..HEAD`): reviewers read via `git show <sha>:<path>`; the checklist is spec §6 line by line, the Contracts table, the Hint rule ("Answer needed" is a plain `<p>`), the shared-file caveat (no S2 region touched), and the ground rules. Fix findings in-slice with explicit-pathspec commits.

- [ ] **Step 6: `docs/plans/APPLY_CHECKLIST.md`** — append:

```markdown
## S3 "Report data integrity" (2026-09-12)

Spec `docs/superpowers/specs/2026-09-12-field-readiness-design.md` §6; plan `docs/superpowers/plans/2026-09-12-s3-report-integrity.md`.

### Migration

- `2026-09-15_03_inspection_provenance.sql` (GMI `<sha>`) — additive, idempotent, one transaction. Column
  defaults `building_inspections.inspected_by = auth.uid()`, `building_inspections.inspection_date = today
  (SAST)`, `compliance_assessments.assessed_by = auth.uid()`; backfill of every null from `reports.author_id`
  and the report's SAST creation day (authorless seeded reports keep a null person, get the date). No new
  tables, functions, policies or grants; both FKs were already `on delete set null` (2026-08-04_09).

### Staging — DONE <date>

- [x] Applied twice (second apply: three `UPDATE 0`), PostgREST reloaded; defaults read back as `auth.uid()` /
      `(timezone('Africa/Johannesburg'::text, now()))::date`; `no_inspector 0 / no_date 0 / rows_with_author <n>`,
      `no_date_any 0`, `no_assessor 0 / rows_with_author <n>`.
- [x] `rls-smoke` 737/0; `fortress-smoke` green, the smoke's assessment carried `assessed_by`.

### Production — DONE <date>

- [x] Applied, PostgREST reloaded; same verify results (`rows_with_author` inspections <n>, assessments <n>).
- [x] `rls-smoke` 737/0. Types regenerated: no diff for the three columns (already optional on Insert).

### Owner items

- **Manager names are per report.** The three header inputs write `reports.asset_manager / ops_manager /
  centre_manager` for that report only; carry-forward copies them to next month's draft like the other header
  fields. Enter them once per building's first report of the cycle.
- **Provenance is who opened the tab.** `inspected_by` / `assessed_by` record the signed-in user who first
  opened the inspection or OHS tab of an editable report — normally the author. Backfilled rows say the report
  author and the report's creation day, which is the best record on file, not a witnessed date.
- **A comment is not an answer.** An OHS item with a comment and no Yes/No/N/A shows "Answer needed" in the
  editor and counts as unanswered in the score and the answered tally; the submit gate does not block on it
  (it never looked at answers — see the plan's Task 4 and the open question below).
- **Open question:** tighten the OHS submit gate to require at least one answered item (today the assessment
  row alone satisfies it). One-line change plus a test; not part of S3.
```

- [ ] **Step 7: Status section** at the end of this plan (the R4a "Status — shipped" block is the format): what shipped (migration + client, one paragraph each), decisions taken (gate unchanged with the evidence; "Answer needed" keyed off the live comment and shown read-only too; comment drafts controlled per item; `building_members` for the inspector name with `author_name` fallback and a date-only line; header inputs h-8 like "Prepared for"; backfill leaves authorless seeded rows without a person), numbers (rls-smoke, fortress-smoke, vitest count, tsc count), follow-ups (the gate; `useReportSectionCounts` counting comment-only rows as content — by design).

- [ ] **Step 8: Memory.** In `fortress-field-readiness-review.md` mark S3 closed at `<sha>` with the decisions above and the open question on the gate.

---

## Self-review (run by the plan author before commit)

- **Spec coverage.** §6 bullet 1 "OHS comment": `setResponse(itemId, response: YesNoNa | null, comment?)` → Task 2; blur saves without an answer, toggle sends the current comment, "Answer needed" guardrail → Task 3. §6 bullet 2 "Provenance": defaults + backfill from `reports.author_id` / `reports.created_at` → Task 1 (`author_id` confirmed as the column name in `fortress-types.ts` and `2026-06-13_01:31`; the SAST cast on both the default and the backfill); "Inspected by … on …" in the annual PDF header when present → Task 6. §6 bullet 3 "Manager names": three header inputs with the `prepared_for` save-on-blur and toast pattern writing the three columns → Task 5; "the PDF signature block already reads them" verified at `fortressReportPdf.ts:148` / `fortressReportDoc.ts:187-189`, so no PDF change for names. §6 tests: `useComplianceSection.test.ts` (null response with comment) Task 2; `ComplianceSection` render test Task 3; editor header inputs Task 5; SQL default check on the throwaway Postgres Task 1 Step 2. §6 "Deferred" paragraph: not planned, as instructed. §2 constraints: migration additive in `../GMI/sql/`, vendored, Management API only (Task 1 / Task 7); no new RLS objects needed and none added; guardrail copy plain, coaching through `<Hint>` (Task 3 line, Task 5 hint); reviewers via `git show`; vendoring serialised (Task 1 note). §9 deploy: staging → prod, `rls-smoke` + `fortress-smoke`, types regenerated, `APPLY_CHECKLIST.md` section → Task 7. Brief's Task 4: the condition ("counts compliance rows regardless of response") was checked against `fortressReports.ts:55-70` and the editor gate at `:254-259` — the gate counts `compliance_assessments`, so no change; recorded with the evidence and an owner-facing open question rather than silently dropped.
- **Ambiguities resolved.** (1) Comment state: a controlled per-item `drafts` map, not input refs — keeps auto-save-on-blur, lets the toggle read the live text, and is the smaller diff. (2) "Answer needed" keys off the live comment (draft or saved) so it appears as the inspector types, and renders in read-only mode too: a reviewer must see that an item was commented on but never answered. (3) Inspector name: `profiles` RLS (`p_select`) hides other users from a `user`-role exporter, so the loader uses the `building_members` RPC (the evidence pack's path) with `reports.author_name` as fallback when `inspected_by === author_id`, and prints the date alone when no name resolves — never fails the export. (4) Backfill scope: `inspected_by`/`assessed_by` only where the report has an author; `inspection_date` for every row with a report. (5) Header inputs keep `h-8` to mirror "Prepared for" (desktop authoring surface). (6) Shared files with S2 (`fortressReportPdf.ts`, `fortressReportDoc.ts`, `fortressReportDoc.test.ts`): non-overlapping regions, Task 6 gated on S2's commits being present.
- **Placeholder scan.** Every code step carries the code; every test step names its assertions and its expected red output; the only conditionals are greps/`git status` checks (vendoring drift, types diff), not guesses.
- **Type consistency.** `setResponse(templateItemId, response: YesNoNa | null, comment?)` in Contracts = Task 2 hook = Task 3 calls (`current ?? null`, `v as YesNoNa`) = Task 3 test expectations. `MANAGER_FIELDS` keys = `reports` columns in `fortress-types.ts` = the `it.each` table in Task 5's test = the `Report` fixture. `ReportData.annualInspectedBy / annualInspectionDate` in Contracts = Task 6 doc = Task 6 loader assignments = the doc test. `inspectionProvenance` wording in Contracts = the helper = the test strings. `building_members` args `{ b }` and return `{ id, full_name }` match `types.ts:4696-4703`.
