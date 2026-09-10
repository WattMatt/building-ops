# R2b "Offline writes" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completing a task, logging an issue, commenting and resolving work with no signal: the write is queued on the device with its photos, replays idempotently on reconnect, and the user can see what is waiting, retry, or discard.

**Architecture:** One per-user IndexedDB queue (`idb-keyval` store, one key per operation, photo blobs inside the record). Every field dialog builds an operation with client-generated row ids and calls `enqueueAndRun`; online, the replay runs immediately so the UI path is identical on- and offline. A sequential replay engine uploads photos to fresh paths, executes one handler per kind (`complete_task` RPC, `issues` insert with the client id, `issue_activity` insert with the client id, resolve = comment + status flip), classifies failures (network → stays pending; 409/23505 → treated as applied; other 4xx → needs attention), and notifies exactly as the online code does today. A `SyncStatusPill` in the top bar and a queue sheet expose state; a pending-overlay marks queued rows on My Day and the Issues list. No schema change: `complete_task` shipped in R2a and both tables accept client ids.

**Tech Stack:** React 18 + TS, TanStack Query v5 (queue list as a query, invalidated by a tiny emitter), `idb-keyval` (already a dep), `fake-indexeddb` (tests), Supabase JS, vitest + Testing Library 16, `vite-node` for the live smoke.

**Spec:** `docs/superpowers/specs/2026-09-10-r2-field-design.md` §6 (+ §5.5 for photo paths).

**Ground rules for every agent:** never `git stash` / `checkout` / `switch` / `reset` / `worktree`; compare with `git show <sha>:<path>`; edit only the files your task names; commit with an explicit pathspec; retry after 5 s on `index.lock`; end commit messages with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; gate = `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'error TS' | grep -E '<your files>'` prints nothing, `npm run test` green, global count ≤ `.github/typecheck-baseline.txt` (56); guardrail copy (offline state, sync failures, "already completed") is plain text, never through `<Hint>`; coaching copy always through `<Hint>`; tap targets ≥ 44 px.

**Facts every task relies on** (from R2a): `src/lib/photos.ts` exports `uploadPhotos(photos, { prefix })` (returns public-style URLs) and `photoPrefix(uid)`; a retry MUST use fresh paths (storage `upsert` onto an existing object needs the admin-only update policy), so never pre-assign paths — orphaned duplicates from a half-failed attempt are acceptable. `public.complete_task(p_completion_id, p_task_instance_id, p_notes, p_signature_confirmed, p_photo_urls)` returns `[{ completion_id, already_completed }]` (typed in `types.ts`). `issues.id` and `issue_activity.id` default to `gen_random_uuid()` and accept a client value. `src/lib/issueActivity.ts` `postIssueComment` does the comment insert (gains an optional `id`). `src/lib/notify.ts` `notify()` is fire-and-forget. `src/hooks/useOnlineStatus.ts` tracks `navigator.onLine`. `src/components/pwa/OfflineBanner.tsx` is the guardrail banner. `useAuth()` gives `{ user }`. The persisted read cache lives in `src/lib/persist.ts` / `src/components/PersistedQueryProvider.tsx` — the queue is separate from it (different store) but is also keyed per user and cleared on sign-out.

---

### Task 1: Queue store

**Files:**
- Create: `src/lib/offline/types.ts`, `src/lib/offline/queue.ts`, `src/lib/offline/queue.test.ts`

- [ ] **Step 1: Types**

