#!/usr/bin/env node
/**
 * Tenant intake smoke (R4c, spec §5.10) — the `tenant-intake` edge function end to end against
 * the live backend, with disposable fixtures it cleans up:
 *
 *   building + admin persona + site user assigned to it (the 'user' role rule → assignee)
 *   + one active tenant (shop 12) + an intake token (inserted with the service role exactly as
 *   the app's `intake_tokens` insert would) + the org flag features.tenant_intake switched ON
 *   →  GET /functions/v1/tenant-intake?t=<token> with NO credential (the way a phone opens the
 *   QR link)  →  POST multipart with one photo  →  issue row (source, reporter, reference,
 *   assigned_to, photo under intake/<building>/)  →  storage object exists  →  inbox rows kind
 *   issue_reported for the admin and the assignee  →  token counters  →  validation 400s
 *   →  honeypot 201 that stores nothing  →  429 on the 6th post from this IP+token  →  429 on the
 *   21st post for the token  →  recovery after the counters are cleared  →  disabled token 404
 *   →  flag off 404  →  405 for PUT.
 *
 * R4c review additions: the token rides on `?t=` for POST too (a POST without it is a 404 and the
 * body is never parsed), a POST that declares no content-length is a 411, rejected posts never
 * spend the token's 20/hour, and the GET lists shop NUMBERS only until
 * organizations.settings.intake.show_shop_names is true.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... node scripts/intake-smoke.mjs
 *
 * The function must be deployed with INTAKE_IP_SALT set. The smoke resets the `ip:*` counters
 * before it starts (a re-run inside the hour would otherwise open on a 429), which is one more
 * reason it refuses production (SUPABASE_URL containing qdzgkttiosahdfqresvz) unless
 * SMOKE_ALLOW_PROD=1 — the same guard as calendar-smoke. It also flips the org's
 * features.tenant_intake flag on and restores the previous settings afterwards.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}
const PROD_REF = 'qdzgkttiosahdfqresvz';
if (URL_BASE.includes(PROD_REF) && process.env.SMOKE_ALLOW_PROD !== '1') {
  console.error(`Refusing to run against production (SUPABASE_URL contains ${PROD_REF}): this smoke creates users, flips the org feature flag and clears rate counters. Set SMOKE_ALLOW_PROD=1 to override.`);
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Intake-Smoke-${RUN}!`;
const SVC = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const FN = `${URL_BASE}/functions/v1/tenant-intake`;
const REFERENCE_RE = /^FO-[A-Z2-7]{6}$/;
// A 1×1 JPEG. The function checks content type and size, not pixels; this keeps the upload real.
const JPEG_1PX = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==', 'base64');

let pass = 0, failures = 0;
const fails = [];
const ok = (n) => { pass++; console.log(`  PASS  ${n}`); };
const fail = (n, d) => { failures++; fails.push(`${n} — ${d}`); console.error(`  FAIL  ${n} — ${d}`); };
const assert = (n, cond, d) => (cond ? ok(n) : fail(n, d));

async function svcInsert(table, row) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}`, { method: 'POST', headers: { ...SVC, Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!res.ok) throw new Error(`fixture ${table}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}
async function svcSelect(table, filter) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { headers: SVC });
  if (!res.ok) throw new Error(`select ${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
async function svcPatch(table, filter, patch) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { method: 'PATCH', headers: { ...SVC, Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(`patch ${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
async function svcUpsert(table, row, onConflict) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?on_conflict=${onConflict}`, { method: 'POST', headers: { ...SVC, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row) });
  if (!res.ok) throw new Error(`upsert ${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}
async function svcDelete(table, filter) {
  await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: SVC });
}

const cleanup = [];   // [table, filter] LIFO
const userIds = [];
async function persona(tag, role, buildingId) {
  const email = `zztest-intake-${tag}-${RUN}@buildingops.app`;
  let res = await fetch(`${URL_BASE}/auth/v1/admin/users`, { method: 'POST', headers: SVC, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }) });
  const id = (await res.json()).id;
  if (!id) throw new Error(`persona ${tag} create failed`);
  userIds.push(id);
  await fetch(`${URL_BASE}/rest/v1/user_roles?on_conflict=user_id`, { method: 'POST', headers: { ...SVC, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: id, role }) });
  if (buildingId) await svcInsert('user_buildings', { user_id: id, building_id: buildingId });
  return { id, email };
}
const mintToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const hourStart = () => { const d = new Date(); d.setUTCMinutes(0, 0, 0); return d.toISOString(); };

/** Exactly what the public page sends: multipart, no apikey, no Authorization. */
function formData(token, over = {}, photos = []) {
  const fd = new FormData();
  const fields = { t: token, title: `ZZTEST intake ${RUN}`, description: 'The light in the passage is out', name: 'Thandi Tenant', shop_number: '12', phone: '0821234567', email: 'thandi@example.com', category: 'Lighting', website: '', ...over };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, String(v));
  for (const p of photos) fd.append('photos', new Blob([p.bytes], { type: p.type }), p.name);
  return fd;
}
async function get(token) {
  const res = await fetch(`${FN}?t=${encodeURIComponent(token)}`);
  return { status: res.status, headers: res.headers, body: await res.text() };
}
/** The token rides on the query as well as in the body: the function resolves it before parsing. */
async function post(fd, { token = fd.get('t'), init = {} } = {}) {
  const url = token === null ? FN : `${FN}?t=${encodeURIComponent(String(token))}`;
  const res = await fetch(url, { method: 'POST', body: fd, ...init });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, headers: res.headers, text, json };
}
/** The bucket row the token's own 20/hour allowance lives in, or null while it has not been spent. */
async function tokenBucketCount(tokenId) {
  const rows = await svcSelect('intake_rate', `bucket=eq.t:${tokenId}&select=count`);
  return rows[0]?.count ?? 0;
}

