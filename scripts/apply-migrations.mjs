#!/usr/bin/env node
/**
 * Apply vendored migrations to a Supabase project through the Management API, then run
 * verification queries. Replaces the per-session scratch `supa.mjs` the R0–R4 apply loop used.
 *
 *   SUPABASE_ACCESS_TOKEN=... node scripts/apply-migrations.mjs <project-ref> [--dry-run] [--verify-only] <file.sql>...
 *
 * - Files are sent whole, in the order given, as one query each (the files carry their own
 *   BEGIN/COMMIT where they need it). A non-2xx response stops the run; nothing after it is sent.
 * - `--verify-only` skips the apply and runs the verification block for the named files.
 * - `--dry-run` prints what would be sent and exits 0.
 * - Never `db push`: the canonical SQL lives in ../GMI/sql and is mirrored into supabase/schema
 *   by `npm run schema:vendor`; this script only ever reads the mirror.
 * - Refuses to run against production unless `APPLY_ALLOW_PROD=1` is set, so a mistyped ref
 *   cannot land on prod by accident.
 *
 * Verification queries live in VERIFY below, keyed by migration basename; add a block when you
 * add a migration. Each entry is { sql, expect } where `expect` is a short human description —
 * the script prints the rows and the expectation side by side and never guesses pass/fail.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const PROD_REF = 'qdzgkttiosahdfqresvz';
const API = 'https://api.supabase.com/v1/projects';

const VERIFY = {
  '2026-09-15_01_team_coverage.sql': [
    { sql: `select policyname, cmd from pg_policies where tablename = 'user_buildings' order by 1`, expect: 'ub_select SELECT, ub_write_managed ALL' },
    { sql: `select proname, prosecdef from pg_proc where pronamespace = 'public'::regnamespace and proname in ('assignable_people','portfolio_coverage') order by 1`, expect: 'assignable_people t, portfolio_coverage f' },
    { sql: `select has_function_privilege('anon','public.assignable_people()','execute') as anon_ap, has_function_privilege('anon','public.portfolio_coverage()','execute') as anon_pc`, expect: 'false, false' },
    { sql: `select (select count(*) from public.portfolio_coverage()) as coverage_rows, (select count(*) from public.buildings) as buildings`, expect: 'equal' },
    { sql: `select building_name from public.portfolio_coverage() where field_members = 0 order by 1`, expect: 'the "No team" list (most buildings on day one)' },
  ],
  '2026-09-15_02_inspection_photo_append.sql': [
    { sql: `select proname, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname = 'append_inspection_photo'`, expect: '1 row; prosecdef false; proconfig {search_path=}' },
    { sql: `select has_function_privilege('anon','public.append_inspection_photo(uuid,uuid,text,text,text)','execute') as anon_can, has_function_privilege('authenticated','public.append_inspection_photo(uuid,uuid,text,text,text)','execute') as auth_can`, expect: 'false, true' },
    { sql: `select conname, convalidated from pg_constraint where conrelid = 'public.inspection_responses'::regclass and conname = 'ir_photo_urls_array'`, expect: '1 row, convalidated false' },
    { sql: `select count(*) from public.inspection_responses where jsonb_typeof(photo_urls) <> 'array'`, expect: '0 (legacy rows the NOT VALID skipped)' },
  ],
  '2026-09-15_03_inspection_provenance.sql': [
    { sql: `select column_name, column_default from information_schema.columns where table_schema = 'public' and table_name = 'building_inspections' and column_name in ('inspected_by','inspection_date') order by 1`, expect: 'inspected_by auth.uid(); inspection_date SAST date' },
    { sql: `select column_default from information_schema.columns where table_schema = 'public' and table_name = 'compliance_assessments' and column_name = 'assessed_by'`, expect: 'auth.uid()' },
    { sql: `select count(*) filter (where bi.inspected_by is null) as no_inspector, count(*) filter (where bi.inspection_date is null) as no_date, count(*) as rows_with_author from public.building_inspections bi join public.reports r on r.id = bi.report_id where r.author_id is not null`, expect: '0 | 0 | n' },
    { sql: `select relname, reloptions from pg_class where relname in ('compliance_scores','compliance_section_scores','compliance_critical_scores') order by 1`, expect: 'all three {security_invoker=on}' },
    { sql: `select viewname, pg_get_viewdef(('public.'||viewname)::regclass) ~* 'response is not null' as null_filtered from pg_views where viewname in ('compliance_scores','compliance_section_scores','compliance_critical_scores') order by 1`, expect: 'true ×3' },
  ],
  '2026-09-15_04_overdue_notify.sql': [
    { sql: `select pg_get_constraintdef(oid) ~ 'task_overdue' as has_kind from pg_constraint where conname = 'notifications_kind_check'`, expect: 'true' },
    { sql: `select prosecdef, prolang::regtype::text as lang from pg_proc where pronamespace = 'public'::regnamespace and proname = 'mark_overdue_tasks'`, expect: 'prosecdef true' },
    { sql: `select has_function_privilege('anon','public.mark_overdue_tasks()','execute') as anon_can, has_function_privilege('authenticated','public.mark_overdue_tasks()','execute') as auth_can, has_function_privilege('service_role','public.mark_overdue_tasks()','execute') as svc_can`, expect: 'false, false, true' },
    { sql: `select jobname, schedule, command from cron.job where jobname = 'task-overdue-sweep'`, expect: '5 22 * * *, select public.mark_overdue_tasks()' },
  ],
};

/** Read before S4 on prod: how many assignees the first sweep would write to. */
const PRE_APPLY = {
  '2026-09-15_04_overdue_notify.sql': [
    { sql: `select count(*) as would_notify from public.task_instances where status = 'pending' and assigned_to is not null and due_date < (now() at time zone 'Africa/Johannesburg')::date`, expect: '0 or today\'s few; STOP if large' },
  ],
};

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: SUPABASE_ACCESS_TOKEN=... node scripts/apply-migrations.mjs <project-ref> [--dry-run] [--verify-only] <file.sql>...');
  process.exit(2);
}

