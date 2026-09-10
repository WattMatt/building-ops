import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// PUSH_ENABLED and the key are read at import time, so every case loads a fresh module
// after stubbing the env (the useGeotag.test.ts idiom).
const TEST_KEY = 'BAAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-Pw';

const state = vi.hoisted(() => ({
  upsert: vi.fn(),
  del: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: state.from },
}));

async function loadPush() {
  vi.resetModules();
  return import('./push');
}

const originalSW = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
const originalUA = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
const originalStandalone = Object.getOwnPropertyDescriptor(navigator, 'standalone');
const originalPushManager = Object.getOwnPropertyDescriptor(window, 'PushManager');
const originalNotification = Object.getOwnPropertyDescriptor(window, 'Notification');

function restore(target: object, key: string, desc: PropertyDescriptor | undefined) {
  if (desc) Object.defineProperty(target, key, desc);
  else delete (target as Record<string, unknown>)[key];
}

function setUA(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua });
}

interface FakeSub {
  endpoint: string;
  toJSON: () => { endpoint: string; keys?: { p256dh?: string; auth?: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
}

function stubServiceWorker(opts: { existing?: FakeSub | null; created?: FakeSub } = {}) {
  // Typed parameter so `subscribe.mock.calls[0][0]` is a PushSubscriptionOptionsInit for the assertions.
  const subscribe = vi.fn(async (options: PushSubscriptionOptionsInit) => (options ? opts.created ?? null : null));
  const getSubscription = vi.fn(async () => opts.existing ?? null);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { subscribe, getSubscription } }) },
  });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
  return { subscribe, getSubscription };
}

function stubNotification(permission: NotificationPermission, requestResult = permission) {
  const requestPermission = vi.fn(async () => requestResult);
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { permission, requestPermission },
  });
  return requestPermission;
}

function fakeSub(endpoint = 'https://push.example/abc'): FakeSub {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'P256', auth: 'AUTH' } }),
    unsubscribe: vi.fn(async () => true),
  };
}