```ts
// src/lib/offline/types.ts
import type { IssuePriority } from '@/lib/constants';

/** A photo held in the queue until it can be uploaded. Files survive structured clone, so the File itself is stored. */
export interface QueuedPhoto { file: File }

export interface TaskCompletePayload {
  kind: 'task_complete';
  completionId: string;           // client id → complete_task.p_completion_id (idempotent replay)
  taskInstanceId: string;
  taskName: string;               // for the queue sheet only
  notes: string | null;
  signatureConfirmed: boolean;
}
export interface IssueCreatePayload {
  kind: 'issue_create';
  issueId: string;                // client id → issues.id
  row: {
    title: string; description: string; priority: IssuePriority; status: 'open';
    building_id: string; deadline: string | null; corrective_action: string | null;
    reported_by: string; assigned_to: string | null; task_instance_id: string | null;
  };
  /** ReportIssueDialog flips the task to issue_logged after the insert. */
  markTaskIssueLogged: string | null;
}
export interface IssueCommentPayload {
  kind: 'issue_comment';
  activityId: string;             // client id → issue_activity.id
  issueId: string;
  issueTitle: string;
  buildingId: string;
  comment: string;
  mentions: string[];
  /** For the two notify calls the composer makes today. */
  notifyOthers: string[];
  userEmail: string | null;
}
export interface IssueResolvePayload {
  kind: 'issue_resolve';
  activityId: string;
  issueId: string;
  note: string;
  userEmail: string | null;
}
export type OpPayload = TaskCompletePayload | IssueCreatePayload | IssueCommentPayload | IssueResolvePayload;
export type OpKind = OpPayload['kind'];

export interface QueuedOp {
  id: string;
  uid: string;
  createdAt: number;
  attempts: number;
  status: 'pending' | 'failed';
  lastError: string | null;
  payload: OpPayload;
  photos: QueuedPhoto[];
}

/** What `enqueueAndRun` tells the caller happened to THEIR op right now. */
export type RunOutcome =
  | { status: 'synced'; result: unknown }
  | { status: 'queued' }             // offline or network failure: it will replay later
  | { status: 'failed'; error: string };
```

- [ ] **Step 2: Failing test** (`src/lib/offline/queue.test.ts`; `fake-indexeddb/auto` is already in `src/test/setup.ts`)

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enqueue, listOps, updateOp, removeOp, clearQueue, subscribeQueue, queueStoreName } from './queue';

const payload = { kind: 'task_complete', completionId: 'c1', taskInstanceId: 't1', taskName: 'Check', notes: null, signatureConfirmed: false } as const;

describe('offline queue store', () => {
  beforeEach(async () => { await clearQueue('u1'); await clearQueue('u2'); });

  it('enqueues, lists oldest-first, and isolates users', async () => {
    const a = await enqueue('u1', payload, []);
    const b = await enqueue('u1', { ...payload, completionId: 'c2', taskInstanceId: 't2' }, []);
    await enqueue('u2', payload, []);
    const ops = await listOps('u1');
    expect(ops.map((o) => o.id)).toEqual([a.id, b.id]);
    expect(ops[0]).toMatchObject({ uid: 'u1', status: 'pending', attempts: 0, lastError: null });
    expect((await listOps('u2')).length).toBe(1);
  });

  it('keeps photo files', async () => {
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    const op = await enqueue('u1', payload, [{ file }]);
    const [stored] = await listOps('u1');
    expect(stored.id).toBe(op.id);
    expect(stored.photos[0].file.name).toBe('a.jpg');
    expect(await stored.photos[0].file.text()).toBe('x');
  });

  it('updates, removes and clears, notifying subscribers each time', async () => {
    const seen = vi.fn();
    const unsub = subscribeQueue(seen);
    const op = await enqueue('u1', payload, []);
    await updateOp('u1', op.id, { status: 'failed', lastError: 'boom', attempts: 1 });
    expect((await listOps('u1'))[0]).toMatchObject({ status: 'failed', lastError: 'boom', attempts: 1 });
    await removeOp('u1', op.id);
    expect(await listOps('u1')).toEqual([]);
    await enqueue('u1', payload, []);
    await clearQueue('u1');
    expect(await listOps('u1')).toEqual([]);
    expect(seen.mock.calls.length).toBeGreaterThanOrEqual(5);
    unsub();
  });

  it('names the store per user', () => {
    expect(queueStoreName('u1')).toBe('bo-queue-u1');
  });
});
```

- [ ] **Step 3: Implementation**

```ts
// src/lib/offline/queue.ts
/**
 * The per-user offline write queue. One IndexedDB key per operation so a write never rewrites
 * the whole queue; photo Files are stored inside the record (structured clone keeps them).
 * Separate from the read cache in src/lib/persist.ts, but keyed per user for the same reason:
 * one phone shared between two caretakers must never replay one user's writes as the other.
 */
