#!/usr/bin/env node
/**
 * Notifications smoke — proves the `notify` edge function and the
 * `notifications` table's RLS agree on inbox visibility, against the live
 * backend, using disposable personas and fixtures it deletes afterwards.
 * Model: scripts/rls-smoke.mjs (env handling, persona helpers, assert,
 * LIFO cleanup, exit codes). Not part of `npm run smoke` yet — Task 9 adds
 * it to the chain once `notify` is confirmed deployed.
 * Refuses to run against production (SUPABASE_URL containing the prod ref
 * qdzgkttiosahdfqresvz) unless SMOKE_ALLOW_PROD=1 — step 6 sends
 * report_submitted, which notifies and EMAILS every real admin/manager.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   node scripts/notifications-smoke.mjs
 *
 * Checks POST /functions/v1/notify (supabase/functions/notify/index.ts):
 *   task_assigned, recipients=[self]              → 200, inserted 0, no inbox row (actor excluded)
 *   task_assigned, recipients=[manager]            → 200, inserted 1, row visible to manager only
 *   buildingId the caller cannot access            → 403
 *   unknown kind                                   → 400
 *   missing Authorization                          → 401
 *   report_submitted, recipients=[] (org-wide)     → 200, inserted ≥1, resolves admins/managers
 * …and the notifications table's own RLS: recipient can mark their row read,
 * a non-recipient's update touches zero rows.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}

// Refuse to run against production: step 6 sends report_submitted, which
// notifies and EMAILS every real admin and manager on the project.
const PROD_REF = 'qdzgkttiosahdfqresvz';
if (URL_BASE.includes(PROD_REF) && process.env.SMOKE_ALLOW_PROD !== '1') {
  console.error(
    `Refusing to run against production (SUPABASE_URL contains ${PROD_REF}): ` +
    'step 6 sends report_submitted, which notifies and EMAILS every real admin ' +
    'and manager on the project. Set SMOKE_ALLOW_PROD=1 to override.'
  );
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Notify-Smoke-${RUN}!`;
const SVC = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

let pass = 0, failures = 0, skips = 0;
const fails = [];
const ok = () => { pass++; };
const fail = (name, detail) => { failures++; fails.push(`${name} — ${detail}`); };
const skip = (name, why) => { skips++; console.log(`  SKIP  ${name} — ${why}`); };
const assert = (name, cond, detail) => (cond ? ok() : fail(name, detail));

/** Logs each step as it starts and prefixes any thrown error with the step name, so a bare "fetch failed" says where. */
async function step(name, fn) {
  console.log(`  step: ${name}`);
  try {
    return await fn();
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    err.message = `[${name}] ${err.message}`;
    throw err;
  }
}

// ── service-role REST helpers ──
async function svcInsert(table, row) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}`, {
    method: 'POST', headers: { ...SVC, Prefer: 'return=representation' }, body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`fixture insert ${table}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}
async function svcDelete(table, id) {
  await fetch(`${URL_BASE}/rest/v1/${table}?id=eq.${id}`, { method: 'DELETE', headers: SVC });
}
async function svcSelectF(table, filter) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}&select=*`, { headers: SVC });
  if (!res.ok) throw new Error(`fixture select ${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

// ── persona-scoped REST probes (notifications table RLS) ──
function authed(jwt) { return { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }; }

async function canSelectF(jwt, table, filter) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}&select=*&limit=1`, { headers: authed(jwt) });
  // Throw on transport/API errors rather than treating them as "can't see it" —
  // a negative visibility assertion must not be able to pass on a 401/500.
  if (!res.ok) throw new Error(`probe select ${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json(); // row array; callers check .length
}
async function updateF(jwt, table, filter, patch) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers: { ...authed(jwt), Prefer: 'return=representation' }, body: JSON.stringify(patch),
  });
  const rows = res.ok ? await res.json() : [];
  return { ok: res.ok, status: res.status, rows };
}

