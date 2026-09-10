import { enqueue, getOp } from './queue';
import { replayAll, runOne } from './replay';
import type { OpPayload, QueuedPhoto, RunOutcome } from './types';

/**
 * The one entry point the dialogs use, on- and offline. Persist first (so a crash or a closed
 * tab never loses the write), then, when the browser thinks it is online, replay everything
 * older that is still pending BEFORE running the new op: an issue_comment must never jump an
 * issue_create that a transient network error left in the queue (it would fail its FK). If the
 * older ops cannot reach the server the new one waits behind them. The outcome tells the dialog
 * which toast to show for ITS op, and carries the op's id so a dialog that learns the failure is
 * terminal (nothing a retry can fix) can discard the op itself.
 */
export async function enqueueAndRun(uid: string, payload: OpPayload, photos: QueuedPhoto[]): Promise<RunOutcome & { opId: string }> {
  const op = await enqueue(uid, payload, photos);
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { status: 'queued', opId: op.id };
  const { blocked } = await replayAll(uid, { stopAt: op.id });
  if (blocked) return { status: 'queued', opId: op.id };
  // A runner-triggered replay that started between the enqueue and the replayAll above shares
  // that run — which has no stopAt, so it already ran this op. Running it again would upload the
  // photos twice and, for complete_task, report already_completed as if someone else had done it.
  if (!(await getOp(uid, op.id))) return { status: 'synced', result: null, opId: op.id };
  return { ...(await runOne(op)), opId: op.id };
}