import { createStore, get, set, del, keys, entries, clear, type UseStore } from 'idb-keyval';
import type { OpPayload, QueuedOp, QueuedPhoto } from './types';

export const queueStoreName = (uid: string) => `bo-queue-${uid}`;
const stores = new Map<string, UseStore>();
function storeFor(uid: string): UseStore {
  let s = stores.get(uid);
  if (!s) { s = createStore(queueStoreName(uid), 'ops'); stores.set(uid, s); }
  return s;
}

type Listener = () => void;
const listeners = new Set<Listener>();
/** Anything that renders queue state subscribes here; every mutation below notifies. */
export function subscribeQueue(fn: Listener): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
function emit() { for (const fn of listeners) fn(); }

export async function enqueue(uid: string, payload: OpPayload, photos: QueuedPhoto[]): Promise<QueuedOp> {
  const op: QueuedOp = { id: crypto.randomUUID(), uid, createdAt: Date.now(), attempts: 0, status: 'pending', lastError: null, payload, photos };
  await set(op.id, op, storeFor(uid));
  emit();
  return op;
}

export async function listOps(uid: string): Promise<QueuedOp[]> {
  const rows = (await entries<string, QueuedOp>(storeFor(uid))).map(([, v]) => v);
  return rows.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export async function getOp(uid: string, id: string): Promise<QueuedOp | undefined> {
  return get<QueuedOp>(id, storeFor(uid));
}

export async function updateOp(uid: string, id: string, patch: Partial<Pick<QueuedOp, 'status' | 'lastError' | 'attempts'>>): Promise<void> {
  const cur = await get<QueuedOp>(id, storeFor(uid));
  if (!cur) return;
  await set(id, { ...cur, ...patch }, storeFor(uid));
  emit();
}

export async function removeOp(uid: string, id: string): Promise<void> {
  await del(id, storeFor(uid));
  emit();
}

export async function clearQueue(uid: string): Promise<void> {
  try { await clear(storeFor(uid)); } catch { /* store never created */ }
  emit();
}

export async function countOps(uid: string): Promise<number> {
  return (await keys(storeFor(uid))).length;
}
```

- [ ] **Step 4: gate, test, commit** — `git add src/lib/offline/types.ts src/lib/offline/queue.ts src/lib/offline/queue.test.ts && git commit -m "Offline write queue store: per-user IndexedDB ops with photos"`

---

### Task 2: Replay engine and handlers

**Files:**
- Create: `src/lib/offline/handlers.ts`, `src/lib/offline/replay.ts`, `src/lib/offline/replay.test.ts`
- Modify: `src/lib/issueActivity.ts` (optional `id` on the insert; `photoUrls` unchanged)

- [ ] **Step 1: `postIssueComment` accepts a client id** — add `id?: string` to `PostIssueCommentInput`; include `...(id ? { id } : {})` in the insert object. No other change.

- [ ] **Step 2: Failing tests** (`replay.test.ts`) with `vi.mock('@/integrations/supabase/client')` (hoisted chainable mock recording `rpc`, `from().insert/update…`), `vi.mock('@/lib/photos', () => ({ uploadPhotos: vi.fn().mockResolvedValue(['https://x/p.jpg']), photoPrefix: (u: string) => `photos/${u}` }))`, `vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))`, `vi.mock('@/lib/issueActivity', () => ({ postIssueComment: vi.fn().mockResolvedValue({ id: 'a1', authorName: 'Thabo' }) }))`. Cases:
  1. `task_complete` → `rpc('complete_task', { p_completion_id, p_task_instance_id, p_notes, p_signature_confirmed, p_photo_urls: ['https://x/p.jpg'] })`; op removed; outcome `synced` with `{ already_completed: false }`.
  2. `task_complete` when rpc returns `already_completed: true` → still `synced`, result carries the flag (caller shows the "someone else" toast).
  3. `issue_create` → `from('issues').insert({ id: issueId, …row, photo_urls })`, then `from('task_instances').update({ status: 'issue_logged' }).eq('id', markTaskIssueLogged)` only when set.
  4. `issue_comment` → `postIssueComment({ id: activityId, … })` then `notify` for `notifyOthers` (`issue_comment`) and for `mentions` minus the actor (`issue_mention`), same titles/urls as `IssueCommentComposer` today.
  5. `issue_resolve` → comment then `from('issues').update({ status: 'resolved' })`; zero rows back → outcome `failed` with the permission message, op marked failed.
  6. Network failure (`TypeError('Failed to fetch')` or an error whose `message` matches /fetch|network|offline/i) → op stays `pending`, attempts +1, outcome `queued`.
  7. Duplicate (`{ code: '23505' }` or `status === 409`) → treated as applied: op removed, outcome `synced`.
  8. Other error (`{ code: '42501', message: 'permission denied' }`) → op `failed`, `lastError` set, outcome `failed`.
  9. `replayAll` processes oldest-first, stops at the first network failure (leaves the rest pending), and skips `failed` ops unless `retryFailed` is passed; it is single-flight (a second concurrent call awaits the first).

- [ ] **Step 3: Handlers**

```ts
// src/lib/offline/handlers.ts
import { supabase } from '@/integrations/supabase/client';
import { uploadPhotos, photoPrefix } from '@/lib/photos';
import { postIssueComment } from '@/lib/issueActivity';
import { notify } from '@/lib/notify';
import type { QueuedOp } from './types';

