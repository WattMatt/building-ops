/**
 * Product analytics + error reporting, both no-ops unless their env keys are set, so local
 * and preview builds send nothing. Keys are an owner action (roadmap decision D8).
 */
type Props = Record<string, string | number | boolean | null | undefined>;
let posthog: { capture: (e: string, p?: Props) => void; identify: (id: string, p?: Props) => void; reset: () => void } | null = null;

export async function initAnalytics(): Promise<void> {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (key) {
    const mod = await import('posthog-js');
    mod.default.init(key, { api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://eu.i.posthog.com', capture_pageview: true, autocapture: false, persistence: 'localStorage' });
    posthog = mod.default;
  }
  if (dsn) {
    const Sentry = await import('@sentry/react');
    Sentry.init({ dsn, tracesSampleRate: 0.1, environment: import.meta.env.MODE });
  }
}
export function track(event: string, props?: Props): void { posthog?.capture(event, props); }
export function identify(userId: string, props?: Props): void { posthog?.identify(userId, props); }
export function resetAnalytics(): void { posthog?.reset(); }
