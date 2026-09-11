import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Covers both halves of this hook:
 *  - the anon/signed-in split (branding view vs. full row), which auth events refetch, and the
 *    settings invalidation a realtime row triggers;
 *  - the realtime ownership rules: every consumer shares ONE channel through the registry, one
 *    consumer unmounting must not tear it down under the others, and re-acquiring the key after a
 *    sign-out waits for the previous channel's leave (see @/lib/realtime/subscribePostgresChanges).
 *
 * The registry keeps module-level state, so every test re-imports the hook after resetModules.
 */
type Session = { user: { id: string } };
type AuthCb = (event: string, session: Session | null) => void;
type RtPayload = { eventType?: string; new: Record<string, unknown> | null; old?: Record<string, unknown> };
type Binding = (payload: RtPayload) => void;
interface FakeChannel {
  topic: string;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  bindings: Binding[];
}

const stub = vi.hoisted(() => {
  const state = {
    session: null as null | Session,
    tables: [] as string[],
    authCb: null as null | AuthCb,
    channels: [] as FakeChannel[],
    bindings: [] as Binding[],
  };
  const removeChannel = vi.fn(async () => 'ok');
  const channel = vi.fn((name: string) => {
    const chan: FakeChannel = {
      topic: `realtime:${name}`,
      on: vi.fn((_type: string, _filter: unknown, cb: Binding) => {
        chan.bindings.push(cb);
        state.bindings.push(cb);
        return chan;
      }),
      subscribe: vi.fn(() => chan),
      bindings: [],
    };
    state.channels.push(chan);
    return chan;
  });
  const from = vi.fn((table: string) => {
    state.tables.push(table);
    const row = table === 'organizations'
      ? { id: 'o1', name: 'Org', email: 'x@y.z', logo_url: null, primary_color: '#111111', created_at: null, updated_at: null }
      : { id: 'o1', name: 'Org', logo_url: null, primary_color: '#111111' };
    const chain = { select: () => chain, limit: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
    return chain;
  });
  return { state, removeChannel, channel, from };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: stub.state.session } }),
      onAuthStateChange: (cb: AuthCb) => {
        stub.state.authCb = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
    from: stub.from,
    channel: stub.channel,
    removeChannel: stub.removeChannel,
  },
}));

type Hook = typeof import('./useOrganization').useOrganization;
let useOrganization: Hook;

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
const signedIn: Session = { user: { id: 'u1' } };
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(async () => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  stub.state.session = null;
  stub.state.tables = [];
  stub.state.authCb = null;
  stub.state.channels = [];
  stub.state.bindings = [];
  stub.channel.mockClear();
  stub.from.mockClear();
  stub.removeChannel.mockClear();
  stub.removeChannel.mockImplementation(async () => 'ok');
  vi.resetModules();
  ({ useOrganization } = await import('./useOrganization'));
});

describe('useOrganization anon/signed-in reads', () => {
  it('reads organization_branding when signed out, and does not open a realtime channel', async () => {
    const { result } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(stub.state.tables).toEqual(['organization_branding']);
    expect(result.current.organization?.primary_color).toBe('#111111');
    expect(result.current.organization?.email).toBeNull();
    expect(stub.channel).not.toHaveBeenCalled();
  });

  it('reads organizations when signed in and subscribes to row changes once', async () => {
    stub.state.session = signedIn;
    const { result } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(stub.state.tables).toEqual(['organizations']);
    expect(result.current.organization?.email).toBe('x@y.z');
    expect(stub.channel).toHaveBeenCalledTimes(1);
    expect(stub.channel).toHaveBeenCalledWith('organization-changes');
    expect(stub.state.channels[0].subscribe).toHaveBeenCalledTimes(1);
  });

  it('ignores auth events that keep the signed-in shape (token refresh, user update)', async () => {
    stub.state.session = signedIn;
    const { result } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { stub.state.authCb!('TOKEN_REFRESHED', signedIn); stub.state.authCb!('USER_UPDATED', signedIn); });
    expect(stub.state.tables).toEqual(['organizations']);
    expect(stub.channel).toHaveBeenCalledTimes(1);
  });

  it('signing out swaps back to the branding view and closes the channel', async () => {
    stub.state.session = signedIn;
    const { result } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { stub.state.authCb!('SIGNED_OUT', null); });
    await waitFor(() => expect(stub.state.tables).toEqual(['organizations', 'organization_branding']));
    expect(result.current.organization?.email).toBeNull();
    expect(stub.removeChannel).toHaveBeenCalledTimes(1);
    // A second anonymous event changes nothing.
    await act(async () => { stub.state.authCb!('INITIAL_SESSION', null); });
    expect(stub.state.tables).toHaveLength(2);
  });

  it('signing in swaps to the full row and opens the channel', async () => {
    const { result } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(stub.channel).not.toHaveBeenCalled();
    await act(async () => { stub.state.authCb!('SIGNED_IN', signedIn); });
    await waitFor(() => expect(result.current.organization?.email).toBe('x@y.z'));
    expect(stub.state.tables).toEqual(['organization_branding', 'organizations']);
    expect(stub.channel).toHaveBeenCalledTimes(1);
  });

  it('a realtime row carrying settings updates the organization and invalidates org-settings', async () => {
    stub.state.session = signedIn;
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(stub.state.bindings).toHaveLength(1));
    await act(async () => { stub.state.bindings[0]({ new: { id: 'o1', name: 'Renamed', settings: { report_due_day: 9 } } }); });
    expect(result.current.organization?.name).toBe('Renamed');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['org-settings'] });
    invalidate.mockClear();
    await act(async () => { stub.state.bindings[0]({ new: { id: 'o1', name: 'Again' } }); });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('unmounting closes the channel', async () => {
    stub.state.session = signedIn;
    const { result, unmount } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();
    expect(stub.removeChannel).toHaveBeenCalledTimes(1);
  });
});

