#!/usr/bin/env node
/**
 * Sign-off journey smoke — multi-signer request -> sign -> record, against the live
 * backend with disposable personas it cleans up. Run AFTER applying
 * GMI/sql/2026-06-14_01_form_signoff.sql (+ _02 storage) to the target project.
 *
 *   sequential: manager assigns 2 signers (active on step 1) -> a non-assigned user
 *   CANNOT sign -> signer2 CANNOT sign out of turn -> signer1 signs (trigger advances:
 *   req1 signed, req2 active) -> signer2 signs -> submission signoff_status=complete.
 *   decline: 1 signer declines -> submission signoff_status=rejected.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   node scripts/signoff-smoke.mjs
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Signoff-Smoke-${RUN}!`;
const SVC = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const authed = (jwt) => ({ apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' });

let pass = 0, failures = 0;
const ok = (n) => { pass++; console.log(`  PASS  ${n}`); };
const fail = (n, d) => { failures++; console.error(`  FAIL  ${n} — ${d}`); };
const assert = (n, cond, d) => (cond ? ok(n) : fail(n, d));

async function svcInsert(table, row) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}`, {
    method: 'POST', headers: { ...SVC, Prefer: 'return=representation' }, body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`fixture ${table}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}
async function svcGet(table, query) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${query}`, { headers: SVC });
  return res.json();
}
async function svcDelete(table, filter) {
  await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: SVC });
}
async function insertAs(jwt, table, row) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}`, {
    method: 'POST', headers: { ...authed(jwt), Prefer: 'return=representation' }, body: JSON.stringify(row),
  });
  return { ok: res.status === 201, status: res.status, body: res.ok ? (await res.json())[0] : await res.text() };
}

const personas = {};
const cleanup = [];
let building = null;

async function persona(key, role, buildingId) {
  const email = `zztest-signoff-${key}-${RUN}@buildingops.app`;
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
  res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const jwt = (await res.json()).access_token;
  if (!jwt) throw new Error(`persona ${key} login failed`);
  personas[key] = { id, jwt };
}

async function newSubmission() {
  const sub = await svcInsert('form_submissions', {
    building_id: building, form_name: `ZZTEST-SIGNOFF ${RUN}`, form_type: 'inspection',
    status: 'submitted', submitted_by: personas.user.id, form_data: { q1: 'ok' },
  });
  cleanup.unshift(['form_submissions', `id=eq.${sub.id}`]);
  return sub.id;
}

try {
  console.log(`signoff-smoke vs ${URL_BASE} (run ${RUN})`);
  building = (await svcInsert('buildings', { name: `ZZTEST-SIGNOFF-${RUN}` })).id;
  cleanup.push(['buildings', `id=eq.${building}`]);
  await persona('user', 'user', building);     // submitter
  await persona('manager', 'manager');         // assigner
  await persona('s1', 'user', building);       // signer 1
  await persona('s2', 'user', building);       // signer 2

  // ── sequential happy path ──
  const subId = await newSubmission();
  const r1 = await svcInsert('form_signoff_requests', {
    submission_id: subId, assigned_to: personas.s1.id, assigned_by: personas.manager.id,
    sequence_order: 1, mode: 'sequential', status: 'pending', active: true,
  });
  const r2 = await svcInsert('form_signoff_requests', {
    submission_id: subId, assigned_to: personas.s2.id, assigned_by: personas.manager.id,
    sequence_order: 2, mode: 'sequential', status: 'pending', active: false,
  });

  // RLS: a non-assigned user cannot sign r1
  const intruder = await insertAs(personas.manager.jwt, 'form_signatures', {
    request_id: r1.id, submission_id: subId, signer_id: personas.manager.id, method: 'typed',
    typed_name: 'Intruder', confirmation_text: 'x',
  });
  assert('non-assigned user CANNOT insert a signature', !intruder.ok, `HTTP ${intruder.status}`);

  // RLS: signer2 cannot sign out of turn (r2 is not active)
  const early = await insertAs(personas.s2.jwt, 'form_signatures', {
    request_id: r2.id, submission_id: subId, signer_id: personas.s2.id, method: 'typed',
    typed_name: 'Too early', confirmation_text: 'x',
  });
  assert('signer 2 CANNOT sign out of turn (request inactive)', !early.ok, `HTTP ${early.status}`);

  // signer1 signs (typed)
  const sign1 = await insertAs(personas.s1.jwt, 'form_signatures', {
    request_id: r1.id, submission_id: subId, signer_id: personas.s1.id, method: 'typed',
    typed_name: 'Signer One', confirmation_text: 'I confirm.',
  });
  assert('signer 1 signs their active request', sign1.ok, `HTTP ${sign1.status} ${sign1.body}`);

  let reqs = await svcGet('form_signoff_requests', `submission_id=eq.${subId}&select=id,status,active,sequence_order`);
  const a1 = reqs.find((r) => r.sequence_order === 1);
  const a2 = reqs.find((r) => r.sequence_order === 2);
  assert('trigger marked request 1 signed', a1?.status === 'signed' && a1?.active === false, JSON.stringify(a1));
  assert('trigger activated request 2', a2?.status === 'pending' && a2?.active === true, JSON.stringify(a2));

  // signer2 signs (drawn — row only; storage tested separately)
  const sign2 = await insertAs(personas.s2.jwt, 'form_signatures', {
    request_id: r2.id, submission_id: subId, signer_id: personas.s2.id, method: 'drawn',
    signature_url: `signatures/${subId}/${personas.s2.id}/sig.png`, confirmation_text: 'I confirm.',
  });
  assert('signer 2 signs once activated', sign2.ok, `HTTP ${sign2.status} ${sign2.body}`);

  const subAfter = (await svcGet('form_submissions', `id=eq.${subId}&select=signoff_status`))[0];
  assert('submission signoff_status = complete after all signed', subAfter?.signoff_status === 'complete', JSON.stringify(subAfter));

  // ── decline path ──
  const subId2 = await newSubmission();
  const dReq = await svcInsert('form_signoff_requests', {
    submission_id: subId2, assigned_to: personas.s1.id, assigned_by: personas.manager.id,
    sequence_order: 1, mode: 'sequential', status: 'pending', active: true,
  });
  await fetch(`${URL_BASE}/rest/v1/form_signoff_requests?id=eq.${dReq.id}`, {
    method: 'PATCH', headers: authed(personas.s1.jwt), body: JSON.stringify({ status: 'declined', active: false }),
  });
  const sub2After = (await svcGet('form_submissions', `id=eq.${subId2}&select=signoff_status`))[0];
  assert('decline sets submission signoff_status = rejected', sub2After?.signoff_status === 'rejected', JSON.stringify(sub2After));
} catch (e) {
  fail('smoke run', e.message);
} finally {
  // child rows (signatures/requests) cascade from form_submissions delete
  for (const [table, filter] of cleanup) await svcDelete(table, filter);
  for (const p of Object.values(personas)) {
    await svcDelete('user_buildings', `user_id=eq.${p.id}`);
    await svcDelete('user_roles', `user_id=eq.${p.id}`);
    await fetch(`${URL_BASE}/auth/v1/admin/users/${p.id}`, { method: 'DELETE', headers: SVC });
  }
  const left = await svcGet('buildings', `name=like.ZZTEST-SIGNOFF-*&select=id`);
  console.log((left.length ?? 0) === 0 ? '  teardown: clean' : `  WARN  ${left.length} ZZTEST-SIGNOFF buildings left`);
}

console.log(`\n${pass} passed, ${failures} failed`);
console.log(failures === 0 ? 'SIGN-OFF JOURNEY HOLDS' : 'SIGN-OFF JOURNEY BROKEN');
process.exit(failures === 0 ? 0 : 1);
