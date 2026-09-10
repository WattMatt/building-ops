import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * Regression for the shared-channel collision: every page inside DashboardLayout calls
 * useOrganization() at the same time as the layout itself. Those consumers must share ONE
 * live subscription, and one consumer unmounting must not tear it down for the others.
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
    removeChannel: vi.fn(async () => 'ok'),
    row: { id: 'org-1', name: 'Acme' } as Record<string, unknown>,
  };
  const channel = vi.fn((name: string) => {
    const chan: FakeChannel = {
      topic: `realtime:${name}`,
      on: vi.fn((_t: string, _f: unknown, cb: Binding) => {
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
      limit: () => ({ single: async () => ({ data: state.row, error: null }) }),
    }),
  }));
  return { state, channel, from };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { channel: stub.channel, removeChannel: stub.state.removeChannel, from: stub.from },
}));

type Hook = typeof import('./useOrganization').useOrganization;
let useOrganization: Hook;

beforeEach(async () => {
  stub.state.bindings = [];
  stub.state.channels = [];
  stub.channel.mockClear();
  stub.state.removeChannel.mockClear();
  vi.resetModules();
  ({ useOrganization } = await import('./useOrganization'));
});

describe('useOrganization realtime ownership', () => {
  it('two mounted consumers share one channel with one binding', async () => {
    const a = renderHook(() => useOrganization());
    const b = renderHook(() => useOrganization());
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    await waitFor(() => expect(b.result.current.loading).toBe(false));

    expect(stub.channel).toHaveBeenCalledTimes(1);
    expect(stub.channel).toHaveBeenCalledWith('organization-changes');
    expect(stub.state.channels[0].on).toHaveBeenCalledTimes(1);
    expect(stub.state.channels[0].subscribe).toHaveBeenCalledTimes(1);
  });

  it('a live change reaches every consumer', async () => {
    const a = renderHook(() => useOrganization());
    const b = renderHook(() => useOrganization());
    await waitFor(() => expect(b.result.current.loading).toBe(false));

    act(() => {
      for (const cb of stub.state.bindings) cb({ eventType: 'UPDATE', new: { id: 'org-1', name: 'Renamed' }, old: {} });
    });
    expect(a.result.current.organization?.name).toBe('Renamed');
    expect(b.result.current.organization?.name).toBe('Renamed');
  });

  it('unmounting one consumer keeps the subscription alive for the other', async () => {
    const a = renderHook(() => useOrganization());
    const b = renderHook(() => useOrganization());
    await waitFor(() => expect(b.result.current.loading).toBe(false));

    a.unmount();
    expect(stub.state.removeChannel).not.toHaveBeenCalled();

    act(() => {
      for (const cb of stub.state.bindings) cb({ eventType: 'UPDATE', new: { id: 'org-1', name: 'Still live' }, old: {} });
    });
    expect(b.result.current.organization?.name).toBe('Still live');

    b.unmount();
    expect(stub.state.removeChannel).toHaveBeenCalledTimes(1);
  });
});
