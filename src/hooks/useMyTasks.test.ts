import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** Every filter call the hook makes, recorded for assertions. */
interface RecordedCall {
  eq: [string, unknown][];
  in: [string, unknown[]][];
}

interface Chain {
  select: () => Chain;
  eq: (col: string, val: unknown) => Chain;
  in: (col: string, vals: unknown[]) => Chain;
  order: () => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
}

const state = vi.hoisted(() => ({
  tables: [] as string[],
  calls: [] as RecordedCall[],
  tasks: [] as Record<string, unknown>[],
  error: null as string | null,
}));

vi.mock('@/integrations/supabase/client', () => {
  function makeChain(table: string): Chain {
    state.tables.push(table);
    const call: RecordedCall = { eq: [], in: [] };
    const chain: Chain = {
      select: () => chain,
      eq: (col, val) => { call.eq.push([col, val]); return chain; },
      in: (col, vals) => { call.in.push([col, vals]); return chain; },
      order: () => {
        state.calls.push(call);
        return Promise.resolve(state.error ? { data: null, error: { message: state.error } } : { data: state.tasks, error: null });
      },
    };
    return chain;
  }
  return { supabase: { from: (table: string) => makeChain(table) } };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me' } }),
}));

import { useMyTasks } from './useMyTasks';
import { todayInOperatingTz } from '@/lib/myWork';

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: newClient() }, children);

beforeEach(() => {
  state.tables = [];
  state.calls = [];
  state.tasks = [];
  state.error = null;
});

describe('useMyTasks', () => {
  it('reads only task_instances, filtered by assigned_to = me and status in pending,overdue', async () => {
    renderHook(() => useMyTasks(), { wrapper });
    await waitFor(() => expect(state.calls.length).toBe(1));
    expect(state.tables).toEqual(['task_instances']);
    expect(state.calls[0].eq).toContainEqual(['assigned_to', 'me']);
    expect(state.calls[0].in).toContainEqual(['status', ['pending', 'overdue']]);
  });

  it('buckets against the operating day and flattens the joined building name', async () => {
    const today = todayInOperatingTz();
    state.tasks = [{
      id: 't1', task_name: 'Check roof', task_description: null, due_date: today, building_id: 'b1',
      requires_photo: false, requires_signature: false, status: 'pending', buildings: { name: 'Block A' },
    }];
    const { result } = renderHook(() => useMyTasks(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.today).toBe(today);
    expect(result.current.buckets.overdue).toEqual([]);
    expect(result.current.buckets.upcoming).toEqual([]);
    expect(result.current.buckets.today).toHaveLength(1);
    expect(result.current.buckets.today[0].building_name).toBe('Block A');
    expect(result.current.buckets.today[0]).not.toHaveProperty('buildings');
  });

  it("keeps the ['my-work','tasks',uid] key that the queue runner and the other readers invalidate, in the offline read cache", async () => {
    const client = newClient();
    const ownWrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useMyTasks(), { wrapper: ownWrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const q = client.getQueryCache().find({ queryKey: ['my-work', 'tasks', 'me'] });
    expect(q).toBeDefined();
    expect(q?.meta?.persist).toBe(true);
    expect(q?.options.networkMode).toBe('offlineFirst');
  });

  it('surfaces a failed read as an error with the server message, not as empty buckets', async () => {
    state.error = 'permission denied for table task_instances';
    const { result } = renderHook(() => useMyTasks(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(true);
    expect(result.current.error?.message).toBe('permission denied for table task_instances');
  });

  it('refetch re-runs the query', async () => {
    const { result } = renderHook(() => useMyTasks(), { wrapper });
    await waitFor(() => expect(state.calls.length).toBe(1));
    result.current.refetch();
    await waitFor(() => expect(state.calls.length).toBe(2));
  });
});
