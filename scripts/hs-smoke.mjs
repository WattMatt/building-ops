#!/usr/bin/env node
/**
 * H&S compliance smoke — the load-bearing DB behaviour behind insurance H&S
 * checklists: building-type scoping + category denormalisation, against the
 * live backend with disposable fixtures.
 *
 *   classify buildings (office / retail)  →  a retail-only template item  →
 *   generates a task for the RETAIL building, SKIPPED for the office building
 *   (trigger returns NULL)  →  a base (applies-to-all) item generates for both
 *   →  category is denormalised onto every generated task  →  the compliance
 *   report's source query returns the categorised tasks.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   node scripts/hs-smoke.mjs
 *
 * (PDF assembly is pure and unit-tested in src/lib/hsComplianceReport.test.ts;
 * this proves the trigger that feeds it.)
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !SERVICE) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const SVC = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

let pass = 0, failures = 0;
const fails = [];
const ok = (n) => { pass++; console.log(`  PASS  ${n}`); };
const fail = (n, d) => { failures++; fails.push(`${n} — ${d}`); console.error(`  FAIL  ${n} — ${d}`); };
const assert = (n, cond, d) => (cond ? ok(n) : fail(n, d));

async function svcInsert(table, row) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}`, {
    method: 'POST', headers: { ...SVC, Prefer: 'return=representation' }, body: JSON.stringify(row),
  });
  const body = res.ok ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`fixture ${table}: HTTP ${res.status} ${body}`);
  return body[0];
}
async function svcDelete(table, filter) {
  await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: SVC });
}
// insert a task_instance and return the row the trigger let through (or null if skipped)
async function genTask(buildingId, templateItemId, name) {
  const res = await fetch(`${URL_BASE}/rest/v1/task_instances`, {
    method: 'POST', headers: { ...SVC, Prefer: 'return=representation' },
    body: JSON.stringify({
      building_id: buildingId, template_item_id: templateItemId,
      task_name: name, due_date: '2030-01-01', status: 'pending', frequency: 'annually',
    }),
  });
  if (!res.ok) throw new Error(`genTask: HTTP ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows[0] ?? null; // trigger returns NULL → no row
}

const cleanup = [];
let office = null, retail = null, tmplRetail = null, tmplBase = null;

try {
  console.log(`hs-smoke vs ${URL_BASE} (run ${RUN})`);

  office = (await svcInsert('buildings', { name: `ZZTEST-HS-office-${RUN}`, building_type: 'office' })).id;
  retail = (await svcInsert('buildings', { name: `ZZTEST-HS-retail-${RUN}`, building_type: 'retail' })).id;
  cleanup.push(['buildings', `id=eq.${office}`], ['buildings', `id=eq.${retail}`]);

  // retail-only template + categorised item
  tmplRetail = (await svcInsert('checklist_templates', { name: `ZZTEST-HS-retail-${RUN}`, frequency: 'annually', is_active: true, applies_to_building_types: ['retail', 'mixed_use'] })).id;
  cleanup.push(['checklist_templates', `id=eq.${tmplRetail}`]);
  const itemRetail = (await svcInsert('template_items', { template_id: tmplRetail, task_name: `ZZTEST-HS retail item ${RUN}`, category: 'fire_safety' })).id;
  cleanup.push(['template_items', `id=eq.${itemRetail}`]);

  // base template (applies to all) + categorised item
  tmplBase = (await svcInsert('checklist_templates', { name: `ZZTEST-HS-base-${RUN}`, frequency: 'annually', is_active: true })).id; // applies_to null
  cleanup.push(['checklist_templates', `id=eq.${tmplBase}`]);
  const itemBase = (await svcInsert('template_items', { template_id: tmplBase, task_name: `ZZTEST-HS base item ${RUN}`, category: 'statutory_certificates' })).id;
  cleanup.push(['template_items', `id=eq.${itemBase}`]);
  console.log('  setup: office + retail buildings, retail-only + base templates');

  // ── scoping: retail-only item ──
  const onRetail = await genTask(retail, itemRetail, `ZZTEST-HS retail→retail ${RUN}`);
  if (onRetail) cleanup.unshift(['task_instances', `id=eq.${onRetail.id}`]);
  assert('retail-only template GENERATES a task for the retail building', !!onRetail, 'task was skipped');
  assert('category denormalised onto the generated task (fire_safety)', onRetail?.category === 'fire_safety', `category=${onRetail?.category}`);

  const onOffice = await genTask(office, itemRetail, `ZZTEST-HS retail→office ${RUN}`);
  if (onOffice) cleanup.unshift(['task_instances', `id=eq.${onOffice.id}`]);
  assert('retail-only template is SKIPPED for the office building (trigger returns NULL)', onOffice === null, 'task was NOT skipped — scoping breached');

  // ── base template applies to both ──
  const baseOffice = await genTask(office, itemBase, `ZZTEST-HS base→office ${RUN}`);
  if (baseOffice) cleanup.unshift(['task_instances', `id=eq.${baseOffice.id}`]);
  assert('base (applies-to-all) template generates for the office building', !!baseOffice, 'base task skipped on office');
  assert('base task category denormalised (statutory_certificates)', baseOffice?.category === 'statutory_certificates', `category=${baseOffice?.category}`);

  const baseRetail = await genTask(retail, itemBase, `ZZTEST-HS base→retail ${RUN}`);
  if (baseRetail) cleanup.unshift(['task_instances', `id=eq.${baseRetail.id}`]);
  assert('base template generates for the retail building too', !!baseRetail, 'base task skipped on retail');

  // ── unclassified building: add-on dormant, base still applies (the prod state) ──
  const uncl = (await svcInsert('buildings', { name: `ZZTEST-HS-unclassified-${RUN}` })).id; // building_type null
  cleanup.push(['buildings', `id=eq.${uncl}`]);
  const onUncl = await genTask(uncl, itemRetail, `ZZTEST-HS retail→uncl ${RUN}`);
  if (onUncl) cleanup.unshift(['task_instances', `id=eq.${onUncl.id}`]);
  assert('retail add-on SKIPPED for an unclassified building (matches prod: classify to activate)', onUncl === null, 'add-on fired on unclassified building');

  // ── compliance report source query returns categorised tasks ──
  const q = `building_id=eq.${retail}&category=not.is.null&select=category,status`;
  const tasks = await (await fetch(`${URL_BASE}/rest/v1/task_instances?${q}`, { headers: SVC })).json();
  const cats = new Set(tasks.map((t) => t.category));
  assert('compliance source query returns categorised tasks for the building', cats.has('fire_safety') && cats.has('statutory_certificates'), `categories=${[...cats]}`);
} catch (e) {
  fail('smoke run', e.message);
} finally {
  for (const [table, filter] of cleanup) await svcDelete(table, filter);
  const left = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-HS-*&select=id`, { headers: SVC })).json();
  console.log((left.length ?? 0) === 0 ? '  teardown: clean' : `  WARN  ${left.length} ZZTEST-HS buildings left`);
}

console.log(`\n${pass} passed, ${failures} failed`);
console.log(failures === 0 ? 'H&S SCOPING HOLDS' : 'H&S SCOPING BROKEN');
process.exit(failures === 0 ? 0 : 1);
