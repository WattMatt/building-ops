import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const lib = vi.hoisted(() => ({
  pushSupport: vi.fn(),
  currentSubscription: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('@/lib/push', () => lib);
vi.mock('@/lib/analytics', () => analytics);

import { usePushSubscription } from './usePushSubscription';

const originalNotification = Object.getOwnPropertyDescriptor(window, 'Notification');

function stubPermission(permission: NotificationPermission) {
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { permission, requestPermission: vi.fn(async () => permission) },
  });
}

/**
 * The error a hook action rejects with, caught inside `act`. `await expect(act(...)).rejects`
 * does not work: React's `act` returns a thenable whose `then` returns undefined, so vitest's
 * `.rejects` resolves at once and the assertion never runs.
 */
async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
  let rejection: unknown;
  await act(async () => {
    await run().catch((e: unknown) => { rejection = e; });
  });
  return rejection;
}

describe('usePushSubscription', () => {
  beforeEach(() => {
    lib.pushSupport.mockReset().mockReturnValue('ok');
    lib.currentSubscription.mockReset().mockResolvedValue(null);
    lib.subscribePush.mockReset().mockResolvedValue('subscribed');
    lib.unsubscribePush.mockReset().mockResolvedValue(undefined);
    analytics.track.mockReset();
    stubPermission('default');
  });

  afterEach(() => {
    if (originalNotification) Object.defineProperty(window, 'Notification', originalNotification);
    else delete (window as unknown as { Notification?: unknown }).Notification;
  });

  it('reports unsupported without probing the service worker', () => {
    lib.pushSupport.mockReturnValue('unsupported');
    const { result } = renderHook(() => usePushSubscription('u1'));
    expect(result.current.status).toBe('unsupported');
    expect(lib.currentSubscription).not.toHaveBeenCalled();
  });

  it('reports ios-not-installed', () => {
    lib.pushSupport.mockReturnValue('ios-not-installed');
    const { result } = renderHook(() => usePushSubscription('u1'));
    expect(result.current.status).toBe('ios-not-installed');
  });

  it('reports denied from Notification.permission on mount', () => {
    stubPermission('denied');
    const { result } = renderHook(() => usePushSubscription('u1'));
    expect(result.current.status).toBe('denied');
    expect(lib.currentSubscription).not.toHaveBeenCalled();
  });

  it('starts busy, then settles to off when there is no subscription', async () => {
    const { result } = renderHook(() => usePushSubscription('u1'));
    expect(result.current.status).toBe('busy');
    await waitFor(() => expect(result.current.status).toBe('off'));
  });

  it('settles to on when the service worker already holds a subscription', async () => {
    lib.currentSubscription.mockResolvedValue({ endpoint: 'https://push.example/x' });
    const { result } = renderHook(() => usePushSubscription('u1'));
    await waitFor(() => expect(result.current.status).toBe('on'));
  });

  it('enable() subscribes for the user and tracks the toggle', async () => {
    const { result } = renderHook(() => usePushSubscription('u1'));
    await waitFor(() => expect(result.current.status).toBe('off'));

    await act(async () => {
      await result.current.enable();
    });

    expect(lib.subscribePush).toHaveBeenCalledWith('u1');
    expect(result.current.status).toBe('on');
    expect(analytics.track).toHaveBeenCalledWith('push_toggled', { on: true });
  });

  it('enable() lands on denied when permission is refused, without tracking', async () => {
    lib.subscribePush.mockResolvedValue('denied');
    const { result } = renderHook(() => usePushSubscription('u1'));
    await waitFor(() => expect(result.current.status).toBe('off'));

    await act(async () => {
      await result.current.enable();
    });

    expect(result.current.status).toBe('denied');
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it('enable() rethrows a failure and returns to off', async () => {
    lib.subscribePush.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePushSubscription('u1'));
    await waitFor(() => expect(result.current.status).toBe('off'));

    expect(await rejectionOf(() => result.current.enable())).toMatchObject({ message: 'boom' });

    expect(result.current.status).toBe('off');
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it('enable() does nothing without a signed-in user', async () => {
    const { result } = renderHook(() => usePushSubscription(undefined));
    await waitFor(() => expect(result.current.status).toBe('off'));

    await act(async () => {
      await result.current.enable();
    });

    expect(lib.subscribePush).not.toHaveBeenCalled();
    expect(result.current.status).toBe('off');
  });

  it('disable() unsubscribes and tracks the toggle', async () => {
    lib.currentSubscription.mockResolvedValue({ endpoint: 'https://push.example/x' });
    const { result } = renderHook(() => usePushSubscription('u1'));
    await waitFor(() => expect(result.current.status).toBe('on'));

    await act(async () => {
      await result.current.disable();
    });

    expect(lib.unsubscribePush).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('off');
    expect(analytics.track).toHaveBeenCalledWith('push_toggled', { on: false });
  });

  it('disable() rethrows a failure and stays on', async () => {
    lib.currentSubscription.mockResolvedValue({ endpoint: 'https://push.example/x' });
    lib.unsubscribePush.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => usePushSubscription('u1'));
    await waitFor(() => expect(result.current.status).toBe('on'));

    expect(await rejectionOf(() => result.current.disable())).toMatchObject({ message: 'offline' });

    expect(result.current.status).toBe('on');
  });
});
