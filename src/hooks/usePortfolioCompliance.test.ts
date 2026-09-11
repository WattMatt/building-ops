import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Postgrest-like chain over BOTH clients: every builder method records itself and returns the same
// chain; the chain is thenable so the hook can `await` it after any number of calls.
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
      for (const method of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'range']) {
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

import { usePortfolioCompliance } from './usePortfolioCompliance';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

const has = (calls: RecordedCall[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));

const snap = (building_id: string, day: string, compliance_pct: number | string | null, computed_at: string) => ({
  building_id, day, compliance_pct, critical_pct: '70', ohs_open_nc: 3, compliance_period: '2026-07-01', task_completion_30d_pct: null, computed_at, reconstructed: false,
});

beforeEach(() => {
  state.queries = [];
  state.result = (table, calls) => {
    if (table === 'buildings') return { data: [{ id: 'b1', name: 'Alpha' }, { id: 'b2', name: 'Beta' }], error: null };
    if (table === 'building_metrics_daily') {
      return { data: [snap('b1', '2026-09-10', '81.3', '2026-09-10T03:00:00Z'), snap('b1', '2026-09-09', '80', '2026-09-09T03:00:00Z')], error: null };
    }
    if (table === 'reports') {
      // The portfolio-wide filed-report list (no building filter) vs the live per-building fallback.
      if (calls.some((c) => c.method === 'eq' && c.args[0] === 'building_id')) return { data: [], error: null };
      return { data: [{ building_id: 'b1', report_period: '2026-08-01', status: 'submitted' }, { building_id: 'b1', report_period: '2026-07-01', status: 'approved' }], error: null };
    }
    return { data: [], error: null };
  };
});

describe('usePortfolioCompliance', () => {
  it('reads snapshot buildings from one query and falls back to live queries for the rest', async () => {
    const { result } = renderHook(() => usePortfolioCompliance(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const b1 = result.current.rows.find((r) => r.buildingId === 'b1');
    // period/status are the latest FILED report's; scorePeriod is the APPROVED report the snapshot scored.
    expect(b1).toMatchObject({ compliancePct: 81.3, criticalPct: 70, openNonCompliances: 3, status: 'submitted', period: '2026-08-01', scorePeriod: '2026-07-01' });

    // Snapshot rows are read once, fresh-window only, newest first.
    const snapQ = state.queries.filter((q) => q.table === 'building_metrics_daily');
    expect(snapQ).toHaveLength(1);
    expect(has(snapQ[0].calls, 'gte', 'day', '2026-09-07')).toBe(true);
    expect(has(snapQ[0].calls, 'order', 'day', { ascending: false })).toBe(true);

    // b2 has no snapshot row → the original per-building live path ran for it, and only for it.
    const liveReports = state.queries.filter((q) => q.table === 'reports' && q.calls.some((c) => c.method === 'eq' && c.args[0] === 'building_id'));
    expect(liveReports).toHaveLength(1);
    expect(has(liveReports[0].calls, 'eq', 'building_id', 'b2')).toBe(true);
    const b2 = result.current.rows.find((r) => r.buildingId === 'b2');
    expect(b2).toMatchObject({ compliancePct: null, period: null, status: null, scorePeriod: null });
  });

  it('falls back to the live path for EVERY building when the snapshot read fails, with no error state', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const base = state.result;
    state.result = (table, calls) => {
      if (table === 'building_metrics_daily') return { data: null, error: { message: 'relation "building_metrics_daily" does not exist' } };
      // Live per-building path: b1 has a submitted report with a score, b2 nothing.
      if (table === 'reports' && calls.some((c) => c.method === 'eq' && c.args[0] === 'building_id' && c.args[1] === 'b1')) {
        return { data: [{ id: 'r1', report_period: '2026-08-01', status: 'submitted' }], error: null };
      }
      if (table === 'compliance_scores') return { data: [{ compliance_pct: '64' }], error: null };
      return base(table, calls);
    };
    const { result } = renderHook(() => usePortfolioCompliance(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.asOf).toBeNull();
    expect(result.current.rows).toHaveLength(2);
    const liveReports = state.queries.filter((q) => q.table === 'reports' && q.calls.some((c) => c.method === 'eq' && c.args[0] === 'building_id'));
    expect(liveReports.map((q) => q.calls.find((c) => c.method === 'eq' && c.args[0] === 'building_id')?.args[1]).sort()).toEqual(['b1', 'b2']);
    // On the live path the score comes from the latest FILED report, and scorePeriod says which.
    expect(result.current.rows.find((r) => r.buildingId === 'b1')).toMatchObject({ compliancePct: 64, status: 'submitted', period: '2026-08-01', scorePeriod: '2026-08-01' });
    expect(result.current.rows.find((r) => r.buildingId === 'b2')).toMatchObject({ compliancePct: null, scorePeriod: null });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[usePortfolioCompliance]'), expect.any(String));
    warn.mockRestore();
  });

  it('averages the non-null scores and counts filed vs scored buildings', async () => {
    const base = state.result;
    state.result = (table, calls) => table === 'building_metrics_daily'
      ? { data: [snap('b1', '2026-09-10', '81.3', '2026-09-10T03:00:00Z'), snap('b2', '2026-09-10', 70.1, '2026-09-10T03:00:00Z')], error: null }
      : base(table, calls);
    const { result } = renderHook(() => usePortfolioCompliance(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.portfolioAvg).toBe(75.7);
    expect(result.current.scoredCount).toBe(2);
    expect(result.current.total).toBe(2);
    // b2 has a score but no filed report: period falls back to the snapshot's compliance_period.
    expect(result.current.reportedCount).toBe(2);
  });

  it('asOf is the newest snapshot computed_at', async () => {
    const base = state.result;
    state.result = (table, calls) => table === 'building_metrics_daily'
      ? { data: [snap('b1', '2026-09-10', 50, '2026-09-10T03:00:00Z'), snap('b2', '2026-09-08', 60, '2026-09-08T03:00:00Z')], error: null }
      : base(table, calls);
    const { result } = renderHook(() => usePortfolioCompliance(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.asOf).toBe('2026-09-10T03:00:00Z');
  });

  it('asOf is null when every row came from live queries', async () => {
    const base = state.result;
    state.result = (table, calls) => table === 'building_metrics_daily' ? { data: [], error: null } : base(table, calls);
    const { result } = renderHook(() => usePortfolioCompliance(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.asOf).toBeNull();
    expect(result.current.rows).toHaveLength(2);
  });
});
