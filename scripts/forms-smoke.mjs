#!/usr/bin/env node
/**
 * Forms journey smoke — fill/submit → review-gating → approve, against the
 * live backend with disposable personas/fixtures it cleans up:
 *
 *   site user uploads a form photo (corrected path) + submits a form
 *   (status=submitted)  →  the SAME user may NOT change review status
 *   (fs_update is admin/manager only)  →  a manager reviews → approves
 *   (status + reviewed_by persist)  →  photo viewable via signed URL.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   node scripts/forms-smoke.mjs
 *
 * Photo path mirrors FillableFormDialog after F-31c. (Branded-PDF export is
 * client-rendered and out of protocol scope; the data + RLS journey is here.)
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Form-Smoke-${RUN}!`;
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

const personas = {};
const cleanup = [];
const storageCleanup = [];
let building = null, submission = null;

async function persona(key, role, buildingId) {
  const email = `zztest-form-${key}-${RUN}@buildingops.app`;
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

try {
  console.log(`forms-smoke vs ${URL_BASE} (run ${RUN})`);

  building = (await svcInsert('buildings', { name: `ZZTEST-FORM-${RUN}` })).id;
  cleanup.push(['buildings', `id=eq.${building}`]);
  await persona('user', 'user', building);   // submitter, assigned to building
  await persona('manager', 'manager');       // reviewer (managers see all)
  console.log('  setup: building + site user + manager');

  // ── step 1: photo upload at corrected path + form submit ──
  const photoPath = `photos/${personas.user.id}/${RUN}-form.jpg`; // FillableFormDialog after F-31c
  const up = await fetch(`${URL_BASE}/storage/v1/object/tenant-documents/${photoPath}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${personas.user.jwt}`, 'Content-Type': 'image/jpeg' }, body: `form-smoke ${RUN}`,
  });
  if (up.ok) storageCleanup.push(`tenant-documents/${photoPath}`);
  assert('form photo uploads to the corrected client path (photos/<uid>/)', up.ok, `HTTP ${up.status}`);

  const publicStyle = `${URL_BASE}/storage/v1/object/public/tenant-documents/${photoPath}`;
  let res = await fetch(`${URL_BASE}/rest/v1/form_submissions`, {
    method: 'POST', headers: { ...authed(personas.user.jwt), Prefer: 'return=representation' },
    body: JSON.stringify({
      building_id: building, form_name: `ZZTEST-FORM ${RUN}`, form_type: 'inspection',
      status: 'submitted', submitted_by: personas.user.id,
      form_data: { q1: 'ok' }, photo_urls: up.ok ? [publicStyle] : [],
    }),
  });
  submission = res.status === 201 ? (await res.json())[0]?.id : null;
  if (submission) cleanup.unshift(['form_submissions', `id=eq.${submission}`]);
  assert('site user submits a form in their building (status=submitted)', !!submission, `HTTP ${res.status}`);

  // ── step 2: review-gating — submitter may NOT change review status ──
  res = await fetch(`${URL_BASE}/rest/v1/form_submissions?id=eq.${submission}`, {
    method: 'PATCH', headers: { ...authed(personas.user.jwt), Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'approved' }),
  });
  const userChanged = res.ok && (await res.json()).length === 1;
  assert('submitter CANNOT self-approve (fs_update is admin/manager only)', !userChanged, 'site user changed review status');

  // ── step 3: manager reviews → approves ──
  const mgrPatch = async (body) => {
    const r = await fetch(`${URL_BASE}/rest/v1/form_submissions?id=eq.${submission}`, {
      method: 'PATCH', headers: { ...authed(personas.manager.jwt), Prefer: 'return=representation' }, body: JSON.stringify(body),
    });
    return r.ok && (await r.json()).length === 1;
  };
  assert('manager marks reviewed', await mgrPatch({ status: 'reviewed', reviewed_by: personas.manager.id }), 'reviewed patch failed');
  assert('manager approves (+ reviewed_by, review_notes)', await mgrPatch({ status: 'approved', review_notes: `ZZTEST-FORM ${RUN}` }), 'approve patch failed');

  res = await fetch(`${URL_BASE}/rest/v1/form_submissions?id=eq.${submission}&select=status,reviewed_by`, { headers: SVC });
  const final = (await res.json())[0];
  assert('approval persisted (status=approved, reviewed_by=manager)', final?.status === 'approved' && final?.reviewed_by === personas.manager.id, JSON.stringify(final));

  // ── step 4: submission photo viewable via signed URL ──
  if (up.ok) {
    const signed = await fetch(`${URL_BASE}/storage/v1/object/sign/tenant-documents/${photoPath}`, {
      method: 'POST', headers: authed(personas.manager.jwt), body: JSON.stringify({ expiresIn: 60 }),
    });
    assert('reviewer can sign a URL for the submission photo (PDF/display path)', signed.ok, `HTTP ${signed.status}`);
  }
} catch (e) {
  fail('smoke run', e.message);
} finally {
  for (const path of storageCleanup) await fetch(`${URL_BASE}/storage/v1/object/${path}`, { method: 'DELETE', headers: SVC });
  for (const [table, filter] of cleanup) await svcDelete(table, filter);
  for (const p of Object.values(personas)) {
    await svcDelete('user_buildings', `user_id=eq.${p.id}`);
    await svcDelete('user_roles', `user_id=eq.${p.id}`);
    await fetch(`${URL_BASE}/auth/v1/admin/users/${p.id}`, { method: 'DELETE', headers: SVC });
  }
  const left = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-FORM-*&select=id`, { headers: SVC })).json();
  console.log((left.length ?? 0) === 0 ? '  teardown: clean' : `  WARN  ${left.length} ZZTEST-FORM buildings left`);
}

console.log(`\n${pass} passed, ${failures} failed`);
console.log(failures === 0 ? 'FORMS JOURNEY HOLDS' : 'FORMS JOURNEY BROKEN');
process.exit(failures === 0 ? 0 : 1);
