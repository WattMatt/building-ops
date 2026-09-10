/// <reference lib="webworker" />
// The app's service worker. Built by vite-plugin-pwa's injectManifest strategy (vite.config.ts):
// the build replaces `self.__WB_MANIFEST` with the precache manifest, everything else here is
// ours. It does three things: serve the app shell offline, hand a waiting build over when the
// page asks (UpdateToast's Reload), and show/route Web Push notifications.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { safeInAppUrl } from './lib/pushUrl';

declare let self: ServiceWorkerGlobalScope & typeof globalThis & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

// App shell only (see vite.config.ts). Supabase REST/storage responses carry the user's bearer
// token and per-user RLS results; a shared SW cache would leak across users on one device.
// Offline data lives in the per-user query persister (src/lib/persist.ts). No runtime caching.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/rest\//, /^\/storage\//, /^\/auth\//],
  }),
);

// registerType: 'prompt' — a new build waits until the user taps Reload. vite-plugin-pwa's
// register helper (`updateServiceWorker(true)` → workbox-window `messageSkipWaiting`) posts
// `{ type: 'SKIP_WAITING' }`; the generateSW build answered the same message.
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Shape sent by supabase/functions/_shared/push.ts (`pushPayloadFor` in notifyRules.ts).
// Untrusted on arrival: every field is optional and `url` goes through the allowlist.
interface PushPayload { title?: string; body?: string | null; url?: string; tag?: string }

self.addEventListener('push', (event) => {
  let p: PushPayload = {};
  try {
    p = event.data?.json() ?? {};
  } catch {
    p = { title: event.data?.text() ?? '' };
  }
  const title = p.title?.trim() || 'Building Ops';
  // `renotify` is real (a same-tag notification replaces silently instead of buzzing again) but
  // TypeScript 5.5+ dropped it from lib NotificationOptions, so widen the type locally.
  const options: NotificationOptions & { renotify?: boolean } = {
    body: p.body ?? undefined,
    tag: p.tag,
    renotify: false,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: safeInAppUrl(p.url) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safeInAppUrl(event.notification.data?.url);
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const target = new URL(url, self.location.origin).href;
      // Reuse an open tab (focus, then navigate it) before opening another window.
      // WindowClient.navigate() rejects on a client this worker does not control (matchAll
      // includes uncontrolled ones), so a failure falls through to openWindow.
      for (const c of clients) {
        if ('focus' in c) {
          try {
            await c.focus();
            if ('navigate' in c) await (c as WindowClient).navigate(target);
            return;
          } catch {
            break;
          }
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
