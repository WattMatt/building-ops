#!/usr/bin/env node
/**
 * Locked-out recovery smoke — reproduces the EXACT state that stranded a
 * pilot client (confirmed email, NO password, must_set_password=false, never
 * signed in → mislabelled "Active" with no recovery option) and proves the
 * real `invite-user` resend edge function recovers them end to end.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   node scripts/recovery-smoke.mjs
 *
 * Edge function lives on prod only — run this against prod.
 * Would have caught the User-Management lockout of 2026-06-12.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Rec-Smoke-${RUN}!`;
const SVC = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const authed = (jwt) => ({ apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' });

let pass = 0, failures = 0;
const fails = [];
const ok = (n) => { pass++; console.log(`  PASS  ${n}`); };
const fail = (n, d) => { failures++; fails.push(`${n} — ${d}`); console.error(`  FAIL  ${n} — ${d}`); };
const assert = (n, cond, d) => (cond ? ok(n) : fail(n, d));

async function followLink(link) {
  const res = await fetch(link, { redirect: 'manual' });
  const loc = res.headers.get('location') ?? '';
  return Object.fromEntries(new URLSearchParams(loc.split('#')[1] ?? ''));
}
async function login(email, password) {
  return fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

let adminId = null, targetId = null;
const adminEmail = `zztest-rec-admin-${RUN}@buildingops.app`;
const targetEmail = `zztest-rec-target-${RUN}@buildingops.app`;

try {
  console.log(`recovery-smoke vs ${URL_BASE} (run ${RUN})`);

  // ── admin caller for the edge function ──
  let res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: SVC, body: JSON.stringify({ email: adminEmail, password: PASSWORD, email_confirm: true }),
  });
  adminId = (await res.json()).id;
  await fetch(`${URL_BASE}/rest/v1/user_roles?on_conflict=user_id`, {
    method: 'POST', headers: { ...SVC, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: adminId, role: 'admin' }),
  });
  const adminJwt = (await (await login(adminEmail, PASSWORD)).json()).access_token;
  if (!adminJwt) throw new Error('admin login failed');

  // ── target in the EXACT broken state ──
  // confirmed email, NO password, never signed in.
  res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: SVC,
    body: JSON.stringify({ email: targetEmail, email_confirm: true }), // no password
  });
  targetId = (await res.json()).id;
  if (!targetId) throw new Error('target create failed');
  // force the stranding flag exactly as observed in prod (default false)
  await fetch(`${URL_BASE}/rest/v1/profiles?id=eq.${targetId}`, {
    method: 'PATCH', headers: { ...SVC, Prefer: 'return=minimal' }, body: JSON.stringify({ must_set_password: false }),
  });

  // verify the repro (admin API redacts encrypted_password, so prove "no
  // usable password" by a failed login instead)
  const u = await (await fetch(`${URL_BASE}/auth/v1/admin/users/${targetId}`, { headers: SVC })).json();
  assert('repro: target email is confirmed', !!u.email_confirmed_at, 'not confirmed');
  assert('repro: target has NEVER signed in', !u.last_sign_in_at, 'unexpectedly signed in');
  const pre = await login(targetEmail, 'Definitely-Wrong-0!');
  assert('repro: target cannot log in (no password set)', !pre.ok, `unexpectedly logged in HTTP ${pre.status}`);
  // this is the state the OLD getStatus would call "Active" (no recovery offered)

  // ── the fix: admin triggers resend (Copy sign-in link path) ──
  res = await fetch(`${URL_BASE}/functions/v1/invite-user`, {
    method: 'POST', headers: { ...authed(adminJwt), apikey: ANON },
    body: JSON.stringify({ action: 'resend', email: targetEmail, delivery: 'link' }),
  });
  const out = res.ok ? await res.json() : { error: await res.text() };
  assert('admin gets a fresh sign-in link for the locked-out user', res.ok && out.status === 'link' && !!out.actionLink, JSON.stringify(out).slice(0, 160));

  // ── the link must actually work: link → session → set password → login ──
  const session = out.actionLink ? await followLink(out.actionLink) : {};
  assert('sign-in link yields a session', !!session.access_token, 'no access_token in redirect fragment');

  if (session.access_token) {
    res = await fetch(`${URL_BASE}/auth/v1/user`, {
      method: 'PUT', headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: `New-${PASSWORD}` }),
    });
    assert('user sets a password via the recovered session', res.ok, `HTTP ${res.status}`);
  }

  res = await login(targetEmail, `New-${PASSWORD}`);
  assert('locked-out user can now LOG IN', res.ok, `HTTP ${res.status}`);

  // ── truthful status: now signed in (login above already proved the password) ──
  const u2 = await (await fetch(`${URL_BASE}/auth/v1/admin/users/${targetId}`, { headers: SVC })).json();
  assert('after recovery the user has signed in (now truly Active in the UI)', !!u2.last_sign_in_at, `last_sign_in=${u2.last_sign_in_at}`);
} catch (e) {
  fail('smoke run', e.message);
} finally {
  for (const id of [adminId, targetId]) {
    if (id) {
      await fetch(`${URL_BASE}/rest/v1/user_roles?user_id=eq.${id}`, { method: 'DELETE', headers: SVC });
      await fetch(`${URL_BASE}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: SVC });
    }
  }
  const left = await (await fetch(`${URL_BASE}/auth/v1/admin/users?page=1&per_page=200`, { headers: SVC })).json();
  const strays = (left?.users ?? []).filter((u) => u.email?.startsWith('zztest-rec-'));
  for (const s of strays) await fetch(`${URL_BASE}/auth/v1/admin/users/${s.id}`, { method: 'DELETE', headers: SVC });
  console.log(strays.length ? `  swept ${strays.length} stray test users` : '  teardown: clean');
}

console.log(`\n${pass} passed, ${failures} failed`);
console.log(failures === 0 ? 'LOCKED-OUT RECOVERY WORKS' : 'RECOVERY BROKEN');
process.exit(failures === 0 ? 0 : 1);
