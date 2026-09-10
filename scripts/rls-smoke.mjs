#!/usr/bin/env node
/**
 * RLS access-matrix smoke — proves row-level security holds for every role
 * against the live backend, using disposable personas and fixtures it
 * deletes afterwards. Companion to auth-smoke.mjs; run after schema or
 * policy changes, and after every deploy via `npm run smoke`.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   node scripts/rls-smoke.mjs
 *
 * Matrix encoded from production pg_policies as of 2026-06-12:
 *   admin/manager  → all buildings; manager lacks admin-only ops
 *                    (user_roles/user_buildings writes, profile/org deletes)
 *   user/reviewer  → restricted to user_buildings assignments
 *   storage        → prefix-scoped paths in tenant-documents; deletes
 *                    admin/manager only; avatars self-scoped
 *   R1 "Mine"      → task_instances.assigned_to writes follow building access;
 *                    building_members() only answers callers who can access the
 *                    building; notifications recipient-only, never client-inserted
 *
 * Personas: admin, manager, userA (user role, assigned building A only),
 * reviewerB (reviewer role, assigned building B only). userA probing
 * building B (and vice versa) is the cross-client leak test.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Rls-Smoke-${RUN}!`;
const SVC = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

let pass = 0, failures = 0, skips = 0;
const fails = [];
const ok = () => { pass++; };
const fail = (name, detail) => { failures++; fails.push(`${name} — ${detail}`); };
const skip = (name, why) => { skips++; console.log(`  SKIP  ${name} — ${why}`); };
const assert = (name, cond, detail) => (cond ? ok() : fail(name, detail));

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

// ── persona-scoped REST probes ──
function authed(jwt) { return { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }; }

async function canSelectF(jwt, table, filter) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}&select=*&limit=1`, { headers: authed(jwt) });
  if (!res.ok) return false;
  return (await res.json()).length > 0;
}
const canSelect = (jwt, table, id) => canSelectF(jwt, table, `id=eq.${id}`);
async function canInsert(jwt, table, row) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}`, {
    method: 'POST', headers: { ...authed(jwt), Prefer: 'return=representation' }, body: JSON.stringify(row),
  });
  if (res.status === 201) {
    const created = (await res.json())[0];
    if (created?.id) await svcDelete(table, created.id); // keep probes side-effect free
    return true;
  }
  return false;
}
async function canUpdateF(jwt, table, filter, patch) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers: { ...authed(jwt), Prefer: 'return=representation' }, body: JSON.stringify(patch),
  });
  if (!res.ok) return false;            // 403 = with_check violation
  return (await res.json()).length > 0; // 0 rows = filtered by USING = denied
}
const canUpdate = (jwt, table, id, patch) => canUpdateF(jwt, table, `id=eq.${id}`, patch);
async function canDelete(jwt, table, id) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?id=eq.${id}`, {
    method: 'DELETE', headers: { ...authed(jwt), Prefer: 'return=representation' },
  });
  if (!res.ok) return false;
  return (await res.json()).length > 0;
}
// SECURITY DEFINER RPCs: a denied caller is either an HTTP error (no EXECUTE
// grant) or an empty row set (the function's own access test failed), so report
// both rather than collapsing them into a boolean.
async function rpcCall(jwt, fn, args) {
  const headers = jwt ? authed(jwt) : { apikey: ANON, 'Content-Type': 'application/json' };
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers, body: JSON.stringify(args),
  });
  if (!res.ok) return { ok: false, status: res.status, rows: [] };
  const body = await res.json();
  return { ok: true, status: res.status, rows: Array.isArray(body) ? body : [body] };
}

async function storagePut(jwt, bucket, path) {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'text/plain' },
    body: `rls-smoke ${RUN}`,
  });
  return res.ok;
}
async function storageGet(jwt, bucket, path) {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
  });
  return res.ok;
}
async function storageDel(jwt, bucket, path) {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${path}`, {
    method: 'DELETE', headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
  });
  return res.ok;
}

// ── lifecycle state ──
const personas = {};            // key → {id, jwt, email}
const createdUsers = [];        // auth user ids, tracked the moment they exist
const cleanup = [];             // [table, id] service-side teardown, LIFO
const storageCleanup = [];      // [bucket, path]
let A = null, B = null;         // building ids

async function createPersona(key, role, buildingId) {
  const email = `zztest-rls-${key}-${RUN}@buildingops.app`;
  let res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: SVC,
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const user = await res.json();
  if (!res.ok || !user.id) throw new Error(`persona ${key}: ${JSON.stringify(user).slice(0, 120)}`);
  createdUsers.push(user.id); // track before any later step can throw
  // signup trigger may have seeded a default role — upsert, don't insert
  if (role) {
    res = await fetch(`${URL_BASE}/rest/v1/user_roles?on_conflict=user_id`, {
      method: 'POST', headers: { ...SVC, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: user.id, role }),
    });
    if (!res.ok) throw new Error(`persona ${key} role: HTTP ${res.status} ${await res.text()}`);
  } else {
    await fetch(`${URL_BASE}/rest/v1/user_roles?user_id=eq.${user.id}`, { method: 'DELETE', headers: SVC });
  }
  if (buildingId) await svcInsert('user_buildings', { user_id: user.id, building_id: buildingId });
  res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const session = await res.json();
  if (!session.access_token) throw new Error(`persona ${key} login: HTTP ${res.status}`);
  personas[key] = { id: user.id, jwt: session.access_token, email };
}

// expectation helpers: which personas may act on a row in building X
const ALL = ['admin', 'manager', 'userA', 'reviewerB'];
const adminMgr = () => ({ admin: true, manager: true, userA: false, reviewerB: false });
const adminOnly = () => ({ admin: true, manager: false, userA: false, reviewerB: false });
const anyAuth = () => ({ admin: true, manager: true, userA: true, reviewerB: true });
const nobody = () => ({ admin: false, manager: false, userA: false, reviewerB: false });
const byAccess = (bldg) => ({ admin: true, manager: true, userA: bldg === 'A', reviewerB: bldg === 'B' });

async function probeMatrix(label, expected, fn) {
  for (const who of ALL) {
    let got = await fn(personas[who].jwt, who);
    if (got !== expected[who]) { // storage API has rare transient denies — confirm before failing
      await new Promise((r) => setTimeout(r, 750));
      got = await fn(personas[who].jwt, who);
    }
    assert(`${label} as ${who}`, got === expected[who], `expected ${expected[who] ? 'ALLOW' : 'DENY'}, got ${got ? 'ALLOW' : 'DENY'}`);
  }
}

try {
  console.log(`rls-smoke vs ${URL_BASE} (run ${RUN})`);

  // ════ Phase 1: personas + fixture buildings ════
  A = (await svcInsert('buildings', { name: `ZZTEST-RLS-A-${RUN}` })).id;
  B = (await svcInsert('buildings', { name: `ZZTEST-RLS-B-${RUN}` })).id;
  cleanup.push(['buildings', A], ['buildings', B]);

  await createPersona('admin', 'admin');
  await createPersona('manager', 'manager');
  await createPersona('userA', 'user', A);
  await createPersona('reviewerB', 'reviewer', B);
  await createPersona('norole', null); // write-probe target only, never a client
  console.log('  setup: 2 buildings, 5 personas');

  // ════ Phase 2: building-scoped tables (direct building_id) ════
  // archetype: select/insert/update by building access, delete admin/manager
  const scoped = [
    ['building_assets', (b) => ({ building_id: b, name: `ZZTEST-RLS-${RUN}` }), { name: 'ZZTEST-RLS-upd' }],
    ['building_documents', (b) => ({ building_id: b, name: `ZZTEST-RLS-${RUN}` }), { name: 'ZZTEST-RLS-upd' }],
    ['building_notes', (b) => ({ building_id: b, content: `ZZTEST-RLS-${RUN}` }), { content: 'ZZTEST-RLS-upd' }],
    ['building_tenants', (b) => ({ building_id: b, name: `ZZTEST-RLS-${RUN}` }), { name: 'ZZTEST-RLS-upd' }],
    ['task_instances', (b) => ({ building_id: b, task_name: `ZZTEST-RLS-${RUN}`, due_date: '2030-01-01' }), { task_name: 'ZZTEST-RLS-upd' }],
    ['issues', (b, uid) => ({ building_id: b, title: `ZZTEST-RLS-${RUN}`, description: 'rls smoke', reported_by: uid }), { title: 'ZZTEST-RLS-upd' }],
    ['form_submissions', (b) => ({ building_id: b, form_name: `ZZTEST-RLS-${RUN}` }), null /* update is admin/mgr */],
  ];
  const rows = {}; // table → {A: id, B: id}
  for (const [table, make] of scoped) {
    rows[table] = {
      A: (await svcInsert(table, make(A, personas.admin.id))).id,
      B: (await svcInsert(table, make(B, personas.admin.id))).id,
    };
    cleanup.push([table, rows[table].A], [table, rows[table].B]);
  }

  for (const [table, make, patch] of scoped) {
    for (const bldg of ['A', 'B']) {
      const bid = bldg === 'A' ? A : B;
      await probeMatrix(`${table}[${bldg}] select`, byAccess(bldg), (jwt) => canSelect(jwt, table, rows[table][bldg]));
      await probeMatrix(`${table}[${bldg}] insert`, byAccess(bldg), (jwt, who) => canInsert(jwt, table, make(bid, personas[who].id)));
      const updExpected = table === 'form_submissions' ? adminMgr() : byAccess(bldg);
      await probeMatrix(`${table}[${bldg}] update`, updExpected, (jwt) => canUpdate(jwt, table, rows[table][bldg], patch ?? { form_name: 'ZZTEST-RLS-upd' }));
    }
    // deletes: site user must NOT delete even in own building; admin can (B row, A row stays for teardown)
    assert(`${table} delete as userA (own bldg)`, (await canDelete(personas.userA.jwt, table, rows[table].A)) === false, 'site user deleted a row');
    assert(`${table} delete as admin`, (await canDelete(personas.admin.jwt, table, rows[table].B)) === true, 'admin delete failed');
    console.log(`  ${table}: done`);
  }

  // buildings themselves: select by access, writes admin/manager
  await probeMatrix('buildings[A] select', byAccess('A'), (jwt) => canSelect(jwt, 'buildings', A));
  await probeMatrix('buildings[B] select', byAccess('B'), (jwt) => canSelect(jwt, 'buildings', B));
  await probeMatrix('buildings insert', adminMgr(), (jwt) => canInsert(jwt, 'buildings', { name: `ZZTEST-RLS-new-${RUN}` }));
  await probeMatrix('buildings update', adminMgr(), (jwt) => canUpdate(jwt, 'buildings', A, { name: `ZZTEST-RLS-A-${RUN}` }));
  console.log('  buildings: done');

  // ════ Phase 3: join-scoped tables ════
  const taskA = rows.task_instances.A;
  const tcA = (await svcInsert('task_completions', { task_instance_id: taskA, completed_by: personas.admin.id })).id;
  cleanup.push(['task_completions', tcA]);
  // one-completion-per-task unique index: insert probes need a completion-free task
  const taskA2 = (await svcInsert('task_instances', { building_id: A, task_name: `ZZTEST-RLS-tc-${RUN}`, due_date: '2030-01-02' })).id;
  cleanup.push(['task_instances', taskA2]);
  await probeMatrix('task_completions[A] select', byAccess('A'), (jwt) => canSelect(jwt, 'task_completions', tcA));
  await probeMatrix('task_completions[A] insert', byAccess('A'), (jwt, who) => canInsert(jwt, 'task_completions', { task_instance_id: taskA2, completed_by: personas[who].id }));
  await probeMatrix('task_completions update', adminMgr(), (jwt) => canUpdate(jwt, 'task_completions', tcA, { notes: 'ZZTEST-RLS-upd' }));

  const assetA = rows.building_assets.A;
  const ashA = (await svcInsert('asset_service_history', { asset_id: assetA, service_date: '2030-01-01' })).id;
  cleanup.push(['asset_service_history', ashA]);
  await probeMatrix('asset_service_history[A] select', byAccess('A'), (jwt) => canSelect(jwt, 'asset_service_history', ashA));
  await probeMatrix('asset_service_history[A] insert', byAccess('A'), (jwt) => canInsert(jwt, 'asset_service_history', { asset_id: assetA, service_date: '2030-01-02' }));
  await probeMatrix('asset_service_history[A] update', byAccess('A'), (jwt) => canUpdate(jwt, 'asset_service_history', ashA, { service_date: '2030-01-01' }));

  const tenantA = rows.building_tenants.A;
  const tdA = (await svcInsert('tenant_documents', { tenant_id: tenantA, document_name: `ZZTEST-RLS-${RUN}`, document_type: 'other' })).id;
  cleanup.push(['tenant_documents', tdA]);
  await probeMatrix('tenant_documents[A] select', byAccess('A'), (jwt) => canSelect(jwt, 'tenant_documents', tdA));
  await probeMatrix('tenant_documents[A] insert', byAccess('A'), (jwt) => canInsert(jwt, 'tenant_documents', { tenant_id: tenantA, document_name: `ZZTEST-RLS-${RUN}`, document_type: 'other' }));
  await probeMatrix('tenant_documents update', adminMgr(), (jwt) => canUpdate(jwt, 'tenant_documents', tdA, { document_name: 'ZZTEST-RLS-upd' }));

  const issueA = rows.issues.A;
  const iaA = (await svcInsert('issue_activity', { issue_id: issueA, activity_type: 'comment', user_id: personas.admin.id })).id;
  cleanup.push(['issue_activity', iaA]);
  await probeMatrix('issue_activity[A] select', byAccess('A'), (jwt) => canSelect(jwt, 'issue_activity', iaA));
  await probeMatrix('issue_activity[A] insert', byAccess('A'), (jwt, who) => canInsert(jwt, 'issue_activity', { issue_id: issueA, activity_type: 'comment', user_id: personas[who].id }));
  await probeMatrix('issue_activity update (no policy)', nobody(), (jwt) => canUpdate(jwt, 'issue_activity', iaA, { activity_type: 'comment' }));
  assert('issue_activity delete as manager (admin-only)', (await canDelete(personas.manager.jwt, 'issue_activity', iaA)) === false, 'manager deleted issue_activity');
  console.log('  join-scoped tables: done');

  // ════ Phase 4: org-global reference tables ════
  const contractor = (await svcInsert('contractors', { company_name: `ZZTEST-RLS-${RUN}` })).id;
  cleanup.push(['contractors', contractor]);
  const cdoc = (await svcInsert('contractor_documents', { contractor_id: contractor, document_type: 'other', document_name: `ZZTEST-RLS-${RUN}` })).id;
  cleanup.push(['contractor_documents', cdoc]);
  const template = (await svcInsert('checklist_templates', { name: `ZZTEST-RLS-${RUN}`, is_active: false })).id;
  cleanup.push(['checklist_templates', template]);
  const titem = (await svcInsert('template_items', { template_id: template, task_name: `ZZTEST-RLS-${RUN}` })).id;
  cleanup.push(['template_items', titem]);
  const media = (await svcInsert('media_attachments', { record_type: 'issue', record_id: issueA, storage_path: `photos/${personas.admin.id}/zztest-rls-${RUN}.txt` })).id;
  cleanup.push(['media_attachments', media]);

  const globals = [
    ['contractors', contractor, () => ({ company_name: `ZZTEST-RLS-${RUN}` }), { company_name: 'ZZTEST-RLS-upd' }, adminMgr()],
    ['contractor_documents', cdoc, () => ({ contractor_id: contractor, document_type: 'other', document_name: 'x' }), { document_name: 'ZZTEST-RLS-upd' }, adminMgr()],
    ['checklist_templates', template, () => ({ name: `ZZTEST-RLS-${RUN}`, is_active: false }), { description: 'ZZTEST-RLS-upd' }, adminMgr()],
    ['template_items', titem, () => ({ template_id: template, task_name: 'x' }), { task_name: `ZZTEST-RLS-${RUN}` }, adminMgr()],
    ['media_attachments', media, (who) => ({ record_type: 'issue', record_id: issueA, storage_path: `photos/${who}/x.txt` }), { record_type: 'issue' }, adminMgr()],
  ];
  for (const [table, id, make, patch, writeExp] of globals) {
    await probeMatrix(`${table} select`, anyAuth(), (jwt) => canSelect(jwt, table, id));
    const insExp = table === 'media_attachments' ? anyAuth() : writeExp;
    await probeMatrix(`${table} insert`, insExp, (jwt, who) => canInsert(jwt, table, make(personas[who].id)));
    await probeMatrix(`${table} update`, writeExp, (jwt) => canUpdate(jwt, table, id, patch));
    assert(`${table} delete as userA`, (await canDelete(personas.userA.jwt, table, id)) === false, 'site user deleted global row');
  }
  console.log('  global tables: done');

  // ════ Phase 5: identity tables ════
  // profiles: own row + admin/manager read; own update or admin
  await probeMatrix('profiles(userA) select', { admin: true, manager: true, userA: true, reviewerB: false }, (jwt) => canSelect(jwt, 'profiles', personas.userA.id));
  assert('profiles own update as userA', (await canUpdate(personas.userA.jwt, 'profiles', personas.userA.id, { full_name: 'ZZTEST RLS' })) === true, 'own-profile update failed');
  assert("profiles foreign update as manager (admin-only)", (await canUpdate(personas.manager.jwt, 'profiles', personas.userA.id, { full_name: 'X' })) === false, "manager updated someone else's profile");
  assert('profiles foreign update as admin', (await canUpdate(personas.admin.jwt, 'profiles', personas.userA.id, { full_name: 'ZZTEST RLS' })) === true, 'admin profile update failed');
  assert('profiles foreign insert as userA', (await canInsert(personas.userA.jwt, 'profiles', { id: crypto.randomUUID(), email: 'zz@x.co' })) === false, 'inserted foreign profile');
  skip('profiles own insert probe', 'row already exists via signup trigger');
  assert('profiles delete as manager (admin-only)', (await canDelete(personas.manager.jwt, 'profiles', personas.norole.id)) === false, 'manager deleted a profile');

  // user_roles / user_buildings: select own or admin/manager; writes admin-only
  // (user_roles is keyed by user_id — no id column)
  const urF = `user_id=eq.${personas.userA.id}`;
  await probeMatrix('user_roles(userA) select', { admin: true, manager: true, userA: true, reviewerB: false }, (jwt) => canSelectF(jwt, 'user_roles', urF));
  assert('user_roles insert as manager (admin-only)', (await canInsert(personas.manager.jwt, 'user_roles', { user_id: personas.norole.id, role: 'user' })) === false, 'manager wrote a role');
  assert('user_roles insert as admin', (await canInsert(personas.admin.jwt, 'user_roles', { user_id: personas.norole.id, role: 'user' })) === true, 'admin role insert failed');
  await fetch(`${URL_BASE}/rest/v1/user_roles?user_id=eq.${personas.norole.id}`, { method: 'DELETE', headers: SVC });
  assert('user_roles update as userA (own row!)', (await canUpdateF(personas.userA.jwt, 'user_roles', urF, { role: 'admin' })) === false, 'PRIVILEGE ESCALATION: user changed own role');

  const userAUB = await (await fetch(`${URL_BASE}/rest/v1/user_buildings?user_id=eq.${personas.userA.id}&select=id`, { headers: SVC })).json();
  await probeMatrix('user_buildings(userA) select', { admin: true, manager: true, userA: true, reviewerB: false }, (jwt) => canSelect(jwt, 'user_buildings', userAUB[0].id));
  assert('user_buildings insert as manager (admin-only)', (await canInsert(personas.manager.jwt, 'user_buildings', { user_id: personas.norole.id, building_id: A })) === false, 'manager wrote an assignment');
  assert('user_buildings self-grant as userA', (await canInsert(personas.userA.jwt, 'user_buildings', { user_id: personas.userA.id, building_id: B })) === false, 'PRIVILEGE ESCALATION: user granted self building B');
  assert('user_buildings insert as admin', (await canInsert(personas.admin.jwt, 'user_buildings', { user_id: personas.norole.id, building_id: A })) === true, 'admin assignment insert failed');

  // audit_logs: insert self-attributed only; read own or admin/manager; immutable
  const alOwn = (await svcInsert('audit_logs', { action: `zztest-rls-${RUN}`, user_id: personas.userA.id })).id;
  cleanup.push(['audit_logs', alOwn]);
  await probeMatrix('audit_logs(userA row) select', { admin: true, manager: true, userA: true, reviewerB: false }, (jwt) => canSelect(jwt, 'audit_logs', alOwn));
  assert('audit_logs self insert as userA', (await canInsert(personas.userA.jwt, 'audit_logs', { action: `zztest-rls-${RUN}`, user_id: personas.userA.id })) === true, 'self-attributed audit insert failed');
  assert('audit_logs spoofed insert as userA', (await canInsert(personas.userA.jwt, 'audit_logs', { action: `zztest-rls-${RUN}`, user_id: personas.admin.id })) === false, 'AUDIT SPOOF: wrote a log as another user');
  await probeMatrix('audit_logs update (immutable)', nobody(), (jwt) => canUpdate(jwt, 'audit_logs', alOwn, { action: `zztest-rls-${RUN}` }));
  assert('audit_logs delete as manager (admin-only)', (await canDelete(personas.manager.jwt, 'audit_logs', alOwn)) === false, 'manager deleted an audit row');

  // organizations: anon-readable; update admin/manager; insert/delete admin (allow-probe skipped: apps assume a single org row)
  const anonOrg = await fetch(`${URL_BASE}/rest/v1/organizations?select=id&limit=1`, { headers: { apikey: ANON } });
  assert('organizations anon read', anonOrg.ok, `HTTP ${anonOrg.status}`);
  const orgRows = await (await fetch(`${URL_BASE}/rest/v1/organizations?select=id,name&limit=1`, { headers: SVC })).json();
  if (orgRows.length) {
    await probeMatrix('organizations update', adminMgr(), (jwt) => canUpdate(jwt, 'organizations', orgRows[0].id, { name: orgRows[0].name }));
    assert('organizations insert as manager (admin-only)', (await canInsert(personas.manager.jwt, 'organizations', { name: 'ZZTEST-RLS' })) === false, 'manager created an org');
    assert('organizations delete as manager (admin-only)', (await canDelete(personas.manager.jwt, 'organizations', orgRows[0].id)) === false, 'manager deleted the org');
  } else skip('organizations write probes', 'no org row in this environment');
  skip('organizations insert/delete as admin', 'apps assume a single org row; not probed on a live backend');
  console.log('  identity tables: done');

  // ════ Phase 6: storage (tenant-documents prefixes + web buckets) ════
  const put = async (bucket, path) => { // service-side seed for read probes
    const r = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST', headers: { ...SVC, 'Content-Type': 'text/plain' }, body: 'rls-smoke' });
    if (!r.ok) throw new Error(`storage seed ${path}: ${r.status}`);
    storageCleanup.push([bucket, path]);
  };
  const TD = 'tenant-documents';
  await put(TD, `documents/${A}/zztest-rls-${RUN}.txt`);
  await put(TD, `documents/${B}/zztest-rls-${RUN}.txt`);
  await put(TD, `tenant-docs/${tenantA}/zztest-rls-${RUN}.txt`);
  await put(TD, `contractor-docs/zztest-rls-${RUN}.txt`);

  await probeMatrix('storage documents/<A> read', byAccess('A'), (jwt) => storageGet(jwt, TD, `documents/${A}/zztest-rls-${RUN}.txt`));
  await probeMatrix('storage documents/<B> read', byAccess('B'), (jwt) => storageGet(jwt, TD, `documents/${B}/zztest-rls-${RUN}.txt`));
  await probeMatrix('storage tenant-docs/<tenantA> read', byAccess('A'), (jwt) => storageGet(jwt, TD, `tenant-docs/${tenantA}/zztest-rls-${RUN}.txt`));
  await probeMatrix('storage contractor-docs read (admin/mgr-only since 2026-08-04_07)', adminMgr(), (jwt) => storageGet(jwt, TD, `contractor-docs/zztest-rls-${RUN}.txt`));

  for (const who of ALL) {
    const expA = byAccess('A')[who];
    const p = `documents/${A}/zztest-rls-w-${who}-${RUN}.txt`;
    const got = await storagePut(personas[who].jwt, TD, p);
    if (got) storageCleanup.push([TD, p]);
    assert(`storage documents/<A> write as ${who}`, got === expA, `expected ${expA ? 'ALLOW' : 'DENY'}`);
  }
  for (const who of ALL) {
    const expA = byAccess('A')[who];
    const p = `tenant-docs/${tenantA}/zztest-rls-w-${who}-${RUN}.txt`;
    const got = await storagePut(personas[who].jwt, TD, p);
    if (got) storageCleanup.push([TD, p]);
    assert(`storage tenant-docs/<tenantA> write as ${who}`, got === expA, `expected ${expA ? 'ALLOW' : 'DENY'}`);
  }
  const ownPhoto = `photos/${personas.userA.id}/zztest-rls-${RUN}.txt`;
  assert('storage photos/<own> write as userA', (await storagePut(personas.userA.jwt, TD, ownPhoto)) === true, 'own-photo upload failed');
  storageCleanup.push([TD, ownPhoto]);
  assert("storage photos/<other> write as userA", (await storagePut(personas.userA.jwt, TD, `photos/${personas.admin.id}/zztest-rls-${RUN}.txt`)) === false, "wrote into another user's photo folder");
  assert('storage contractor-docs write as userA (admin/mgr-only)', (await storagePut(personas.userA.jwt, TD, `contractor-docs/zztest-rls-x-${RUN}.txt`)) === false, 'site user wrote contractor doc');
  assert('storage delete as userA (admin/mgr-only)', (await storageDel(personas.userA.jwt, TD, ownPhoto)) === false, 'site user deleted a storage object');
  assert('storage delete as admin', (await storageDel(personas.admin.jwt, TD, `documents/${B}/zztest-rls-${RUN}.txt`)) === true, 'admin storage delete failed');
  storageCleanup.splice(storageCleanup.findIndex(([, p]) => p === `documents/${B}/zztest-rls-${RUN}.txt`), 1);

  // web buckets: avatars self-scoped (incl. self-delete), building-logos admin/manager
  const avatar = `${personas.userA.id}/zztest-rls-${RUN}.txt`;
  assert('storage avatars/<own> write as userA', (await storagePut(personas.userA.jwt, 'avatars', avatar)) === true, 'own avatar upload failed');
  assert("storage avatars/<other> write as userA", (await storagePut(personas.userA.jwt, 'avatars', `${personas.admin.id}/zztest-rls-${RUN}.txt`)) === false, "wrote another user's avatar");
  assert('storage avatars self-delete as userA', (await storageDel(personas.userA.jwt, 'avatars', avatar)) === true, 'own avatar delete failed');
  assert('storage building-logos write as userA (admin/mgr-only)', (await storagePut(personas.userA.jwt, 'building-logos', `zztest-rls-${RUN}.txt`)) === false, 'site user wrote building logo');
  console.log('  storage: done');

  // ════ Phase 7: R1 "Mine" — assignee, member directory, inbox ════
  // Phase 2 deleted the building-B row of every scoped table (admin delete probe),
  // so the cross-building assign probe needs a fresh task in B.
  const taskB = (await svcInsert('task_instances', { building_id: B, task_name: `ZZTEST-RLS-r1-${RUN}`, due_date: '2030-01-03' })).id;
  cleanup.push(['task_instances', taskB]);
  await probeMatrix('task_instances[A] assign', byAccess('A'), (jwt, who) => canUpdate(jwt, 'task_instances', rows.task_instances.A, { assigned_to: personas[who].id }));
  await probeMatrix('task_instances[B] assign', byAccess('B'), (jwt, who) => canUpdate(jwt, 'task_instances', taskB, { assigned_to: personas[who].id }));

  // building_members(b): SECURITY DEFINER, so its own can_access_building(b) gate
  // is the whole boundary — a non-member must get an empty list, not a roster.
  const membersA = await rpcCall(personas.userA.jwt, 'building_members', { b: A });
  assert('building_members(A) callable by member userA', membersA.ok, `HTTP ${membersA.status}`);
  assert('building_members(A) lists the caller', membersA.rows.some((m) => m.id === personas.userA.id), 'member missing from own building roster');
  assert('building_members(A) lists admin and manager', membersA.rows.some((m) => m.id === personas.admin.id) && membersA.rows.some((m) => m.id === personas.manager.id), 'admin/manager missing from roster');
  assert('building_members(A) excludes reviewerB (building B only)', !membersA.rows.some((m) => m.id === personas.reviewerB.id), 'LEAK: unassigned user listed as a building A member');
  // norole has no user_buildings row by default, so excluding them proves nothing about
  // the exists(user_roles) guard on its own — give them a real user_buildings(A) row
  // (so the membership test itself would pass) and confirm they are STILL excluded.
  const noroleUB = await svcInsert('user_buildings', { user_id: personas.norole.id, building_id: A });
  cleanup.push(['user_buildings', noroleUB.id]);
  const membersAWithNorole = await rpcCall(personas.userA.jwt, 'building_members', { b: A });
  assert('building_members(A) excludes the role-less persona', !membersAWithNorole.rows.some((m) => m.id === personas.norole.id), 'user with no role row listed as a member despite a user_buildings row (exists(user_roles) guard broken)');
  await svcDelete('user_buildings', noroleUB.id);
  cleanup.splice(cleanup.findIndex(([t, id]) => t === 'user_buildings' && id === noroleUB.id), 1);
  assert('building_members(A) returns one row per person', new Set(membersA.rows.map((m) => m.id)).size === membersA.rows.length, 'duplicate people (multi-row user_roles joined, not EXISTS-tested)');
  assert('building_members(A) resolves a role for everyone', membersA.rows.every((m) => typeof m.role === 'string' && m.role.length > 0), 'null role returned');
  const membersB = await rpcCall(personas.userA.jwt, 'building_members', { b: B });
  assert('building_members(B) empty for non-member userA', (membersB.rows ?? []).length === 0, 'LEAK: non-member read a foreign building roster');
  const membersRev = await rpcCall(personas.reviewerB.jwt, 'building_members', { b: B });
  assert('building_members(B) callable by reviewerB', membersRev.ok && membersRev.rows.some((m) => m.id === personas.reviewerB.id), 'reviewer missing from own building roster');
  const membersAnon = await rpcCall(null, 'building_members', { b: A });
  // An empty 200 (function ran, returned no rows) does NOT prove the EXECUTE revoke —
  // only a real HTTP denial does. Assert the status itself is not 200.
  assert('building_members not executable by anon', membersAnon.status === 401 || membersAnon.status === 403, `expected HTTP 401/403 (revoked grant), got HTTP ${membersAnon.status}`);

  // notifications: recipient-only select/update, no client insert policy at all.
  await probeMatrix('notifications insert (no client policy)', nobody(), (jwt, who) => canInsert(jwt, 'notifications', {
    recipient_id: personas[who].id, kind: 'task_assigned', entity_type: 'task', title: `ZZTEST-RLS-${RUN}`, url: '/tasks',
  }));
  const notifA = (await svcInsert('notifications', {
    recipient_id: personas.userA.id, kind: 'task_assigned', entity_type: 'task',
    entity_id: rows.task_instances.A, building_id: A, title: `ZZTEST-RLS-${RUN}`, url: '/tasks',
  })).id;
  cleanup.push(['notifications', notifA]);
  // Recipient-only, so admin/manager see nothing here — deliberately unlike every other table.
  await probeMatrix('notifications(userA row) select', { admin: false, manager: false, userA: true, reviewerB: false }, (jwt) => canSelect(jwt, 'notifications', notifA));
  assert('notifications own update (mark read) as userA', (await canUpdate(personas.userA.jwt, 'notifications', notifA, { read_at: new Date().toISOString() })) === true, 'recipient could not mark own notification read');
  assert('notifications foreign update as admin', (await canUpdate(personas.admin.jwt, 'notifications', notifA, { read_at: null })) === false, "admin updated another recipient's notification");
  assert('notifications recipient reassign as userA', (await canUpdate(personas.userA.jwt, 'notifications', notifA, { recipient_id: personas.admin.id })) === false, 'recipient handed their notification to someone else');
  assert('notifications delete as userA (no delete policy)', (await canDelete(personas.userA.jwt, 'notifications', notifA)) === false, 'recipient deleted a notification row');
  assert('notifications delete as admin (no delete policy)', (await canDelete(personas.admin.jwt, 'notifications', notifA)) === false, 'admin deleted a notification row');

  // ── R2a: RPC executability + push_subscriptions ownership ──
  // An empty 200 never proves a revoked grant — only a real HTTP denial does.
  for (const [fn, args] of [
    ['generate_scheduled_tasks', {}],
    ['complete_task', { p_completion_id: crypto.randomUUID(), p_task_instance_id: rows.task_instances.A }],
    ['search_entities', { q: 'zz' }],
    ['mark_overdue_tasks', {}],
  ]) {
    const r = await rpcCall(null, fn, args);
    assert(`${fn} not executable by anon`, r.status === 401 || r.status === 403, `expected HTTP 401/403 (revoked grant), got HTTP ${r.status}`);
  }
  // 403 exactly: PostgREST maps a revoked EXECUTE (42501) to 403 for a signed-in caller, and a
  // looser `!== 200` would let a 404 from a missing function pass.
  {
    const r = await rpcCall(personas.admin.jwt, 'mark_overdue_tasks', {});
    assert('mark_overdue_tasks not executable by authenticated', r.status === 403, `expected HTTP 403 (revoked grant), got HTTP ${r.status}`);
  }
  {
    const r = await rpcCall(personas.userA.jwt, 'generate_scheduled_tasks', { p_building: A });
    assert('generate_scheduled_tasks refused for a site user', r.status === 403, `expected HTTP 403 (raised 42501), got HTTP ${r.status}`);
  }
  // Only the nightly cron (null uid) may generate for every building at once; a signed-in
  // manager omitting p_building would otherwise fan out across buildings they cannot access.
  {
    const r = await rpcCall(personas.manager.jwt, 'generate_scheduled_tasks', {});
    assert('generate_scheduled_tasks refused without a building for a signed-in manager', r.status === 403, `expected HTTP 403 (raised 42501), got HTTP ${r.status}`);
  }
  // Inserts real task_instances for building A from every active unscoped template on the
  // project; the teardown deletes generated rows for A/B before the buildings themselves.
  assert('generate_scheduled_tasks runs for admin', (await rpcCall(personas.admin.jwt, 'generate_scheduled_tasks', { p_building: A })).status === 200, 'admin generate failed');
  assert('search_entities runs for a site user', (await rpcCall(personas.userA.jwt, 'search_entities', { q: 'ZZTEST' })).status === 200, 'search failed');
  const psA = (await svcInsert('push_subscriptions', { user_id: personas.userA.id, endpoint: `https://push.example/${RUN}-a`, p256dh: 'x', auth: 'y' })).id;
  cleanup.push(['push_subscriptions', psA]);
  // Owner-only, like notifications: admin/manager see nothing here.
  await probeMatrix('push_subscriptions(userA row) select', { admin: false, manager: false, userA: true, reviewerB: false }, (jwt) => canSelect(jwt, 'push_subscriptions', psA));
  // canInsert deletes what it creates, so the -b row needs no cleanup entry.
  assert('push_subscriptions insert own as userA', (await canInsert(personas.userA.jwt, 'push_subscriptions', { user_id: personas.userA.id, endpoint: `https://push.example/${RUN}-b`, p256dh: 'x', auth: 'y' })) === true, 'user could not register their device');
  assert('push_subscriptions insert for someone else as userA', (await canInsert(personas.userA.jwt, 'push_subscriptions', { user_id: personas.admin.id, endpoint: `https://push.example/${RUN}-c`, p256dh: 'x', auth: 'y' })) === false, 'user registered a device for another user');
  assert('push_subscriptions delete own as userA', (await canDelete(personas.userA.jwt, 'push_subscriptions', psA)) === true, 'user could not remove their device');
  console.log('  R1 mine (assignee, building_members, notifications): done');
} catch (e) {
  fail('smoke run', e.message);
} finally {
  // ════ Teardown (service role): storage, rows (LIFO = children first), personas ════
  for (const [bucket, path] of storageCleanup) {
    await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${path}`, { method: 'DELETE', headers: SVC });
  }
  // generate_scheduled_tasks (R2a probe) inserted template-backed task_instances for A/B that
  // no cleanup entry names — remove them before the buildings themselves are deleted.
  if (A || B) {
    await fetch(`${URL_BASE}/rest/v1/task_instances?building_id=in.(${[A, B].filter(Boolean).join(',')})&template_item_id=not.is.null`, { method: 'DELETE', headers: SVC });
  }
  for (const [table, id] of cleanup.reverse()) await svcDelete(table, id);
  for (const uid of createdUsers) {
    await fetch(`${URL_BASE}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: SVC });
  }
  // sweep strays from earlier aborted runs
  const list = await (await fetch(`${URL_BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: SVC })).json();
  for (const u of list?.users ?? []) {
    if (u.email?.startsWith('zztest-rls-')) {
      await fetch(`${URL_BASE}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: SVC });
    }
  }
  // orphan check: nothing ZZTEST-RLS-tagged may survive
  const leftBuildings = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-RLS-*&select=id`, { headers: SVC })).json();
  const leftProfiles = await (await fetch(`${URL_BASE}/rest/v1/profiles?email=like.zztest-rls-*&select=id`, { headers: SVC })).json();
  if ((leftBuildings.length ?? 0) > 0 || (leftProfiles.length ?? 0) > 0) {
    console.error(`  WARN  teardown incomplete: ${leftBuildings.length} buildings, ${leftProfiles.length} profiles left (grep ZZTEST-RLS)`);
  } else {
    console.log('  teardown: clean (no ZZTEST-RLS remnants)');
  }
}

console.log(`\n${pass} passed, ${failures} failed, ${skips} skipped`);
for (const f of fails) console.error(`  FAIL  ${f}`);
console.log(failures === 0 ? 'RLS MATRIX HOLDS' : 'RLS MATRIX VIOLATIONS FOUND');
process.exit(failures === 0 ? 0 : 1);
