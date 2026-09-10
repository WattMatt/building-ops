import { useCallback, useEffect, useState } from 'react';
import { track } from '@/lib/analytics';
import { currentSubscription, pushSupport, subscribePush, unsubscribePush } from '@/lib/push';

export type PushStatus = 'unsupported' | 'ios-not-installed' | 'off' | 'on' | 'denied' | 'busy';

/**
 * This device's push state for the Profile switch. Reads browser permission plus the
 * service worker's subscription on mount; `enable`/`disable` drive the lib and report
 * the toggle. `userId` is the signed-in user the subscription row belongs to.
 *
 * Errors are surfaced to the caller (thrown from enable/disable) so the page decides how
 * to tell the user; the status always settles back to something the switch can render.
 */
export function usePushSubscription(userId: string | undefined) {
  const [status, setStatus] = useState<PushStatus>(() => {
    const support = pushSupport();
    if (support !== 'ok') return support;
    return Notification.permission === 'denied' ? 'denied' : 'busy';
  });

  useEffect(() => {
    if (status !== 'busy') return;
    let cancelled = false;
    void currentSubscription().then((sub) => {
      if (!cancelled) setStatus(sub ? 'on' : 'off');
    });
    return () => {
      cancelled = true;
    };
    // Only the initial probe: later 'busy' states are owned by enable/disable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enable = useCallback(async () => {
    if (!userId) return;
    setStatus('busy');
    try {
      const result = await subscribePush(userId);
      if (result === 'subscribed') {
        setStatus('on');
        track('push_toggled', { on: true });
      } else if (result === 'denied') {
        setStatus('denied');
      } else {
        setStatus('unsupported');
      }
    } catch (err) {
      setStatus('off');
      throw err;
    }
  }, [userId]);

  const disable = useCallback(async () => {
    setStatus('busy');
    try {
      await unsubscribePush();
      setStatus('off');
      track('push_toggled', { on: false });
    } catch (err) {
      setStatus('on');
      throw err;
    }
  }, []);

  return { status, enable, disable };
}
