/**
 * Sequential, per-user single-flight replay of the queue. Oldest first. A network failure stops
 * the run (everything behind it is still pending and will replay on the next trigger); a
 * duplicate (23505) means an earlier attempt already landed and the op is done; anything else is
 * a real rejection the user has to look at (retry or discard) — it never blocks the ops behind it.
 */
import { listOps, updateOp, removeOp, getOp } from './queue';
import { runOp } from './handlers';
import type { QueuedOp, RunOutcome } from './types';

/** After this many network failures the op is parked as failed so the queue cannot spin forever. */
export const MAX_ATTEMPTS = 20;

/**
 * Only a transport failure counts as "network": the TypeError fetch throws, or the same message
 * after supabase-js/postgrest-js has wrapped it into a plain error object. A bare TypeError is a
 * programming bug and must surface as failed, not retry silently; a statement timeout (57014) is
 * a real rejection, so "timed out" is deliberately not matched.
 */
export function isNetworkError(e: unknown): boolean {
  const msg = (e as { message?: string } | null)?.message ?? '';
  return (
    (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) ||
    /failed to fetch|network ?error|load failed|networkrequest/i.test(msg)
  );
}

export function isDuplicateError(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === '23505';
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
    const attempts = op.attempts + 1;
    if (isDuplicateError(e)) {
      await removeOp(op.uid, op.id);
      return { status: 'synced', result: { duplicate: true } };
    }
    if (isNetworkError(e)) {
      if (attempts >= MAX_ATTEMPTS) {
        const error = `Could not reach the server after ${MAX_ATTEMPTS} tries`;
        await updateOp(op.uid, op.id, { status: 'failed', lastError: error, attempts });
        return { status: 'failed', error };
      }
      await updateOp(op.uid, op.id, { attempts });
      return { status: 'queued' };
    }
    const error = messageOf(e);
    await updateOp(op.uid, op.id, { status: 'failed', lastError: error, attempts });
    return { status: 'failed', error };
  }
}

/** One run per user at a time; a second trigger while a run is going shares that run's promise. */
const inFlight = new Map<string, Promise<void>>();

/** Replays every pending op for the user (and failed ones when asked). Concurrent calls share one run. */
export function replayAll(uid: string, opts: { retryFailed?: boolean } = {}): Promise<void> {
  const running = inFlight.get(uid);
  if (running) return running;
  const run = (async () => {
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
      inFlight.delete(uid);
    }
  })();
  inFlight.set(uid, run);
  return run;
}

export async function retryOp(uid: string, id: string): Promise<RunOutcome> {
  const op = await getOp(uid, id);
  if (!op) return { status: 'failed', error: 'This change is no longer queued.' };
  await updateOp(uid, id, { status: 'pending', lastError: null });
  return runOne({ ...op, status: 'pending', lastError: null });
}
