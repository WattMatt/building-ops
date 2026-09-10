import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { replayAll } from '@/lib/offline/replay';

/** Triggers arrive in bursts (online + visibilitychange + status flip); one replay covers them all. */
const DEBOUNCE_MS = 500;

/**
 * Renders nothing. Kicks the queue replay whenever the device might have regained a connection:
 * on mount with a signed-in user, on the window `online` event, when the tab becomes visible
 * again, and when `useOnlineStatus()` flips to true. Every trigger is debounced into one
 * `replayAll(uid)` call; replay itself is single-flight, so overlapping kicks are harmless.
 * A uid change only rewires the listeners — the queue is per user, nothing to hand over.
 */
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
      replayAll(uid).catch((e: unknown) => {
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
