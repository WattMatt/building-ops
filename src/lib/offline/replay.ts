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

function codeOf(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
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
    // Includes the handlers' own terminal codes (RESOLVE_DENIED, USER_MISMATCH). From a dialog the
    // caller discards the op itself; from a background replay it is simply left failed, with the
    // message, so the sheet shows it and the user can discard it. A retry re-runs it honestly.
    const error = messageOf(e);
    const code = codeOf(e);
    await updateOp(op.uid, op.id, { status: 'failed', lastError: error, attempts });
    return code ? { status: 'failed', error, code } : { status: 'failed', error };
  }
}

export interface ReplayOptions {
  /** Also re-run ops the user has to look at (parked as `failed`), clearing their error first. */
  retryFailed?: boolean;
  /**
   * Stop BEFORE the op with this id, leaving it and everything behind it untouched. `enqueueAndRun`
   * passes its own op here so every older pending write lands first, in order, while the caller
   * keeps running (and reporting on) its own op itself.
   */
  stopAt?: string;
}

export interface ReplayResult {
  /** True when the run stopped on a network failure: the op it stopped on (and all behind it) is still pending. */
  blocked: boolean;
}

/**
 * Per-user lock: a replay run and a single-op retry for the same user never overlap, so one op is
 * never run twice at once. Callers queue behind whatever holds the lock, in order.
 */
const locks = new Map<string, Promise<void>>();
async function withUserLock<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(uid) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  const tail = prev.then(() => mine);
  locks.set(uid, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(uid) === tail) locks.delete(uid);
  }
}

/** One run per user at a time; a second trigger while a run is going shares that run's promise. */
const inFlight = new Map<string, Promise<ReplayResult>>();

/**
 * Replays every pending op for the user (and failed ones when asked), oldest first. Concurrent calls
 * share one run — and therefore that run's options and result.
 */
export function replayAll(uid: string, opts: ReplayOptions = {}): Promise<ReplayResult> {
  const running = inFlight.get(uid);
  if (running) return running;
  const run = withUserLock(uid, async (): Promise<ReplayResult> => {
    let blocked = false;
    const ops = await listOps(uid);
    for (const op of ops) {
      if (op.id === opts.stopAt) break; // the caller runs this one (and reports on it) itself
      if (op.status === 'failed' && !opts.retryFailed) continue;
      const fresh = await getOp(uid, op.id); // may have been discarded meanwhile
      if (!fresh) continue;
      if (fresh.status === 'failed') await updateOp(uid, fresh.id, { status: 'pending', lastError: null });
      const outcome = await runOne({ ...fresh, status: 'pending' });
      if (outcome.status === 'queued') { blocked = true; break; } // still offline: stop, keep order
    }
    return { blocked };
  }).finally(() => { inFlight.delete(uid); });
  inFlight.set(uid, run);
  return run;
}

/**
 * Re-runs one parked op on the user's request. Takes the same per-user lock as `replayAll`, so a
 * background replay (retryAll, or the runner coming back online) that is already running this op
 * finishes first — the retry then finds the op gone instead of running it a second time.
 */
export function retryOp(uid: string, id: string): Promise<RunOutcome> {
  return withUserLock(uid, async () => {
    const op = await getOp(uid, id);
    if (!op) return { status: 'failed', error: 'This change is no longer queued.' };
    await updateOp(uid, id, { status: 'pending', lastError: null });
    return runOne({ ...op, status: 'pending', lastError: null });
  });
}
