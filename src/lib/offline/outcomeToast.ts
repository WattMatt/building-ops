/**
 * One toast per `enqueueAndRun` outcome, so every field dialog says the same thing about the
 * same situation. The queued and failed copy is a guardrail: plain text, never through <Hint>.
 */
import { toast } from 'sonner';
import type { RunOutcome } from './types';

export const QUEUED_DEFAULT = "Saved on this device — it will sync when you're back online";

/**
 * `synced` is optional so a dialog that never toasted on success (the comment composer) can
 * keep its quiet success path while still getting the shared queued/failed copy.
 */
export function toastForOutcome(outcome: RunOutcome, copy: { synced?: string; queued?: string }): void {
  switch (outcome.status) {
    case 'synced':
      if (copy.synced) toast.success(copy.synced);
      break;
    case 'queued':
      toast(copy.queued ?? QUEUED_DEFAULT);
      break;
    case 'failed':
      toast.error(outcome.error);
      break;
  }
}