/** Runs one op against the backend. Throws on failure; the caller classifies the error. */
export async function runOp(op: QueuedOp): Promise<unknown> {
  // Fresh paths every attempt: overwriting an existing object needs the admin-only update policy.
  const photoUrls = op.photos.length
    ? await uploadPhotos(op.photos.map((p) => ({ file: p.file, preview: '' })), { prefix: photoPrefix(op.uid) })
    : [];
  const p = op.payload;
  switch (p.kind) {
    case 'task_complete': {
      const { data, error } = await supabase.rpc('complete_task', {
        p_completion_id: p.completionId, p_task_instance_id: p.taskInstanceId,
        p_notes: p.notes, p_signature_confirmed: p.signatureConfirmed, p_photo_urls: photoUrls,
      });
      if (error) throw error;
      return data?.[0] ?? { completion_id: p.completionId, already_completed: false };
    }
    case 'issue_create': {
      const { error } = await supabase.from('issues').insert({ id: p.issueId, ...p.row, photo_urls: photoUrls.length ? photoUrls : null });
      if (error) throw error;
      if (p.markTaskIssueLogged) {
        const { error: e2 } = await supabase.from('task_instances').update({ status: 'issue_logged' }).eq('id', p.markTaskIssueLogged);
        if (e2) throw e2;
      }
      return { issueId: p.issueId };
    }
    case 'issue_comment': {
      const { authorName } = await postIssueComment({ id: p.activityId, issueId: p.issueId, userId: op.uid, userEmail: p.userEmail, comment: p.comment, photoUrls, mentions: p.mentions });
      const others = p.notifyOthers.filter((id) => id !== op.uid && !p.mentions.includes(id));
      if (others.length) void notify({ kind: 'issue_comment', entityType: 'issue', entityId: p.issueId, buildingId: p.buildingId, recipients: others, title: `${authorName} commented on: ${p.issueTitle}`, body: p.comment.slice(0, 200), url: `/issues?open=${p.issueId}` });
      const mentioned = p.mentions.filter((id) => id !== op.uid);
      if (mentioned.length) void notify({ kind: 'issue_mention', entityType: 'issue', entityId: p.issueId, buildingId: p.buildingId, recipients: mentioned, title: `${authorName} mentioned you on: ${p.issueTitle}`, body: p.comment.slice(0, 200), url: `/issues?open=${p.issueId}` });
      return { activityId: p.activityId, authorName };
    }
    case 'issue_resolve': {
      await postIssueComment({ id: p.activityId, issueId: p.issueId, userId: op.uid, userEmail: p.userEmail, comment: p.note, photoUrls });
      const { data, error } = await supabase.from('issues').update({ status: 'resolved' }).eq('id', p.issueId).select('id');
      if (error) throw error;
      if (!data?.length) throw Object.assign(new Error('Your note was saved, but you do not have permission to resolve this issue.'), { code: 'RESOLVE_DENIED' });
      return { issueId: p.issueId };
    }
  }
}
```

- [ ] **Step 4: Replay**

```ts
// src/lib/offline/replay.ts
/**
 * Sequential, single-flight replay of the queue. Oldest first. A network failure stops the run
 * (everything behind it is still pending and will replay on the next trigger); a duplicate
 * (409 / 23505) means an earlier attempt already landed and the op is done; anything else is a
 * real rejection the user has to look at (retry or discard) — it never blocks the ops behind it.
 */
