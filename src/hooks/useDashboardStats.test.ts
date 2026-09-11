import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; count?: number | null; error: { message: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & {
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
};

const state = vi.hoisted(() => ({
  queries: [] as { table: string; calls: RecordedCall[] }[],
  result: (() => ({ data: [], count: 0, error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
}));

vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string): Chain => {
    const own: RecordedCall[] = [];
    const chain = {} as Chain;
    for (const method of ['select', 'eq', 'neq', 'in', 'gte', 'gt', 'lte', 'lt', 'order', 'limit']) {
      chain[method] = (...args: unknown[]) => { own.push({ table, method, args }); return chain; };
    }
    chain.then = (resolve, reject) => {
      state.queries.push({ table, calls: own });
      return Promise.resolve(state.result(table, own)).then(resolve, reject);
    };
    return chain;
  };
  return { supabase: { from } };
});
vi.mock('@/lib/myWork', () => ({ todayInOperatingTz: () => '2026-09-10' }));

import { useDashboardStats } from './useDashboardStats';

const has = (calls: RecordedCall[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));

const isHeadCount = (calls: RecordedCall[]) =>
  calls.some((c) => c.method === 'select' && (c.args[1] as { head?: boolean } | undefined)?.head === true);

beforeEach(() => {
  state.queries = [];
  state.result = (table, calls) => {
    if (table === 'task_instances' && isHeadCount(calls)) {
      return { data: null, count: has(calls, 'in', 'status', ['pending', 'overdue']) ? 5 : 2, error: null };
    }
    if (table === 'buildings') return { data: null, count: 3, error: null };
    if (table === 'issues' && isHeadCount(calls)) return { data: null, count: 1, error: null };
    return { data: [], error: null };
  };
});

describe('useDashboardStats', () => {
  it('counts open tasks as pending/overdue due today or earlier, never the generation horizon', async () => {
    const { result } = renderHook(() => useDashboardStats());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const open = state.queries.find((q) => q.table === 'task_instances' && has(q.calls, 'in', 'status', ['pending', 'overdue']));
    expect(open).toBeDefined();
    expect(open && isHeadCount(open.calls)).toBe(true);
    expect(open && has(open.calls, 'lte', 'due_date', '2026-09-10')).toBe(true);
    expect(result.current.stats).toEqual({ buildings: 3, pendingTasks: 5, completedToday: 2, openIssues: 1 });
  });

  it('surfaces a resolved-with-error result as an error instead of an empty portfolio', async () => {
    state.result = (table) => (table === 'buildings' ? { data: null, count: null, error: { message: 'boom' } } : { data: [], count: 0, error: null });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useDashboardStats());
    await waitFor(() => expect(result.current.loading).toBe(false));
    // supabase-js resolves with a plain error object, which the hook wraps in an Error.
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.stats.buildings).toBe(0);
    expect(spy).toHaveBeenCalledWith('Error fetching dashboard data:', expect.objectContaining({ message: 'boom' }));
    spy.mockRestore();
  });
});
