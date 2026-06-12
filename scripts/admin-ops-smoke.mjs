#!/usr/bin/env node
/**
 * Admin operations smoke — role change, deactivate/reactivate, and what the
 * AFFECTED user experiences in real time, against the live backend with
 * disposable personas it cleans up.
 *
 *   role change takes effect LIVE (is_admin_or_manager re-evaluates per query,
 *   no token refresh)  →  deactivate bans + wipes building access + audit  →
 *   deactivated user: existing token loses building data immediately AND new
 *   login is refused  →  reactivate restores login (but NOT buildings — F-35)
 *   →  guard: an admin cannot deactivate themselves.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   node scripts/admin-ops-smoke.mjs
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Admin-Smoke-${RUN}!`;
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
async function canRead(jwt, table, id) {
  const r = await fetch(`${URL_BASE}/rest/v1/${table}?id=eq.${id}&select=id`, { headers: authed(jwt) });
  return r.ok && (await r.json()).length === 1;
}
async function login(email) {
  const r = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return r;
}
async function setStatus(callerJwt, userId, action) {
  return fetch(`${URL_BASE}/functions/v1/set-user-status`, {
    method: 'POST', headers: { ...authed(callerJwt), apikey: ANON }, body: JSON.stringify({ userId, action }),
  });
}

const personas = {};
const cleanup = [];
let bldgA = null, bldgB = null;

async function persona(key, role, buildingId) {
  const email = `zztest-admin-${key}-${RUN}@buildingops.app`;
  let res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: SVC, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const id = (await res.json()).id;
  if (!id) throw new Error(`persona ${key} create failed`);
  await fetch(`${URL_BASE}/rest/v1/user_roles?on_conflict=user_id`, {
    method: 'POST', headers: { ...SVC, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: id, role }),
  });
  if (buildingId) await svcInsert('user_buildings', { user_id: id, building_id: buildingId });
  res = await login(email);
  const jwt = (await res.json()).access_token;
  if (!jwt) throw new Error(`persona ${key} login failed`);
  personas[key] = { id, email, jwt };
}

try {
  console.log(`admin-ops-smoke vs ${URL_BASE} (run ${RUN})`);

  bldgA = (await svcInsert('buildings', { name: `ZZTEST-ADM-A-${RUN}` })).id;
  bldgB = (await svcInsert('buildings', { name: `ZZTEST-ADM-B-${RUN}` })).id;
  cleanup.push(['buildings', `id=eq.${bldgA}`], ['buildings', `id=eq.${bldgB}`]);

  await persona('admin', 'admin');             // caller (also keeps ≥2 admins globally, so last-admin guard never trips on real data)
  await persona('target', 'user', bldgA);      // assigned to A only
  console.log('  setup: 2 buildings, admin caller + target user (assigned to A)');

  // ── role change takes effect LIVE (same token, no refresh) ──
  assert('baseline: target (user, A-only) CANNOT read building B', !(await canRead(personas.target.jwt, 'buildings', bldgB)), 'target saw unassigned building');
  await fetch(`${URL_BASE}/rest/v1/user_roles?user_id=eq.${personas.target.id}`, {
    method: 'PATCH', headers: { ...SVC, Prefer: 'return=minimal' }, body: JSON.stringify({ role: 'manager' }),
  });
  assert('after promotion to manager, the SAME token now reads building B (role re-evaluates live)', await canRead(personas.target.jwt, 'buildings', bldgB), 'live role change not reflected');
  // demote back to user for the deactivation phase
  await fetch(`${URL_BASE}/rest/v1/user_roles?user_id=eq.${personas.target.id}`, {
    method: 'PATCH', headers: { ...SVC, Prefer: 'return=minimal' }, body: JSON.stringify({ role: 'user' }),
  });
  assert('after demotion, the SAME token loses building B again', !(await canRead(personas.target.jwt, 'buildings', bldgB)), 'demotion not reflected live');

  // ── deactivate via the edge function ──
  let res = await setStatus(personas.admin.jwt, personas.target.id, 'deactivate');
  assert('admin deactivates target (set-user-status 200)', res.ok, `HTTP ${res.status} ${res.ok ? '' : await res.text()}`);
  const prof = await (await fetch(`${URL_BASE}/rest/v1/profiles?id=eq.${personas.target.id}&select=deactivated`, { headers: SVC })).json();
  assert('profiles.deactivated flag set', prof[0]?.deactivated === true, JSON.stringify(prof[0]));
  const ub = await (await fetch(`${URL_BASE}/rest/v1/user_buildings?user_id=eq.${personas.target.id}&select=id`, { headers: SVC })).json();
  assert('building assignments revoked on deactivate (user_buildings wiped)', (ub.length ?? 0) === 0, `${ub.length} assignments remain`);
  const audit = await (await fetch(`${URL_BASE}/rest/v1/audit_logs?entity_id=eq.${personas.target.id}&action=eq.deactivate_user&select=id`, { headers: SVC })).json();
  assert('deactivation written to audit_logs', (audit.length ?? 0) >= 1, 'no audit row');

  // ── what the deactivated user experiences immediately ──
  assert('deactivated user: existing token loses building A data at once (RLS, user_buildings gone)', !(await canRead(personas.target.jwt, 'buildings', bldgA)), 'deactivated user still saw their building');
  res = await login(personas.target.email);
  assert('deactivated user: a NEW login is refused (banned)', !res.ok, `login HTTP ${res.status} (expected failure)`);

  // ── reactivate restores login, but NOT buildings (F-35) ──
  res = await setStatus(personas.admin.jwt, personas.target.id, 'reactivate');
  assert('admin reactivates target (set-user-status 200)', res.ok, `HTTP ${res.status}`);
  res = await login(personas.target.email);
  const reJwt = res.ok ? (await res.json()).access_token : null;
  assert('reactivated user can log in again', !!reJwt, `login HTTP ${res.status}`);
  const ub2 = await (await fetch(`${URL_BASE}/rest/v1/user_buildings?user_id=eq.${personas.target.id}&select=id`, { headers: SVC })).json();
  assert('reactivate does NOT auto-restore assignments (admin re-assigns explicitly — by design)', (ub2.length ?? 0) === 0, `unexpectedly restored ${ub2.length}`);
  if (reJwt) assert('reactivated user cannot see their old building until re-assigned', !(await canRead(reJwt, 'buildings', bldgA)), 'saw building without reassignment');

  // ── F-35 fix: admin re-assigns via the same insert EditAssignmentsDialog uses ──
  const reassign = await fetch(`${URL_BASE}/rest/v1/user_buildings`, {
    method: 'POST', headers: { ...authed(personas.admin.jwt), Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: personas.target.id, building_id: bldgA }),
  });
  assert('admin re-assigns a building (user_buildings insert — the F-35 UI path)', reassign.status === 201, `HTTP ${reassign.status}`);
  if (reJwt) assert('after re-assignment the user regains building access', await canRead(reJwt, 'buildings', bldgA), 'access not restored after re-assignment');

  // ── guard: an admin cannot deactivate themselves ──
  res = await setStatus(personas.admin.jwt, personas.admin.id, 'deactivate');
  assert('guard: admin cannot deactivate their own account (400)', res.status === 400, `HTTP ${res.status}`);

  // ── hard delete (delete-user edge fn): self-guard, then real deletion ──
  const del = (callerJwt, userId) => fetch(`${URL_BASE}/functions/v1/delete-user`, {
    method: 'POST', headers: { ...authed(callerJwt), apikey: ANON }, body: JSON.stringify({ userId }),
  });
  res = await del(personas.admin.jwt, personas.admin.id);
  assert('guard: admin cannot delete their own account (400)', res.status === 400, `HTTP ${res.status}`);

  res = await del(personas.admin.jwt, personas.target.id);
  assert('admin hard-deletes the target user (delete-user 200)', res.ok, `HTTP ${res.status} ${res.ok ? '' : await res.text()}`);
  const goneAuth = await fetch(`${URL_BASE}/auth/v1/admin/users/${personas.target.id}`, { headers: SVC });
  assert('deleted user is removed from auth.users', goneAuth.status === 404, `HTTP ${goneAuth.status}`);
  const goneProf = await (await fetch(`${URL_BASE}/rest/v1/profiles?id=eq.${personas.target.id}&select=id`, { headers: SVC })).json();
  assert('deleted user profile + child rows gone', (goneProf.length ?? 0) === 0, `${goneProf.length} profile rows remain`);
  delete personas.target; // already gone — skip it in teardown

  console.log('  NOTE  last-admin guard is enforced in set-user-status/delete-user but not exercised here (would require being the only admin on shared prod).');
} catch (e) {
  fail('smoke run', e.message);
} finally {
  for (const [table, filter] of cleanup) await svcDelete(table, filter);
  for (const p of Object.values(personas)) {
    await svcDelete('user_buildings', `user_id=eq.${p.id}`);
    await svcDelete('user_roles', `user_id=eq.${p.id}`);
    await fetch(`${URL_BASE}/auth/v1/admin/users/${p.id}`, { method: 'DELETE', headers: SVC });
  }
  const left = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-ADM-*&select=id`, { headers: SVC })).json();
  console.log((left.length ?? 0) === 0 ? '  teardown: clean' : `  WARN  ${left.length} ZZTEST-ADM buildings left`);
}

console.log(`\n${pass} passed, ${failures} failed`);
console.log(failures === 0 ? 'ADMIN OPERATIONS HOLD' : 'ADMIN OPERATIONS BROKEN');
process.exit(failures === 0 ? 0 : 1);
