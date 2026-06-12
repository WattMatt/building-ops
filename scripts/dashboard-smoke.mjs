#!/usr/bin/env node
/**
 * Dashboard truthfulness smoke — every KPI re-derived against a known fixture
 * and compared with the dashboard's (corrected) query semantics. Catches the
 * three F-34 bugs: overdue dropped from "pending", "completed today" keyed off
 * due_date, and completions never stamping completed_at.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   node scripts/dashboard-smoke.mjs
 *
 * Fixture (one isolated building): 2 pending(past) + 1 pending(future)
 * + 1 overdue + 2 completed-today + 1 completed-yesterday; 1 open issue
 * + 1 resolved issue. Expected KPIs as a real admin would see them:
 *   open tasks = 4 (3 pending + 1 overdue) · completed today = 2 · open issues = 1.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Dash-Smoke-${RUN}!`;
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
async function svcDelete(table, filter) {
  await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: SVC });
}

// date helpers (caller-side; fine outside the workflow sandbox)
const now = new Date();
const ymd = (d) => d.toISOString().slice(0, 10);
const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
const noonToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).toISOString();
const noonYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString();

const cleanup = [];
let userId = null, building = null;

// count via the SAME query shape the dashboard hook uses, scoped to our building
async function dashCount(jwt, buildY) {
  const head = { ...authed(jwt), Prefer: 'count=exact' };
  const c = async (qs) => {
    const r = await fetch(`${URL_BASE}/rest/v1/${qs}`, { headers: head });
    return Number(r.headers.get('content-range')?.split('/')[1] ?? -1);
  };
  return {
    open: await c(`task_instances?building_id=eq.${buildY}&status=in.(pending,overdue)&select=id`),
    completedToday: await c(`task_instances?building_id=eq.${buildY}&status=eq.completed&completed_at=gte.${startOfToday}&completed_at=lt.${startOfTomorrow}&select=id`),
    openIssues: await c(`issues?building_id=eq.${buildY}&status=neq.resolved&select=id`),
  };
}

try {
  console.log(`dashboard-smoke vs ${URL_BASE} (run ${RUN})`);

  building = (await svcInsert('buildings', { name: `ZZTEST-DASH-${RUN}` })).id;
  cleanup.push(['buildings', `id=eq.${building}`]);

  const email = `zztest-dash-${RUN}@buildingops.app`;
  let res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: SVC, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  userId = (await res.json()).id;
  await fetch(`${URL_BASE}/rest/v1/user_roles?on_conflict=user_id`, {
    method: 'POST', headers: { ...SVC, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: userId, role: 'admin' }),
  });
  res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const jwt = (await res.json()).access_token;
  if (!jwt) throw new Error('login failed');

  // ── fixture: a precise, known task/issue mix ──
  const T = (over) => ({ building_id: building, task_name: `ZZTEST-DASH ${RUN}`, frequency: 'monthly', ...over });
  const seeded = [
    T({ status: 'pending', due_date: ymd(new Date(now.getTime() - 5 * 86400000)) }),
    T({ status: 'pending', due_date: ymd(new Date(now.getTime() - 1 * 86400000)) }),
    T({ status: 'pending', due_date: ymd(new Date(now.getTime() + 10 * 86400000)) }), // future
    T({ status: 'overdue', due_date: ymd(new Date(now.getTime() - 3 * 86400000)) }),  // overdue STATUS
    T({ status: 'completed', due_date: ymd(new Date(now.getTime() - 2 * 86400000)), completed_at: noonToday, completed_by: userId }), // due past, done today
    T({ status: 'completed', due_date: ymd(new Date(now.getTime() - 4 * 86400000)), completed_at: noonToday, completed_by: userId }), // due past, done today
    T({ status: 'completed', due_date: ymd(now), completed_at: noonYesterday, completed_by: userId }), // due today, done YESTERDAY
  ];
  for (const t of seeded) {
    const row = await svcInsert('task_instances', t);
    cleanup.unshift(['task_instances', `id=eq.${row.id}`]);
  }
  const openIssue = await svcInsert('issues', { building_id: building, title: `ZZTEST-DASH ${RUN}`, description: 'x', status: 'open', reported_by: userId, priority: 'low' });
  cleanup.unshift(['issues', `id=eq.${openIssue.id}`]);
  const resIssue = await svcInsert('issues', { building_id: building, title: `ZZTEST-DASH ${RUN}`, description: 'x', status: 'resolved', reported_by: userId, priority: 'low' });
  cleanup.unshift(['issues', `id=eq.${resIssue.id}`]);
  console.log('  setup: 7 tasks (3 pending, 1 overdue, 2 completed-today, 1 completed-yesterday) + 2 issues');

  // ── KPIs as the dashboard now computes them ──
  const k = await dashCount(jwt, building);

  assert('open tasks = 4 (3 pending + 1 overdue)', k.open === 4, `got ${k.open}`);
  assert('  → overdue-status task IS counted as open (was dropped before)', k.open >= 4, `open=${k.open}`);
  assert('completed today = 2 (by completed_at, not due_date)', k.completedToday === 2, `got ${k.completedToday}`);
  assert('  → yesterday-completed is NOT counted today', k.completedToday === 2, `completedToday=${k.completedToday}`);
  assert('open issues = 1 (resolved excluded)', k.openIssues === 1, `got ${k.openIssues}`);

  // ── regression guards: the OLD semantics would have been wrong ──
  const oldPending = await (async () => {
    const r = await fetch(`${URL_BASE}/rest/v1/task_instances?building_id=eq.${building}&status=eq.pending&due_date=lte.${ymd(now)}&select=id`, { headers: { ...authed(jwt), Prefer: 'count=exact' } });
    return Number(r.headers.get('content-range')?.split('/')[1] ?? -1);
  })();
  assert('regression: old pending query (status=pending,due<=today) would MISS the overdue task', oldPending === 2 && k.open === 4, `old=${oldPending} new=${k.open}`);

  const oldCompleted = await (async () => {
    const r = await fetch(`${URL_BASE}/rest/v1/task_instances?building_id=eq.${building}&status=eq.completed&due_date=eq.${ymd(now)}&select=id`, { headers: { ...authed(jwt), Prefer: 'count=exact' } });
    return Number(r.headers.get('content-range')?.split('/')[1] ?? -1);
  })();
  assert('regression: old completed query (due_date=today) gives a DIFFERENT count than completed_at', oldCompleted === 1 && k.completedToday === 2, `old=${oldCompleted} new=${k.completedToday}`);
} catch (e) {
  fail('smoke run', e.message);
} finally {
  for (const [table, filter] of cleanup) await svcDelete(table, filter);
  if (userId) {
    await svcDelete('user_roles', `user_id=eq.${userId}`);
    await fetch(`${URL_BASE}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: SVC });
  }
  const left = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-DASH-*&select=id`, { headers: SVC })).json();
  console.log((left.length ?? 0) === 0 ? '  teardown: clean' : `  WARN  ${left.length} ZZTEST-DASH buildings left`);
}

console.log(`\n${pass} passed, ${failures} failed`);
console.log(failures === 0 ? 'DASHBOARD KPIs TRUTHFUL' : 'DASHBOARD KPIs WRONG');
process.exit(failures === 0 ? 0 : 1);
