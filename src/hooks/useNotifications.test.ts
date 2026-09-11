import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

interface FakeChannel { on: () => FakeChannel; subscribe: () => FakeChannel }

const state = vi.hoisted(() => {
  const channelObj: FakeChannel = { on: () => channelObj, subscribe: () => channelObj };
  return {
    rows: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    channel: vi.fn(() => channelObj),
    // The registry awaits the leave before it will reopen the key, so this must be thenable.
    removeChannel: vi.fn(async () => 'ok'),
  };
});
interface FakeQuery {
  select: () => FakeQuery;
  eq: () => FakeQuery;
  order: () => FakeQuery;
  limit: () => Promise<{ data: Record<string, unknown>[]; error: null }>;
  is: () => Promise<{ count: number; error: null }>;
  update: (patch: Record<string, unknown>) => { eq: () => { is: () => Promise<{ error: null }> } };
}

vi.mock('@/integrations/supabase/client', () => {
  const chain: FakeQuery = {
    select: () => chain, eq: () => chain, order: () => chain,
    limit: () => Promise.resolve({ data: state.rows, error: null }),
    // The row query ends at .limit(); the head-only unread count ends at .is('read_at', null).
    is: () => Promise.resolve({ count: state.rows.filter((r) => !r.read_at).length, error: null }),
    update: (patch: Record<string, unknown>) => { state.updates.push(patch); return { eq: () => ({ is: () => Promise.resolve({ error: null }) }) }; },
  };
  return { supabase: { from: () => chain, channel: state.channel, removeChannel: state.removeChannel } };
});
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));

import { useNotifications, useNotificationsRealtime } from './useNotifications';
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

beforeEach(() => {
  state.rows = [
    { id: '1', kind: 'issue_comment', read_at: null, title: 'a', url: '/issues', created_at: '2026-09-10T00:00:00Z' },
    { id: '2', kind: 'signoff_requested', read_at: null, title: 'b', url: '/my-signoffs', created_at: '2026-09-10T00:00:00Z' },
    { id: '3', kind: 'issue_assigned', read_at: '2026-09-10T01:00:00Z', title: 'c', url: '/issues', created_at: '2026-09-10T00:00:00Z' },
  ];
  state.updates = [];
  state.channel.mockClear();
  state.removeChannel.mockClear();
});

describe('useNotifications', () => {
  it('loads rows and counts unread by kind', async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(result.current.unread).toBe(2);
    expect(result.current.unreadByKind(['issue_comment', 'issue_assigned'])).toBe(1);
  });

  it('markRead writes read_at', async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0));
    await result.current.markRead('1');
    expect(state.updates.at(-1)).toHaveProperty('read_at');
  });

  it('opens no realtime channel of its own', async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(state.channel).not.toHaveBeenCalled();
  });
});

describe('useNotificationsRealtime', () => {
  // Regression: the channel used to be opened by useNotifications itself, so the layout, the
  // bell and the inbox page each asked for the topic `notifications-<uid>`. Supabase hands back
  // the SAME channel for a repeated topic, so the extra callers only appended bindings to an
  // already-joined channel — which errors it — and the first one to unmount removed the channel
  // out from under the rest. The subscription now goes through the ref-counted registry, which
  // owns the channel for however many callers there are.
  it('opens one channel for many consumers and only removes it when its owner unmounts', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const Consumer = () => { useNotifications(); return null; };
    const Owner = () => { useNotificationsRealtime(); return null; };

    const consumerA = render(createElement(Consumer), { wrapper: shared });
    const consumerB = render(createElement(Consumer), { wrapper: shared });
    const owner = render(createElement(Owner), { wrapper: shared });

    await waitFor(() => expect(state.channel).toHaveBeenCalledTimes(1));
    expect(state.channel).toHaveBeenCalledWith('notifications-me');

    consumerA.unmount();
    expect(state.removeChannel).not.toHaveBeenCalled();

    owner.unmount();
    expect(state.removeChannel).toHaveBeenCalledTimes(1);

    consumerB.unmount();
  });

  it('two owners still share one channel, removed only when the last releases', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const Owner = () => { useNotificationsRealtime(); return null; };

    const first = render(createElement(Owner), { wrapper: shared });
    const second = render(createElement(Owner), { wrapper: shared });

    await waitFor(() => expect(state.channel).toHaveBeenCalledTimes(1));

    first.unmount();
    expect(state.removeChannel).not.toHaveBeenCalled();

    second.unmount();
    expect(state.removeChannel).toHaveBeenCalledTimes(1);
  });
});
