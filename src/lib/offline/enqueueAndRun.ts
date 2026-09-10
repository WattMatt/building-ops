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