// ── the function under test ──
async function notifyCall(jwt, body) {
  const headers = { apikey: ANON, 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  const res = await fetch(`${URL_BASE}/functions/v1/notify`, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

// ── lifecycle state ──
const personas = {};      // key → {id, jwt, email}
const createdUsers = [];  // auth user ids, tracked the moment they exist
const cleanup = [];       // [table, id] service-side teardown, LIFO
let A = null, B = null;   // building ids

async function createPersona(key, role, buildingId) {
  const email = `zztest-notify-${key}-${RUN}@buildingops.app`;
  let res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: SVC,
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const user = await res.json();
  if (!res.ok || !user.id) throw new Error(`persona ${key}: ${JSON.stringify(user).slice(0, 120)}`);
  createdUsers.push(user.id); // track before any later step can throw
  // signup trigger may have seeded a default role — upsert, don't insert
  res = await fetch(`${URL_BASE}/rest/v1/user_roles?on_conflict=user_id`, {
    method: 'POST', headers: { ...SVC, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: user.id, role }),
  });
  if (!res.ok) throw new Error(`persona ${key} role: HTTP ${res.status} ${await res.text()}`);
  // Personas are opted out of email so a live Resend key never sends to
  // non-existent @buildingops.app addresses.
  res = await fetch(`${URL_BASE}/rest/v1/profiles?id=eq.${user.id}`, {
    method: 'PATCH', headers: SVC, body: JSON.stringify({ email_notifications: false }),
  });
  if (!res.ok) throw new Error(`persona ${key} email opt-out: HTTP ${res.status} ${await res.text()}`);
  if (buildingId) await svcInsert('user_buildings', { user_id: user.id, building_id: buildingId });
  res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const session = await res.json();
  if (!session.access_token) throw new Error(`persona ${key} login: HTTP ${res.status}`);
  personas[key] = { id: user.id, jwt: session.access_token, email };
}

/** Every notifications row this run created for a given entityId, via the service key. */
async function rowsFor(entityId) {
  return svcSelectF('notifications', `entity_id=eq.${entityId}`);
}
// Buildings A/B and the personas cascade-delete their notification rows anyway
// (FKs `on delete cascade` in supabase/schema/2026-09-11_01_r1_mine.sql) — this
// explicit registration only exists to fix LIFO teardown order, not because
// the rows would otherwise be orphaned.
async function registerCleanup(entityId) {
  const rows = await rowsFor(entityId);
  for (const r of rows) cleanup.push(['notifications', r.id]);
  return rows;
}

let managerRowFilter = null;

try {
  console.log(`notifications-smoke vs ${URL_BASE} (run ${RUN})`);

  // ════ Phase 1: personas + fixture buildings ════
  await step('setup: buildings + personas', async () => {
    A = (await svcInsert('buildings', { name: `ZZTEST-NOTIFY-A-${RUN}` })).id;
    B = (await svcInsert('buildings', { name: `ZZTEST-NOTIFY-B-${RUN}` })).id;
    cleanup.push(['buildings', A], ['buildings', B]);

    await createPersona('admin', 'admin');
    await createPersona('manager', 'manager');
    await createPersona('user', 'user', A); // assigned to A only — B is out of reach
    console.log('  setup: 2 buildings, 3 personas (admin, manager, user assigned to A)');
  });

  // ════ 1: task_assigned, recipients=[self] → 200, inserted 0, no inbox row (actor excluded) ════
  await step('task_assigned: self-recipient', async () => {
    const entityId = crypto.randomUUID();
    const { status, body } = await notifyCall(personas.user.jwt, {
      kind: 'task_assigned', entityType: 'task', entityId, buildingId: A,
      recipients: [personas.user.id], title: `ZZTEST-NOTIFY self ${RUN}`, url: '/tasks',
    });
    assert('self-recipient: HTTP 200', status === 200, `HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`);
    assert('self-recipient: inserted 0 (actor excluded)', body?.inserted === 0, `inserted=${body?.inserted}`);
    const rows = await rowsFor(entityId);
    assert('self-recipient: no inbox row written', rows.length === 0, `found ${rows.length} row(s)`);
  });

  // ════ 2: task_assigned, recipients=[manager] → 200, inserted 1, visible to manager only ════
  await step('task_assigned: manager-recipient', async () => {
    const entityId = crypto.randomUUID();
    const { status, body } = await notifyCall(personas.user.jwt, {
      kind: 'task_assigned', entityType: 'task', entityId, buildingId: A,
      recipients: [personas.manager.id], title: `ZZTEST-NOTIFY manager ${RUN}`, url: '/tasks',
    });
    assert('manager-recipient: HTTP 200', status === 200, `HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`);
    assert('manager-recipient: inserted 1', body?.inserted === 1, `inserted=${body?.inserted}`);
    const rows = await registerCleanup(entityId);
    assert('manager-recipient: exactly one row written', rows.length === 1, `found ${rows.length} row(s)`);
    managerRowFilter = `entity_id=eq.${entityId}`;
    const managerCanSee = await canSelectF(personas.manager.jwt, 'notifications', managerRowFilter);
    assert('manager-recipient: visible via manager JWT', managerCanSee.length > 0, 'manager could not see own inbox row');
    const userCanSee = await canSelectF(personas.user.jwt, 'notifications', managerRowFilter);
    assert('manager-recipient: NOT visible via user JWT', userCanSee.length === 0, "actor could read the recipient's inbox row");
  });

  // ════ 3: buildingId the caller cannot access → 403 ════
  await step('buildingId the caller cannot access', async () => {
    const { status, body } = await notifyCall(personas.user.jwt, {
      kind: 'task_assigned', entityType: 'task', entityId: crypto.randomUUID(), buildingId: B,
      recipients: [personas.user.id], title: `ZZTEST-NOTIFY forbidden ${RUN}`, url: '/tasks',
    });
    assert('non-member building: HTTP 403', status === 403, `HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`);
  });

  // ════ 4: unknown kind → 400 ════
  await step('unknown kind', async () => {
    const { status, body } = await notifyCall(personas.user.jwt, {
      kind: 'not_a_real_kind', entityType: 'task', entityId: crypto.randomUUID(), buildingId: A,
      recipients: [personas.user.id], title: `ZZTEST-NOTIFY badkind ${RUN}`, url: '/tasks',
    });
    assert('unknown kind: HTTP 400', status === 400, `HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`);
  });

  // ════ 5: missing Authorization → 401 ════
  await step('missing Authorization', async () => {
    const { status, body } = await notifyCall(null, {
      kind: 'task_assigned', entityType: 'task', entityId: crypto.randomUUID(), buildingId: A,
      recipients: [personas.user.id], title: `ZZTEST-NOTIFY noauth ${RUN}`, url: '/tasks',
    });
    assert('missing Authorization: HTTP 401', status === 401, `HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`);
  });

  // ════ 6: report_submitted, recipients=[] → 200, inserted ≥1, org-wide resolves admins/managers ════
  await step('report_submitted: org-wide', async () => {
    const entityId = crypto.randomUUID();
    const { status, body } = await notifyCall(personas.user.jwt, {
      kind: 'report_submitted', entityType: 'report', entityId, buildingId: A,
      recipients: [], title: `ZZTEST-NOTIFY report ${RUN}`, url: '/reports/fortress',
    });
    assert('org-wide report_submitted: HTTP 200', status === 200, `HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`);
    assert('org-wide report_submitted: inserted >= 1', (body?.inserted ?? 0) >= 1, `inserted=${body?.inserted}`);
    const rows = await registerCleanup(entityId);
    const recipientIds = rows.map((r) => r.recipient_id);
    assert('org-wide report_submitted: reaches admin', recipientIds.includes(personas.admin.id), 'admin missing from resolved recipients');
    assert('org-wide report_submitted: reaches manager', recipientIds.includes(personas.manager.id), 'manager missing from resolved recipients');
    assert('org-wide report_submitted: excludes the acting user', !recipientIds.includes(personas.user.id), 'actor received their own org-wide notification');
  });

  // ════ 7: notifications RLS — recipient can mark their own row read; a non-recipient cannot ════
  await step('notifications RLS: mark-read', async () => {
    if (!managerRowFilter) {
      skip('mark-read as recipient', 'no manager row from step 2 to update');
      skip('mark-read as non-recipient', 'no manager row from step 2 to update');
      return;
    }
    const asManager = await updateF(personas.manager.jwt, 'notifications', managerRowFilter, { read_at: new Date().toISOString() });
    assert('mark read as recipient: request ok', asManager.ok, `HTTP ${asManager.status}`);
    assert('mark read as recipient: one row updated', asManager.rows.length === 1, `updated ${asManager.rows.length} row(s)`);
    assert('mark read as recipient: read_at set', !!asManager.rows[0]?.read_at, 'read_at still null after update');

    const asUser = await updateF(personas.user.jwt, 'notifications', managerRowFilter, { read_at: null });
    assert(
      'mark read as non-recipient: zero rows touched',
      asUser.ok && asUser.rows.length === 0,
      `HTTP ${asUser.status}, updated ${asUser.rows.length} row(s) — RLS did not scope to recipient`
    );
  });

  console.log('  notify function + inbox RLS: done');
} catch (e) {
  fail('smoke run', e.message);
} finally {
  // ════ Teardown (service role): rows (LIFO = children first), personas ════
  for (const [table, id] of cleanup.reverse()) await svcDelete(table, id);
  for (const uid of createdUsers) {
    await fetch(`${URL_BASE}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: SVC });
  }
  // sweep strays from earlier aborted runs
  const list = await (await fetch(`${URL_BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: SVC })).json();
  for (const u of list?.users ?? []) {
    if (u.email?.startsWith('zztest-notify-')) {
      await fetch(`${URL_BASE}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: SVC });
    }
  }
  // sweep stray ZZTEST-NOTIFY-* buildings from earlier aborted runs — their
  // notification rows cascade-delete with the building, so a killed run
  // self-heals here rather than accumulating.
  const strayBuildings = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-NOTIFY-*&select=id`, { headers: SVC })).json();
  for (const b of strayBuildings ?? []) {
    await fetch(`${URL_BASE}/rest/v1/buildings?id=eq.${b.id}`, { method: 'DELETE', headers: SVC });
  }
  // orphan check: nothing ZZTEST-NOTIFY-tagged may survive
  const leftBuildings = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-NOTIFY-*&select=id`, { headers: SVC })).json();
  const leftNotifs = await (await fetch(`${URL_BASE}/rest/v1/notifications?title=like.ZZTEST-NOTIFY*&select=id`, { headers: SVC })).json();
  if ((leftBuildings.length ?? 0) > 0 || (leftNotifs.length ?? 0) > 0) {
    console.error(`  WARN  teardown incomplete: ${leftBuildings.length} buildings, ${leftNotifs.length} notifications left (grep ZZTEST-NOTIFY)`);
  } else {
    console.log('  teardown: clean (no ZZTEST-NOTIFY remnants)');
  }
}

console.log(`\n${pass} passed, ${failures} failed, ${skips} skipped`);
for (const f of fails) console.error(`  FAIL  ${f}`);
console.log(failures === 0 ? 'NOTIFICATIONS SMOKE HOLDS' : 'NOTIFICATIONS SMOKE VIOLATIONS FOUND');
process.exit(failures === 0 ? 0 : 1);
