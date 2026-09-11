/**
 * Offline-replay smoke — proves the R2b write queue end to end against the live backend,
 * through the SAME modules the app runs (src/lib/offline/*, the app's supabase client), with
 * disposable personas and fixtures it deletes afterwards:
 *
 *   site user signed in on the app client  →  navigator.onLine = false  →
 *   task_complete (+1 photo) / issue_create / issue_comment all return `queued`  →
 *   nothing has reached the backend  →  navigator.onLine = true  →  replayAll twice  →
 *   exactly one task_completions row (client completionId, 1 photo URL under photos/<uid>/),
 *   the task is completed, exactly one issues row (client issueId), exactly one issue_activity
 *   row (client activityId), one issue_comment notification in the admin's inbox, queue empty.
 *   Then a task in a building the user cannot access is queued and replayed: the op ends
 *   `failed` with the RLS error as lastError, is skipped by the next replay, and can be discarded.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... npm run smoke:offline
 *
 * Runs under vite-node so `@/` imports resolve. The app client reads
 * import.meta.env.VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY, and Vite INLINES those into
 * src/integrations/supabase/client.ts at transform time from the env it computed when vite-node
 * started (shell env first, then .env.local / .env). Setting process.env inside this file is too
 * late for that module, so `npm run smoke:offline` maps SUPABASE_URL / SUPABASE_ANON_KEY onto the
 * VITE_* names in the shell BEFORE vite-node launches (see package.json and .env.example). The
 * assignment below is kept as a fallback for any module that reads process.env, and the script
 * verifies the client's URL matches SUPABASE_URL before it touches anything — otherwise the
 * fixtures (service role, SUPABASE_URL) and the replay (app client, VITE_SUPABASE_URL) would hit
 * two different projects.
 *
 * Refuses production (SUPABASE_URL containing the prod ref qdzgkttiosahdfqresvz) unless
 * SMOKE_ALLOW_PROD=1: it creates auth users, uploads to tenant-documents and invokes `notify`.
 */
if (process.env.SUPABASE_URL) process.env.VITE_SUPABASE_URL = process.env.SUPABASE_URL;
if (process.env.SUPABASE_ANON_KEY) process.env.VITE_SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_ANON_KEY;

import 'fake-indexeddb/auto'; // side-effect only (installs indexedDB globals); safe to hoist, unlike the app modules below
import type { QueuedOp } from '@/lib/offline/types'; // type-only: erased, so it does not hoist app code

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !SERVICE || !ANON) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');
  process.exit(2);
}

// Same guard as scripts/notifications-smoke.mjs: this smoke creates auth users, writes to
// storage and invokes the notify edge function — none of that belongs on production.
const PROD_REF = 'qdzgkttiosahdfqresvz';
if (URL_BASE.includes(PROD_REF) && process.env.SMOKE_ALLOW_PROD !== '1') {
  console.error(
    `Refusing to run against production (SUPABASE_URL contains ${PROD_REF}): ` +
    'this smoke creates auth users, uploads photos and invokes notify. Set SMOKE_ALLOW_PROD=1 to override.',
  );
  process.exit(2);
}

// ── browser globals the offline modules and the app client expect ──
// Node's own `navigator` has no `onLine`, and `!undefined` would read as "offline" forever
// (enqueueAndRun and isNetworkError both test it), so replace it with a mutable stand-in.
const nav = { onLine: false };
Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
// client.ts passes `storage: localStorage` to the auth client; Node has no usable localStorage
// without --localstorage-file, so give it an in-memory one before the module loads.
const mem = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true, writable: true,
  value: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  },
});

// Dynamic imports so the globals above exist before any app module evaluates (static imports hoist).
const { supabase } = await import('@/integrations/supabase/client');
const { enqueueAndRun } = await import('@/lib/offline/enqueueAndRun');
const { replayAll } = await import('@/lib/offline/replay');
const { listOps, removeOp, clearQueue } = await import('@/lib/offline/queue');

// The one check that makes the env note above enforceable.
const clientUrl = (supabase as unknown as { supabaseUrl: string }).supabaseUrl.replace(/\/+$/, '');
if (clientUrl !== URL_BASE.replace(/\/+$/, '')) {
  console.error(
    `App client targets ${clientUrl} but SUPABASE_URL is ${URL_BASE}. ` +
    'The client inlines VITE_SUPABASE_URL when vite-node starts (the repo .env leaks in otherwise): ' +
    'run through `npm run smoke:offline`, or export VITE_SUPABASE_URL=$SUPABASE_URL and ' +
    'VITE_SUPABASE_PUBLISHABLE_KEY=$SUPABASE_ANON_KEY before `npx vite-node`.',
  );
  process.exit(2);
}

