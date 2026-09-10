/**
 * Web Push subscription for this device. The row in `push_subscriptions` is what the
 * senders (`supabase/functions/_shared/push.ts`) fan out to; the browser-side
 * PushSubscription is the credential that row describes.
 *
 * Env-gated like analytics: with no VITE_VAPID_PUBLIC_KEY the whole feature is off and
 * the Profile switch does not render, so a preview build without the key never prompts.
 *
 * Inbox rows remain the record; a push is a hint. Nothing here throws on the happy path
 * outside a genuine browser/API failure, which the caller reports as a toast.
 */
import { supabase } from '@/integrations/supabase/client';
import { isIosSafari, isStandalone } from '@/hooks/useInstallPrompt';

const KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

/** True when the build carries a VAPID public key; the switch is hidden otherwise. */
export const PUSH_ENABLED = !!KEY;

export type PushSupport = 'unsupported' | 'ios-not-installed' | 'ok';
export type SubscribeResult = 'subscribed' | 'denied' | 'unsupported';

/**
 * Decode a base64url VAPID public key into the raw bytes `pushManager.subscribe` wants.
 * Chrome accepts the string form, Safari does not, so always pass bytes.
 */
export function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Whether this browser can subscribe at all. iOS Safari only exposes push to web apps
 * added to the home screen, so a plain-tab visit is reported separately so the UI can
 * say what to do about it.
 */
export function pushSupport(): PushSupport {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'unsupported';
  if (isIosSafari() && !isStandalone()) return 'ios-not-installed';
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return supported ? 'ok' : 'unsupported';
}

/** The service worker's current subscription for this origin, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Ask permission, subscribe through the service worker, and record the endpoint for
 * `uid`. Re-running on a device that is already subscribed refreshes the row (the
 * endpoint is unique) and clears any `failed_at` a sender stamped earlier.
 */
export async function subscribePush(uid: string): Promise<SubscribeResult> {
  if (!KEY || pushSupport() !== 'ok') return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(KEY),
    }));

  const keys = sub.toJSON().keys ?? {};
  const p256dh = keys.p256dh;
  const auth = keys.auth;
  if (!p256dh || !auth) throw new Error('Push subscription has no encryption keys');

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: uid,
      endpoint: sub.endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent.slice(0, 200),
      last_seen_at: new Date().toISOString(),
      failed_at: null,
    },
    { onConflict: 'endpoint' },
  );
  if (error) throw error;
  return 'subscribed';
}

/**
 * Remove this device's row, then drop the browser subscription. Row first: if the
 * browser side fails the sender still stops targeting a device the user turned off.
 */
export async function unsubscribePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  if (error) throw error;
  await sub.unsubscribe();
}
