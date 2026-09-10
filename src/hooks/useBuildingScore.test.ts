import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Postgrest-like chain: every builder method records itself and returns the same chain; the
// chain is thenable so the hook can `await` it after any number of calls.
interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: { message: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & {
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
};

const state = vi.hoisted(() => {
  const s = {
    queries: [] as { client: string; table: string; calls: RecordedCall[] }[],
    result: (() => ({ data: [], error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
    makeFrom: (client: string) => (table: string): Chain => {
      const own: RecordedCall[] = [];
      const chain = {} as Chain;
      for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'range']) {
        chain[method] = (...args: unknown[]) => { own.push({ table, method, args }); return chain; };
      }
      chain.then = (resolve, reject) => {
        s.queries.push({ client, table, calls: own });
        return Promise.resolve(s.result(table, own)).then(resolve, reject);
      };
      return chain;
    },
  };
  return s;
});

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: state.makeFrom('supabase') } }));
vi.mock('@/integrations/supabase/fortress-db', () => ({ fdb: { from: state.makeFrom('fdb') } }));
vi.mock('@/lib/myWork', () => ({ todayInOperatingTz: () => '2026-09-10' }));

import { useBuildingScore } from './useBuildingScore';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

const has = (calls: RecordedCall[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));

beforeEach(() => {
  state.queries = [];
  state.result = (table) => {
    if (table === 'reports') return { data: [{ id: 'r1', report_period: '2026-08' }], error: null };
    if (table === 'compliance_scores') return { data: [{ compliance_pct: '92.5' }], error: null };
    if (table === 'task_instances') {
      return { data: [{ status: 'completed' }, { status: 'completed' }, { status: 'pending' }, { status: 'overdue' }], error: null };
    }
    return { data: [], error: null };
  };
});

describe('useBuildingScore', () => {
  it('bounds the task window to due_date <= today so future pending rows never count as not-done', async () => {
    const { result } = renderHook(() => useBuildingScore('b1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const tasks = state.queries.find((q) => q.table === 'task_instances');
    expect(tasks?.client).toBe('supabase');
    expect(tasks && has(tasks.calls, 'eq', 'building_id', 'b1')).toBe(true);
    // Lower bound: 30 days back. Upper bound: today in the operating zone, never the 90-day horizon.
    expect(tasks && tasks.calls.some((c) => c.method === 'gte' && c.args[0] === 'due_date' && /^\d{4}-\d{2}-\d{2}$/.test(String(c.args[1])))).toBe(true);
    expect(tasks && has(tasks.calls, 'lte', 'due_date', '2026-09-10')).toBe(true);
  });

  it('reads OHS from the latest approved ops_monthly report and scores tasks from the counts', async () => {
    const { result } = renderHook(() => useBuildingScore('b1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.ohsPct).toBe(92.5);
    expect(result.current.ohsPeriod).toBe('2026-08');
    // 2 completed of 4 in the window.
    expect(result.current.taskPct).toBe(50);
    const reports = state.queries.find((q) => q.table === 'reports');
    expect(reports?.client).toBe('fdb');
    expect(reports && has(reports.calls, 'eq', 'status', 'approved')).toBe(true);
  });

  it('reads the latest fresh snapshot row and skips the live queries', async () => {
    state.result = (table) => table === 'building_metrics_daily'
      ? { data: [{ building_id: 'b1', day: '2026-09-10', compliance_pct: '81.3', compliance_period: '2026-08-01', task_completion_30d_pct: 66.7, computed_at: '2026-09-10T03:00:00Z' }], error: null }
      : { data: [], error: null };
    const { result } = renderHook(() => useBuildingScore('b1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({ ohsPct: 81.3, ohsPeriod: '2026-08-01', taskPct: 66.7, source: 'snapshot', asOf: '2026-09-10T03:00:00Z' });
    expect(state.queries.map((q) => q.table)).toEqual(['building_metrics_daily']);
  });

  it('does nothing without a building id', () => {
    renderHook(() => useBuildingScore(undefined), { wrapper });
    expect(state.queries).toHaveLength(0);
  });
});