let orgId = null, orgSettingsBefore = null, building = null;
try {
  console.log(`intake-smoke vs ${URL_BASE} (run ${RUN})`);

  // ── setup ──
  await svcDelete('intake_rate', 'bucket=like.ip:*');   // a re-run inside the hour must not open on a 429
  building = (await svcInsert('buildings', { name: `ZZTEST-INTAKE-${RUN}` })).id;
  cleanup.push(['buildings', `id=eq.${building}`]);
  const admin = await persona('admin', 'admin');
  const site = await persona('site', 'user', building);
  await svcInsert('building_role_assignments', { building_id: building, role: 'user', user_id: site.id });
  const tenant = await svcInsert('building_tenants', { building_id: building, shop_number: '12', shop_name: `ZZTEST Shop ${RUN}`, unit_number: 'G12', is_active: true });
  cleanup.unshift(['building_tenants', `id=eq.${tenant.id}`]);
  const tokenRow = await svcInsert('intake_tokens', { building_id: building, token: mintToken(), created_by: admin.id, label: `ZZTEST ${RUN}` });
  cleanup.unshift(['intake_tokens', `id=eq.${tokenRow.id}`]);
  const orgs = await svcSelect('organizations', 'select=id,settings&limit=1');
  if (!orgs[0] || !('settings' in orgs[0])) throw new Error('organizations.settings is missing — apply the R4a migration (2026-09-14_01) first');
  orgId = orgs[0].id; orgSettingsBefore = orgs[0].settings ?? {};
  const withFlag = (on, showNames = false) => ({
    ...orgSettingsBefore,
    features: { ...(orgSettingsBefore.features ?? {}), tenant_intake: on },
    intake: { ...(orgSettingsBefore.intake ?? {}), show_shop_names: showNames },
  });
  await svcPatch('organizations', `id=eq.${orgId}`, { settings: withFlag(true) });
  ok('fixtures: building, admin, site user (role rule "user"), tenant 12, token, flag on');

  // ── 1. GET ──
  let r = await get('');
  assert('GET without token: 404', r.status === 404, `HTTP ${r.status}`);
  r = await get('garbage');
  assert('GET malformed token: 404', r.status === 404, `HTTP ${r.status}`);
  const unknown = await get(mintToken());
  assert('GET unknown token: 404 identical to malformed', unknown.status === 404 && unknown.body === r.body, `${unknown.status}/${unknown.body}`);
  r = await get(tokenRow.token);
  assert('GET good token: 200 JSON', r.status === 200 && (r.headers.get('content-type') ?? '').includes('application/json'), `HTTP ${r.status} ${r.body.slice(0, 120)}`);
  assert('GET: no-store', (r.headers.get('cache-control') ?? '').includes('no-store'), r.headers.get('cache-control'));
  const info = JSON.parse(r.body || '{}');
  assert('GET: building name, org branding, categories', info.building?.name === `ZZTEST-INTAKE-${RUN}` && typeof info.org?.name === 'string' && Array.isArray(info.categories) && info.categories.includes('Lighting'), JSON.stringify(info).slice(0, 200));
  // The GET is unauthenticated and the token is printed on a poster, so the tenant roster is
  // numbers-only unless the owner opts in: the shop NAME must not be in the default answer.
  assert('GET: shop 12 listed by number, no shop name (the default)', info.shops?.some((s) => s.shopNumber === '12' && !s.shopName) && !JSON.stringify(info).includes(`ZZTEST Shop ${RUN}`) && !JSON.stringify(info).includes(building), JSON.stringify(info.shops ?? []).slice(0, 200));
  await svcPatch('organizations', `id=eq.${orgId}`, { settings: withFlag(true, true) });
  const named = JSON.parse((await get(tokenRow.token)).body || '{}');
  assert('GET: shop names appear once settings.intake.show_shop_names is true', named.shops?.some((s) => s.shopNumber === '12' && s.shopName === `ZZTEST Shop ${RUN}`), JSON.stringify(named.shops ?? []).slice(0, 200));
  await svcPatch('organizations', `id=eq.${orgId}`, { settings: withFlag(true) });

  // ── 1b. POST guards that run BEFORE the body is parsed (neither spends the IP+token allowance) ──
  let p = await post(formData(tokenRow.token), { token: null });
  assert('POST with no ?t=: 404, body never parsed', p.status === 404 && p.json?.error === 'not_found', `HTTP ${p.status} ${p.text.slice(0, 120)}`);
  p = await post(formData(mintToken()), { token: mintToken() });
  assert('POST with an unknown token: 404', p.status === 404, `HTTP ${p.status} ${p.text.slice(0, 120)}`);
  p = await post(new FormData(), {
    token: tokenRow.token,
    init: {
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('--x--\r\n')); c.close(); } }),
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      duplex: 'half',
    },
  });
  assert('POST with a chunked body (no content-length): 411, body never parsed', p.status === 411, `HTTP ${p.status} ${p.text.slice(0, 120)}`);

  // ── 2. POST with a photo ──
  p = await post(formData(tokenRow.token, {}, [{ bytes: JPEG_1PX, type: 'image/jpeg', name: 'light.jpg' }]));
  assert('POST: 201', p.status === 201, `HTTP ${p.status} ${p.text.slice(0, 200)}`);
  const reference = p.json?.reference;
  assert('POST: reference FO-XXXXXX and nothing else', REFERENCE_RE.test(reference ?? '') && Object.keys(p.json ?? {}).length === 1, p.text.slice(0, 120));
  const issues = await svcSelect('issues', `reference=eq.${reference}&select=*`);
  const issue = issues[0];
  cleanup.unshift(['issues', `reference=eq.${reference}`]);
  assert('issue row: source tenant_intake, medium, open, category', issue && issue.source === 'tenant_intake' && issue.priority === 'medium' && issue.status === 'open' && issue.category === 'Lighting', JSON.stringify(issue ?? null).slice(0, 200));
  assert('issue row: reporter jsonb (name, shop from the tenant row, unit, phone, email)', issue?.reporter?.name === 'Thandi Tenant' && issue.reporter.shop === `ZZTEST Shop ${RUN}` && issue.reporter.shop_number === '12' && issue.reporter.unit === 'G12' && issue.reporter.phone === '0821234567' && issue.reporter.email === 'thandi@example.com', JSON.stringify(issue?.reporter));
  assert('issue row: reported_by = token creator, assigned_to = the building\'s "user" rule', issue?.reported_by === admin.id && issue?.assigned_to === site.id, `reported_by=${issue?.reported_by} assigned_to=${issue?.assigned_to}`);
  const photoUrl = issue?.photo_urls?.[0] ?? '';
  const photoPath = photoUrl.split('/object/public/tenant-documents/')[1] ?? '';
  assert('issue row: one photo under intake/<building>/', issue?.photo_urls?.length === 1 && photoPath.startsWith(`intake/${building}/`), photoUrl);
  const obj = await fetch(`${URL_BASE}/storage/v1/object/tenant-documents/${photoPath}`, { headers: SVC });
  assert('storage: the object exists', obj.ok && (obj.headers.get('content-type') ?? '').startsWith('image/jpeg'), `HTTP ${obj.status}`);
  const notes = await svcSelect('notifications', `entity_id=eq.${issue?.id}&kind=eq.issue_reported&select=recipient_id,url,title`);
  cleanup.unshift(['notifications', `entity_id=eq.${issue?.id}`]);
  const recipients = new Set(notes.map((n) => n.recipient_id));
  assert('notifications: issue_reported for the admin and the assignee, url /issues?open=<id>', recipients.has(admin.id) && recipients.has(site.id) && notes.every((n) => n.url === `/issues?open=${issue?.id}`), JSON.stringify(notes).slice(0, 200));
  const tok = (await svcSelect('intake_tokens', `id=eq.${tokenRow.id}&select=submissions_count,last_used_at`))[0];
  assert('token: submissions_count 1, last_used_at set', tok?.submissions_count === 1 && !!tok?.last_used_at, JSON.stringify(tok));

  // ── 3. validation (these count against the limits: 2, 3, 4 of 5 for this IP) ──
  p = await post(formData(tokenRow.token, { title: '' }));
  assert('POST missing title: 400 invalid[title]', p.status === 400 && p.json?.error === 'invalid' && p.json.fields?.includes('title'), `HTTP ${p.status} ${p.text.slice(0, 120)}`);
  p = await post(formData(tokenRow.token, { shop_number: '999' }));
  assert('POST unknown shop: 400 invalid[shop_number]', p.status === 400 && p.json?.fields?.includes('shop_number'), `HTTP ${p.status} ${p.text.slice(0, 120)}`);
  p = await post(formData(tokenRow.token, {}, Array.from({ length: 4 }, (_, i) => ({ bytes: JPEG_1PX, type: 'image/jpeg', name: `p${i}.jpg` }))));
  assert('POST four photos: 400 invalid[photos]', p.status === 400 && p.json?.fields?.includes('photos'), `HTTP ${p.status} ${p.text.slice(0, 120)}`);

  // ── 4. honeypot (5 of 5) ──
  p = await post(formData(tokenRow.token, { website: 'http://spam.example' }));
  assert('honeypot: 201 with a reference', p.status === 201 && REFERENCE_RE.test(p.json?.reference ?? ''), `HTTP ${p.status} ${p.text.slice(0, 120)}`);
  assert('honeypot: nothing stored', (await svcSelect('issues', `reference=eq.${p.json?.reference}&select=id`)).length === 0, 'an issue row exists for the honeypot reference');
  assert('honeypot: token counter untouched', (await svcSelect('intake_tokens', `id=eq.${tokenRow.id}&select=submissions_count`))[0]?.submissions_count === 1, 'submissions_count moved');
  // The token is printed on a poster: only the ONE stored submission may have spent its allowance,
  // never the three rejected posts, the honeypot, the 404s or the 411.
  assert('token allowance: spent once, by the stored submission only', await tokenBucketCount(tokenRow.id) === 1, `t:${tokenRow.id} count=${await tokenBucketCount(tokenRow.id)}`);

  // ── 5. per-IP-and-token limit: the 6th post this hour ──
  p = await post(formData(tokenRow.token));
  assert('6th POST from this IP for this token: 429 rate_limited + Retry-After', p.status === 429 && p.json?.error === 'rate_limited' && !!p.headers.get('retry-after'), `HTTP ${p.status} ${p.text.slice(0, 120)}`);
  // Keyed on address AND token, so a second building behind the same connection is unaffected.
  const other = await svcInsert('intake_tokens', { building_id: building, token: mintToken(), created_by: admin.id, label: `ZZTEST other ${RUN}` });
  cleanup.unshift(['intake_tokens', `id=eq.${other.id}`]);
  p = await post(formData(other.token, { title: `ZZTEST other token ${RUN}` }));
  assert('a different token from the same IP is not rate limited', p.status === 201, `HTTP ${p.status} ${p.text.slice(0, 120)}`);
  if (p.json?.reference) {
    cleanup.unshift(['issues', `reference=eq.${p.json.reference}`]);
    const row = (await svcSelect('issues', `reference=eq.${p.json.reference}&select=id`))[0];
    if (row?.id) cleanup.unshift(['notifications', `entity_id=eq.${row.id}`]);
  }

  // ── 6. per-token limit: counter forced to 20, ip counters cleared ──
  await svcDelete('intake_rate', 'bucket=like.ip:*');
  await svcUpsert('intake_rate', { bucket: `t:${tokenRow.id}`, window_start: hourStart(), count: 20 }, 'bucket,window_start');
  p = await post(formData(tokenRow.token));
  assert('21st POST for the token: 429', p.status === 429 && p.json?.error === 'rate_limited', `HTTP ${p.status} ${p.text.slice(0, 120)}`);
  await svcDelete('intake_rate', `bucket=eq.t:${tokenRow.id}`);
  const paragraphs = 'The light in the passage is out.\n\nIt has been out since Friday and the stairwell is dark.';
  p = await post(formData(tokenRow.token, { title: `ZZTEST second ${RUN}`, description: paragraphs }));
  assert('after clearing the counters: 201 again (no photo → photo_urls null)', p.status === 201 && REFERENCE_RE.test(p.json?.reference ?? ''), `HTTP ${p.status} ${p.text.slice(0, 120)}`);
  if (p.json?.reference) {
    cleanup.unshift(['issues', `reference=eq.${p.json.reference}`]);
    const second = (await svcSelect('issues', `reference=eq.${p.json.reference}&select=id,photo_urls,reference,description`))[0];
    if (second?.id) cleanup.unshift(['notifications', `entity_id=eq.${second.id}`]);   // the second submission notifies the real admins too
    assert('second issue: photo_urls null, distinct reference', second?.photo_urls === null && second.reference !== reference, JSON.stringify(second));
    assert('second issue: the description keeps its paragraph break', second?.description === paragraphs, JSON.stringify(second?.description));
  }

  // ── 7. disabled token, flag off, method ──
  await svcPatch('intake_tokens', `id=eq.${tokenRow.id}`, { is_active: false });
  r = await get(tokenRow.token);
  assert('disabled token: GET 404', r.status === 404, `HTTP ${r.status}`);
  p = await post(formData(tokenRow.token));
  assert('disabled token: POST 404', p.status === 404, `HTTP ${p.status}`);
  await svcPatch('intake_tokens', `id=eq.${tokenRow.id}`, { is_active: true });
  await svcPatch('organizations', `id=eq.${orgId}`, { settings: withFlag(false) });
  r = await get(tokenRow.token);
  assert('flag off: GET 404 even for an active token', r.status === 404, `HTTP ${r.status}`);
  await svcPatch('organizations', `id=eq.${orgId}`, { settings: withFlag(true) });
  const put = await fetch(FN, { method: 'PUT' });
  assert('PUT: 405 with Allow', put.status === 405 && (put.headers.get('allow') ?? '').includes('POST'), `HTTP ${put.status}`);
} catch (e) {
  fail('smoke run', e.message);
} finally {
  // storage objects for the fixture building
  const listed = await fetch(`${URL_BASE}/storage/v1/object/list/tenant-documents`, { method: 'POST', headers: SVC, body: JSON.stringify({ prefix: `intake/${building}`, limit: 100 }) }).then((r) => r.ok ? r.json() : []).catch(() => []);
  for (const o of listed ?? []) await fetch(`${URL_BASE}/storage/v1/object/tenant-documents/intake/${building}/${o.name}`, { method: 'DELETE', headers: SVC });
  for (const [table, filter] of cleanup) await svcDelete(table, filter);
  await svcDelete('intake_rate', 'bucket=like.ip:*');
  if (orgId && orgSettingsBefore !== null) await svcPatch('organizations', `id=eq.${orgId}`, { settings: orgSettingsBefore }).catch(() => {});
  for (const id of userIds) {
    await svcDelete('notifications', `recipient_id=eq.${id}`);
    await svcDelete('user_buildings', `user_id=eq.${id}`);
    await svcDelete('user_roles', `user_id=eq.${id}`);
    await fetch(`${URL_BASE}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: SVC });
  }
  const left = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-INTAKE-*&select=id`, { headers: SVC })).json();
  console.log((left.length ?? 0) === 0 ? '  teardown: clean' : `  WARN  ${left.length} ZZTEST-INTAKE buildings left`);
}

console.log(`\n${pass} passed, ${failures} failed`);
if (fails.length) for (const f of fails) console.log(`  - ${f}`);
console.log(failures === 0 ? 'TENANT INTAKE HOLDS' : 'TENANT INTAKE BROKEN');
process.exit(failures === 0 ? 0 : 1);
