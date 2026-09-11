import { describe, it, expect, vi, beforeEach } from 'vitest';

const init = vi.hoisted(() => vi.fn());
const capture = vi.hoisted(() => vi.fn());
const identifyMock = vi.hoisted(() => vi.fn());
const reset = vi.hoisted(() => vi.fn());
const sentryInit = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());

vi.mock('posthog-js', () => ({
  default: { init, capture, identify: identifyMock, reset },
}));

vi.mock('@sentry/react', () => ({
  init: sentryInit,
  captureException,
}));

/** The shape PostHog hands `before_send`; only the property bags matter here. */
type PropertyBag = Record<string, unknown>;
type Captured = { properties: PropertyBag; $set?: PropertyBag; $set_once?: PropertyBag };
type BeforeSend = (c: Captured | null) => Captured | null;

/** Pull the `before_send` hook back out of the options PostHog's init was called with. */
function beforeSendFromInit(): BeforeSend {
  const options = init.mock.calls[0]?.[1] as { before_send?: BeforeSend } | undefined;
  if (!options?.before_send) throw new Error('posthog init was not given a before_send hook');
  return options.before_send;
}

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe('scrubUrl', () => {
    // Invite and recovery links carry live Supabase credentials in the fragment; none of
    // these may survive into a vendor payload.
    it.each([
      [
        'drops an invite fragment carrying access + refresh tokens',
        'https://app.example.com/set-password#access_token=eyJhbGciOi.J9&refresh_token=r3fr3sh&type=invite',
        'https://app.example.com/set-password',
      ],
      [
        'drops a recovery fragment',
        'https://app.example.com/reset#access_token=abc&type=recovery',
        'https://app.example.com/reset',
      ],
      [
        'drops the marker fragment the app sets itself',
        'https://app.example.com/reset#type=recovery',
        'https://app.example.com/reset',
      ],
      [
        'drops any other fragment too, wholesale',
        'https://app.example.com/reports#section-3',
        'https://app.example.com/reports',
      ],
      [
        'strips token query params but keeps the rest of the query',
        'https://app.example.com/reset?code=pkce123&building=42',
        'https://app.example.com/reset?building=42',
      ],
      [
        'drops the whole query when only tokens were in it',
        'https://app.example.com/cb?access_token=a&refresh_token=b',
        'https://app.example.com/cb',
      ],
      [
        'strips tokens from the query AND drops the fragment',
        'https://app.example.com/cb?code=x&page=2#access_token=y',
        'https://app.example.com/cb?page=2',
      ],
      // The public share page carries a 43-char bearer token in the PATH, so the fragment and
      // query rules are not enough: `$current_url`, `$pathname` and Sentry's navigation crumbs
      // would ship the credential itself.
      [
        'redacts the share token out of the pathname',
        'https://app.example.com/share/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'https://app.example.com/share/[token]',
      ],
      [
        'redacts a share token on a bare path (the $pathname shape)',
        '/share/bBcC-dEfG_hIjKlMnOpQrStUvWxYz0123456789abcd',
        '/share/[token]',
      ],
      [
        'redacts the share token when the URL also carries a query and a fragment',
        'https://app.example.com/share/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?ref=mail#x',
        'https://app.example.com/share/[token]?ref=mail',
      ],
      [
        'redacts the share token on the token-query branch too',
        'https://app.example.com/share/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?code=x&page=2',
        'https://app.example.com/share/[token]?page=2',
      ],
      [
        'leaves a /share path that is not a token alone',
        'https://app.example.com/share/help',
        'https://app.example.com/share/help',
      ],
      // `/intake/:token` is the same shape: an unauthenticated page whose 43-char token is the
      // credential — and one that is printed on a poster, so it is the longest-lived of the two.
      [
        'redacts the intake token out of the pathname',
        'https://app.example.com/intake/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'https://app.example.com/intake/[token]',
      ],
      [
        'redacts an intake token on a bare path (the $pathname shape)',
        '/intake/bBcC-dEfG_hIjKlMnOpQrStUvWxYz0123456789abcd',
        '/intake/[token]',
      ],
      [
        'redacts the intake token when the URL also carries a query and a fragment',
        'https://app.example.com/intake/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?ref=qr#x',
        'https://app.example.com/intake/[token]?ref=qr',
      ],
      [
        'redacts the intake token on the token-query branch too',
        'https://app.example.com/intake/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?code=x&page=2',
        'https://app.example.com/intake/[token]?page=2',
      ],
      [
        'leaves an /intake path that is not a token alone',
        'https://app.example.com/intake/help',
        'https://app.example.com/intake/help',
      ],
      // `t` is the bearer token of the ICS feed and of the share function's GET; both reach
      // Sentry as a fetch breadcrumb URL.
      [
        'strips the ics-feed / report-share `t` token from the query',
        'https://x.supabase.co/functions/v1/ics-feed?t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'https://x.supabase.co/functions/v1/ics-feed',
      ],
      [
        'leaves an ordinary URL untouched',
        'https://app.example.com/dashboard?building=42&tab=open',
        'https://app.example.com/dashboard?building=42&tab=open',
      ],
      ['leaves a plain path untouched', 'https://app.example.com/dashboard', 'https://app.example.com/dashboard'],
      ['handles a bare path', '/set-password#access_token=a', '/set-password'],
      ['handles the empty string', '', ''],
      ['handles a non-URL string without throwing', 'not a url at all', 'not a url at all'],
    ])('%s', async (_name, input, expected) => {
      const { scrubUrl } = await import('./analytics');
      expect(scrubUrl(input)).toBe(expected);
    });
  });

  describe('init', () => {
    it('is a no-op with no env: initAnalytics resolves and track does not throw', async () => {
      const { initAnalytics, track } = await import('./analytics');
      await expect(initAnalytics()).resolves.toBeUndefined();
      expect(() => track('x')).not.toThrow();
      expect(init).not.toHaveBeenCalled();
      expect(sentryInit).not.toHaveBeenCalled();
    });

    it('does not call posthog init when VITE_POSTHOG_KEY is absent', async () => {
      const { initAnalytics } = await import('./analytics');
      await initAnalytics();
      expect(init).not.toHaveBeenCalled();
    });

    it('calls posthog init when VITE_POSTHOG_KEY is set', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test123');
      const { initAnalytics } = await import('./analytics');
      await initAnalytics();
      expect(init).toHaveBeenCalledTimes(1);
      expect(init).toHaveBeenCalledWith(
        'phc_test123',
        expect.objectContaining({
          api_host: 'https://eu.i.posthog.com',
          autocapture: false,
          // 'history_change', not true: SPA route changes must count as pageviews.
          capture_pageview: 'history_change',
          // PostHog strips location.hash itself, before before_send ever runs.
          disable_capture_url_hashes: true,
          persistence: 'localStorage',
          before_send: expect.any(Function),
        }),
      );
    });

    it('honours a VITE_POSTHOG_HOST override', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test123');
      vi.stubEnv('VITE_POSTHOG_HOST', 'https://ph.example.com');
      const { initAnalytics } = await import('./analytics');
      await initAnalytics();
      expect(init).toHaveBeenCalledWith(
        'phc_test123',
        expect.objectContaining({ api_host: 'https://ph.example.com' }),
      );
    });

    it('initialises Sentry only when a DSN is configured', async () => {
      const { initAnalytics } = await import('./analytics');
      await initAnalytics();
      expect(sentryInit).not.toHaveBeenCalled();
    });

    it('initialises Sentry with a DSN, an environment, and no trace sampling', async () => {
      vi.stubEnv('VITE_SENTRY_DSN', 'https://public@sentry.example.com/1');
      const { initAnalytics } = await import('./analytics');
      await initAnalytics();
      expect(sentryInit).toHaveBeenCalledTimes(1);
      const options = sentryInit.mock.calls[0][0];
      expect(options).toMatchObject({
        dsn: 'https://public@sentry.example.com/1',
        beforeSend: expect.any(Function),
      });
      expect(options.environment).toBeDefined();
      // No browser-tracing integration is registered, so a sample rate would be dead weight.
      expect(options).not.toHaveProperty('tracesSampleRate');
    });

    it('initialises each vendor independently: PostHog still loads when Sentry has no DSN', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test123');
      const { initAnalytics } = await import('./analytics');
      await initAnalytics();
      expect(init).toHaveBeenCalledTimes(1);
      expect(sentryInit).not.toHaveBeenCalled();
    });

    it('never rejects when a vendor init throws', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test123');
      vi.stubEnv('VITE_SENTRY_DSN', 'https://public@sentry.example.com/1');
      init.mockImplementationOnce(() => { throw new Error('ad blocker ate the chunk'); });
      const { initAnalytics } = await import('./analytics');
      await expect(initAnalytics()).resolves.toBeUndefined();
      // Sentry is unaffected by PostHog blowing up.
      expect(sentryInit).toHaveBeenCalledTimes(1);
    });
  });

  describe('URL scrubbing is wired into the vendors', () => {
    it("strips a token fragment from PostHog's event and person URL properties", async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test123');
      const { initAnalytics } = await import('./analytics');
      await initAnalytics();

      const beforeSend = beforeSendFromInit();
      const result = beforeSend({
        properties: {
          $current_url: 'https://app.example.com/set-password#access_token=eyJ.abc&refresh_token=r3f',
          $referrer: 'https://app.example.com/set-password#access_token=eyJ.ghi',
          $pathname: '/set-password#access_token=eyJ.jkl',
          building_id: 42,
          // Person properties ride along in their own bags. $initial_* is written once,
          // so a token that lands here is attached to the person for good.
          $set: { $current_url: 'https://app.example.com/reset#access_token=eyJ.mno' },
          $set_once: {
            $initial_current_url: 'https://app.example.com/reset#access_token=eyJ.def',
            $initial_referrer: 'https://app.example.com/set-password#refresh_token=r3f',
          },
        },
        // The same two bags also exist at the top level of CaptureResult.
        $set_once: { $initial_current_url: 'https://app.example.com/reset#access_token=eyJ.pqr' },
      });

      expect(result?.properties.$current_url).toBe('https://app.example.com/set-password');
      expect(result?.properties.$referrer).toBe('https://app.example.com/set-password');
      expect(result?.properties.$pathname).toBe('/set-password');
      const set = result?.properties.$set as Record<string, unknown>;
      const setOnce = result?.properties.$set_once as Record<string, unknown>;
      expect(set.$current_url).toBe('https://app.example.com/reset');
      expect(setOnce.$initial_current_url).toBe('https://app.example.com/reset');
      expect(setOnce.$initial_referrer).toBe('https://app.example.com/set-password');
      expect(result?.$set_once?.$initial_current_url).toBe('https://app.example.com/reset');
      // Nothing token-shaped survives anywhere in the payload.
      expect(JSON.stringify(result)).not.toContain('access_token');
      expect(JSON.stringify(result)).not.toContain('refresh_token');
      // Unrelated properties are left alone.
      expect(result?.properties.building_id).toBe(42);
    });

    it('leaves a captured event without URL properties alone, and tolerates null', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test123');
      const { initAnalytics } = await import('./analytics');
      await initAnalytics();

      const beforeSend = beforeSendFromInit();
      expect(beforeSend(null)).toBeNull();
      expect(beforeSend({ properties: { building_id: 7 } })?.properties.building_id).toBe(7);
    });

    it("strips a token fragment from Sentry's request URL", async () => {
      vi.stubEnv('VITE_SENTRY_DSN', 'https://public@sentry.example.com/1');
      const { initAnalytics } = await import('./analytics');
      await initAnalytics();

      const { beforeSend } = sentryInit.mock.calls[0][0];
      const event = beforeSend(
        { request: { url: 'https://app.example.com/set-password#access_token=eyJ.abc&refresh_token=r3f' } },
        {},
      );
      expect(event.request.url).toBe('https://app.example.com/set-password');

      // An event with no request block must survive untouched.
      expect(beforeSend({ message: 'boom' }, {})).toEqual({ message: 'boom' });
    });

    it("strips a token fragment from a Sentry navigation breadcrumb's from/to", async () => {
      vi.stubEnv('VITE_SENTRY_DSN', 'https://public@sentry.example.com/1');
      const { initAnalytics } = await import('./analytics');
      await initAnalytics();

      const { beforeSend } = sentryInit.mock.calls[0][0];
      const event = beforeSend(
        {
          message: 'boom',
          breadcrumbs: [
            {
              category: 'navigation',
              data: {
                from: 'https://app.example.com/set-password#access_token=eyJ.abc&refresh_token=r3f',
                to: 'https://app.example.com/dashboard?building=42',
              },
            },
            { category: 'fetch', data: { url: 'https://api.example.com/cb?access_token=a&page=2' } },
            // A crumb with no data at all must survive the map untouched.
            { category: 'console', message: 'hello' },
          ],
        },
        {},
      );

      expect(event.breadcrumbs[0].data.from).toBe('https://app.example.com/set-password');
      expect(event.breadcrumbs[0].data.to).toBe('https://app.example.com/dashboard?building=42');
      expect(event.breadcrumbs[1].data.url).toBe('https://api.example.com/cb?page=2');
      expect(event.breadcrumbs[2]).toEqual({ category: 'console', message: 'hello' });
      expect(JSON.stringify(event)).not.toContain('access_token');
      expect(JSON.stringify(event)).not.toContain('refresh_token');
    });
  });

  describe('forwarding', () => {
    it('forwards track to posthog.capture', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test123');
      const { initAnalytics, track } = await import('./analytics');
      await initAnalytics();
      track('report_exported', { format: 'pdf' });
      await vi.waitFor(() => expect(capture).toHaveBeenCalledWith('report_exported', { format: 'pdf' }));
    });

    it('forwards identify to posthog.identify', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test123');
      const { initAnalytics, identify } = await import('./analytics');
      await initAnalytics();
      identify('user-1', { role: 'manager' });
      await vi.waitFor(() => expect(identifyMock).toHaveBeenCalledWith('user-1', { role: 'manager' }));
    });

    it('forwards resetAnalytics to posthog.reset', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test123');
      const { initAnalytics, resetAnalytics } = await import('./analytics');
      await initAnalytics();
      resetAnalytics();
      await vi.waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
    });

    it('does not lose a track() fired before initAnalytics resolves', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test123');
      const { initAnalytics, track } = await import('./analytics');

      // Deliberately not awaited: this is the real-world window between main.tsx kicking
      // init off and the dynamically imported vendor chunk actually arriving.
      const pending = initAnalytics();
      track('app_opened');
      expect(capture).not.toHaveBeenCalled();

      await pending;
      await vi.waitFor(() => expect(capture).toHaveBeenCalledWith('app_opened', undefined));
    });

    it('does not lose an identify() fired before initAnalytics resolves', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test123');
      const { initAnalytics, identify } = await import('./analytics');

      const pending = initAnalytics();
      identify('user-2', { role: 'admin' });
      await pending;
      await vi.waitFor(() => expect(identifyMock).toHaveBeenCalledWith('user-2', { role: 'admin' }));
    });

    it('drops calls silently when no key is configured', async () => {
      const { initAnalytics, track, identify, resetAnalytics } = await import('./analytics');
      await initAnalytics();
      track('x');
      identify('user-1');
      resetAnalytics();
      await Promise.resolve();
      expect(capture).not.toHaveBeenCalled();
      expect(identifyMock).not.toHaveBeenCalled();
      expect(reset).not.toHaveBeenCalled();
    });
  });

  describe('reportError', () => {
    it('sends the error to Sentry when a DSN is configured', async () => {
      vi.stubEnv('VITE_SENTRY_DSN', 'https://public@sentry.example.com/1');
      const { initAnalytics, reportError } = await import('./analytics');
      await initAnalytics();

      const boom = new Error('boom');
      reportError(boom, { componentStack: 'at Dashboard' });
      await vi.waitFor(() => expect(captureException).toHaveBeenCalledWith(boom, {
        extra: { componentStack: 'at Dashboard' },
      }));
    });

    it('passes no hint when no context is given', async () => {
      vi.stubEnv('VITE_SENTRY_DSN', 'https://public@sentry.example.com/1');
      const { initAnalytics, reportError } = await import('./analytics');
      await initAnalytics();

      const boom = new Error('boom');
      reportError(boom);
      await vi.waitFor(() => expect(captureException).toHaveBeenCalledWith(boom, undefined));
    });

    it('is a no-op without a DSN', async () => {
      const { initAnalytics, reportError } = await import('./analytics');
      await initAnalytics();
      expect(() => reportError(new Error('boom'))).not.toThrow();
      await Promise.resolve();
      expect(captureException).not.toHaveBeenCalled();
    });

    it('does not lose a reportError fired before initAnalytics resolves', async () => {
      vi.stubEnv('VITE_SENTRY_DSN', 'https://public@sentry.example.com/1');
      const { initAnalytics, reportError } = await import('./analytics');

      const pending = initAnalytics();
      const boom = new Error('early boom');
      reportError(boom);
      await pending;
      await vi.waitFor(() => expect(captureException).toHaveBeenCalledWith(boom, undefined));
    });
  });
});
