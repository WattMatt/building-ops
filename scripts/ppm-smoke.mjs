#!/usr/bin/env node
/**
 * PPM journey smoke (R3c, spec §5.6 / §5.7) — the plan → execution → derived grid → rating →
 * cost rollup chain, end to end against the live backend with disposable fixtures it cleans up:
 *
 *   building + admin + assigned site user  →  one building_ppm_services line (monthly on the 1st)
 *   + a 'contractor' building_role_assignments rule → the site user + a second, inactive line
 *   →  generate_ppm_tasks(p_building, 120) as admin  →  one task_instance per first-of-month in
 *   the horizon (source_ppm_id set, responsible_role 'contractor', assigned_to the site user,
 *   no task_description), none for the inactive line  →  complete the first via complete_task
 *   →  ppm_monthly_status (as the admin JWT) reads 'done' for that month and 'due' / 'missed'
 *   for the rest  →  re-run generation is a no-op  →  a pending occurrence due yesterday reads
 *   'missed'  →  flipping the line's recurrence (as admin) drops its future untouched
 *   occurrences and regenerates over 365 days, keeping the completed and the missed rows;
 *   deactivating drops the future rows, reactivating brings them back; reschedule_ppm_line is
 *   refused for the site user  →  a contractor + an issue with contractor_id + a
 *   contractor_ratings row  →  contractors.rating equals the rating  →  building_month_costs
 *   sums the issue's actual_cost and a service-history cost for the month.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   node scripts/ppm-smoke.mjs
 *
 * Expected occurrence dates are computed from today's SAST date (the server generates in
 * Africa/Johannesburg), never hard-coded.
 *
 * Every step is scoped to the fixture building — generate_ppm_tasks is called with p_building,
 * and the views are filtered by building — so nothing here fans out across the project and
 * the whole journey runs on prod too (it sits in `npm run smoke`). The prod guard is the same
 * as checklist-smoke's (SUPABASE_URL containing the prod ref qdzgkttiosahdfqresvz, overridden
 * by SMOKE_ALLOW_PROD=1): today it only prints a note, and any future project-wide step
 * (a cron-style `generate_ppm_tasks(null, …)`, say) must SKIP behind it.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}

// Same guard as scripts/checklist-smoke.mjs; no step is gated by it yet (see the header).
const PROD_REF = 'qdzgkttiosahdfqresvz';
const PROJECT_WIDE_ALLOWED = !URL_BASE.includes(PROD_REF) || process.env.SMOKE_ALLOW_PROD === '1';
if (!PROJECT_WIDE_ALLOWED) console.log(`  NOTE  SUPABASE_URL contains the prod ref ${PROD_REF}; every step here is scoped to the fixture building, so nothing is skipped.`);

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Ppm-Smoke-${RUN}!`;
const SVC = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const authed = (jwt) => ({ apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' });

let pass = 0, failures = 0;
const fails = [];
const ok = (n) => { pass++; console.log(`  PASS  ${n}`); };
const fail = (n, d) => { failures++; fails.push(`${n} — ${d}`); console.error(`  FAIL  ${n} — ${d}`); };
const assert = (n, cond, d) => (cond ? ok(n) : fail(n, d));

async function svcInsert(table, row) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}`, {
    method: 'POST', headers: { ...SVC, Prefer: 'return=representation' }, body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`fixture ${table}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}
/** Service-role delete by filter. Throws on a non-2xx so a teardown that silently leaves rows behind cannot pass. */
async function svcDelete(table, filter) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: SVC });
  if (!res.ok) throw new Error(`fixture delete ${table}?${filter}: HTTP ${res.status} ${await res.text()}`);
}
async function svcSelect(table, filter) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { headers: SVC });
  if (!res.ok) throw new Error(`fixture select ${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
/** Persona-scoped select: RLS applies. Returns the rows (empty on a filtered-out row) or null on an HTTP error. */
async function selectAs(jwt, table, filter) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { headers: authed(jwt) });
  if (!res.ok) return null;
  return res.json();
}
const rpc = (tok, fn, body) => fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
  method: 'POST', headers: tok ? authed(tok) : { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const cleanup = [];       // [table, filter] — iterated in order: unshift children, push parents
const userIds = [];       // disposable users, torn down after the rows that reference them
let building = null;

/** A confirmed user with `role`, optionally assigned to `buildingId`, signed in. Registered for teardown. */
async function persona(tag, role, buildingId) {
  const email = `zztest-ppm-${tag}-${RUN}@buildingops.app`;
  let res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: SVC, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const id = (await res.json()).id;
  if (!id) throw new Error(`persona ${tag} create failed`);
  userIds.push(id);
  await fetch(`${URL_BASE}/rest/v1/user_roles?on_conflict=user_id`, {
    method: 'POST', headers: { ...SVC, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: id, role }),
  });
  if (buildingId) await svcInsert('user_buildings', { user_id: id, building_id: buildingId });
  res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const jwt = (await res.json()).access_token;
  if (!jwt) throw new Error(`persona ${tag} login failed`);
  return { id, jwt };
}
/** A confirmed site user ('user' role) assigned to `buildingId`, signed in. */
const siteUser = (tag, buildingId) => persona(tag, 'user', buildingId);
/** A confirmed admin (all buildings), signed in. */
const adminUser = (tag) => persona(tag, 'admin', null);

// Calendar helpers: the server works in Africa/Johannesburg dates.
const sastToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
/** First-of-month dates in [from, from + horizonDays] (inclusive) — what {every:1, unit:'month', monthDay:1} yields. */
const firstOfMonths = (from, horizonDays) => {
  const out = [];
  for (let i = 0; i <= horizonDays; i++) { const d = addDays(from, i); if (d.endsWith('-01')) out.push(d); }
  return out;
};
const sameSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

try {
  console.log(`ppm-smoke vs ${URL_BASE} (run ${RUN})`);

  // Sweep stray personas from earlier aborted runs first (rls-smoke does the same for zztest-rls-*).
  {
    const list = await (await fetch(`${URL_BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: SVC })).json();
    let swept = 0;
    for (const u of list?.users ?? []) {
      if (u.email?.startsWith('zztest-ppm-')) {
        await fetch(`${URL_BASE}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: SVC });
        swept++;
      }
    }
    if (swept) console.log(`  swept ${swept} stray zztest-ppm-* auth user(s) from earlier runs`);
  }

  // ── setup: building + admin + assigned site user ──
  building = (await svcInsert('buildings', { name: `ZZTEST-PPM-${RUN}` })).id;
  cleanup.push(['buildings', `id=eq.${building}`]);
  const admin = await adminUser('admin');
  const site = await siteUser('site', building);
  console.log('  setup: building + admin + assigned site user');

  // ── step 1: the plan line (service role, as an admin form would write it) ──
  const line = await svcInsert('building_ppm_services', {
    building_id: building, service_name: `ZZTEST-PPM Aircon ${RUN}`, recurrence: { every: 1, unit: 'month', monthDay: 1 }, sort_order: 1,
    notes: 'ZZTEST-PPM plan note — must not become the task description',
  });
  cleanup.push(['building_ppm_services', `id=eq.${line.id}`]);
  // Generated occurrences reference the line (on delete set null): remove them before it.
  // Their completions are registered per instance once the instances exist (step 2).
  cleanup.unshift(['task_instances', `source_ppm_id=eq.${line.id}`]);
  ok('building_ppm_services line inserted (monthly on the 1st)');
  // Who does the contractor's work here: the building's 'contractor' role rule → the site user.
  await svcInsert('building_role_assignments', { building_id: building, role: 'contractor', user_id: site.id });
  cleanup.push(['building_role_assignments', `building_id=eq.${building}&role=eq.contractor`]);
  // A second, inactive line: the generator must skip it entirely.
  const inactive = await svcInsert('building_ppm_services', {
    building_id: building, service_name: `ZZTEST-PPM Lifts ${RUN}`, recurrence: { every: 3, unit: 'month', monthDay: 1 }, sort_order: 2, is_active: false,
  });
  cleanup.push(['building_ppm_services', `id=eq.${inactive.id}`]);
  cleanup.unshift(['task_instances', `source_ppm_id=eq.${inactive.id}`]);

  // ── step 2: generation as admin over a 120-day horizon ──
  const today = sastToday();
  const expected = firstOfMonths(today, 120);
  let r = await rpc(admin.jwt, 'generate_ppm_tasks', { p_building: building, p_horizon_days: 120 });
  let body = await r.json();
  assert(`generate_ppm_tasks(120) as admin inserts one row per first-of-month in [today, today+120] (${expected.length})`,
    r.ok && body === expected.length, `HTTP ${r.status} ${JSON.stringify(body)}`);
  const gen = await svcSelect('task_instances', `source_ppm_id=eq.${line.id}&select=id,due_date,task_name,task_description,frequency,responsible_role,status,template_item_id,assigned_to&order=due_date`);
  for (const t of gen) cleanup.unshift(['task_completions', `task_instance_id=eq.${t.id}`]);
  assert('generated rows: due dates are exactly the expected first-of-month set',
    sameSet(gen.map((t) => t.due_date), expected), JSON.stringify(gen.map((t) => t.due_date)));
  assert("generated rows: task_name = service_name, frequency 'monthly', responsible_role 'contractor', pending, no template_item_id",
    gen.length > 0 && gen.every((t) => t.task_name === line.service_name && t.frequency === 'monthly' && t.responsible_role === 'contractor' && t.status === 'pending' && t.template_item_id === null),
    JSON.stringify(gen[0]));
  assert("generated rows: assigned_to = the site user via the building's 'contractor' role assignment",
    gen.length > 0 && gen.every((t) => t.assigned_to === site.id), JSON.stringify(gen.map((t) => t.assigned_to)));
  assert('generated rows: task_description is null (plan-line notes are not copied onto the task)',
    gen.every((t) => t.task_description === null), JSON.stringify(gen.map((t) => t.task_description)));
  const genInactive = await svcSelect('task_instances', `source_ppm_id=eq.${inactive.id}&select=id`);
  assert('inactive plan line produced 0 occurrences', genInactive.length === 0, `${genInactive.length} rows`);

  r = await rpc(site.jwt, 'generate_ppm_tasks', { p_building: building, p_horizon_days: 120 });
  assert('generate_ppm_tasks refused for the site user', r.status === 403, `expected HTTP 403 (raised 42501), got ${r.status}`);
  r = await rpc(null, 'generate_ppm_tasks', { p_building: building, p_horizon_days: 120 });
  assert('generate_ppm_tasks not executable by anon', r.status === 401 || r.status === 403, `expected HTTP 401/403 (revoked grant), got ${r.status}`);

  // ── step 3: complete the first occurrence via complete_task, then read the derived grid ──
  const first = gen[0];
  const cid = crypto.randomUUID();
  r = await rpc(admin.jwt, 'complete_task', { p_completion_id: cid, p_task_instance_id: first.id, p_notes: 'ZZTEST-PPM', p_signature_confirmed: false, p_photo_urls: [] });
  body = await r.json();
  assert('complete_task completes the first occurrence as admin', r.ok && body[0]?.completion_id === cid && body[0]?.already_completed === false, `HTTP ${r.status} ${JSON.stringify(body)}`);

  const doneMonth = first.due_date.slice(0, 7);
  const grid = await selectAs(admin.jwt, 'ppm_monthly_status', `building_id=eq.${building}&ppm_service_id=eq.${line.id}&select=service_name,period_month,status,done_on&order=period_month`);
  assert('ppm_monthly_status (admin JWT) has one row per generated occurrence', Array.isArray(grid) && grid.length === gen.length, JSON.stringify(grid));
  const doneRow = (grid ?? []).find((g) => g.period_month === doneMonth);
  assert(`ppm_monthly_status shows 'done' with a done_on date for ${doneMonth}`, doneRow?.status === 'done' && typeof doneRow?.done_on === 'string', JSON.stringify(doneRow));
  const rest = (grid ?? []).filter((g) => g.period_month !== doneMonth);
  assert("ppm_monthly_status shows 'due' or 'missed' for every other month, never 'done'",
    rest.length === gen.length - 1 && rest.every((g) => g.status === 'due' || g.status === 'missed'), JSON.stringify(rest));
  assert('ppm_monthly_status carries the plan line name as service_name', (grid ?? []).every((g) => g.service_name === line.service_name), JSON.stringify(grid?.[0]));
  const gridSite = await selectAs(site.jwt, 'ppm_monthly_status', `building_id=eq.${building}&select=period_month,status`);
  assert('ppm_monthly_status readable by the assigned site user (security invoker, building RLS)', Array.isArray(gridSite) && gridSite.length === gen.length, JSON.stringify(gridSite));

  // ── step 4: generation is idempotent ──
  r = await rpc(admin.jwt, 'generate_ppm_tasks', { p_building: building, p_horizon_days: 120 });
  assert('generate_ppm_tasks re-run inserts 0 (partial unique index arbitrates)', r.ok && (await r.json()) === 0, `HTTP ${r.status}`);
  const after = await svcSelect('task_instances', `source_ppm_id=eq.${line.id}&select=id,status`);
  assert('re-run kept the completed occurrence completed and added no rows',
    after.length === gen.length && after.find((t) => t.id === first.id)?.status === 'completed', JSON.stringify(after));

  // ── step 4b: an explicit 'missed' cell — a pending occurrence due yesterday (service role) ──
  // Every generated row is a first-of-month on/after today, so yesterday's month has no other row.
  const yesterday = addDays(today, -1);
  const missed = await svcInsert('task_instances', {
    building_id: building, source_ppm_id: line.id, task_name: line.service_name, frequency: 'monthly', responsible_role: 'contractor', status: 'pending', due_date: yesterday,
  });
  const missedMonth = yesterday.slice(0, 7);
  const gridMissed = await selectAs(admin.jwt, 'ppm_monthly_status', `building_id=eq.${building}&ppm_service_id=eq.${line.id}&period_month=eq.${missedMonth}&select=period_month,status`);
  assert(`ppm_monthly_status shows 'missed' for the overdue pending occurrence (${missedMonth})`,
    Array.isArray(gridMissed) && gridMissed.length === 1 && gridMissed[0].status === 'missed', JSON.stringify(gridMissed));

  // ── step 4c: reschedule on a plan-line change (trigger + reschedule_ppm_line, 2026-09-13_05 §8) ──
  // Untouched future rows go, the completed and the overdue rows stay, and the line is regenerated
  // over the cron's 365-day horizon with the new rule: quarterly = every third first-of-month,
  // anchored on the first one on/after today (which is the completed occurrence).
  const pendingBefore = (await svcSelect('task_instances', `source_ppm_id=eq.${line.id}&status=eq.pending&due_date=gt.${today}&select=id`)).map((t) => t.id);
  const quarterly = firstOfMonths(today, 365).filter((_, i) => i % 3 === 0);
  const futurePending = (rows) => rows.filter((t) => t.status === 'pending' && t.due_date > today).map((t) => t.due_date);
  const patchLine = (jwt, patch) => fetch(`${URL_BASE}/rest/v1/building_ppm_services?id=eq.${line.id}`, {
    method: 'PATCH', headers: { ...authed(jwt), Prefer: 'return=representation' }, body: JSON.stringify(patch),
  });
  let pr = await patchLine(admin.jwt, { recurrence: { every: 3, unit: 'month', monthDay: 1 } });
  assert('plan line recurrence flipped to quarterly as admin', pr.ok && (await pr.json()).length === 1, `HTTP ${pr.status}`);
  const afterFlip = await svcSelect('task_instances', `source_ppm_id=eq.${line.id}&select=id,due_date,status`);
  assert('reschedule: the old future pending occurrences are gone', pendingBefore.length > 0 && !afterFlip.some((t) => pendingBefore.includes(t.id)), JSON.stringify(afterFlip));
  assert(`reschedule: the completed (${first.due_date}) and the overdue (${yesterday}) occurrences survive`,
    afterFlip.some((t) => t.id === first.id && t.status === 'completed') && afterFlip.some((t) => t.id === missed.id), JSON.stringify(afterFlip));
  assert('reschedule: future pending rows are exactly the quarterly set over 365 days (the completed anchor excluded)',
    sameSet(futurePending(afterFlip), quarterly.filter((d) => d !== first.due_date)), `${JSON.stringify(futurePending(afterFlip))} vs ${JSON.stringify(quarterly)}`);
  pr = await patchLine(admin.jwt, { is_active: false });
  assert('plan line deactivated as admin', pr.ok && (await pr.json()).length === 1, `HTTP ${pr.status}`);
  const afterOff = await svcSelect('task_instances', `source_ppm_id=eq.${line.id}&select=id,due_date,status`);
  assert('deactivate: no future pending occurrence remains; the completed and the overdue rows stay',
    futurePending(afterOff).length === 0 && afterOff.length === 2, JSON.stringify(afterOff));
  r = await rpc(site.jwt, 'reschedule_ppm_line', { p_line: line.id });
  assert('reschedule_ppm_line refused for the site user', r.status === 403, `expected HTTP 403 (raised 42501), got ${r.status}`);
  r = await rpc(admin.jwt, 'reschedule_ppm_line', { p_line: line.id });
  assert('reschedule_ppm_line on an inactive line returns 0 as admin', r.ok && (await r.json()) === 0, `HTTP ${r.status}`);
  pr = await patchLine(admin.jwt, { is_active: true });
  assert('plan line reactivated as admin', pr.ok && (await pr.json()).length === 1, `HTTP ${pr.status}`);
  const afterOn = await svcSelect('task_instances', `source_ppm_id=eq.${line.id}&select=id,due_date,status`);
  assert('reactivate: the quarterly future occurrences are regenerated',
    sameSet(futurePending(afterOn), quarterly.filter((d) => d !== first.due_date)), JSON.stringify(futurePending(afterOn)));

  // ── step 5: contractor + issue with contractor_id + rating → contractors.rating ──
  const month = today.slice(0, 7);
  const contractor = (await svcInsert('contractors', { company_name: `ZZTEST-PPM-${RUN}`, trade: 'HVAC' })).id;
  cleanup.push(['contractors', `id=eq.${contractor}`]);
  cleanup.unshift(['contractor_ratings', `contractor_id=eq.${contractor}`]);
  const issue = (await svcInsert('issues', {
    building_id: building, title: `ZZTEST-PPM-${RUN}`, description: 'ppm smoke', reported_by: admin.id, contractor_id: contractor,
    status: 'resolved', resolved_at: `${month}-15T10:00:00Z`, actual_cost: 150,
  })).id;
  cleanup.push(['issues', `id=eq.${issue}`]);
  r = await fetch(`${URL_BASE}/rest/v1/contractor_ratings`, {
    method: 'POST', headers: { ...authed(admin.jwt), Prefer: 'return=representation' },
    body: JSON.stringify({ contractor_id: contractor, issue_id: issue, rating: 4, comment: 'ZZTEST-PPM', rated_by: admin.id }),
  });
  assert('contractor_ratings insert as admin (own rated_by, accessible issue)', r.status === 201, `HTTP ${r.status} ${r.status === 201 ? '' : await r.text()}`);
  const cRow = await svcSelect('contractors', `id=eq.${contractor}&select=rating`);
  assert('contractors.rating equals the single rating (trigger average)', Number(cRow[0]?.rating) === 4, JSON.stringify(cRow[0]));

  // ── step 6: cost rollup for the month — issue actual_cost + a service-history cost ──
  const asset = (await svcInsert('building_assets', { building_id: building, name: `ZZTEST-PPM chiller ${RUN}` })).id;
  cleanup.push(['building_assets', `id=eq.${asset}`]);
  cleanup.unshift(['asset_service_history', `asset_id=eq.${asset}`]);
  await svcInsert('asset_service_history', { asset_id: asset, contractor_id: contractor, service_date: `${month}-03`, service_type: 'ZZTEST-PPM', cost: 250 });
  const costs = await selectAs(admin.jwt, 'building_month_costs', `building_id=eq.${building}&month=eq.${month}&select=month,issues_actual,services_cost,total`);
  assert(`building_month_costs (admin JWT) has exactly one row for ${month}`, Array.isArray(costs) && costs.length === 1, JSON.stringify(costs));
  const c = costs?.[0] ?? {};
  assert('building_month_costs: issues_actual 150, services_cost 250, total 400',
    Number(c.issues_actual) === 150 && Number(c.services_cost) === 250 && Number(c.total) === 400, JSON.stringify(c));
  const costsSite = await selectAs(site.jwt, 'building_month_costs', `building_id=eq.${building}&month=eq.${month}&select=total`);
  assert('building_month_costs readable by the assigned site user (security invoker)', Array.isArray(costsSite) && Number(costsSite[0]?.total) === 400, JSON.stringify(costsSite));
} catch (e) {
  fail('smoke run', e.message);
} finally {
  // Teardown (service role): children first — completions, generated instances, ratings,
  // service history — then the rows they hang off, then the building, then the users.
  // A failed delete is reported and the teardown carries on, so the orphan check below still runs.
  const tryDelete = async (table, filter) => { try { await svcDelete(table, filter); } catch (e) { console.error(`  WARN  teardown: ${e.message}`); } };
  for (const [table, filter] of cleanup) await tryDelete(table, filter);
  for (const id of userIds) {
    await tryDelete('user_buildings', `user_id=eq.${id}`);
    await tryDelete('user_roles', `user_id=eq.${id}`);
    await fetch(`${URL_BASE}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: SVC });
  }
  const left = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-PPM-*&select=id`, { headers: SVC })).json();
  const leftC = await (await fetch(`${URL_BASE}/rest/v1/contractors?company_name=like.ZZTEST-PPM-*&select=id`, { headers: SVC })).json();
  console.log((left.length ?? 0) === 0 && (leftC.length ?? 0) === 0 ? '  teardown: clean' : `  WARN  ${left.length} ZZTEST-PPM buildings, ${leftC.length} contractors left`);
}

console.log(`\n${pass} passed, ${failures} failed`);
console.log(failures === 0 ? 'PPM JOURNEY HOLDS' : 'PPM JOURNEY BROKEN');
process.exit(failures === 0 ? 0 : 1);
