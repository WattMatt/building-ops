/**
 * Product analytics + error reporting, both no-ops unless their env keys are set, so local
 * and preview builds send nothing. Keys are an owner action (roadmap decision D8).
 *
 * Two things this module exists to get right:
 *
 * 1. Nothing is dropped while the vendor chunk loads. Both SDKs arrive via dynamic
 *    `import()`, so there is a window between `initAnalytics()` being called and the
 *    module being usable. Every public entry point queues behind the module-level
 *    `ready` promise instead of reading the SDK handle synchronously, so a `track()`
 *    fired during that window still lands.
 *
 * 2. No URL that could carry an auth token ever reaches a vendor. Supabase invite and
 *    recovery links land on `/set-password#access_token=…&refresh_token=…` (and
 *    `/reset#…`), and the fragment is live credential material until the SDK consumes
 *    it. Both vendors therefore get a scrubbing hook — see `scrubUrl`.
 */
import type { CaptureResult } from 'posthog-js';

type Props = Record<string, string | number | boolean | null | undefined>;

let posthog: {
  capture: (e: string, p?: Props) => void;
  identify: (id: string, p?: Props) => void;
  reset: () => void;
} | null = null;

// Type-only query: erased at build time, so this does NOT pull Sentry into the main chunk.
let sentry: typeof import('@sentry/react') | null = null;

/**
 * Resolves once `initAnalytics()` has settled. Starts pre-resolved so that a call made
 * when analytics is never initialised (tests, and any build without keys) is a cheap
 * no-op rather than a promise that hangs forever holding a reference to its argument.
 */
let ready: Promise<void> = Promise.resolve();

/** Query params worth stripping defensively, in case a link ever puts a token in the query. */
const TOKEN_PARAMS = ['access_token', 'refresh_token', 'code'];

/** PostHog properties that hold a URL and therefore need scrubbing. */
const URL_PROPERTIES = ['$current_url', '$initial_current_url', '$referrer'] as const;

/**
 * Strip credential material out of a URL before it is handed to a third party.
 *
 * The fragment goes entirely — invite/recovery links carry `access_token` and
 * `refresh_token` there, and no fragment we produce is worth the risk of keeping.
 * Known token query params are removed as well, belt-and-braces, in case a future link
 * shape puts them in the query string.
 *
 * Pure and total: any string in, a string out, never throws, so it is safe to call from
 * inside a vendor hook where an exception would be swallowed or would break capture.
 */
export function scrubUrl(url: string): string {
  if (!url) return url;

  const hashAt = url.indexOf('#');
  const withoutFragment = hashAt === -1 ? url : url.slice(0, hashAt);

  const queryAt = withoutFragment.indexOf('?');
  if (queryAt === -1) return withoutFragment;

  const base = withoutFragment.slice(0, queryAt);
  const params = new URLSearchParams(withoutFragment.slice(queryAt + 1));
  if (!TOKEN_PARAMS.some((name) => params.has(name))) return withoutFragment;

  for (const name of TOKEN_PARAMS) params.delete(name);
  const rest = params.toString();
  return rest ? `${base}?${rest}` : base;
}

/** PostHog `before_send`: rewrite every URL-bearing property on the outgoing event. */
function scrubCapture(captured: CaptureResult | null): CaptureResult | null {
  const properties = captured?.properties;
  if (!properties) return captured;
  for (const key of URL_PROPERTIES) {
    const value = properties[key];
    if (typeof value === 'string') properties[key] = scrubUrl(value);
  }
  return captured;
}

async function initPostHog(): Promise<void> {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!key) return;
  const mod = await import('posthog-js');
  mod.default.init(key, {
    api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://eu.i.posthog.com',
    // 'history_change' so client-side route changes count as pageviews; the app is a
    // SPA, and plain `true` would only ever record the first hard load.
    capture_pageview: 'history_change',
    autocapture: false,
    persistence: 'localStorage',
    // Note: PostHog's `ip` init option is a documented no-op in this version. IP
    // collection is switched off in the PostHog project ("Discard client IP data") —
    // see .env.example.
    before_send: scrubCapture,
  });
  posthog = mod.default;
}

async function initSentry(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  const mod = await import('@sentry/react');
  mod.init({
    dsn,
    environment: import.meta.env.MODE,
    // No browser-tracing integration is registered, so a trace sample rate would only
    // cost bundle size and sample nothing. Errors only, deliberately.
    beforeSend(event) {
      if (event.request?.url) event.request.url = scrubUrl(event.request.url);
      return event;
    },
  });
  sentry = mod;
}

/**
 * Load and configure whichever vendors have keys. The two are independent: a failing or
 * ad-blocked PostHog chunk must not cost us error reporting, and vice versa. Never
 * rejects — analytics is not load-bearing, so a failure is a DEV warning and nothing more.
 */
export function initAnalytics(): Promise<void> {
  ready = Promise.allSettled([initPostHog(), initSentry()])
    .then((results) => {
      if (!import.meta.env.DEV) return;
      for (const result of results) {
        if (result.status === 'rejected') console.warn('[analytics] init failed:', result.reason);
      }
    })
    .catch(() => { /* analytics must never break the app */ });
  return ready;
}

/** Queue work behind init so a call made before the SDK chunk lands is not lost. */
function whenReady(fn: () => void): void {
  void ready.then(fn).catch(() => { /* a vendor call must never surface to the app */ });
}

export function track(event: string, props?: Props): void {
  whenReady(() => { if (posthog) posthog.capture(event, props); });
}

export function identify(userId: string, props?: Props): void {
  whenReady(() => { if (posthog) posthog.identify(userId, props); });
}

export function resetAnalytics(): void {
  whenReady(() => { if (posthog) posthog.reset(); });
}

/**
 * Report a caught error to Sentry. A no-op unless VITE_SENTRY_DSN is configured, so
 * local and preview builds stay silent.
 */
export function reportError(error: unknown, context?: Props): void {
  whenReady(() => {
    if (sentry) sentry.captureException(error, context ? { extra: { ...context } } : undefined);
  });
}