const RUN = crypto.randomUUID().slice(0, 8);
const PASSWORD = `Offline-Smoke-${RUN}!`;
const SVC = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

let pass = 0, failures = 0;
const fails: string[] = [];
const ok = (n: string) => { pass++; console.log(`  PASS  ${n}`); };
const fail = (n: string, d: string) => { failures++; fails.push(`${n} — ${d}`); console.error(`  FAIL  ${n} — ${d}`); };
const assert = (n: string, cond: boolean, d: string) => (cond ? ok(n) : fail(n, d));

/** Logs each step as it starts and prefixes any thrown error with the step name, so a bare "fetch failed" says where. */
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  console.log(`  step: ${name}`);
  try {
    return await fn();
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    err.message = `[${name}] ${err.message}`;
    throw err;
  }
}

type Row = Record<string, unknown>;

// ── service-role REST helpers (same shape as scripts/checklist-smoke.mjs) ──
async function svcInsert(table: string, row: Row): Promise<Row> {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}`, {
    method: 'POST', headers: { ...SVC, Prefer: 'return=representation' }, body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`fixture ${table}: HTTP ${res.status} ${await res.text()}`);
  return ((await res.json()) as Row[])[0];
}
async function svcSelect(table: string, filter: string, select = '*'): Promise<Row[]> {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}&select=${select}`, { headers: SVC });
  if (!res.ok) throw new Error(`select ${table}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as Row[];
}
/** Teardown only: never throws, so a backend that vanished mid-run cannot abort the finally block before the summary. */
async function svcDelete(table: string, filter: string): Promise<void> {
  try {
    const res = await fetch(`${URL_BASE}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: SVC });
    if (!res.ok) console.error(`  WARN  delete ${table}?${filter}: HTTP ${res.status}`);
  } catch (e) { console.error(`  WARN  delete ${table}?${filter}: ${e instanceof Error ? e.message : String(e)}`); }
}
async function quiet(what: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch (e) { console.error(`  WARN  ${what}: ${e instanceof Error ? e.message : String(e)}`); }
}
/** Object names under a tenant-documents prefix, via the service role (photo paths are minted by uploadPhotos, so cleanup has to look). */
async function storageList(prefix: string): Promise<string[]> {
  const res = await fetch(`${URL_BASE}/storage/v1/object/list/tenant-documents`, {
    method: 'POST', headers: SVC, body: JSON.stringify({ prefix, limit: 100, offset: 0 }),
  });
  if (!res.ok) throw new Error(`storage list ${prefix}: HTTP ${res.status} ${await res.text()}`);
  return ((await res.json()) as { name: string }[]).map((o) => `${prefix}/${o.name}`);
}
/** Polls until `fn` returns a non-null value or `ms` elapse. */
async function waitFor<T>(fn: () => Promise<T | null>, ms = 15000, every = 500): Promise<T | null> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== null) return v;
    if (Date.now() >= until) return null;
    await new Promise((r) => setTimeout(r, every));
  }
}

// ── lifecycle state ──
const cleanup: [string, string][] = []; // [table, filter] LIFO; children unshifted in front of parents
const userIds: string[] = [];          // disposable auth users, torn down after the rows that reference them
let siteUid: string | null = null;      // whose photos/<uid>/ prefix gets swept

/** A confirmed persona with `role`, opted out of email, optionally assigned to a building. Not signed in here. */
async function createPersona(key: string, role: 'admin' | 'user', buildingId?: string) {
  const email = `zztest-offline-${key}-${RUN}@buildingops.app`;
  let res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: SVC, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const user = (await res.json()) as { id?: string };
  if (!res.ok || !user.id) throw new Error(`persona ${key}: HTTP ${res.status} ${JSON.stringify(user).slice(0, 120)}`);
  userIds.push(user.id); // track before any later step can throw
  // signup trigger may have seeded a default role — upsert, don't insert
  res = await fetch(`${URL_BASE}/rest/v1/user_roles?on_conflict=user_id`, {
    method: 'POST', headers: { ...SVC, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: user.id, role }),
  });
  if (!res.ok) throw new Error(`persona ${key} role: HTTP ${res.status} ${await res.text()}`);
  // Personas are opted out of email so a live Resend key never sends to non-existent addresses.
  res = await fetch(`${URL_BASE}/rest/v1/profiles?id=eq.${user.id}`, {
    method: 'PATCH', headers: SVC, body: JSON.stringify({ email_notifications: false }),
  });
  if (!res.ok) throw new Error(`persona ${key} email opt-out: HTTP ${res.status} ${await res.text()}`);
  if (buildingId) await svcInsert('user_buildings', { user_id: user.id, building_id: buildingId });
  return { id: user.id, email };
}

