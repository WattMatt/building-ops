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
  return (
    e instanceof TypeError ||
    status === 0 ||
    /failed to fetch|network|offline|load failed|timed? ?out/i.test(msg) ||
    (typeof navigator !== 'undefined' && !navigator.onLine)
  );
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
    if (isDuplicateError(e)) {
      await removeOp(op.uid, op.id);
      return { status: 'synced', result: { duplicate: true } };
    }
    if (isNetworkError(e)) {
      await updateOp(op.uid, op.id, { attempts: op.attempts + 1 });
      return { status: 'queued' };
    }
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
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export async function retryOp(uid: string, id: string): Promise<RunOutcome> {
  const op = await getOp(uid, id);
  if (!op) return { status: 'failed', error: 'This change is no longer queued.' };
  await updateOp(uid, id, { status: 'pending', lastError: null });
  return runOne({ ...op, status: 'pending', lastError: null });
}
