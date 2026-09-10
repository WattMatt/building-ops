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
 *   [EXPIRING_ALERTS_SECRET=...] node scripts/notifications-smoke.mjs
 *
 * Checks POST /functions/v1/notify (supabase/functions/notify/index.ts):
 *   task_assigned, recipients=[self]              → 200, inserted 0, no inbox row (actor excluded)
 *   task_assigned, recipients=[manager]            → 200, inserted 1, row visible to manager only
 *   task_assigned, manager has a push subscription → 200, inserted 1, numeric `pushed`; the
 *                                                    subscription row survives (failed_at null or set)
 *   buildingId the caller cannot access            → 403
 *   unknown kind                                   → 400
 *   missing Authorization                          → 401
 *   report_submitted, recipients=[] (org-wide)     → 200, inserted ≥1, resolves admins/managers
 * …and the notifications table's own RLS: recipient can mark their row read,
 * a non-recipient's update touches zero rows.
 *
 * With EXPIRING_ALERTS_SECRET set (the same value as the edge function's secret), it also
 * checks POST /functions/v1/notify-expiring-alerts (supabase/functions/notify-expiring-alerts):
 *   building document expiring in 3 days, notifyAdmins:false → 200, inboxRows ≥ 1, exactly one
 *                                                    document_expiring row for the admin persona
 *   same call again                                → still exactly one (idempotent per day)
 *   also a tenant document expiring in 3 days      → one document_expiring row deep-linking to
 *                                                    `?tab=tenants`
 *   an asset warranty expiring in 5 days           → one document_expiring row with entity_type
 *                                                    asset deep-linking to `?tab=assets`
 * Without the secret that step is SKIPped, not failed.
 *
 * Step 9 — `mark_sla_breaches` (SQL, cron-shaped): an issue past its target → issue_sla_breached
 * rows for the assignee and every admin/manager; second call adds none; a site user is refused.
 * Inbox only; on a shared backend this also breaches any real overdue issue (inbox rows to real
 * admins; no email).
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
/** Persona-scoped RPC: `{ status, body }` with the JSON body (or null when the response is not JSON). */
async function rpcAs(jwt, fn, args) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: authed(jwt), body: JSON.stringify(args) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

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
      recipients: [personas.user.id], title: `ZZTEST-NOTIFY self ${RUN}`, url: `/buildings/${A}?tab=checklists`,
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
      recipients: [personas.manager.id], title: `ZZTEST-NOTIFY manager ${RUN}`, url: `/buildings/${A}?tab=checklists`,
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

  // ════ 2b: task_assigned with a push subscription on file → push fan-out never breaks the inbox ════
  // R2c: the shared sender reads push_subscriptions (failed_at null) for each recipient and
  // sends via web-push. This endpoint is well-formed but not a real subscription, so the push
  // service will reject it (404/410 → failed_at stamped) or the send will error some other way
  // (logged, failed_at left null). Either is acceptable — what must hold is that the inbox row
  // still lands and the function still answers 200 with a numeric `pushed` count.
  await step('task_assigned: recipient with a push subscription', async () => {
    const sub = await svcInsert('push_subscriptions', {
      user_id: personas.manager.id,
      endpoint: `https://updates.push.services.mozilla.com/wpush/v2/ZZTEST-${RUN}`,
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', // valid-shaped 65-byte P-256 point
      auth: 'tBHItJI5svbpez7KI4CCXg', // 16 bytes base64url
      user_agent: 'zztest',
    });
    cleanup.push(['push_subscriptions', sub.id]);

    const entityId = crypto.randomUUID();
    const { status, body } = await notifyCall(personas.user.jwt, {
      kind: 'task_assigned', entityType: 'task', entityId, buildingId: A,
      recipients: [personas.manager.id], title: `ZZTEST-NOTIFY push ${RUN}`, url: `/buildings/${A}?tab=checklists`,
    });
    assert('push fan-out does not break the inbox: HTTP 200', status === 200, `HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`);
    assert('push fan-out does not break the inbox: inserted 1', body?.inserted === 1, `inserted=${body?.inserted}`);
    const rows = await registerCleanup(entityId);
    assert('push fan-out does not break the inbox: inbox row written', rows.length === 1, `found ${rows.length} row(s)`);
    assert('notify reports a pushed count', typeof body?.pushed === 'number', `pushed=${JSON.stringify(body?.pushed)} (expected a number, 0 or 1)`);
    console.log(`  info: notify pushed=${body?.pushed}`);

    const after = await svcSelectF('push_subscriptions', `id=eq.${sub.id}`);
    assert('subscription row survives with failed_at null-or-set: row still exists', after.length === 1, `found ${after.length} row(s) after notify`);
    const failedAt = after[0]?.failed_at ?? null;
    assert(
      'subscription row survives with failed_at null-or-set: failed_at is null or a timestamp',
      failedAt === null || (typeof failedAt === 'string' && !Number.isNaN(Date.parse(failedAt))),
      `failed_at=${JSON.stringify(failedAt)}`
    );
    console.log(`  info: subscription failed_at ${failedAt === null ? 'is null (push not attempted, or send failed without 404/410)' : `= ${failedAt} (push service reported the subscription gone)`}`);
  });

  // ════ 3: buildingId the caller cannot access → 403 ════
  await step('buildingId the caller cannot access', async () => {
    const { status, body } = await notifyCall(personas.user.jwt, {
      kind: 'task_assigned', entityType: 'task', entityId: crypto.randomUUID(), buildingId: B,
      recipients: [personas.user.id], title: `ZZTEST-NOTIFY forbidden ${RUN}`, url: `/buildings/${B}?tab=checklists`,
    });
    assert('non-member building: HTTP 403', status === 403, `HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`);
  });

  // ════ 4: unknown kind → 400 ════
  await step('unknown kind', async () => {
    const { status, body } = await notifyCall(personas.user.jwt, {
      kind: 'not_a_real_kind', entityType: 'task', entityId: crypto.randomUUID(), buildingId: A,
      recipients: [personas.user.id], title: `ZZTEST-NOTIFY badkind ${RUN}`, url: `/buildings/${A}?tab=checklists`,
    });
    assert('unknown kind: HTTP 400', status === 400, `HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`);
  });

  // ════ 5: missing Authorization → 401 ════
  await step('missing Authorization', async () => {
    const { status, body } = await notifyCall(null, {
      kind: 'task_assigned', entityType: 'task', entityId: crypto.randomUUID(), buildingId: A,
      recipients: [personas.user.id], title: `ZZTEST-NOTIFY noauth ${RUN}`, url: `/buildings/${A}?tab=checklists`,
    });
    assert('missing Authorization: HTTP 401', status === 401, `HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`);
  });

  // ════ 6: report_submitted, recipients=[] → 200, inserted ≥1, org-wide resolves admins/managers ════
  await step('report_submitted: org-wide', async () => {
    const entityId = crypto.randomUUID();
    const { status, body } = await notifyCall(personas.user.jwt, {
      kind: 'report_submitted', entityType: 'report', entityId, buildingId: A,
      recipients: [], title: `ZZTEST-NOTIFY report ${RUN}`, url: `/reports/fortress/${entityId}`,
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

  // ════ 8: notify-expiring-alerts writes document_expiring inbox rows, once per entity per day ════
  // Cron-shaped function: authorised by `x-alerts-secret`, not a persona JWT. `notifyAdmins:false`
  // keeps its summary email off (the function documents that the flag governs the email only —
  // inbox rows are written regardless; only `dryRun` skips them). Note the function scans the
  // whole project, so on a shared backend it also writes today's rows for any real expiring
  // documents / overdue assets to the real admins and managers — inbox only, no email.
  await step('notify-expiring-alerts: inbox rows', async () => {
    const secret = process.env.EXPIRING_ALERTS_SECRET;
    if (!secret) {
      skip('expiring alerts inbox rows', 'EXPIRING_ALERTS_SECRET not set');
      return;
    }
    const expiry = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const doc = await svcInsert('building_documents', {
      building_id: A, name: `ZZTEST-NOTIFY-DOC-${RUN}`, document_type: 'Fire certificate', expiry_date: expiry,
    });
    cleanup.push(['building_documents', doc.id]);
    const tenant = await svcInsert('building_tenants', { building_id: A, name: `ZZTEST-NOTIFY-TENANT-${RUN}`, shop_name: 'Shop 1' });
    cleanup.push(['building_tenants', tenant.id]);
    const tdoc = await svcInsert('tenant_documents', { tenant_id: tenant.id, document_name: `ZZTEST-NOTIFY-TDOC-${RUN}`, document_type: 'Lease', expiry_date: expiry });
    cleanup.unshift(['tenant_documents', tdoc.id]);
    const warrantyExpiry = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const asset = await svcInsert('building_assets', { building_id: A, name: `ZZTEST-NOTIFY-ASSET-${RUN}`, category: 'HVAC', warranty_expiry: warrantyExpiry });
    cleanup.push(['building_assets', asset.id]);

    const call = async () => {
      const res = await fetch(`${URL_BASE}/functions/v1/notify-expiring-alerts`, {
        method: 'POST',
        headers: { 'x-alerts-secret': secret, apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyAdmins: false }),
      });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, body: json };
    };
    const adminRows = () => svcSelectF(
      'notifications',
      `kind=eq.document_expiring&entity_id=eq.${doc.id}&recipient_id=eq.${personas.admin.id}`,
    );

    const first = await call();
    assert('expiring alerts: HTTP 200', first.status === 200, `HTTP ${first.status} ${JSON.stringify(first.body).slice(0, 160)}`);
    assert('expiring alerts: inboxRows >= 1', (first.body?.inboxRows ?? 0) >= 1, `inboxRows=${JSON.stringify(first.body?.inboxRows)}`);
    console.log(`  info: expiring alerts inboxRows=${first.body?.inboxRows} alreadyToday=${first.body?.inboxAlreadyToday} failed=${first.body?.inboxFailed}`);
    await registerCleanup(doc.id); // every recipient's row for this document, LIFO before the document
    const rows = await adminRows();
    assert('expiring alerts: exactly one document_expiring row for the admin', rows.length === 1, `found ${rows.length} row(s)`);
    assert('expiring alerts: row deep-links to the building documents tab', rows[0]?.url === `/buildings/${A}?tab=documents`, `url=${rows[0]?.url}`);
    assert('expiring alerts: row title names the document', typeof rows[0]?.title === 'string' && rows[0].title.startsWith(`ZZTEST-NOTIFY-DOC-${RUN}`), `title=${rows[0]?.title}`);
    await registerCleanup(tdoc.id);
    await registerCleanup(asset.id);
    const tRows = await svcSelectF('notifications', `kind=eq.document_expiring&entity_id=eq.${tdoc.id}&recipient_id=eq.${personas.admin.id}`);
    assert('expiring alerts: one row for the tenant document', tRows.length === 1, `found ${tRows.length} row(s)`);
    assert('expiring alerts: tenant document deep-links to the tenants tab', tRows[0]?.url === `/buildings/${A}?tab=tenants`, `url=${tRows[0]?.url}`);
    const wRows = await svcSelectF('notifications', `kind=eq.document_expiring&entity_id=eq.${asset.id}&recipient_id=eq.${personas.admin.id}`);
    assert('expiring alerts: one row for the asset warranty', wRows.length === 1, `found ${wRows.length} row(s)`);
    assert('expiring alerts: warranty row is entity_type asset and links to the assets tab', wRows[0]?.entity_type === 'asset' && wRows[0]?.url === `/buildings/${A}?tab=assets`, JSON.stringify(wRows[0]));

    const second = await call();
    assert('expiring alerts re-run: HTTP 200', second.status === 200, `HTTP ${second.status} ${JSON.stringify(second.body).slice(0, 160)}`);
    assert('expiring alerts re-run: reports the row as already sent today', (second.body?.inboxAlreadyToday ?? 0) >= 1, `inboxAlreadyToday=${JSON.stringify(second.body?.inboxAlreadyToday)}`);
    const rowsAfter = await adminRows();
    assert('expiring alerts re-run: still exactly one row (idempotent per day)', rowsAfter.length === 1, `found ${rowsAfter.length} row(s)`);
  });

  // ════ 9: mark_sla_breaches writes issue_sla_breached rows for the assignee and every admin/manager ════
  await step('mark_sla_breaches: inbox rows', async () => {
    const issue = await svcInsert('issues', {
      building_id: A, title: `ZZTEST-NOTIFY-SLA-${RUN}`, description: 'sla smoke', priority: 'high',
      reported_by: personas.admin.id, assigned_to: personas.manager.id,
    });
    cleanup.push(['issues', issue.id]);
    // The trigger gave it the org default (24 h for high); push the target and the clock so it is past due.
    const patched = await fetch(`${URL_BASE}/rest/v1/issues?id=eq.${issue.id}`, {
      method: 'PATCH', headers: { ...SVC, Prefer: 'return=representation' },
      body: JSON.stringify({ sla_target_hours: 0.01, created_at: new Date(Date.now() - 3_600_000).toISOString() }),
    });
    assert('sla fixture: default target was 24 h before the patch', Number(issue.sla_target_hours) === 24, `sla_target_hours=${issue.sla_target_hours}`);
    assert('sla fixture: patched', patched.ok, `HTTP ${patched.status}`);
    const sweep = await rpcAs(personas.admin.jwt, 'mark_sla_breaches', {});
    assert('mark_sla_breaches as admin: HTTP 200', sweep.status === 200, `HTTP ${sweep.status}`);
    assert('mark_sla_breaches: at least one issue breached', Number(sweep.body) >= 1, `returned ${JSON.stringify(sweep.body)}`);
    await registerCleanup(issue.id);
    const forManager = await svcSelectF('notifications', `kind=eq.issue_sla_breached&entity_id=eq.${issue.id}&recipient_id=eq.${personas.manager.id}`);
    const forAdmin = await svcSelectF('notifications', `kind=eq.issue_sla_breached&entity_id=eq.${issue.id}&recipient_id=eq.${personas.admin.id}`);
    assert('sla breach: one row for the assignee (manager)', forManager.length === 1, `found ${forManager.length}`);
    assert('sla breach: one row for the admin', forAdmin.length === 1, `found ${forAdmin.length}`);
    assert('sla breach: row deep-links to the issue', forAdmin[0]?.url === `/issues?open=${issue.id}`, `url=${forAdmin[0]?.url}`);
    assert('sla breach: title names the issue', forAdmin[0]?.title === `SLA breached: ZZTEST-NOTIFY-SLA-${RUN}`, `title=${forAdmin[0]?.title}`);
    const beforeAgain = (await svcSelectF('notifications', `kind=eq.issue_sla_breached&entity_id=eq.${issue.id}`)).length;
    const again = await rpcAs(personas.admin.jwt, 'mark_sla_breaches', {});
    const afterAgain = (await svcSelectF('notifications', `kind=eq.issue_sla_breached&entity_id=eq.${issue.id}`)).length;
    assert('sla breach re-run: no new rows for the same issue', again.status === 200 && afterAgain === beforeAgain, `${beforeAgain} → ${afterAgain} rows`);
    const asUser = await rpcAs(personas.user.jwt, 'mark_sla_breaches', {});
    assert('mark_sla_breaches refused for a site user', asUser.status === 403, `HTTP ${asUser.status}`);
  });

  console.log('  notify function + inbox RLS + SLA sweep: done');
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
  // sweep stray ZZTEST-NOTIFY-* building documents first (step 8 fixture); they may
  // not cascade with their building. Same for the tenant document (step 8) — its tenant,
  // the asset and the issue (step 9) cascade with building A below.
  await fetch(`${URL_BASE}/rest/v1/building_documents?name=like.ZZTEST-NOTIFY-*`, { method: 'DELETE', headers: SVC });
  await fetch(`${URL_BASE}/rest/v1/tenant_documents?document_name=like.ZZTEST-NOTIFY-*`, { method: 'DELETE', headers: SVC });
  // sweep stray ZZTEST-NOTIFY-* buildings from earlier aborted runs — their
  // notification rows cascade-delete with the building, so a killed run
  // self-heals here rather than accumulating.
  const strayBuildings = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-NOTIFY-*&select=id`, { headers: SVC })).json();
  for (const b of strayBuildings ?? []) {
    await fetch(`${URL_BASE}/rest/v1/buildings?id=eq.${b.id}`, { method: 'DELETE', headers: SVC });
  }
  // sweep stray ZZTEST push subscriptions from earlier aborted runs (they cascade with the
  // persona's profile, but a run killed before persona deletion leaves them behind).
  await fetch(`${URL_BASE}/rest/v1/push_subscriptions?endpoint=like.*%2FZZTEST-*`, { method: 'DELETE', headers: SVC });
  // orphan check: nothing ZZTEST-NOTIFY-tagged may survive
  const leftBuildings = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-NOTIFY-*&select=id`, { headers: SVC })).json();
  const leftNotifs = await (await fetch(`${URL_BASE}/rest/v1/notifications?title=like.ZZTEST-NOTIFY*&select=id`, { headers: SVC })).json();
  const leftSubs = await (await fetch(`${URL_BASE}/rest/v1/push_subscriptions?endpoint=like.*%2FZZTEST-*&select=id`, { headers: SVC })).json();
  if ((leftBuildings.length ?? 0) > 0 || (leftNotifs.length ?? 0) > 0 || (leftSubs.length ?? 0) > 0) {
    console.error(`  WARN  teardown incomplete: ${leftBuildings.length} buildings, ${leftNotifs.length} notifications, ${leftSubs.length} push subscriptions left (grep ZZTEST-NOTIFY / ZZTEST-)`);
  } else {
    console.log('  teardown: clean (no ZZTEST-NOTIFY remnants)');
  }
}

console.log(`\n${pass} passed, ${failures} failed, ${skips} skipped`);
for (const f of fails) console.error(`  FAIL  ${f}`);
console.log(failures === 0 ? 'NOTIFICATIONS SMOKE HOLDS' : 'NOTIFICATIONS SMOKE VIOLATIONS FOUND');
process.exit(failures === 0 ? 0 : 1);
