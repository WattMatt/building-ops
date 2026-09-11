import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Postgrest-like chain: every builder method records itself and returns the same chain; the
// chain is thenable so the hook can `await` it after any number of calls.
interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: { message: string; code?: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & {
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
};

const state = vi.hoisted(() => {
  const s = {
    queries: [] as { table: string; calls: RecordedCall[] }[],
    result: (() => ({ data: [], error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
    from: (table: string): Chain => {
      const own: RecordedCall[] = [];
      const chain = {} as Chain;
      for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'range', 'in']) {
        chain[method] = (...args: unknown[]) => { own.push({ table, method, args }); return chain; };
      }
      chain.then = (resolve, reject) => {
        s.queries.push({ table, calls: own });
        return Promise.resolve(s.result(table, own)).then(resolve, reject);
      };
      return chain;
    },
  };
  return s;
});

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: state.from } }));
vi.mock('@/lib/myWork', () => ({ todayInOperatingTz: () => '2026-09-10' }));

import { useBuildingTrend, useBuildingsTrends } from './useBuildingTrend';
import { TREND_COLUMNS } from '@/lib/snapshotClient';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

const has = (calls: RecordedCall[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));
const rangeOf = (calls: RecordedCall[]) => calls.find((c) => c.method === 'range')?.args as [number, number] | undefined;

const snap = (building_id: string, day: string, compliance_pct: number | string | null, task_completion_30d_pct: number | null = null) => ({
  building_id, day, compliance_pct, task_completion_30d_pct, issues_open: 1, tasks_overdue: 0, docs_expiring_30: 2, issues_breached: 0, reconstructed: false, computed_at: `${day}T03:00:00Z`,
});

beforeEach(() => {
  state.queries = [];
  state.result = () => ({ data: [], error: null });
});

describe('useBuildingTrend', () => {
  it('queries the trend columns for one building, ascending by day, and maps string numerics', async () => {
    state.result = () => ({ data: [snap('b1', '2026-08-12', '81.3', 50), snap('b1', '2026-09-10', 90, null)], error: null });
    const { result } = renderHook(() => useBuildingTrend('b1', 30), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const q = state.queries.find((q) => q.table === 'building_metrics_daily');
    expect(q).toBeTruthy();
    expect(q && has(q.calls, 'select', TREND_COLUMNS)).toBe(true);
    expect(q && has(q.calls, 'eq', 'building_id', 'b1')).toBe(true);
    // "30 days" is today plus the 29 before it (2026-08-12..2026-09-10 = 30 rows), not 31.
    expect(q && has(q.calls, 'gte', 'day', '2026-08-12')).toBe(true);
    expect(q && has(q.calls, 'order', 'day', { ascending: true })).toBe(true);
    expect(q && rangeOf(q.calls)).toEqual([0, 999]);

    expect(result.current.series.compliance).toEqual([81.3, 90]);
    expect(result.current.series.tasks).toEqual([50, null]);
    expect(result.current.latest?.day).toBe('2026-09-10');
  });

  it('does nothing without a building id and returns empty series', () => {
    const { result } = renderHook(() => useBuildingTrend(undefined), { wrapper });
    expect(state.queries).toHaveLength(0);
    expect(result.current.series.compliance).toEqual([]);
    expect(result.current.latest).toBeNull();
  });
});

describe('useBuildingsTrends', () => {
  it('reads every visible building in one query and groups rows by building_id', async () => {
    state.result = () => ({
      data: [snap('b1', '2026-09-01', 60), snap('b2', '2026-09-01', 90), snap('b1', '2026-09-02', 72.4), snap('b2', '2026-09-02', 85)],
      error: null,
    });
    const { result } = renderHook(() => useBuildingsTrends(30), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(state.queries.map((q) => q.table)).toEqual(['building_metrics_daily']);
    const q = state.queries[0];
    expect(has(q.calls, 'select', TREND_COLUMNS)).toBe(true);
    expect(has(q.calls, 'gte', 'day', '2026-08-12')).toBe(true);
    expect(q.calls.some((c) => c.method === 'eq')).toBe(false);
    // Deterministic paging: day, then building_id.
    expect(q.calls.filter((c) => c.method === 'order').map((c) => c.args[0])).toEqual(['day', 'building_id']);

    expect(Object.keys(result.current.rows).sort()).toEqual(['b1', 'b2']);
    expect(result.current.byBuilding.b1.compliance).toEqual([60, 72.4]);
    expect(result.current.byBuilding.b2.compliance).toEqual([90, 85]);
  });

  it('pages past the 1 000-row server cap: a full first page is followed by a second request', async () => {
    // 47 buildings × 30 days: the first page is exactly the cap, the second is the 410-row tail.
    const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => {
      const n = from + i;
      return snap(`b${n % 47}`, `2026-08-${String(12 + Math.floor(n / 47)).padStart(2, '0')}`, n % 100);
    });
    state.result = (_table, calls) => {
      const [from] = rangeOf(calls) ?? [0, 0];
      return { data: from === 0 ? page(0, 1000) : page(1000, 410), error: null };
    };
    const { result } = renderHook(() => useBuildingsTrends(30), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(state.queries.map((q) => rangeOf(q.calls))).toEqual([[0, 999], [1000, 1999]]);
    expect(Object.keys(result.current.rows)).toHaveLength(47);
    expect(Object.values(result.current.rows).reduce((n, rows) => n + rows.length, 0)).toBe(1410);
  });

  it('exposes each building\'s latest FRESH row (within the 3-day window) for the grid chips', async () => {
    state.result = () => ({
      data: [snap('stale', '2026-09-01', 60), snap('stale', '2026-09-05', 61), snap('fresh', '2026-09-01', 90), snap('fresh', '2026-09-07', 88)],
      error: null,
    });
    const { result } = renderHook(() => useBuildingsTrends(30), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // 2026-09-07 is exactly SNAPSHOT_FRESH_DAYS ago from the mocked today: still fresh. 09-05 is not.
    expect(Object.keys(result.current.latest)).toEqual(['fresh']);
    expect(result.current.latest.fresh.day).toBe('2026-09-07');
    // The stale building still gets its sparkline.
    expect(result.current.byBuilding.stale.compliance).toEqual([60, 61]);
  });

  it('surfaces a read error (the grid shows chips from the live fallback, sparklines stay empty)', async () => {
    state.result = () => ({ data: null, error: { message: 'relation does not exist', code: '42P01' } });
    const { result } = renderHook(() => useBuildingsTrends(30), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rows).toEqual({});
    expect(result.current.latest).toEqual({});
    expect(state.queries).toHaveLength(1);
  });
});
