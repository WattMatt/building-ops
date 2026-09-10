#!/usr/bin/env node
/**
 * Calendar feed smoke — the `ics-feed` edge function end to end against the live backend,
 * with disposable fixtures it cleans up:
 *
 *   buildings A and B  →  site user assigned to A  →  two pending tasks in A, one in B  →
 *   user token (minted with the service role, exactly as the app's `calendar_tokens` insert
 *   would)  →  GET /functions/v1/ics-feed?t=<token> with NO other credential, the way
 *   Outlook / Google / Apple Calendar fetch it.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   node scripts/calendar-smoke.mjs
 *
 * What it proves:
 *   - a USER token serves the owner's buildings only: A's task UIDs present, B's absent
 *     (no cross-building leakage), `text/calendar`, an `X-WR-CALNAME` line;
 *   - a BUILDING token for A serves both A tasks and nothing from B;
 *   - a building token for B — a building the owner cannot access — is a 404, even though
 *     the token row exists (the feed applies the OWNER's access, not the token's);
 *   - a revoked token is a 404; a malformed token and a well-formed unknown token are 404s
 *     that look identical (nothing reveals whether a token exists).
 *
 * The feed function must be deployed on the target project. This creates and deletes real
 * users and rows, so it refuses production (SUPABASE_URL containing the prod ref
 * qdzgkttiosahdfqresvz) unless SMOKE_ALLOW_PROD=1 — same guard as notifications-smoke.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}

// Refuse to run against production: the fixtures are real auth users, buildings and tasks.
const PROD_REF = 'qdzgkttiosahdfqresvz';
if (URL_BASE.includes(PROD_REF) && process.env.SMOKE_ALLOW_PROD !== '1') {
  console.error(
    `Refusing to run against production (SUPABASE_URL contains ${PROD_REF}): ` +
    'this smoke creates and deletes auth users, buildings, tasks and calendar tokens. ' +
    'Set SMOKE_ALLOW_PROD=1 to override.'
  );
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Cal-Smoke-${RUN}!`;
const SVC = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

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

const cleanup = [];       // [table, filter] LIFO
const userIds = [];       // disposable users, torn down after the rows that reference them

/** A confirmed user with `role`, optionally assigned to `buildingId`, signed in. Registered for teardown. */
async function persona(tag, role, buildingId) {
  const email = `zztest-cal-${tag}-${RUN}@buildingops.app`;
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

/** Today's `YYYY-MM-DD` in the operating timezone — inside every window the feed applies. */
const sastToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** What the app's `mintToken()` produces: base64url of 32 random bytes (43 chars, no padding). */
const mintToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
};

/** Insert a `calendar_tokens` row as the service role (the app does this as the signed-in owner). */
async function issueToken(userId, buildingId, label) {
  const token = mintToken();
  const row = await svcInsert('calendar_tokens', { user_id: userId, building_id: buildingId, token, label });
  cleanup.unshift(['calendar_tokens', `id=eq.${row.id}`]);
  return { id: row.id, token };
}

/** GET the feed exactly as a calendar client would: no apikey, no Authorization. */
async function feed(token) {
  const res = await fetch(`${URL_BASE}/functions/v1/ics-feed?t=${encodeURIComponent(token)}`);
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
}
const uidLine = (taskId) => `UID:task-${taskId}@buildingops.app`;
/** Unfold RFC 5545 continuation lines so a UID or header line can be matched whole. */
const unfold = (ics) => ics.replace(/\r\n[ \t]/g, '');

