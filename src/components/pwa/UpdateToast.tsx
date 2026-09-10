import { useEffect } from 'react';
import { toast } from 'sonner';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Registers the app-shell service worker (registerType: "prompt" in vite.config.ts) and,
 * when a new build is waiting, offers a Reload instead of swapping under the user's feet.
 * Renders nothing. Mount once, and only when `'serviceWorker' in navigator`.
 */
export function UpdateToast() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: (e) => {
      if (import.meta.env.DEV) console.error('sw register:', e);
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    toast('A new version is ready', {
      action: { label: 'Reload', onClick: () => void updateServiceWorker(true) },
      duration: Infinity,
    });
  }, [needRefresh, updateServiceWorker]);

  return null;
}
