import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { listOps, removeOp, subscribeQueue } from '@/lib/offline/queue';
import { replayAll, retryOp } from '@/lib/offline/replay';
import type { QueuedOp, RunOutcome } from '@/lib/offline/types';

export const OFFLINE_QUEUE_KEY = 'offline-queue';

export interface OfflineQueueState {
  ops: QueuedOp[];
  /** Waiting for a connection (or mid-replay). */
  pending: number;
  /** Rejected by the backend; needs the user to retry or discard. */
  failed: number;
  retry: (id: string) => Promise<RunOutcome>;
  discard: (id: string) => Promise<void>;
  retryAll: () => Promise<void>;
}

const EMPTY: QueuedOp[] = [];

/**
 * The current user's offline write queue as a query. The queue store emits on every mutation
 * and this hook invalidates on that, so every subscriber (pill, sheet, overlays) re-reads
 * together. Deliberately NOT in the persisted read cache: IndexedDB is already the source of
 * truth, and a stale snapshot of "what is waiting" is worse than none.
 */
export function useOfflineQueue(): OfflineQueueState {
  const { user } = useAuth();
  const uid = user?.id;
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: [OFFLINE_QUEUE_KEY, uid],
    queryFn: () => listOps(uid as string),
    enabled: !!uid,
    // This reads IndexedDB, not the network: it must run while offline, which is exactly
    // when the queue is worth looking at. The default 'online' mode would pause it.
    networkMode: 'always',
    staleTime: Infinity,
    retry: false,
  });

  useEffect(
    () => subscribeQueue(() => { void qc.invalidateQueries({ queryKey: [OFFLINE_QUEUE_KEY] }); }),
    [qc],
  );

  const ops = data ?? EMPTY;
  let pending = 0;
  let failed = 0;
  for (const op of ops) {
    if (op.status === 'failed') failed += 1;
    else pending += 1;
  }

  const retry = useCallback(
    (id: string): Promise<RunOutcome> =>
      uid ? retryOp(uid, id) : Promise.resolve({ status: 'failed', error: 'Not signed in.' }),
    [uid],
  );
  const discard = useCallback((id: string) => (uid ? removeOp(uid, id) : Promise.resolve()), [uid]);
  const retryAll = useCallback(async () => { if (uid) await replayAll(uid, { retryFailed: true }); }, [uid]);

  return { ops, pending, failed, retry, discard, retryAll };
}