describe('push lib', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', TEST_KEY);
    state.upsert.mockReset().mockResolvedValue({ error: null });
    state.eq.mockReset().mockResolvedValue({ error: null });
    state.del.mockReset().mockReturnValue({ eq: state.eq });
    state.from.mockReset().mockReturnValue({ upsert: state.upsert, delete: state.del });
    setUA('Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    restore(navigator, 'serviceWorker', originalSW);
    restore(navigator, 'userAgent', originalUA);
    restore(navigator, 'standalone', originalStandalone);
    restore(window, 'PushManager', originalPushManager);
    restore(window, 'Notification', originalNotification);
  });

  describe('urlBase64ToUint8Array', () => {
    it('decodes a 65-byte uncompressed P-256 key, handling - _ and missing padding', async () => {
      const { urlBase64ToUint8Array } = await loadPush();
      const bytes = urlBase64ToUint8Array(TEST_KEY);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(65);
      expect(bytes[0]).toBe(4);
      expect(Array.from(bytes.slice(1))).toEqual(Array.from({ length: 64 }, (_, i) => (i * 4) % 256));
    });
  });

  describe('PUSH_ENABLED', () => {
    it('is true when the key is set and false when it is empty', async () => {
      expect((await loadPush()).PUSH_ENABLED).toBe(true);
      vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
      expect((await loadPush()).PUSH_ENABLED).toBe(false);
    });
  });

  describe('pushSupport', () => {
    it('is ok when serviceWorker, PushManager and Notification all exist', async () => {
      stubServiceWorker();
      stubNotification('default');
      expect((await loadPush()).pushSupport()).toBe('ok');
    });

    it('is unsupported when PushManager is missing', async () => {
      stubServiceWorker();
      stubNotification('default');
      delete (window as unknown as { PushManager?: unknown }).PushManager;
      expect((await loadPush()).pushSupport()).toBe('unsupported');
    });

    it('is ios-not-installed for iOS Safari in a browser tab', async () => {
      stubServiceWorker();
      stubNotification('default');
      setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1');
      expect((await loadPush()).pushSupport()).toBe('ios-not-installed');
    });

    it('is ok for iOS Safari once installed to the home screen', async () => {
      stubServiceWorker();
      stubNotification('default');
      setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1');
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
      expect((await loadPush()).pushSupport()).toBe('ok');
    });
  });

  describe('subscribePush', () => {
    it('subscribes with the VAPID key and upserts the row keyed by endpoint', async () => {
      const created = fakeSub();
      const { subscribe } = stubServiceWorker({ created });
      const requestPermission = stubNotification('default', 'granted');
      const { subscribePush } = await loadPush();

      await expect(subscribePush('user-1')).resolves.toBe('subscribed');

      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(subscribe).toHaveBeenCalledTimes(1);
      const opts = subscribe.mock.calls[0][0];
      expect(opts.userVisibleOnly).toBe(true);
      expect(opts.applicationServerKey).toBeInstanceOf(Uint8Array);
      expect((opts.applicationServerKey as Uint8Array).length).toBe(65);

      expect(state.from).toHaveBeenCalledWith('push_subscriptions');
      expect(state.upsert).toHaveBeenCalledTimes(1);
      const [row, upsertOpts] = state.upsert.mock.calls[0];
      expect(row).toMatchObject({
        user_id: 'user-1',
        endpoint: 'https://push.example/abc',
        p256dh: 'P256',
        auth: 'AUTH',
        failed_at: null,
      });
      expect(typeof row.last_seen_at).toBe('string');
      expect(row.user_agent.length).toBeLessThanOrEqual(200);
      expect(upsertOpts).toEqual({ onConflict: 'endpoint' });
    });

    it('reuses an existing browser subscription instead of creating a second one', async () => {
      const existing = fakeSub('https://push.example/existing');
      const { subscribe } = stubServiceWorker({ existing });
      stubNotification('granted');
      const { subscribePush } = await loadPush();

      await expect(subscribePush('user-1')).resolves.toBe('subscribed');
      expect(subscribe).not.toHaveBeenCalled();
      expect(state.upsert.mock.calls[0][0].endpoint).toBe('https://push.example/existing');
    });

    it('returns denied and writes nothing when permission is refused', async () => {
      const { subscribe } = stubServiceWorker({ created: fakeSub() });
      stubNotification('default', 'denied');
      const { subscribePush } = await loadPush();

      await expect(subscribePush('user-1')).resolves.toBe('denied');
      expect(subscribe).not.toHaveBeenCalled();
      expect(state.upsert).not.toHaveBeenCalled();
    });

    it('returns unsupported without prompting when the browser cannot push', async () => {
      stubServiceWorker();
      const requestPermission = stubNotification('default', 'granted');
      delete (window as unknown as { PushManager?: unknown }).PushManager;
      const { subscribePush } = await loadPush();

      await expect(subscribePush('user-1')).resolves.toBe('unsupported');
      expect(requestPermission).not.toHaveBeenCalled();
    });

    it('surfaces an upsert error so the UI can report it', async () => {
      stubServiceWorker({ created: fakeSub() });
      stubNotification('granted');
      state.upsert.mockResolvedValue({ error: { message: 'RLS' } });
      const { subscribePush } = await loadPush();

      await expect(subscribePush('user-1')).rejects.toMatchObject({ message: 'RLS' });
    });
  });

  describe('unsubscribePush', () => {
    it('deletes the row by endpoint, then unsubscribes the browser', async () => {
      const existing = fakeSub('https://push.example/gone');
      stubServiceWorker({ existing });
      stubNotification('granted');
      const { unsubscribePush } = await loadPush();

      await unsubscribePush();

      expect(state.from).toHaveBeenCalledWith('push_subscriptions');
      expect(state.del).toHaveBeenCalledTimes(1);
      expect(state.eq).toHaveBeenCalledWith('endpoint', 'https://push.example/gone');
      expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when there is no subscription', async () => {
      stubServiceWorker({ existing: null });
      stubNotification('granted');
      const { unsubscribePush } = await loadPush();

      await unsubscribePush();
      expect(state.del).not.toHaveBeenCalled();
    });
  });

  describe('currentSubscription', () => {
    it('returns the service worker subscription when supported', async () => {
      const existing = fakeSub();
      stubServiceWorker({ existing });
      stubNotification('granted');
      const { currentSubscription } = await loadPush();
      expect(await currentSubscription()).toBe(existing);
    });

    it('returns null when unsupported', async () => {
      stubServiceWorker({ existing: fakeSub() });
      stubNotification('granted');
      delete (window as unknown as { PushManager?: unknown }).PushManager;
      const { currentSubscription } = await loadPush();
      expect(await currentSubscription()).toBeNull();
    });
  });
});
