import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
      for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit', 'range']) {
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

import { chipValues, useBuildingsScores } from './useBuildingsScores';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

const has = (calls: RecordedCall[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));

beforeEach(() => {
  state.queries = [];
  state.result = (table) => {
    if (table === 'task_instances') {
      return {
        data: [
          { building_id: 'b1', status: 'completed' },
          { building_id: 'b1', status: 'pending' },
          { building_id: 'b2', status: 'completed' },
          { building_id: null, status: 'completed' },
        ],
        error: null,
      };
    }
    if (table === 'reports') {
      // Newest first: b1's latest approved report is r2, not r1.
      return { data: [{ id: 'r2', building_id: 'b1', report_period: '2026-08-01' }, { id: 'r1', building_id: 'b1', report_period: '2026-07-01' }, { id: 'r3', building_id: 'b3', report_period: '2026-08-01' }], error: null };
    }
    if (table === 'compliance_scores') return { data: [{ report_id: 'r2', compliance_pct: '80' }, { report_id: 'r1', compliance_pct: '10' }], error: null };
    return { data: [], error: null };
  };
});

describe('useBuildingsScores', () => {
  it('bounds the one task query to due_date <= today and sets an explicit range past the 1000-row default', async () => {
    const { result } = renderHook(() => useBuildingsScores(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const tasks = state.queries.find((q) => q.table === 'task_instances');
    expect(tasks?.client).toBe('supabase');
    expect(tasks && has(tasks.calls, 'select', 'building_id,status')).toBe(true);
    expect(tasks && tasks.calls.some((c) => c.method === 'gte' && c.args[0] === 'due_date')).toBe(true);
    expect(tasks && has(tasks.calls, 'lte', 'due_date', '2026-09-10')).toBe(true);
    expect(tasks && has(tasks.calls, 'range', 0, 4999)).toBe(true);
  });

  it('scores OHS live from the latest APPROVED ops report per building — two portfolio-wide queries, never per building', async () => {
    const { result } = renderHook(() => useBuildingsScores(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const reports = state.queries.filter((q) => q.table === 'reports');
    expect(reports).toHaveLength(1);
    expect(reports[0].client).toBe('fdb');
    expect(has(reports[0].calls, 'eq', 'report_type', 'ops_monthly')).toBe(true);
    expect(has(reports[0].calls, 'eq', 'status', 'approved')).toBe(true);
    expect(reports[0].calls.some((c) => c.method === 'eq' && c.args[0] === 'building_id')).toBe(false);
    const scores = state.queries.filter((q) => q.table === 'compliance_scores');
    expect(scores).toHaveLength(1);
    // Only each building's LATEST approved report is scored (r2 and r3, not r1).
    expect(has(scores[0].calls, 'in', 'report_id', ['r2', 'r3'])).toBe(true);

    expect(result.current.scores.b1).toEqual({ ohsPct: 80, taskPct: 50 });
    expect(result.current.scores.b2).toEqual({ ohsPct: null, taskPct: 100 });
    // b3: an approved report whose score row is missing → null, not 10 from an older report.
    expect(result.current.scores.b3).toEqual({ ohsPct: null, taskPct: null });
  });

  it('never touches the snapshot table — the grid reads that once, via useBuildingsTrends', async () => {
    const { result } = renderHook(() => useBuildingsScores(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(state.queries.some((q) => q.table === 'building_metrics_daily')).toBe(false);
  });
});

describe('chipValues', () => {
  it('takes BOTH chips from the fresh snapshot row when there is one, with its "as of"', () => {
    const v = chipValues({ compliance_pct: '81.3', task_completion_30d_pct: null, computed_at: '2026-09-10T03:00:00Z' }, { ohsPct: 50, taskPct: 75 });
    // taskPct is null from the snapshot and stays null: no mixing in the live 75.
    expect(v).toEqual({ ohsPct: 81.3, taskPct: null, asOf: '2026-09-10T03:00:00Z' });
  });

  it('falls back to the live scores, without an "as of", when the building has no fresh row', () => {
    expect(chipValues(undefined, { ohsPct: 50, taskPct: 75 })).toEqual({ ohsPct: 50, taskPct: 75, asOf: null });
    expect(chipValues(undefined, undefined)).toEqual({ ohsPct: null, taskPct: null, asOf: null });
  });
});
