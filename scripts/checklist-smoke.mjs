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
 *
 * R3a adds: a template with a weekly recurrence rule, generated over a horizon with
 * assigned_to resolved through building_role_assignments, then rescheduled after a
 * rule change. Expected date sets are computed from today's SAST date.
 *
 * Two steps have project-wide side effects and are SKIPped against production
 * (SUPABASE_URL containing the prod ref qdzgkttiosahdfqresvz) unless SMOKE_ALLOW_PROD=1;
 * the rest of the journey still runs:
 *   - the overdue sweep calls `mark_overdue_tasks` as the service role, which flips EVERY
 *     genuinely back-dated pending task on the target project, not just the fixture;
 *   - `reschedule_template` regenerates into every building the template applies to. The
 *     fixture template is scoped to a building type only the fixture building carries
 *     (asserted first, service role), so on staging the fan-out stays inside the fixture.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}

// Same guard as scripts/notifications-smoke.mjs, but scoped to the overdue sweep only.
const PROD_REF = 'qdzgkttiosahdfqresvz';
const SWEEP_ALLOWED = !URL_BASE.includes(PROD_REF) || process.env.SMOKE_ALLOW_PROD === '1';

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
async function svcPatch(table, filter, patch) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers: { ...SVC, Prefer: 'return=representation' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`fixture patch ${table}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}
async function svcSelect(table, filter) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { headers: SVC });
  if (!res.ok) throw new Error(`fixture select ${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const cleanup = [];       // [table, filter] LIFO
const storageCleanup = [];
const userIds = [];       // disposable site users, torn down after the rows that reference them
let building = null;

/** A confirmed user with `role`, optionally assigned to `buildingId`, signed in. Registered for teardown. */
async function persona(tag, role, buildingId) {
  const email = `zztest-chk-${tag}-${RUN}@buildingops.app`;
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

// Calendar helpers for the R3a assertions: the server works in Africa/Johannesburg dates, and the
// expected occurrence sets are computed here from today's date rather than hard-coded.
const sastToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const isoWeekday = (iso) => { const [y, m, d] = iso.split('-').map(Number); return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1; }; // 1 = Mon … 7 = Sun
/** Dates in [from, from + horizonDays] (inclusive) whose ISO weekday is in `weekdays`. */
const weekdayDates = (from, horizonDays, weekdays) => {
  const out = [];
  for (let i = 0; i <= horizonDays; i++) { const d = addDays(from, i); if (weekdays.includes(isoWeekday(d))) out.push(d); }
  return out;
};
const sameSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

try {
  console.log(`checklist-smoke vs ${URL_BASE} (run ${RUN})`);

  // ── setup: building + assigned site user + active template/item ──
  building = (await svcInsert('buildings', { name: `ZZTEST-CHK-${RUN}` })).id;
  cleanup.push(['buildings', `id=eq.${building}`]);

  const { id: userId, jwt } = await siteUser('a', building);
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
  let res = await fetch(`${URL_BASE}/rest/v1/task_completions`, {
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

  // ── R2a: complete_task is atomic and idempotent; mark_overdue_tasks flips back-dated tasks ──
  // The task above was completed through the two direct writes, so use a fresh pending one.
  const rpc = (tok, fn, body) => fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: authed(tok), body: JSON.stringify(body) });
  const task2 = (await svcInsert('task_instances', {
    building_id: building, task_name: `ZZTEST-CHK rpc ${RUN}`, due_date: today, status: 'pending', frequency: 'daily',
  })).id;
  cleanup.unshift(['task_instances', `id=eq.${task2}`]);
  cleanup.unshift(['task_completions', `task_instance_id=eq.${task2}`]); // in front: child before parent
  const cid = crypto.randomUUID();
  let r = await rpc(jwt, 'complete_task', { p_completion_id: cid, p_task_instance_id: task2, p_notes: 'ZZTEST', p_signature_confirmed: true, p_photo_urls: [] });
  let body = await r.json();
  assert('complete_task first call inserts', r.ok && body[0]?.completion_id === cid && body[0]?.already_completed === false, `HTTP ${r.status} ${JSON.stringify(body)}`);
  const ti = await (await fetch(`${URL_BASE}/rest/v1/task_instances?id=eq.${task2}&select=status,completed_by`, { headers: SVC })).json();
  assert('complete_task stamps the instance in the same call', ti[0]?.status === 'completed' && ti[0]?.completed_by === userId, JSON.stringify(ti[0]));
  r = await rpc(jwt, 'complete_task', { p_completion_id: cid, p_task_instance_id: task2, p_notes: 'ZZTEST', p_signature_confirmed: true, p_photo_urls: [] });
  body = await r.json();
  assert('complete_task replay is a no-op that reports already_completed', r.ok && body[0]?.completion_id === cid && body[0]?.already_completed === true, `HTTP ${r.status} ${JSON.stringify(body)}`);
  const tcs = await (await fetch(`${URL_BASE}/rest/v1/task_completions?task_instance_id=eq.${task2}&select=id`, { headers: SVC })).json();
  assert('exactly one completion row after replay', tcs.length === 1, `${tcs.length} rows`);

  // Spec §8: a second site user on the same building completing the same task (two phones,
  // one checklist) gets the ORIGINAL completion back, not a second row, and the instance
  // still credits whoever finished it first.
  const { id: userB, jwt: jwtB } = await siteUser('b', building);
  r = await rpc(jwtB, 'complete_task', { p_completion_id: crypto.randomUUID(), p_task_instance_id: task2, p_notes: 'ZZTEST second user', p_signature_confirmed: true, p_photo_urls: [] });
  body = await r.json();
  assert('complete_task by a second site user reports already_completed with the original completion_id',
    r.ok && body[0]?.already_completed === true && body[0]?.completion_id === cid, `HTTP ${r.status} ${JSON.stringify(body)}`);
  const tiB = await (await fetch(`${URL_BASE}/rest/v1/task_instances?id=eq.${task2}&select=status,completed_by`, { headers: SVC })).json();
  assert('task_instances.completed_by still credits the first user', tiB[0]?.status === 'completed' && tiB[0]?.completed_by === userId && tiB[0]?.completed_by !== userB, JSON.stringify(tiB[0]));
  const tcsB = await (await fetch(`${URL_BASE}/rest/v1/task_completions?task_instance_id=eq.${task2}&select=id`, { headers: SVC })).json();
  assert('still exactly one completion row after the second user', tcsB.length === 1, `${tcsB.length} rows`);

  // Sweep: flips every genuinely back-dated pending task on the project (what the cron does nightly).
  // That is a real side effect on prod, so refuse there unless SMOKE_ALLOW_PROD=1.
  if (!SWEEP_ALLOWED) {
    console.log(`  SKIP  mark_overdue_tasks sweep — SUPABASE_URL contains the prod ref ${PROD_REF}; the sweep flips every back-dated pending task. Set SMOKE_ALLOW_PROD=1 to run it.`);
  } else {
    const late = (await svcInsert('task_instances', {
      building_id: building, task_name: `ZZTEST-late-${RUN}`, frequency: 'daily', status: 'pending', due_date: '2020-01-01', responsible_role: 'user',
    })).id;
    cleanup.unshift(['task_instances', `id=eq.${late}`]);
    r = await fetch(`${URL_BASE}/rest/v1/rpc/mark_overdue_tasks`, { method: 'POST', headers: SVC, body: '{}' });
    assert('mark_overdue_tasks runs as service role', r.ok, `HTTP ${r.status}`);
    const lateRow = await (await fetch(`${URL_BASE}/rest/v1/task_instances?id=eq.${late}&select=status`, { headers: SVC })).json();
    assert('back-dated pending task is now overdue', lateRow[0]?.status === 'overdue', JSON.stringify(lateRow[0]));
    await svcDelete('task_instances', `id=eq.${late}`);
  }

  // ── R3a: recurrence rule -> horizon generation with per-role assignment -> reschedule ──
  // A weekly Mon/Wed template, one item whose responsible_party is 'Maintenance', and a
  // building_role_assignments row mapping that label to the site user. Expected dates are
  // computed from today's SAST date, never hard-coded.
  //
  // Scope: reschedule_template fans out into EVERY building the template applies to, and
  // src/lib/compliance.ts has no spare BUILDING_TYPES value, so the fixture building is made
  // 'industrial' and the template scoped to ['industrial'] — after asserting (service role)
  // that no other building in the project has that type. If one does, the fan-out cannot be
  // isolated: the step still runs where SWEEP_ALLOWED permits, the expected count includes
  // those buildings, and a note says so. Teardown deletes every row by template_item_id.
  {
    const { jwt: adminJwt } = await adminUser('admin');
    const SCOPE_TYPE = 'industrial';
    const otherScoped = await svcSelect('buildings', `building_type=eq.${SCOPE_TYPE}&id=neq.${building}&select=id,name`);
    const isolated = otherScoped.length === 0;
    if (isolated) {
      ok(`fixture scope: no other building is '${SCOPE_TYPE}', so the reschedule fan-out stays inside the fixture`);
    } else {
      console.log(`  NOTE  ${otherScoped.length} other building(s) already carry building_type '${SCOPE_TYPE}' (${otherScoped.map((b) => b.name).join(', ')}); `
        + `the reschedule fan-out cannot be isolated to the fixture — falling back to the prod guard only, and counting those buildings in the expected total.`);
    }
    await svcPatch('buildings', `id=eq.${building}`, { building_type: SCOPE_TYPE });
    const rule = { every: 1, unit: 'week', weekdays: [1, 3] };
    const tpl = await svcInsert('checklist_templates', {
      name: `ZZTEST-CHK-R3-${RUN}`, frequency: 'daily', is_active: true, recurrence: rule, applies_to_building_types: [SCOPE_TYPE],
    });
    cleanup.push(['checklist_templates', `id=eq.${tpl.id}`]);
    const item = (await svcInsert('template_items', { template_id: tpl.id, task_name: `ZZTEST-CHK-R3 item ${RUN}`, responsible_party: 'Maintenance' })).id;
    cleanup.push(['template_items', `id=eq.${item}`]);
    // Generated rows land in every building of SCOPE_TYPE the reschedule fan-out reaches, not just ours.
    cleanup.unshift(['task_instances', `template_item_id=eq.${item}`]);
    await svcInsert('building_role_assignments', { building_id: building, role: 'Maintenance', user_id: userId });
    cleanup.unshift(['building_role_assignments', `building_id=eq.${building}`]);
    assert('template trigger derives frequency weekly from the rule (daily was passed) and starts at version 1',
      tpl.frequency === 'weekly' && tpl.version === 1 && tpl.recurrence?.unit === 'week', JSON.stringify({ frequency: tpl.frequency, version: tpl.version }));

    // Generation is per building (p_building), so it is safe on any project.
    const today = sastToday();
    const expectMonWed = weekdayDates(today, 28, [1, 3]);
    r = await rpc(adminJwt, 'generate_scheduled_tasks', { p_building: building, p_template: tpl.id, p_horizon_days: 28 });
    body = await r.json();
    assert(`generate_scheduled_tasks(horizon 28) as admin inserts every Mon/Wed in [today, today+28] (${expectMonWed.length})`,
      r.ok && body === expectMonWed.length, `HTTP ${r.status} ${JSON.stringify(body)}`);
    let gen = await svcSelect('task_instances', `template_item_id=eq.${item}&select=building_id,due_date,assigned_to,responsible_role,status`);
    assert('generated rows: due dates are exactly the expected set, all for the fixture building',
      sameSet(gen.map((t) => t.due_date), expectMonWed) && gen.every((t) => t.building_id === building), JSON.stringify(gen.map((t) => t.due_date)));
    assert('generated rows: assigned_to = the Maintenance assignee, responsible_role = Maintenance, pending',
      gen.length > 0 && gen.every((t) => t.assigned_to === userId && t.responsible_role === 'Maintenance' && t.status === 'pending'), JSON.stringify(gen[0]));
    r = await rpc(adminJwt, 'generate_scheduled_tasks', { p_building: building, p_template: tpl.id, p_horizon_days: 28 });
    assert('generate_scheduled_tasks re-run is idempotent (0)', r.ok && (await r.json()) === 0, `HTTP ${r.status}`);
    r = await rpc(jwt, 'generate_scheduled_tasks', { p_building: building, p_template: tpl.id, p_horizon_days: 28 });
    assert('generate_scheduled_tasks refused for the site user', r.status === 403, `expected HTTP 403, got ${r.status}`);

    // Rule change (fixture template only — safe anywhere): version bumps, frequency stays weekly.
    const tpl2 = await svcPatch('checklist_templates', `id=eq.${tpl.id}`, { recurrence: { every: 1, unit: 'week', weekdays: [1] } });
    assert('rule change bumps version to 2 and keeps frequency weekly', tpl2.version === 2 && tpl2.frequency === 'weekly', JSON.stringify({ version: tpl2.version, frequency: tpl2.frequency }));

    // Reschedule: untouched future rows go, Mondays come back over the 90-day weekly cap — in
    // every SCOPE_TYPE building, which on prod may be real ones. Same guard as the overdue sweep.
    if (!SWEEP_ALLOWED) {
      console.log(`  SKIP  reschedule_template — SUPABASE_URL contains the prod ref ${PROD_REF}; reschedule regenerates ZZTEST rows into every '${SCOPE_TYPE}' building until teardown. Set SMOKE_ALLOW_PROD=1 to run it.`);
    } else {
      const surviving = gen.filter((t) => t.due_date <= today).map((t) => t.due_date);   // due today is not "future"
      const expectDeleted = gen.length - surviving.length;
      const mondays90 = weekdayDates(today, 90, [1]);
      // Re-read the scope at this point: it is the fixture building plus whatever else carries SCOPE_TYPE.
      const scoped = await svcSelect('buildings', `building_type=eq.${SCOPE_TYPE}&select=id`);
      assert(`reschedule scope: the fixture building is one of the ${scoped.length} '${SCOPE_TYPE}' building(s)`, scoped.some((b) => b.id === building), JSON.stringify(scoped));
      const expectGenerated = mondays90.filter((d) => !surviving.includes(d)).length + (scoped.length - 1) * mondays90.length;
      r = await rpc(adminJwt, 'reschedule_template', { p_template: tpl.id });
      body = await r.json();
      assert(`reschedule_template deletes the ${expectDeleted} untouched future rows`, r.ok && body[0]?.deleted === expectDeleted, `HTTP ${r.status} ${JSON.stringify(body)}`);
      assert(`reschedule_template regenerates ${expectGenerated} rows (Mondays over 90 days x ${scoped.length} '${SCOPE_TYPE}' building(s))`,
        r.ok && body[0]?.generated === expectGenerated, `HTTP ${r.status} ${JSON.stringify(body)}`);
      gen = await svcSelect('task_instances', `template_item_id=eq.${item}&building_id=eq.${building}&select=due_date,assigned_to`);
      assert('after reschedule: fixture building holds exactly Mondays (90 days) plus any row already due today',
        sameSet(gen.map((t) => t.due_date), [...new Set([...mondays90, ...surviving])]), JSON.stringify(gen.map((t) => t.due_date)));
      assert('after reschedule: regenerated rows are assigned through the role assignment', gen.every((t) => t.assigned_to === userId), JSON.stringify(gen[0]));
      if (isolated) {
        const elsewhere = await svcSelect('task_instances', `template_item_id=eq.${item}&building_id=neq.${building}&select=id`);
        assert('after reschedule: no ZZTEST rows landed in any other building', elsewhere.length === 0, `${elsewhere.length} row(s) outside the fixture building`);
      }
      r = await rpc(jwt, 'reschedule_template', { p_template: tpl.id });
      assert('reschedule_template refused for the site user', r.status === 403, `expected HTTP 403, got ${r.status}`);
    }
  }
} catch (e) {
  fail('smoke run', e.message);
} finally {
  for (const path of storageCleanup) await fetch(`${URL_BASE}/storage/v1/object/${path}`, { method: 'DELETE', headers: SVC });
  for (const [table, filter] of cleanup) await svcDelete(table, filter);
  for (const id of userIds) {
    await svcDelete('user_buildings', `user_id=eq.${id}`);
    await svcDelete('user_roles', `user_id=eq.${id}`);
    await fetch(`${URL_BASE}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: SVC });
  }
  const left = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-CHK-*&select=id`, { headers: SVC })).json();
  console.log((left.length ?? 0) === 0 ? '  teardown: clean' : `  WARN  ${left.length} ZZTEST-CHK buildings left`);
}

console.log(`\n${pass} passed, ${failures} failed`);
console.log(failures === 0 ? 'CHECKLIST JOURNEY HOLDS' : 'CHECKLIST JOURNEY BROKEN');
process.exit(failures === 0 ? 0 : 1);
