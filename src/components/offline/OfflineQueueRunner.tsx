import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { countOps } from '@/lib/offline/queue';
import { replayAll } from '@/lib/offline/replay';
import { queryClient } from '@/lib/queryClient';

/** Triggers arrive in bursts (online + visibilitychange + status flip); one replay covers them all. */
const DEBOUNCE_MS = 500;

/**
 * Renders nothing. Kicks the queue replay whenever the device might have regained a connection:
 * on mount with a signed-in user, on the window `online` event, when the tab becomes visible
 * again, and when `useOnlineStatus()` flips to true. Every trigger is debounced into one
 * `replayAll(uid)` call; replay itself is single-flight, so overlapping kicks are harmless.
 * A uid change only rewires the listeners — the queue is per user, nothing to hand over.
 *
 * After a run the pages that show the synced rows are refetched (My Day and the building
 * overview read through react-query; the Issues list subscribes to the queue emitter itself),
 * and when the run emptied a non-empty queue the user gets a short "All synced".
 */
async function replayAndRefresh(uid: string): Promise<void> {
  const before = await countOps(uid);
  await replayAll(uid);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['my-work'] }),
    queryClient.invalidateQueries({ queryKey: ['building-overview'] }),
  ]);
  const after = await countOps(uid);
  if (before > 0 && after === 0) toast.success('All synced', { duration: 2000 });
}

export function OfflineQueueRunner() {
  const { user } = useAuth();
  const uid = user?.id;
  const online = useOnlineStatus();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const kick = useCallback(() => {
    if (!uid) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      replayAndRefresh(uid).catch((e: unknown) => {
        // replayAll swallows per-op errors; only the store itself failing lands here.
        console.warn('[offline-queue] replay could not run', e);
      });
    }, DEBOUNCE_MS);
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const onVisible = () => { if (document.visibilityState === 'visible') kick(); };
    window.addEventListener('online', kick);
    document.addEventListener('visibilitychange', onVisible);
    kick();
    return () => {
      window.removeEventListener('online', kick);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    };
  }, [uid, kick]);

  // useOnlineStatus can flip to true without a window `online` event reaching this listener
  // (it is subscribed first and mounts earlier in the tree), so watch the value too.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) kick();
    wasOnline.current = online;
  }, [online, kick]);

  return null;
}
