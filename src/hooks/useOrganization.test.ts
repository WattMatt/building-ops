import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Session = { user: { id: string } };
type AuthCb = (event: string, session: Session | null) => void;
type RtHandler = (payload: { new: Record<string, unknown> | null }) => void;
const state = vi.hoisted(() => ({
  session: null as null | Session,
  tables: [] as string[],
  authCb: null as null | AuthCb,
  rtHandler: null as null | RtHandler,
  subscribed: 0,
  removed: 0,
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      onAuthStateChange: (cb: AuthCb) => { state.authCb = cb; return { data: { subscription: { unsubscribe: () => {} } } }; },
    },
    from: (table: string) => {
      state.tables.push(table);
      const row = table === 'organizations'
        ? { id: 'o1', name: 'Org', email: 'x@y.z', logo_url: null, primary_color: '#111111', created_at: null, updated_at: null }
        : { id: 'o1', name: 'Org', logo_url: null, primary_color: '#111111' };
      const chain = { select: () => chain, limit: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
      return chain;
    },
    channel: () => {
      const ch = {
        on(_e: string, _f: unknown, handler: RtHandler) { state.rtHandler = handler; return ch; },
        subscribe() { state.subscribed += 1; return ch; },
      };
      return ch;
    },
    removeChannel: () => { state.removed += 1; },
  },
}));

import { useOrganization } from './useOrganization';

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
const signedIn: Session = { user: { id: 'u1' } };

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.tables = []; state.session = null; state.authCb = null; state.rtHandler = null; state.subscribed = 0; state.removed = 0;
});

describe('useOrganization', () => {
  it('reads organization_branding when signed out, and does not open a realtime channel', async () => {
    const { result } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(state.tables).toEqual(['organization_branding']);
    expect(result.current.organization?.primary_color).toBe('#111111');
    expect(result.current.organization?.email).toBeNull();
    expect(state.subscribed).toBe(0);
  });
  it('reads organizations when signed in and subscribes to row changes once', async () => {
    state.session = signedIn;
    const { result } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(state.tables).toEqual(['organizations']);
    expect(result.current.organization?.email).toBe('x@y.z');
    expect(state.subscribed).toBe(1);
  });
  it('ignores auth events that keep the signed-in shape (token refresh, user update)', async () => {
    state.session = signedIn;
    const { result } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { state.authCb!('TOKEN_REFRESHED', signedIn); state.authCb!('USER_UPDATED', signedIn); });
    expect(state.tables).toEqual(['organizations']);
    expect(state.subscribed).toBe(1);
  });
  it('signing out swaps back to the branding view and closes the channel', async () => {
    state.session = signedIn;
    const { result } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { state.authCb!('SIGNED_OUT', null); });
    await waitFor(() => expect(state.tables).toEqual(['organizations', 'organization_branding']));
    expect(result.current.organization?.email).toBeNull();
    expect(state.removed).toBe(1);
    // A second anonymous event changes nothing.
    await act(async () => { state.authCb!('INITIAL_SESSION', null); });
    expect(state.tables).toHaveLength(2);
  });
  it('signing in swaps to the full row and opens the channel', async () => {
    const { result } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(state.subscribed).toBe(0);
    await act(async () => { state.authCb!('SIGNED_IN', signedIn); });
    await waitFor(() => expect(result.current.organization?.email).toBe('x@y.z'));
    expect(state.tables).toEqual(['organization_branding', 'organizations']);
    expect(state.subscribed).toBe(1);
  });
  it('a realtime row carrying settings updates the organization and invalidates org-settings', async () => {
    state.session = signedIn;
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(state.rtHandler).not.toBeNull());
    await act(async () => { state.rtHandler!({ new: { id: 'o1', name: 'Renamed', settings: { report_due_day: 9 } } }); });
    expect(result.current.organization?.name).toBe('Renamed');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['org-settings'] });
    invalidate.mockClear();
    await act(async () => { state.rtHandler!({ new: { id: 'o1', name: 'Again' } }); });
    expect(invalidate).not.toHaveBeenCalled();
  });
  it('unmounting closes the channel', async () => {
    state.session = signedIn;
    const { result, unmount } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();
    expect(state.removed).toBe(1);
  });
});
