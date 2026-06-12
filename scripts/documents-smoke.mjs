#!/usr/bin/env node
/**
 * Documents & certificates smoke — upload → signed-URL view → expiry-driven
 * renewal task generation, against the live backend with disposable fixtures.
 *
 *   building doc upload (documents/<bid>/…)  +  tenant doc upload
 *     (tenant-docs/<tid>/…) at the CORRECTED client paths  →
 *   record row  →  signed URL serves the file (private bucket)  →
 *   cert with expiry ≤ 60d  →  generate_certificate_renewal_tasks() makes a
 *   renewal task (idempotent on re-run)  →  lapsed cert → overdue task.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   node scripts/documents-smoke.mjs
 *
 * Upload paths mirror DocumentsTab / TenantDocumentsDialog after F-31 e/f.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Doc-Smoke-${RUN}!`;
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
// caller stamps dates (Date.now is unavailable in workflow ctx but fine here)
const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const cleanup = [];
const storageCleanup = [];
let userId = null, building = null, tenant = null;

try {
  console.log(`documents-smoke vs ${URL_BASE} (run ${RUN})`);

  building = (await svcInsert('buildings', { name: `ZZTEST-DOC-${RUN}` })).id;
  cleanup.push(['buildings', `id=eq.${building}`]);
  tenant = (await svcInsert('building_tenants', { building_id: building, name: `ZZTEST-DOC-tenant-${RUN}` })).id;
  cleanup.push(['building_tenants', `id=eq.${tenant}`]);

  const email = `zztest-doc-${RUN}@buildingops.app`;
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
  console.log('  setup: building + tenant + assigned site user + login');

  // ── step 1: building-doc upload at the corrected path ──
  const docPath = `documents/${building}/${RUN}-cert.pdf`; // DocumentsTab after F-31e
  let up = await fetch(`${URL_BASE}/storage/v1/object/tenant-documents/${docPath}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/pdf' }, body: `doc-smoke ${RUN}`,
  });
  if (up.ok) storageCleanup.push(`tenant-documents/${docPath}`);
  assert('building doc uploads to documents/<bid>/ (site user, own building)', up.ok, `HTTP ${up.status}`);

  // ── step 2: tenant-doc upload at the corrected path ──
  const tdPath = `tenant-docs/${tenant}/${RUN}-lease.pdf`; // TenantDocumentsDialog after F-31f
  up = await fetch(`${URL_BASE}/storage/v1/object/tenant-documents/${tdPath}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/pdf' }, body: `doc-smoke ${RUN}`,
  });
  if (up.ok) storageCleanup.push(`tenant-documents/${tdPath}`);
  assert('tenant doc uploads to tenant-docs/<tid>/ (site user, own building)', up.ok, `HTTP ${up.status}`);

  // ── step 3: record row + signed-URL display (private bucket) ──
  const publicStyle = `${URL_BASE}/storage/v1/object/public/tenant-documents/${docPath}`;
  const doc = await svcInsert('building_documents', {
    building_id: building, name: `ZZTEST-DOC Fire Cert ${RUN}`, document_type: 'fire_certificate',
    expiry_date: dayOffset(30), file_url: publicStyle, uploaded_by: userId,
  });
  cleanup.unshift(['building_documents', `id=eq.${doc.id}`]);
  const signed = await fetch(`${URL_BASE}/storage/v1/object/sign/tenant-documents/${docPath}`, {
    method: 'POST', headers: authed(jwt), body: JSON.stringify({ expiresIn: 60 }),
  });
  assert('document is viewable via signed URL (openStorageFile path)', signed.ok, `HTTP ${signed.status}`);
  const pub = await fetch(publicStyle);
  assert('stored public-style URL does NOT serve directly (private bucket)', !pub.ok, `public URL HTTP ${pub.status}`);

  // ── step 4: cert-renewal cron function — expiring cert makes a renewal task ──
  const callFn = async () => {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/generate_certificate_renewal_tasks`, { method: 'POST', headers: SVC });
    return r.ok ? await r.json() : null;
  };
  await callFn();
  const renewalQ = `building_id=eq.${building}&source_document_id=eq.${doc.id}&select=id,status,due_date,category`;
  let renewals = await (await fetch(`${URL_BASE}/rest/v1/task_instances?${renewalQ}`, { headers: SVC })).json();
  if (renewals.length) cleanup.unshift(['task_instances', `source_document_id=eq.${doc.id}`]);
  assert('expiring cert (≤60d) generates a renewal task', renewals.length === 1, `got ${renewals.length}`);
  assert('renewal task categorised statutory_certificates, due on expiry, pending',
    renewals[0]?.category === 'statutory_certificates' && renewals[0]?.due_date === dayOffset(30) && renewals[0]?.status === 'pending',
    JSON.stringify(renewals[0]));

  // idempotent re-run: still exactly one
  await callFn();
  renewals = await (await fetch(`${URL_BASE}/rest/v1/task_instances?${renewalQ}`, { headers: SVC })).json();
  assert('renewal generation is idempotent (no duplicate on re-run)', renewals.length === 1, `got ${renewals.length}`);

  // ── step 5: lapsed cert → overdue renewal task ──
  const lapsed = await svcInsert('building_documents', {
    building_id: building, name: `ZZTEST-DOC Lapsed COC ${RUN}`, document_type: 'electrical_coc',
    expiry_date: dayOffset(-5), file_url: null, uploaded_by: userId,
  });
  cleanup.unshift(['building_documents', `id=eq.${lapsed.id}`]);
  await callFn();
  const lapsedTask = await (await fetch(`${URL_BASE}/rest/v1/task_instances?source_document_id=eq.${lapsed.id}&select=status`, { headers: SVC })).json();
  if (lapsedTask.length) cleanup.unshift(['task_instances', `source_document_id=eq.${lapsed.id}`]);
  assert('lapsed cert generates an OVERDUE renewal task', lapsedTask[0]?.status === 'overdue', JSON.stringify(lapsedTask));
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
  const left = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-DOC-*&select=id`, { headers: SVC })).json();
  console.log((left.length ?? 0) === 0 ? '  teardown: clean' : `  WARN  ${left.length} ZZTEST-DOC buildings left`);
}

console.log(`\n${pass} passed, ${failures} failed`);
console.log(failures === 0 ? 'DOCUMENTS & CERTIFICATES JOURNEY HOLDS' : 'DOCUMENTS JOURNEY BROKEN');
process.exit(failures === 0 ? 0 : 1);