try {
  console.log(`calendar-smoke vs ${URL_BASE} (run ${RUN})`);

  // ── setup: buildings A and B, a site user on A, pending tasks in both ──
  const buildingA = (await svcInsert('buildings', { name: `ZZTEST-CAL-A-${RUN}` })).id;
  cleanup.push(['buildings', `id=eq.${buildingA}`]);
  const buildingB = (await svcInsert('buildings', { name: `ZZTEST-CAL-B-${RUN}` })).id;
  cleanup.push(['buildings', `id=eq.${buildingB}`]);

  const { id: userId } = await siteUser('a', buildingA);

  const today = sastToday();
  const mkTask = async (buildingId, label) => {
    const t = await svcInsert('task_instances', {
      building_id: buildingId, task_name: `ZZTEST-CAL ${label} ${RUN}`, due_date: today, status: 'pending', frequency: 'monthly',
    });
    cleanup.unshift(['task_instances', `id=eq.${t.id}`]);
    return t.id;
  };
  const taskA1 = await mkTask(buildingA, 'A1');
  const taskA2 = await mkTask(buildingA, 'A2');
  const taskB1 = await mkTask(buildingB, 'B1');
  ok('fixtures: buildings A + B, site user assigned to A, two pending tasks in A and one in B');

  // ── 1. user token: the owner's buildings only ──
  const userTok = await issueToken(userId, null, `ZZTEST user ${RUN}`);
  let r = await feed(userTok.token);
  assert('user token: HTTP 200', r.status === 200, `HTTP ${r.status} ${r.body.slice(0, 200)}`);
  assert('user token: Content-Type is text/calendar', r.type.startsWith('text/calendar'), `content-type=${r.type}`);
  let ics = unfold(r.body);
  assert('user token: X-WR-CALNAME line present', /^X-WR-CALNAME:.+$/m.test(ics), 'no X-WR-CALNAME line');
  assert('user token: task A1 UID present', ics.includes(uidLine(taskA1)), `missing ${uidLine(taskA1)}`);
  assert('user token: task A2 UID present', ics.includes(uidLine(taskA2)), `missing ${uidLine(taskA2)}`);
  assert('user token: task B1 UID absent (no cross-building leakage)', !ics.includes(uidLine(taskB1)), `found ${uidLine(taskB1)} — a site user\'s feed served another building`);
  assert('user token: document is a VCALENDAR with CRLF endings', ics.startsWith('BEGIN:VCALENDAR\r\n') && r.body.endsWith('END:VCALENDAR\r\n'), r.body.slice(0, 60));

  // ── 2. building token for A: both A tasks, nothing from B ──
  const bldTokA = await issueToken(userId, buildingA, `ZZTEST building A ${RUN}`);
  r = await feed(bldTokA.token);
  assert('building token (A): HTTP 200 text/calendar', r.status === 200 && r.type.startsWith('text/calendar'), `HTTP ${r.status} content-type=${r.type}`);
  ics = unfold(r.body);
  assert('building token (A): both A task UIDs present', ics.includes(uidLine(taskA1)) && ics.includes(uidLine(taskA2)), 'an A task is missing');
  assert('building token (A): task B1 UID absent', !ics.includes(uidLine(taskB1)), `found ${uidLine(taskB1)}`);
  assert('building token (A): calendar is named after the building', ics.includes(`X-WR-CALNAME:Building Ops · ZZTEST-CAL-A-${RUN}`), (ics.match(/^X-WR-CALNAME:.*$/m) ?? ['no X-WR-CALNAME'])[0]);

  // ── 3. building token for B, which the owner cannot access: 404 despite the row existing ──
  const bldTokB = await issueToken(userId, buildingB, `ZZTEST building B ${RUN}`);
  r = await feed(bldTokB.token);
  assert('building token (B, owner has no access): HTTP 404', r.status === 404, `HTTP ${r.status} — the feed served a building the owner cannot access`);
  assert('building token (B): body carries no calendar', !r.body.includes('VCALENDAR'), 'a VCALENDAR came back with the 404');

  // ── 4. revoked user token: 404 ──
  await svcPatch('calendar_tokens', `id=eq.${userTok.id}`, { revoked_at: new Date().toISOString() });
  r = await feed(userTok.token);
  assert('revoked user token: HTTP 404', r.status === 404, `HTTP ${r.status} — a revoked token still serves`);

  // ── 5. garbage and unknown tokens: the same 404 ──
  r = await feed('garbage');
  assert('malformed token: HTTP 404', r.status === 404, `HTTP ${r.status}`);
  const unknown = await feed(mintToken()); // well-formed, never issued
  assert('well-formed unknown token: HTTP 404', unknown.status === 404, `HTTP ${unknown.status}`);
  assert('malformed and unknown tokens answer identically', r.status === unknown.status && r.body === unknown.body, `${r.status}/${JSON.stringify(r.body)} vs ${unknown.status}/${JSON.stringify(unknown.body)}`);
  r = await feed('');
  assert('missing token: HTTP 404', r.status === 404, `HTTP ${r.status}`);
} catch (e) {
  fail('smoke run', e.message);
} finally {
  for (const [table, filter] of cleanup) await svcDelete(table, filter);
  for (const id of userIds) {
    await svcDelete('calendar_tokens', `user_id=eq.${id}`);
    await svcDelete('user_buildings', `user_id=eq.${id}`);
    await svcDelete('user_roles', `user_id=eq.${id}`);
    await fetch(`${URL_BASE}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: SVC });
  }
  const left = await (await fetch(`${URL_BASE}/rest/v1/buildings?name=like.ZZTEST-CAL-*&select=id`, { headers: SVC })).json();
  console.log((left.length ?? 0) === 0 ? '  teardown: clean' : `  WARN  ${left.length} ZZTEST-CAL buildings left`);
}

console.log(`\n${pass} passed, ${failures} failed`);
if (fails.length) for (const f of fails) console.log(`  - ${f}`);
console.log(failures === 0 ? 'CALENDAR FEED HOLDS' : 'CALENDAR FEED BROKEN');
process.exit(failures === 0 ? 0 : 1);