const args = process.argv.slice(2);
const ref = args.shift();
if (!ref || !/^[a-z]{20}$/.test(ref)) usage('first argument must be a 20-letter project ref');
const dryRun = args.includes('--dry-run');
const verifyOnly = args.includes('--verify-only');
const files = args.filter((a) => !a.startsWith('--'));
if (files.length === 0) usage('no migration files given');
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token && !dryRun) usage('SUPABASE_ACCESS_TOKEN is not set');
if (ref === PROD_REF && process.env.APPLY_ALLOW_PROD !== '1' && !dryRun) {
  usage(`refusing to touch production (${PROD_REF}) without APPLY_ALLOW_PROD=1`);
}

async function query(sql) {
  const res = await fetch(`${API}/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body };
}

function show(rows) {
  if (Array.isArray(rows)) {
    if (rows.length === 0) return '(0 rows)';
    return rows.map((r) => '  ' + Object.entries(r).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' | ')).join('\n');
  }
  return '  ' + JSON.stringify(rows);
}

async function runBlock(label, checks) {
  for (const c of checks) {
    if (dryRun) { console.log(`[dry-run] ${label}: ${c.sql}`); continue; }
    const r = await query(c.sql);
    console.log(`\n${label} — expect: ${c.expect}\n  ${c.sql.replace(/\s+/g, ' ').slice(0, 140)}${c.sql.length > 140 ? '…' : ''}`);
    console.log(r.ok ? show(r.body) : `  !! HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  }
}

console.log(`project ${ref}${ref === PROD_REF ? ' (PRODUCTION)' : ''}${dryRun ? ' [dry-run]' : ''}${verifyOnly ? ' [verify-only]' : ''}`);
for (const file of files) {
  const name = basename(file);
  const sql = await readFile(file, 'utf8');
  if (!verifyOnly) {
    if (PRE_APPLY[name]) await runBlock(`pre-apply ${name}`, PRE_APPLY[name]);
    if (dryRun) {
      console.log(`[dry-run] would apply ${name} (${sql.length} bytes, ${sql.split('\n').length} lines)`);
    } else {
      const r = await query(sql);
      if (!r.ok) {
        console.error(`\n!! ${name}: HTTP ${r.status}\n${JSON.stringify(r.body, null, 2).slice(0, 2000)}`);
        console.error('stopping; nothing after this file was sent.');
        process.exit(1);
      }
      console.log(`applied ${name}: HTTP ${r.status}`);
    }
  }
  if (VERIFY[name]) await runBlock(`verify ${name}`, VERIFY[name]);
  else console.log(`(no verification block for ${name})`);
}
console.log('\ndone.');