// A real 1×1 JPEG (630 bytes) so the stored object is a genuine image, not a text stub.
const JPEG_1x1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCOiiigD//Z',
  'base64',
);

try {
  console.log(`offline-smoke vs ${URL_BASE} (run ${RUN})`);

  // ════ setup: two buildings, a site user on A, an admin, a pending task in each building ════
  const fx = await step('setup: buildings + personas + tasks', async () => {
    const A = (await svcInsert('buildings', { name: `ZZTEST-OFFLINE-A-${RUN}` })).id as string;
    const B = (await svcInsert('buildings', { name: `ZZTEST-OFFLINE-B-${RUN}` })).id as string;
    cleanup.push(['buildings', `id=eq.${A}`], ['buildings', `id=eq.${B}`]);
    const user = await createPersona('user', 'user', A);   // assigned to A only — B is out of reach
    const admin = await createPersona('admin', 'admin');    // reported_by / comment recipient; admins are members of every building
    siteUid = user.id;
    const today = new Date().toISOString().slice(0, 10);
    const taskA = (await svcInsert('task_instances', {
      building_id: A, task_name: `ZZTEST-OFFLINE task ${RUN}`, due_date: today, status: 'pending', frequency: 'daily',
    })).id as string;
    const taskB = (await svcInsert('task_instances', {
      building_id: B, task_name: `ZZTEST-OFFLINE foreign ${RUN}`, due_date: today, status: 'pending', frequency: 'daily',
    })).id as string;
    cleanup.unshift(['task_instances', `id=in.(${taskA},${taskB})`]);
    cleanup.unshift(['task_completions', `task_instance_id=in.(${taskA},${taskB})`]); // child before parent
    console.log('  setup: 2 buildings, site user on A, admin, pending task in A and in B');
    return { A, B, user, admin, taskA, taskB };
  });

  // ════ sign in the site user ON THE APP CLIENT — the replay handlers use it, and notify needs its JWT ════
  const uid = await step('sign in site user on the app client', async () => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: fx.user.email, password: PASSWORD });
    if (error || !data.session || !data.user) throw new Error(`signInWithPassword: ${error?.message ?? 'no session'}`);
    assert('app client holds the site user session', data.user.id === fx.user.id, `uid ${data.user.id} vs persona ${fx.user.id}`);
    await clearQueue(data.user.id); // fake-indexeddb is fresh per process; belt and braces
    return data.user.id;
  });

  const completionId = crypto.randomUUID();
  const issueId = crypto.randomUUID();
  const activityId = crypto.randomUUID();
  const issueTitle = `ZZTEST-OFFLINE issue ${RUN}`;
  // Registered now so a crash mid-run still tears them down; harmless if the rows never land.
  cleanup.unshift(['issues', `id=eq.${issueId}`]);
  cleanup.unshift(['issue_activity', `id=eq.${activityId}`]);
  cleanup.unshift(['notifications', `recipient_id=eq.${fx.admin.id}`]);

  // ════ offline: three writes queue, none reach the backend ════
  await step('offline: enqueue task_complete (+photo), issue_create, issue_comment', async () => {
    nav.onLine = false;
    const photo = new File([JPEG_1x1], `${RUN}-evidence.jpg`, { type: 'image/jpeg' });
    const r1 = await enqueueAndRun(uid, {
      kind: 'task_complete', completionId, taskInstanceId: fx.taskA, taskName: `ZZTEST-OFFLINE task ${RUN}`,
      notes: `ZZTEST-OFFLINE ${RUN}`, signatureConfirmed: true,
    }, [{ file: photo }]);
    assert('task_complete returns queued while offline', r1.status === 'queued', JSON.stringify(r1));
    const r2 = await enqueueAndRun(uid, {
      kind: 'issue_create', issueId,
      row: {
        title: issueTitle, description: 'offline smoke', priority: 'high', status: 'open',
        building_id: fx.A, deadline: null, corrective_action: null,
        reported_by: uid, assigned_to: null, task_instance_id: null,
      },
      markTaskIssueLogged: null,
    }, []);
    assert('issue_create returns queued while offline', r2.status === 'queued', JSON.stringify(r2));
    const r3 = await enqueueAndRun(uid, {
      kind: 'issue_comment', activityId, issueId, issueTitle, buildingId: fx.A,
      comment: `ZZTEST-OFFLINE comment ${RUN}`, mentions: [], notifyOthers: [fx.admin.id], userEmail: fx.user.email,
    }, []);
    assert('issue_comment returns queued while offline', r3.status === 'queued', JSON.stringify(r3));

    const ops = await listOps(uid);
    assert('queue holds 3 pending ops, oldest first', ops.length === 3 && ops.every((o) => o.status === 'pending')
      && ops.map((o) => o.payload.kind).join(',') === 'task_complete,issue_create,issue_comment',
      ops.map((o) => `${o.payload.kind}:${o.status}`).join(','));
    assert('queued photo survives IndexedDB', ops[0]?.photos.length === 1 && ops[0].photos[0].file.size === JPEG_1x1.length,
      `photos=${ops[0]?.photos.length} size=${ops[0]?.photos[0]?.file.size}`);

    const tc = await svcSelect('task_completions', `id=eq.${completionId}`, 'id');
    const is = await svcSelect('issues', `id=eq.${issueId}`, 'id');
    assert('nothing reached the backend while offline', tc.length === 0 && is.length === 0, `completions=${tc.length} issues=${is.length}`);
  });

  // ════ back online: replay twice (the second must be a no-op) ════
  await step('online: replayAll twice', async () => {
    nav.onLine = true;
    await replayAll(uid);
    await replayAll(uid);
    const left = await listOps(uid);
    assert('queue is empty after replay', left.length === 0,
      left.map((o) => `${o.payload.kind}:${o.status}:${o.lastError ?? ''}`).join(' | ') || 'n/a');
  });

  await step('verify via service role', async () => {
    const tcById = await svcSelect('task_completions', `id=eq.${completionId}`, 'id,completed_by,photo_urls,notes');
    const tcByTask = await svcSelect('task_completions', `task_instance_id=eq.${fx.taskA}`, 'id');
    const urls = (tcById[0]?.photo_urls ?? []) as string[];
    assert('exactly one task_completions row, carrying the client completionId', tcById.length === 1 && tcByTask.length === 1,
      `by id=${tcById.length} by task=${tcByTask.length}`);
    assert('completion has exactly one photo URL under photos/<uid>/', urls.length === 1 && urls[0].includes(`photos/${uid}/`),
      JSON.stringify(urls));
    assert('completion credited to the site user', tcById[0]?.completed_by === uid, String(tcById[0]?.completed_by));
    const objects = siteUid ? await storageList(`photos/${siteUid}`) : [];
    assert('exactly one photo object was uploaded (no duplicate across the two replays)', objects.length === 1, JSON.stringify(objects));

    const ti = await svcSelect('task_instances', `id=eq.${fx.taskA}`, 'status,completed_by');
    assert('task_instance flipped to completed by the site user', ti[0]?.status === 'completed' && ti[0]?.completed_by === uid, JSON.stringify(ti[0]));

    const issue = await svcSelect('issues', `id=eq.${issueId}`, 'id,building_id,reported_by,status,title');
    assert('exactly one issues row with the client issueId', issue.length === 1 && issue[0].building_id === fx.A && issue[0].reported_by === uid
      && issue[0].status === 'open', JSON.stringify(issue));

    const act = await svcSelect('issue_activity', `id=eq.${activityId}`, 'id,issue_id,activity_type,user_id,comment');
    const actByIssue = await svcSelect('issue_activity', `issue_id=eq.${issueId}&activity_type=eq.comment`, 'id');
    assert('exactly one issue_activity comment with the client activityId', act.length === 1 && act[0].issue_id === issueId
      && act[0].activity_type === 'comment' && act[0].user_id === uid && actByIssue.length === 1,
      `by id=${act.length} by issue=${actByIssue.length} ${JSON.stringify(act[0] ?? null)}`);

    // notify is fire-and-forget inside the handler, so the inbox row can land after replayAll resolves.
    const notif = await waitFor(async () => {
      const rows = await svcSelect('notifications', `recipient_id=eq.${fx.admin.id}&kind=eq.issue_comment&entity_id=eq.${issueId}`, 'id,actor_id,title,url');
      return rows.length ? rows : null;
    });
    if (!notif) {
      // The handler swallows notify errors, so call the edge function directly with the same JWT to say why.
      const { data: { session } } = await supabase.auth.getSession();
      const probe = await fetch(`${URL_BASE}/functions/v1/notify`, {
        method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'issue_comment', entityType: 'issue', entityId: issueId, buildingId: fx.A, recipients: [fx.admin.id], title: `ZZTEST-OFFLINE diag ${RUN}`, url: `/issues?open=${issueId}` }),
      });
      fail('admin received one issue_comment notification', `no row within 15 s; direct notify probe → HTTP ${probe.status} ${(await probe.text()).slice(0, 200)}`);
    } else {
      assert('admin received one issue_comment notification', notif.length === 1 && notif[0].actor_id === uid && notif[0].url === `/issues?open=${issueId}`,
        JSON.stringify(notif));
    }
  });

  // ════ rejection: a task in a building the user cannot access ════
  await step('rejection: task_complete in an inaccessible building', async () => {
    nav.onLine = false;
    const r = await enqueueAndRun(uid, {
      kind: 'task_complete', completionId: crypto.randomUUID(), taskInstanceId: fx.taskB, taskName: `ZZTEST-OFFLINE foreign ${RUN}`,
      notes: null, signatureConfirmed: false,
    }, []);
    assert('foreign task_complete queues while offline', r.status === 'queued', JSON.stringify(r));
    nav.onLine = true;
    await replayAll(uid);
    let ops: QueuedOp[] = await listOps(uid);
    assert('replay marks the op failed with a non-empty lastError (RLS)', ops.length === 1 && ops[0].status === 'failed'
      && typeof ops[0].lastError === 'string' && ops[0].lastError.length > 0 && ops[0].attempts === 1,
      ops.map((o) => `${o.status} attempts=${o.attempts} lastError=${JSON.stringify(o.lastError)}`).join(' | ') || 'queue empty');
    console.log(`  info: lastError = ${JSON.stringify(ops[0]?.lastError ?? null)}`);
    await replayAll(uid);
    ops = await listOps(uid);
    assert('a plain replay skips the failed op (still failed, attempts unchanged)', ops.length === 1 && ops[0].status === 'failed' && ops[0].attempts === 1,
      ops.map((o) => `${o.status} attempts=${o.attempts}`).join(' | ') || 'queue empty');
    const tcB = await svcSelect('task_completions', `task_instance_id=eq.${fx.taskB}`, 'id');
    const tiB = await svcSelect('task_instances', `id=eq.${fx.taskB}`, 'status');
    assert('RLS held: no completion row and the foreign task is still pending', tcB.length === 0 && tiB[0]?.status === 'pending',
      `completions=${tcB.length} status=${String(tiB[0]?.status)}`);
    if (ops[0]) await removeOp(uid, ops[0].id);
    assert('discard (removeOp) empties the queue', (await listOps(uid)).length === 0, 'op still queued');
  });
} catch (e) {
  fail('smoke run', e instanceof Error ? e.message : String(e));
} finally {
  await quiet('sign-out', () => supabase.auth.signOut());
  if (siteUid) {
    const sid = siteUid;
    await quiet('clearQueue', () => clearQueue(sid));
    await quiet('storage sweep', async () => {
      for (const path of await storageList(`photos/${sid}`)) {
        await fetch(`${URL_BASE}/storage/v1/object/tenant-documents/${path}`, { method: 'DELETE', headers: SVC });
      }
    });
  }
  for (const [table, filter] of cleanup) await svcDelete(table, filter);
  for (const id of userIds) {
    await svcDelete('user_buildings', `user_id=eq.${id}`);
    await svcDelete('user_roles', `user_id=eq.${id}`);
    await quiet(`delete auth user ${id}`, () => fetch(`${URL_BASE}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: SVC }));
  }
  try {
    const left = await svcSelect('buildings', 'name=like.ZZTEST-OFFLINE-*', 'id');
    console.log(left.length === 0 ? '  teardown: clean' : `  WARN  ${left.length} ZZTEST-OFFLINE buildings left`);
  } catch (e) { console.error(`  WARN  teardown could not be verified: ${e instanceof Error ? e.message : String(e)}`); }
}

if (fails.length) { console.error('\nFailures:'); for (const f of fails) console.error(`  - ${f}`); }
console.log(`\n${pass} passed, ${failures} failed`);
console.log(failures === 0 ? 'OFFLINE REPLAY HOLDS' : 'OFFLINE REPLAY BROKEN');
process.exit(failures === 0 ? 0 : 1);
