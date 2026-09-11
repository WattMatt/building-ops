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

/**
 * Query params carrying credential material. `t` is the bearer token of the ICS feed
 * (`/functions/v1/ics-feed?t=…`), the share function's GET (`/functions/v1/report-share?t=…`) and
 * the tenant-intake function (`/functions/v1/tenant-intake?t=…`), which reaches Sentry as a fetch
 * breadcrumb's `data.url`; no route of ours uses `t` for anything else.
 */
const TOKEN_PARAMS = ['access_token', 'refresh_token', 'code', 't'];

/**
 * Credentials embedded in the PATH rather than the query. `/share/:token` (a shared report) and
 * `/intake/:token` (the public tenant form whose token is printed on the building's poster) are
 * both public pages whose 43-char token IS the credential, and PostHog records
 * `$current_url`/`$pathname` for every pageview, so the path has to be redacted as well as the
 * query and the fragment.
 */
const TOKEN_PATHS: readonly (readonly [RegExp, string])[] = [
  [/\/share\/[A-Za-z0-9_-]{43}/g, '/share/[token]'],
  [/\/intake\/[A-Za-z0-9_-]{43}/g, '/intake/[token]'],
];

/** Replace every path-embedded token with a placeholder. Pure; safe on any string. */
function redactPaths(url: string): string {
  let out = url;
  for (const [pattern, replacement] of TOKEN_PATHS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * PostHog properties that hold a URL and therefore need scrubbing. The `$initial_*`
 * spellings are person properties rather than event properties — PostHog writes them
 * into `$set_once` — so they are looked for in every bag, not just on the event.
 */
const URL_PROPERTIES = [
  '$current_url',
  '$initial_current_url',
  '$referrer',
  '$initial_referrer',
  '$pathname',
  '$initial_pathname',
] as const;

/**
 * Strip credential material out of a URL before it is handed to a third party.
 *
 * The fragment goes entirely — invite/recovery links carry `access_token` and
 * `refresh_token` there, and no fragment we produce is worth the risk of keeping.
 * Known token query params are removed as well, belt-and-braces, in case a future link
 * shape puts them in the query string. The path is redacted on EVERY return, because
 * `/share/:token` carries a live bearer credential in `location.pathname` itself.
 *
 * Pure and total: any string in, a string out, never throws, so it is safe to call from
 * inside a vendor hook where an exception would be swallowed or would break capture.
 */
export function scrubUrl(url: string): string {
  if (!url) return url;

  const hashAt = url.indexOf('#');
  const withoutFragment = hashAt === -1 ? url : url.slice(0, hashAt);

  const queryAt = withoutFragment.indexOf('?');
  if (queryAt === -1) return redactPaths(withoutFragment);

  const base = redactPaths(withoutFragment.slice(0, queryAt));
  const params = new URLSearchParams(withoutFragment.slice(queryAt + 1));
  if (!TOKEN_PARAMS.some((name) => params.has(name))) return redactPaths(withoutFragment);

  for (const name of TOKEN_PARAMS) params.delete(name);
  const rest = params.toString();
  return rest ? `${base}?${rest}` : base;
}

type PropertyBag = Record<string, unknown>;

/** Rewrite every URL-bearing key of one property bag, in place. Tolerates a missing bag. */
function scrubPropertyBag(bag: unknown): void {
  if (!bag || typeof bag !== 'object') return;
  const properties = bag as PropertyBag;
  for (const key of URL_PROPERTIES) {
    const value = properties[key];
    if (typeof value === 'string') properties[key] = scrubUrl(value);
  }
}

/**
 * PostHog `before_send`: rewrite every URL-bearing property on the outgoing event.
 *
 * Event properties are only half of it. Person properties travel in their own bags —
 * PostHog puts `$initial_current_url` and `$initial_referrer` into `$set_once` and
 * refreshes `$current_url`/`$referrer` in `$set` — so an invite link's fragment reaches
 * the vendor as a *person* property, and permanently, unless those bags are walked too.
 * Both placements are covered: nested under `properties` (how the payload is shaped on
 * the wire) and the top-level `$set`/`$set_once` on `CaptureResult`.
 */
function scrubCapture(captured: CaptureResult | null): CaptureResult | null {
  if (!captured) return captured;
  const properties = captured.properties as PropertyBag | undefined;
  scrubPropertyBag(properties);
  scrubPropertyBag(properties?.$set);
  scrubPropertyBag(properties?.$set_once);
  scrubPropertyBag(captured.$set);
  scrubPropertyBag(captured.$set_once);
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
    // Belt to `scrubCapture`'s braces: PostHog drops `location.hash` from every URL it
    // records (pageviews, web vitals, autocapture hrefs, replay meta) before our hook
    // ever sees the event. The app has no hash routes, so nothing of ours is lost.
    disable_capture_url_hashes: true,
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
      // Breadcrumbs keep their own copies of the URL: a navigation crumb records
      // `data.from` and `data.to`, and fetch/xhr crumbs a `data.url`. Landing on
      // `/set-password#access_token=…` and navigating away therefore ships the token to
      // Sentry via the crumb trail even when `request.url` is already clean.
      const breadcrumbs = event.breadcrumbs ?? [];
      // Only reassigned when there is something to scrub, so an event that carried no
      // breadcrumbs is handed on exactly as it arrived rather than growing an empty array.
      if (breadcrumbs.length) {
        event.breadcrumbs = breadcrumbs.map((crumb) => {
          if (!crumb.data) return crumb;
          const data = { ...crumb.data };
          for (const key of ['from', 'to', 'url'] as const) {
            const value = data[key];
            if (typeof value === 'string') data[key] = scrubUrl(value);
          }
          return { ...crumb, data };
        });
      }
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
