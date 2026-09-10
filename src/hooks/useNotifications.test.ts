import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[] }));
vi.mock('@/integrations/supabase/client', () => {
  const chain: any = {
    select: () => chain, eq: () => chain, is: () => chain, order: () => chain, in: () => chain,
    limit: () => Promise.resolve({ data: state.rows, error: null }),
    update: (patch: Record<string, unknown>) => { state.updates.push(patch); return { eq: () => ({ is: () => Promise.resolve({ error: null }) }) }; },
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: () => chain, channel: () => channel, removeChannel: () => {} } };
});
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));

import { useNotifications } from './useNotifications';
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

describe('useNotifications', () => {
  it('loads rows and counts unread by kind', async () => {
    state.rows = [
      { id: '1', kind: 'issue_comment', read_at: null, title: 'a', url: '/issues', created_at: '2026-09-10T00:00:00Z' },
      { id: '2', kind: 'signoff_requested', read_at: null, title: 'b', url: '/my-signoffs', created_at: '2026-09-10T00:00:00Z' },
      { id: '3', kind: 'issue_assigned', read_at: '2026-09-10T01:00:00Z', title: 'c', url: '/issues', created_at: '2026-09-10T00:00:00Z' },
    ];
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
});
