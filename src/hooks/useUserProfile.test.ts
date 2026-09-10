import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * Regression for the shared-channel collision: DashboardLayout and the Dashboard page both
 * call useUserProfile() at once. They must share ONE live subscription, and one unmounting
 * must not tear it down for the other.
 */
const stub = vi.hoisted(() => {
  type Payload = { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> };
  type Binding = (p: Payload) => void;
  interface FakeChannel {
    topic: string;
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  }
  const state = {
    bindings: [] as Binding[],
    channels: [] as FakeChannel[],
    filters: [] as unknown[],
    removeChannel: vi.fn(async () => 'ok'),
    row: { full_name: 'Ada', avatar_url: null, phone: null, email: 'ada@example.com' } as Record<string, unknown>,
    user: { id: 'user-1' } as { id: string } | null,
  };
  const channel = vi.fn((name: string) => {
    const chan: FakeChannel = {
      topic: `realtime:${name}`,
      on: vi.fn((_t: string, filter: unknown, cb: Binding) => {
        state.filters.push(filter);
        state.bindings.push(cb);
        return chan;
      }),
      subscribe: vi.fn(() => chan),
    };
    state.channels.push(chan);
    return chan;
  });
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: state.row, error: null }) }),
    }),
  }));
  return { state, channel, from };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { channel: stub.channel, removeChannel: stub.state.removeChannel, from: stub.from },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: stub.state.user }),
}));

type Hook = typeof import('./useUserProfile').useUserProfile;
let useUserProfile: Hook;

beforeEach(async () => {
  stub.state.bindings = [];
  stub.state.channels = [];
  stub.state.filters = [];
  stub.state.user = { id: 'user-1' };
  stub.channel.mockClear();
  stub.state.removeChannel.mockClear();
  vi.resetModules();
  ({ useUserProfile } = await import('./useUserProfile'));
});

describe('useUserProfile realtime ownership', () => {
  it('two mounted consumers share one channel with one binding scoped to the user', async () => {
    const a = renderHook(() => useUserProfile());
    const b = renderHook(() => useUserProfile());
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    await waitFor(() => expect(b.result.current.loading).toBe(false));

    expect(stub.channel).toHaveBeenCalledTimes(1);
    expect(stub.state.channels[0].on).toHaveBeenCalledTimes(1);
    expect(stub.state.filters[0]).toMatchObject({ event: 'UPDATE', table: 'profiles', filter: 'id=eq.user-1' });
    expect(stub.state.channels[0].subscribe).toHaveBeenCalledTimes(1);
  });

  it('a live change reaches every consumer', async () => {
    const a = renderHook(() => useUserProfile());
    const b = renderHook(() => useUserProfile());
    await waitFor(() => expect(b.result.current.loading).toBe(false));

    act(() => {
      for (const cb of stub.state.bindings) cb({ eventType: 'UPDATE', new: { ...stub.state.row, full_name: 'Ada L.' }, old: {} });
    });
    expect(a.result.current.profile?.full_name).toBe('Ada L.');
    expect(b.result.current.profile?.full_name).toBe('Ada L.');
  });

  it('unmounting one consumer keeps the subscription alive for the other', async () => {
    const a = renderHook(() => useUserProfile());
    const b = renderHook(() => useUserProfile());
    await waitFor(() => expect(b.result.current.loading).toBe(false));

    a.unmount();
    expect(stub.state.removeChannel).not.toHaveBeenCalled();

    act(() => {
      for (const cb of stub.state.bindings) cb({ eventType: 'UPDATE', new: { ...stub.state.row, full_name: 'Still live' }, old: {} });
    });
    expect(b.result.current.profile?.full_name).toBe('Still live');

    b.unmount();
    expect(stub.state.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('opens no subscription when signed out', () => {
    stub.state.user = null;
    const { result } = renderHook(() => useUserProfile());
    expect(result.current.loading).toBe(false);
    expect(stub.channel).not.toHaveBeenCalled();
  });
});