describe('useOrganization realtime ownership', () => {
  it('two mounted consumers share one channel with one binding', async () => {
    stub.state.session = signedIn;
    const a = renderHook(() => useOrganization(), { wrapper });
    const b = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    await waitFor(() => expect(b.result.current.loading).toBe(false));

    expect(stub.channel).toHaveBeenCalledTimes(1);
    expect(stub.channel).toHaveBeenCalledWith('organization-changes');
    expect(stub.state.channels[0].on).toHaveBeenCalledTimes(1);
    expect(stub.state.channels[0].on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'organizations' },
      expect.any(Function),
    );
    expect(stub.state.channels[0].subscribe).toHaveBeenCalledTimes(1);
  });

  it('a live change reaches every consumer', async () => {
    stub.state.session = signedIn;
    const a = renderHook(() => useOrganization(), { wrapper });
    const b = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(b.result.current.loading).toBe(false));

    await act(async () => { stub.state.bindings[0]({ eventType: 'UPDATE', new: { id: 'o1', name: 'Renamed' }, old: {} }); });
    expect(a.result.current.organization?.name).toBe('Renamed');
    expect(b.result.current.organization?.name).toBe('Renamed');
  });

  it('unmounting one consumer keeps the subscription alive for the other', async () => {
    stub.state.session = signedIn;
    const a = renderHook(() => useOrganization(), { wrapper });
    const b = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(b.result.current.loading).toBe(false));

    a.unmount();
    expect(stub.removeChannel).not.toHaveBeenCalled();

    await act(async () => { stub.state.bindings[0]({ eventType: 'UPDATE', new: { id: 'o1', name: 'Still live' }, old: {} }); });
    expect(b.result.current.organization?.name).toBe('Still live');

    b.unmount();
    expect(stub.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('signing out then back in reopens the channel only once the previous leave is acknowledged', async () => {
    let finishLeave!: () => void;
    stub.removeChannel.mockImplementation(() => new Promise<string>((r) => { finishLeave = () => r('ok'); }));
    stub.state.session = signedIn;

    const { result } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(stub.channel).toHaveBeenCalledTimes(1);

    await act(async () => { stub.state.authCb!('SIGNED_OUT', null); });
    await waitFor(() => expect(stub.removeChannel).toHaveBeenCalledTimes(1));

    // Signing back in re-acquires the key while the old channel is still leaving: opening now
    // would hand back the departing channel, so the registry must wait for the leave.
    await act(async () => { stub.state.authCb!('SIGNED_IN', signedIn); });
    await act(async () => { await flush(); });
    expect(stub.channel).toHaveBeenCalledTimes(1);

    await act(async () => { finishLeave(); await flush(); });
    expect(stub.channel).toHaveBeenCalledTimes(2);
    expect(stub.state.channels[1]).not.toBe(stub.state.channels[0]);
    expect(stub.state.channels[1].on).toHaveBeenCalledTimes(1);
    expect(stub.state.channels[1].subscribe).toHaveBeenCalledTimes(1);

    // The reopened channel feeds the same consumer.
    await act(async () => { stub.state.channels[1].bindings[0]({ eventType: 'UPDATE', new: { id: 'o1', name: 'After resubscribe' }, old: {} }); });
    expect(result.current.organization?.name).toBe('After resubscribe');
  });
});