import { listOps, updateOp, removeOp, getOp } from './queue';
import { runOp } from './handlers';
import type { QueuedOp, RunOutcome } from './types';

export function isNetworkError(e: unknown): boolean {
  const msg = (e as { message?: string })?.message ?? '';
  const status = (e as { status?: number })?.status;
  return e instanceof TypeError || status === 0 || /failed to fetch|network|offline|load failed|timed? ?out/i.test(msg) || (typeof navigator !== 'undefined' && !navigator.onLine);
}
export function isDuplicateError(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const status = (e as { status?: number })?.status;
  return code === '23505' || status === 409;
}
function messageOf(e: unknown): string {
  return (e as { message?: string })?.message || 'The change was rejected.';
}

/** Runs one op and records the result on it. */
export async function runOne(op: QueuedOp): Promise<RunOutcome> {
  try {
    const result = await runOp(op);
    await removeOp(op.uid, op.id);
    return { status: 'synced', result };
  } catch (e) {
    if (isDuplicateError(e)) { await removeOp(op.uid, op.id); return { status: 'synced', result: { duplicate: true } }; }
    if (isNetworkError(e)) { await updateOp(op.uid, op.id, { attempts: op.attempts + 1 }); return { status: 'queued' }; }
    const error = messageOf(e);
    await updateOp(op.uid, op.id, { status: 'failed', lastError: error, attempts: op.attempts + 1 });
    return { status: 'failed', error };
  }
}

let inFlight: Promise<void> | null = null;
/** Replays every pending op for the user (and failed ones when asked). Concurrent calls share one run. */
export function replayAll(uid: string, opts: { retryFailed?: boolean } = {}): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const ops = await listOps(uid);
      for (const op of ops) {
        if (op.status === 'failed' && !opts.retryFailed) continue;
        const fresh = await getOp(uid, op.id); // may have been discarded meanwhile
        if (!fresh) continue;
        if (fresh.status === 'failed') await updateOp(uid, fresh.id, { status: 'pending', lastError: null });
        const outcome = await runOne({ ...fresh, status: 'pending' });
        if (outcome.status === 'queued') break; // still offline: stop, keep order
      }
    } finally { inFlight = null; }
  })();
  return inFlight;
}

export async function retryOp(uid: string, id: string): Promise<RunOutcome> {
  const op = await getOp(uid, id);
  if (!op) return { status: 'failed', error: 'This change is no longer queued.' };
  await updateOp(uid, id, { status: 'pending', lastError: null });
  return runOne({ ...op, status: 'pending', lastError: null });
}
```

- [ ] **Step 5: gate, tests, commit** — `git add src/lib/offline/handlers.ts src/lib/offline/replay.ts src/lib/offline/replay.test.ts src/lib/issueActivity.ts && git commit -m "Offline replay engine: sequential, idempotent handlers for complete/create/comment/resolve"`

---

### Task 3: `enqueueAndRun`, triggers, and the queue hook

**Files:**
- Create: `src/lib/offline/enqueueAndRun.ts`, `src/hooks/useOfflineQueue.ts`, `src/hooks/useOfflineQueue.test.ts`, `src/components/offline/OfflineQueueRunner.tsx`
- Modify: `src/components/layout/DashboardLayout.tsx` (mount `OfflineQueueRunner` once, next to `UpdateToast`), `src/contexts/AuthContext.tsx` (`clearQueue(uid)` beside `clearPersistedCache`)

- [ ] **Step 1: `enqueueAndRun`**

```ts
// src/lib/offline/enqueueAndRun.ts
import { enqueue } from './queue';
import { runOne } from './replay';
import type { OpPayload, QueuedPhoto, RunOutcome } from './types';

