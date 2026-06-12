#!/usr/bin/env node
/**
 * Auth-journey smoke — protocol-level checks of every onboarding/login path,
 * against the live backend, using a disposable user (deleted afterwards).
 * Run after every web deploy:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/auth-smoke.mjs
 *
 * Checks: invite link → session → set password → login · recovery link →
 * new password → login · first-login gate set → cleared → login.
 * Exit code 0 = all pass. Would have caught every auth failure of 2026-06-11.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !SERVICE) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
const EMAIL = `zztest-smoke-${Date.now()}@buildingops.app`;
const ADMIN = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

let failures = 0;
const ok = (name) => console.log(`  PASS  ${name}`);
const fail = (name, detail) => { failures++; console.error(`  FAIL  ${name} — ${detail}`); };

async function followLink(link) {
  // The verify link 303s with the session in the fragment; manual redirect
  // so we can read it (a browser would carry it to the SPA).
  const res = await fetch(link, { redirect: 'manual' });
  const loc = res.headers.get('location') ?? '';
  const frag = loc.split('#')[1] ?? '';
  return Object.fromEntries(new URLSearchParams(frag));
}

async function login(password) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SERVICE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  return res;
}

let userId = null;
try {
  console.log(`auth-smoke vs ${URL_BASE} as ${EMAIL}`);

  // ── Journey 1: invite link → session → set password → login ──
  let res = await fetch(`${URL_BASE}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: ADMIN,
    body: JSON.stringify({ type: 'invite', email: EMAIL, redirect_to: 'https://buildingops.app/set-password' }),
  });
  const inviteOut = await res.json();
  userId = inviteOut.user?.id ?? inviteOut.id ?? null;
  if (!res.ok || !inviteOut.action_link) fail('invite link generated', JSON.stringify(inviteOut).slice(0, 120));
  else ok('invite link generated');

  const session1 = await followLink(inviteOut.action_link);
  if (!session1.access_token) fail('invite link yields session', 'no access_token in redirect fragment');
  else ok('invite link yields session');

  res = await fetch(`${URL_BASE}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: SERVICE, Authorization: `Bearer ${session1.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Smoke-Pass-1!' }),
  });
  res.ok ? ok('password set via invite session') : fail('password set via invite session', `HTTP ${res.status}`);

  res = await login('Smoke-Pass-1!');
  res.ok ? ok('login with invite-set password') : fail('login with invite-set password', `HTTP ${res.status}`);
  if (!userId) userId = (await res.clone().json().catch(() => ({})))?.user?.id ?? null;

  // ── Journey 2: recovery link → new password → login ──
  res = await fetch(`${URL_BASE}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: ADMIN,
    body: JSON.stringify({ type: 'recovery', email: EMAIL, redirect_to: 'https://buildingops.app/reset' }),
  });
  const recOut = await res.json();
  if (!res.ok || !recOut.action_link) fail('recovery link generated', JSON.stringify(recOut).slice(0, 120));
  else ok('recovery link generated');

  const session2 = await followLink(recOut.action_link);
  if (!session2.access_token) fail('recovery link yields session', 'no access_token in redirect fragment');
  else ok('recovery link yields session');

  res = await fetch(`${URL_BASE}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: SERVICE, Authorization: `Bearer ${session2.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Smoke-Pass-2!' }),
  });
  res.ok ? ok('password reset via recovery session') : fail('password reset via recovery session', `HTTP ${res.status}`);

  res = await login('Smoke-Pass-2!');
  res.ok ? ok('login with reset password') : fail('login with reset password', `HTTP ${res.status}`);

  // ── Journey 3: first-login gate set → cleared → login unaffected ──
  if (userId) {
    res = await fetch(`${URL_BASE}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH', headers: { ...ADMIN, Prefer: 'return=minimal' },
      body: JSON.stringify({ must_set_password: true }),
    });
    res.ok ? ok('gate flag set') : fail('gate flag set', `HTTP ${res.status}`);

    res = await fetch(`${URL_BASE}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH', headers: { ...ADMIN, Prefer: 'return=minimal' },
      body: JSON.stringify({ must_set_password: false }),
    });
    res.ok ? ok('gate flag cleared') : fail('gate flag cleared', `HTTP ${res.status}`);

    res = await login('Smoke-Pass-2!');
    res.ok ? ok('login after gate cycle') : fail('login after gate cycle', `HTTP ${res.status}`);
  } else {
    fail('gate flag journey', 'no userId resolved');
  }
} catch (e) {
  fail('smoke run', e.message);
} finally {
  if (userId) {
    const res = await fetch(`${URL_BASE}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: ADMIN });
    console.log(res.ok ? '  PASS  disposable user deleted' : `  WARN  cleanup failed (delete ${userId} manually)`);
  }
}

console.log(failures === 0 ? '\nALL AUTH JOURNEYS PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
