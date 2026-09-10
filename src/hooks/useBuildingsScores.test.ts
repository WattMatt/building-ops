import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: { message: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & {
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
};

const state = vi.hoisted(() => ({
  queries: [] as { table: string; calls: RecordedCall[] }[],
  result: (() => ({ data: [], error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
}));

vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string): Chain => {
    const own: RecordedCall[] = [];
    const chain = {} as Chain;
    for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'range']) {
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
vi.mock('@/hooks/usePortfolioCompliance', () => ({
  usePortfolioCompliance: () => ({
    rows: [{ buildingId: 'b1', compliancePct: 80 }, { buildingId: 'b2', compliancePct: null }],
    isLoading: false,
  }),
}));

import { useBuildingsScores } from './useBuildingsScores';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

const has = (calls: RecordedCall[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));

beforeEach(() => {
  state.queries = [];
  state.result = () => ({
    data: [
      { building_id: 'b1', status: 'completed' },
      { building_id: 'b1', status: 'pending' },
      { building_id: 'b2', status: 'completed' },
      { building_id: null, status: 'completed' },
    ],
    error: null,
  });
});

describe('useBuildingsScores', () => {
  it('bounds the one task query to due_date <= today and sets an explicit range past the 1000-row default', async () => {
    const { result } = renderHook(() => useBuildingsScores(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const tasks = state.queries.find((q) => q.table === 'task_instances');
    expect(tasks && has(tasks.calls, 'select', 'building_id,status')).toBe(true);
    expect(tasks && tasks.calls.some((c) => c.method === 'gte' && c.args[0] === 'due_date')).toBe(true);
    expect(tasks && has(tasks.calls, 'lte', 'due_date', '2026-09-10')).toBe(true);
    expect(tasks && has(tasks.calls, 'range', 0, 4999)).toBe(true);
  });

  it('scores each visible building from its own rows, OHS from the portfolio hook', async () => {
    const { result } = renderHook(() => useBuildingsScores(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.scores.b1).toEqual({ ohsPct: 80, taskPct: 50 });
    expect(result.current.scores.b2).toEqual({ ohsPct: null, taskPct: 100 });
    // Only one task_instances read for the whole grid.
    expect(state.queries.filter((q) => q.table === 'task_instances')).toHaveLength(1);
  });
});