/**
 * The one entry point the dialogs use, on- and offline. Persist first (so a crash or a closed
 * tab never loses the write), then try to run it right away when the browser thinks it is
 * online. The outcome tells the dialog which toast to show.
 */
export async function enqueueAndRun(uid: string, payload: OpPayload, photos: QueuedPhoto[]): Promise<RunOutcome> {
  const op = await enqueue(uid, payload, photos);
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { status: 'queued' };
  return runOne(op);
}
```

- [ ] **Step 2: Hook** — `useOfflineQueue()` returns `{ ops, pending, failed, retry(id), discard(id), retryAll() }` using `useQuery({ queryKey: ['offline-queue', uid], queryFn: () => listOps(uid), enabled: !!uid })` and an effect that `subscribeQueue(() => qc.invalidateQueries({ queryKey: ['offline-queue'] }))`. NOT persisted (no `PERSIST_DEFAULTS`). Test with fake-indexeddb: enqueue → `pending === 1`; `discard` removes; `retry` calls `retryOp` (mock `./replay`).

- [ ] **Step 3: Runner** — `OfflineQueueRunner` (renders null): on mount with a uid, on `online`, and on `visibilitychange` → visible, call `replayAll(uid)`; debounce 500 ms; also when `useOnlineStatus()` flips to true. On `uid` change do nothing else (the queue is per user). Mount in `DashboardLayout` once. In `AuthContext.signOut` add `void clearQueue(outgoingUid)` next to `clearPersistedCache` — sign-out discards unsynced writes deliberately: warn in the sheet (Task 5) that signing out drops queued changes.

- [ ] **Step 4: gate, tests, commit** — `git add src/lib/offline/enqueueAndRun.ts src/hooks/useOfflineQueue.ts src/hooks/useOfflineQueue.test.ts src/components/offline/OfflineQueueRunner.tsx src/components/layout/DashboardLayout.tsx src/contexts/AuthContext.tsx && git commit -m "Queue entry point, replay triggers, and the queue hook"`

---

### Task 4: Dialogs go through the queue

**Files:**
- Modify: `src/components/checklists/CompleteTaskDialog.tsx`, `src/pages/NewIssue.tsx`, `src/components/checklists/ReportIssueDialog.tsx`, `src/components/issues/IssueCommentComposer.tsx`, `src/components/issues/ResolveIssueDialog.tsx`, and their tests

- [ ] **Step 1: A shared toast helper** — in `src/lib/offline/outcomeToast.ts`: `toastForOutcome(outcome, { synced: string, queued?: string })` → `synced` → `toast.success(synced)`, `queued` → `toast(queued ?? 'Saved on this device — it will sync when you're back online')` (guardrail copy), `failed` → `toast.error(outcome.error)`.

- [ ] **Step 2: CompleteTaskDialog** — replace the upload + upsert + update block with:

```ts
      const outcome = await enqueueAndRun(user.id, {
        kind: 'task_complete', completionId: crypto.randomUUID(), taskInstanceId: taskId, taskName,
        notes: notes.trim() || null, signatureConfirmed,
      }, photos.map((p) => ({ file: p.file })));
      if (outcome.status === 'synced' && (outcome.result as { already_completed?: boolean })?.already_completed) {
        toast.info('This task was already completed by someone else — your notes were not saved.');
      } else {
        toastForOutcome(outcome, { synced: 'Task completed successfully', queued: 'Task saved on this device — it will complete when you're back online' });
      }
      if (outcome.status !== 'failed') { resetForm(); onOpenChange(false); onSuccess?.(); }
```

Remove the now-unused `supabase`/`uploadPhotos` imports. The `complete_task` RPC replaces the two direct writes (spec §4.3): an RLS denial arrives as `outcome.failed` with the server message.

- [ ] **Step 3: NewIssue** — `const issueId = crypto.randomUUID(); const outcome = await enqueueAndRun(user.id, { kind: 'issue_create', issueId, row: {...as today, reported_by: user.id, assigned_to: null, task_instance_id: null, status: 'open' }, markTaskIssueLogged: null }, photos.map(...))`; on `synced` or `queued` navigate to `/issues` (queued issues show there via Task 6); drop `createIssue` from `useIssues` usage here (keep the hook for the list). **ReportIssueDialog** — same with `task_instance_id: taskId`, `markTaskIssueLogged: taskId`; on non-failed → reset/close/`onSuccess`. **IssueCommentComposer** — build `issue_comment` with `activityId: crypto.randomUUID()`, `notifyOthers: [assigneeId, reporterId].filter(Boolean)`, `mentions: kept`, `userEmail: user.email ?? null`; the two `notify` calls move into the handler (delete them here); `track('issue_commented', …)` stays; on non-failed clear the box and `onPosted()`. **ResolveIssueDialog** — `issue_resolve` with `activityId`; on `synced` → "Issue resolved"; `queued` → "Saved on this device — it will resolve when you're back online"; `failed` → the error (the RESOLVE_DENIED message is already user-facing).

- [ ] **Step 4: Tests** — each dialog test mocks `@/lib/offline/enqueueAndRun` (`enqueueAndRun: vi.fn().mockResolvedValue({ status: 'synced', result: {} })`) and asserts the payload shape (kind, client id is a UUID, key fields) and the toast for `queued`/`failed` outcomes. Remove now-dead mocks of `@/lib/photos`/`@/lib/issueActivity` where a component no longer imports them.

- [ ] **Step 5: gate, tests, commit** — `git add src/lib/offline/outcomeToast.ts <the five components> <their tests> && git commit -m "Field dialogs write through the offline queue; task completion uses complete_task"`

---

### Task 5: Sync status pill, queue sheet, banner copy

**Files:**
- Create: `src/components/offline/SyncStatusPill.tsx`, `src/components/offline/QueueSheet.tsx`, `src/components/offline/SyncStatusPill.test.tsx`
- Modify: `src/components/layout/DashboardLayout.tsx` (mount pill before `QuickCreateMenu`), `src/components/pwa/OfflineBanner.tsx` (copy)

- [ ] **Step 1: Pill states** (all guardrail copy, plain text): offline with N pending → `Offline · N queued` (warning tone); online with pending and a replay in flight → `Syncing…`; failed > 0 → `N need attention` (destructive tone); otherwise render nothing (an "All synced" state is noise in a top bar — show it only as a 2 s toast when a replay finishes with zero pending, via the runner). Tap opens `QueueSheet` (a `ResponsiveDialog`) listing ops oldest-first: kind label ("Complete task", "New issue", "Comment", "Resolve issue"), the task/issue title from the payload, `createdAt` relative time, photo count, status chip, and for failed ops the `lastError` plus Retry / Discard buttons (44 px). Footer note: "Signing out discards changes that have not synced." `track('offline_queue_opened', { pending, failed })`.

- [ ] **Step 2: Banner copy** — `OfflineBanner` becomes "You're offline. Your day is available; changes you make will sync when you're back online." (spec §5.1 promised this once R2b landed).

- [ ] **Step 3: Tests** — render the pill with a mocked `useOfflineQueue` + `useOnlineStatus` for each state; open the sheet; Retry calls `retry(id)`, Discard calls `discard(id)`.

- [ ] **Step 4: gate, tests, commit** — `git add src/components/offline/SyncStatusPill.tsx src/components/offline/QueueSheet.tsx src/components/offline/SyncStatusPill.test.tsx src/components/layout/DashboardLayout.tsx src/components/pwa/OfflineBanner.tsx && git commit -m "Sync status pill and queue sheet; offline banner promises the sync"`

---

### Task 6: Pending overlay on My Day and the Issues list

**Files:**
- Create: `src/lib/offline/pendingOverlay.ts`, `src/lib/offline/pendingOverlay.test.ts`
- Modify: `src/pages/MyDay.tsx`, `src/pages/MyDay.test.tsx`, `src/pages/Issues.tsx`

- [ ] **Step 1: Pure selectors** — `queuedTaskIds(ops)` → Set of `taskInstanceId` for pending/failed `task_complete` ops; `queuedIssues(ops, buildingNames)` → array of `{ id, title, description, priority, status: 'open', building_id, building_name, created_at: iso(createdAt), queued: true, failed: boolean }` from `issue_create` ops. Tests for both.

- [ ] **Step 2: My Day** — tasks whose id is in `queuedTaskIds` render with a "Queued" (or "Needs attention") chip instead of the Complete button, still counted in their bucket; `useMyWork` untouched. **Issues page** — prepend `queuedIssues` (from `useOfflineQueue().ops`) to the list with a "Queued" chip and no detail dialog (tap opens the QueueSheet). Keep filters working (queued rows participate in the status/priority filters).

- [ ] **Step 3: Tests** — MyDay test: with a queued op for `t1`, the row shows "Queued" and no Complete button. Issues page has no test; add a minimal one rendering with mocked `useIssues` + `useOfflineQueue` and asserting the queued row.

- [ ] **Step 4: gate, tests, commit** — `git add src/lib/offline/pendingOverlay.ts src/lib/offline/pendingOverlay.test.ts src/pages/MyDay.tsx src/pages/MyDay.test.tsx src/pages/Issues.tsx src/pages/Issues.test.tsx && git commit -m "Queued writes show on My Day and the Issues list"`

---

### Task 7: Live offline smoke

**Files:**
- Create: `scripts/offline-smoke.ts`
- Modify: `package.json` (`"smoke:offline": "npx vite-node scripts/offline-smoke.ts"`), `.env.example` (document `SMOKE_*` → `VITE_*` mapping for this smoke)

- [ ] **Step 1: Script** — runs under `vite-node` so it can import the real queue/replay modules through the `@/` alias. Needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (same as the other smokes) and sets `import.meta.env.VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` before importing the client (`process.env.VITE_SUPABASE_URL = process.env.SUPABASE_URL` etc. at the top; vite-node exposes `process.env` VITE_ vars through `import.meta.env`). Refuses the prod ref unless `SMOKE_ALLOW_PROD=1` (copy the guard from `notifications-smoke.mjs`). Imports `fake-indexeddb/auto`. Steps: create a building + a site user + a pending task via the service role (raw fetch, same helpers as `checklist-smoke.mjs`); `supabase.auth.signInWithPassword` as the user; stub `navigator.onLine = false` (`Object.defineProperty(globalThis, 'navigator', …)`); `enqueueAndRun` three ops: `task_complete`, `issue_create`, `issue_comment` (on the created issue id) — all return `queued`; set online; `replayAll(uid)` twice; assert via service role: exactly one `task_completions` row with the client `completionId`, one `issues` row with the client `issueId`, one `issue_activity` row with the client `activityId`; queue empty; a `notifications` row for the comment if a recipient was given (use the admin as reporter). Teardown everything (users, rows, building). Print `passed/failed` like the others.

- [ ] **Step 2: Run against staging** (controller), fix, commit — `git add scripts/offline-smoke.ts package.json .env.example && git commit -m "Live offline-replay smoke"`

---

### Task 8 (controller): verify, review, record

- [ ] `npm run smoke && npm run smoke:notifications && npm run smoke:offline` against staging; nothing to apply to prod (no migration); whole-slice review; Status section here; `docs/plans/APPLY_CHECKLIST.md` R2b section; push; PR #3 body.
