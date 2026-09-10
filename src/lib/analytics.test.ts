import { describe, it, expect, vi, beforeEach } from 'vitest';

const init = vi.hoisted(() => vi.fn());
const capture = vi.hoisted(() => vi.fn());
const identify = vi.hoisted(() => vi.fn());
const reset = vi.hoisted(() => vi.fn());

vi.mock('posthog-js', () => ({
  default: { init, capture, identify, reset },
}));

describe('analytics', () => {
  beforeEach(() => {
    init.mockClear();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is a no-op with no env: initAnalytics resolves and track does not throw', async () => {
    const { initAnalytics, track } = await import('./analytics');
    await expect(initAnalytics()).resolves.toBeUndefined();
    expect(() => track('x')).not.toThrow();
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
      expect.objectContaining({ api_host: 'https://eu.i.posthog.com', autocapture: false, capture_pageview: true, persistence: 'localStorage' }),
    );
  });
});
