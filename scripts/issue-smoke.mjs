#!/usr/bin/env node
/**
 * Issue lifecycle smoke — proves the BACKEND supports the full journey
 * (the web UI currently only exposes create + list; see F-33). Against the
 * live backend with disposable fixtures it cleans up:
 *
 *   log issue (+ photo at the client's corrected path)  →  assign  →
 *   open → in_progress → escalated → resolved  →  issue_activity audit row.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   node scripts/issue-smoke.mjs
 *
 * The photo step uploads to photos/<uid>/… (what ReportIssueDialog and
 * NewIssue build after the F-31 b/d fix). The issue_activity step is marked
 * EXPECTED-GAP until F-32 is wired — it asserts the table ACCEPTS a lifecycle
 * row (so the audit trail is ready to turn on), not that the app writes one.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Iss-Smoke-${RUN}!`;
const SVC = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const authed = (jwt) => ({ apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' });

let pass = 0, failures = 0;
const fails = [];
const ok = (n) => { pass++; console.log(`  PASS  ${n}`); };
const fail = (n, d) => { failures++; fails.push(`${n} — ${d}`); console.error(`  FAIL  ${n} — ${d}`); };
const note = (n) => console.log(`  NOTE  ${n}`);
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

const cleanup = [];
const storageCleanup = [];
let userId = null, building = null, issue = null;

try {
  console.log(`issue-smoke vs ${URL_BASE} (run ${RUN})`);

  building = (await svcInsert('buildings', { name: `ZZTEST-ISS-${RUN}` })).id;
  cleanup.push(['buildings', `id=eq.${building}`]);

  const email = `zztest-iss-${RUN}@buildingops.app`;
  let res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: SVC, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  userId = (await res.json()).id;
  if (!userId) throw new Error('persona create failed');
  await fetch(`${URL_BASE}/rest/v1/user_roles?on_conflict=user_id`, {
    method: 'POST', headers: { ...SVC, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: userId, role: 'user' }),
  });
  await svcInsert('user_buildings', { user_id: userId, building_id: building });
  res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const jwt = (await res.json()).access_token;
  if (!jwt) throw new Error('persona login failed');
  console.log('  setup: building + assigned site user + login');

  // ── step 1: photo upload at the client's corrected path, then log issue ──
  const clientPath = `photos/${userId}/${RUN}-issue.jpg`; // mirrors ReportIssueDialog / NewIssue after F-31 b/d
  const up = await fetch(`${URL_BASE}/storage/v1/object/tenant-documents/${clientPath}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'image/jpeg' }, body: `iss-smoke ${RUN}`,
  });
  if (up.ok) storageCleanup.push(`tenant-documents/${clientPath}`);
  assert('issue photo uploads to the corrected client path (photos/<uid>/)', up.ok, `HTTP ${up.status}`);

  res = await fetch(`${URL_BASE}/rest/v1/issues`, {
    method: 'POST', headers: { ...authed(jwt), Prefer: 'return=representation' },
    body: JSON.stringify({
      title: `ZZTEST-ISS ${RUN}`, description: 'issue smoke', building_id: building,
      priority: 'high', status: 'open', reported_by: userId, photo_urls: up.ok ? [clientPath] : [],
    }),
  });
  const created = res.status === 201 ? (await res.json())[0] : null;
  issue = created?.id;
  if (issue) cleanup.unshift(['issues', `id=eq.${issue}`]);
  assert('site user logs an issue in their building (status=open)', !!issue, `HTTP ${res.status}`);

  // ── step 2: assign + lifecycle transitions (data layer; UI gap = F-33) ──
  const patch = async (body) => {
    const r = await fetch(`${URL_BASE}/rest/v1/issues?id=eq.${issue}`, {
      method: 'PATCH', headers: { ...authed(jwt), Prefer: 'return=representation' }, body: JSON.stringify(body),
    });
    return r.ok && (await r.json()).length === 1;
  };
  assert('assign issue to a user (assigned_to)', await patch({ assigned_to: userId }), 'assign patch failed');
  for (const status of ['in_progress', 'escalated', 'resolved']) {
    assert(`transition → ${status}`, await patch({ status }), `${status} patch failed`);
  }
  // confirm the terminal state stuck
  res = await fetch(`${URL_BASE}/rest/v1/issues?id=eq.${issue}&select=status,assigned_to`, { headers: authed(jwt) });
  const final = (await res.json())[0];
  assert('issue resolved + assigned (terminal state persisted)', final?.status === 'resolved' && final?.assigned_to === userId,
    `status=${final?.status} assigned_to=${final?.assigned_to}`);

  // ── step 3: audit trail auto-logged by the F-32 trigger ──
  // The create + the 4 patches above (assign, in_progress, escalated, resolved)
  // should each have produced an issue_activity row automatically.
  const acts = await (await fetch(`${URL_BASE}/rest/v1/issue_activity?issue_id=eq.${issue}&select=activity_type,old_value,new_value,user_id&order=created_at`, { headers: SVC })).json();
  if (acts.length) cleanup.unshift(['issue_activity', `issue_id=eq.${issue}`]);
  const types = acts.map((a) => a.activity_type);
  assert('trigger logged "created" on insert', types.includes('created'), `types=${types}`);
  assert('trigger logged the assignment', acts.some((a) => a.activity_type === 'assignment' && a.new_value === userId), `acts=${JSON.stringify(acts)}`);
  const statusLog = acts.filter((a) => a.activity_type === 'status_change');
  assert('trigger logged all 3 status transitions (in_progress, escalated, resolved)',
    statusLog.length === 3 && statusLog.map((a) => a.new_value).join(',') === 'in_progress,escalated,resolved',
    `status_changes=${JSON.stringify(statusLog.map((a) => `${a.old_value}->${a.new_value}`))}`);
  assert('every logged change attributes the actor (user_id set)', acts.every((a) => a.user_id === userId), 'some activity rows have no actor');
} catch (e) {
  fail('smoke run', e.message);
} finally {
  for (const path of storageCleanup) await fetch(`${URL_BASE}/storage/v1/object/${path}`, { method: 'DELETE', headers: SVC });
  for (const [table, filter] of cleanup) await svcDelete(table, filter);
  if (userId) {
    await svcDelete('user_buildings', `user_id=eq.${userId}`);
    await svcDelete('user_roles', `user_id=eq.${userId}`);
    await fetch(`${URL_BASE}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: SVC });
  }
  const left = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-ISS-*&select=id`, { headers: SVC })).json();
  console.log((left.length ?? 0) === 0 ? '  teardown: clean' : `  WARN  ${left.length} ZZTEST-ISS buildings left`);
}

console.log(`\n${pass} passed, ${failures} failed`);
console.log(failures === 0 ? 'ISSUE BACKEND HOLDS (UI gap F-33 tracked separately)' : 'ISSUE JOURNEY BROKEN');
process.exit(failures === 0 ? 0 : 1);
