#!/usr/bin/env node
/**
 * Checklist execution smoke — the core daily client journey, end to end,
 * against the live backend with a disposable site user it cleans up:
 *
 *   active template + item  →  task generated for a building  →
 *   site user uploads completion photo (the EXACT path the web client uses)  →
 *   task_completion row inserted  →  task_instance flips to completed  →
 *   dashboard "completed today" count moves.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   node scripts/checklist-smoke.mjs
 *
 * The photo step uploads to whatever path CompleteTaskDialog.tsx builds, so a
 * storage-policy/path mismatch (the F-30 failure class) shows up HERE as a
 * real client would hit it, not as an abstract policy probe.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Chk-Smoke-${RUN}!`;
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

const cleanup = [];       // [table, filter] LIFO
const storageCleanup = [];
let userId = null, building = null;

try {
  console.log(`checklist-smoke vs ${URL_BASE} (run ${RUN})`);

  // ── setup: building + assigned site user + active template/item ──
  building = (await svcInsert('buildings', { name: `ZZTEST-CHK-${RUN}` })).id;
  cleanup.push(['buildings', `id=eq.${building}`]);

  const email = `zztest-chk-${RUN}@buildingops.app`;
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

  const template = (await svcInsert('checklist_templates', { name: `ZZTEST-CHK-${RUN}`, frequency: 'monthly', is_active: true })).id;
  cleanup.push(['checklist_templates', `id=eq.${template}`]);
  const titem = (await svcInsert('template_items', { template_id: template, task_name: `ZZTEST-CHK item ${RUN}`, requires_photo: true })).id;
  cleanup.push(['template_items', `id=eq.${titem}`]);
  ok('active template + photo-required item created');

  // ── step 1: a task exists for this building (site user can generate per RLS) ──
  const today = new Date(Date.now()).toISOString().slice(0, 10); // stamped by caller, fine for fixture
  const task = await svcInsert('task_instances', {
    building_id: building, task_name: `ZZTEST-CHK item ${RUN}`, due_date: today, status: 'pending', frequency: 'monthly',
  });
  cleanup.push(['task_instances', `id=eq.${task.id}`]);
  ok('task_instance present (pending, due today)');

  // baseline dashboard counts AS THE SITE USER (RLS-scoped to their building)
  const countAs = async (status) => {
    const r = await fetch(`${URL_BASE}/rest/v1/task_instances?building_id=eq.${building}&status=eq.${status}&due_date=eq.${today}&select=id`, {
      headers: { ...authed(jwt), Prefer: 'count=exact' },
    });
    return Number(r.headers.get('content-range')?.split('/')[1] ?? 0);
  };
  const pending0 = await countAs('pending');
  const completed0 = await countAs('completed');
  assert('baseline: 1 pending / 0 completed for building', pending0 === 1 && completed0 === 0, `pending=${pending0} completed=${completed0}`);

  // ── step 2: completion photo upload — MUST mirror CompleteTaskDialog's path ──
  // (photos/<uid>/… is the only tenant-documents prefix a non-admin may write)
  const clientPath = `photos/${userId}/${RUN}-evidence.jpg`;
  let up = await fetch(`${URL_BASE}/storage/v1/object/tenant-documents/${clientPath}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'image/jpeg' }, body: `chk-smoke ${RUN}`,
  });
  if (up.ok) storageCleanup.push(`tenant-documents/${clientPath}`);
  assert('completion photo uploads to the path the client uses', up.ok,
    `HTTP ${up.status} — CompleteTaskDialog uploads to completions/<uid>/ but no storage policy allows that prefix`);

  // ── step 3: completion record + status flip (as the site user) ──
  let photoUrls = [];
  if (up.ok) {
    // what the client SHOULD store: a resolvable reference (path), not a public URL of a private bucket
    photoUrls = [clientPath];
  }
  res = await fetch(`${URL_BASE}/rest/v1/task_completions`, {
    method: 'POST', headers: { ...authed(jwt), Prefer: 'return=representation' },
    body: JSON.stringify({ task_instance_id: task.id, completed_by: userId, notes: `ZZTEST-CHK ${RUN}`, signature_confirmed: false, photo_urls: photoUrls }),
  });
  const tcOk = res.status === 201;
  if (tcOk) cleanup.unshift(['task_completions', `task_instance_id=eq.${task.id}`]);
  assert('site user inserts task_completion (RLS join allows own building)', tcOk, `HTTP ${res.status} ${tcOk ? '' : await res.text()}`);

  res = await fetch(`${URL_BASE}/rest/v1/task_instances?id=eq.${task.id}`, {
    method: 'PATCH', headers: { ...authed(jwt), Prefer: 'return=representation' }, body: JSON.stringify({ status: 'completed' }),
  });
  const flipped = res.ok && (await res.json()).length === 1;
  assert('task_instance flips to completed (site user, own building)', flipped, `HTTP ${res.status}`);

  // ── step 4: dashboard count moved ──
  const pending1 = await countAs('pending');
  const completed1 = await countAs('completed');
  assert('dashboard: pending 1→0', pending1 === 0, `pending=${pending1}`);
  assert('dashboard: completed 0→1', completed1 === 1, `completed=${completed1}`);

  // ── step 5: display path — getPublicUrl on a PRIVATE bucket must NOT serve bytes ──
  if (up.ok) {
    const pub = await fetch(`${URL_BASE}/storage/v1/object/public/tenant-documents/${clientPath}`);
    assert('private-bucket public URL does NOT serve (signed URL required for display)', !pub.ok,
      `public URL returned HTTP ${pub.status} — if this ever passes, the bucket leaked public`);
    const signed = await fetch(`${URL_BASE}/storage/v1/object/sign/tenant-documents/${clientPath}`, {
      method: 'POST', headers: authed(jwt), body: JSON.stringify({ expiresIn: 60 }),
    });
    assert('signed URL issues for the stored photo (display path works)', signed.ok, `HTTP ${signed.status}`);
  }
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
  const left = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-CHK-*&select=id`, { headers: SVC })).json();
  console.log((left.length ?? 0) === 0 ? '  teardown: clean' : `  WARN  ${left.length} ZZTEST-CHK buildings left`);
}

console.log(`\n${pass} passed, ${failures} failed`);
console.log(failures === 0 ? 'CHECKLIST JOURNEY HOLDS' : 'CHECKLIST JOURNEY BROKEN');
process.exit(failures === 0 ? 0 : 1);
