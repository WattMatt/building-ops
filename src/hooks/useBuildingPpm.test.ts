import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Postgrest-like chain: every builder method records itself and returns the same chain; the
// chain is thenable so the hook can `await` it after any number of calls. `state.result`
// decides what a table answers with, given the calls chained before it ran.
interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: { message: string; code?: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & {
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
};

const state = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  queries: [] as { table: string; calls: RecordedCall[] }[],
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcResult: { data: 0, error: null } as QueryResult,
  result: (() => ({ data: [], error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
}));

vi.mock('@/integrations/supabase/client', () => {
  const METHODS = ['select', 'eq', 'in', 'order', 'insert', 'update', 'upsert', 'delete', 'maybeSingle'];
  const from = (table: string): Chain => {
    const own: RecordedCall[] = [];
    const chain = {} as Chain;
    for (const method of METHODS) {
      chain[method] = (...args: unknown[]) => {
        const call = { table, method, args };
        own.push(call);
        state.calls.push(call);
        return chain;
      };
    }
    chain.then = (resolve, reject) => {
      state.queries.push({ table, calls: own });
      return Promise.resolve(state.result(table, own)).then(resolve, reject);
    };
    return chain;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    state.rpcCalls.push({ fn, args });
    return Promise.resolve(state.rpcResult);
  };
  return { supabase: { from, rpc } };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

import { useBuildingPpm, useDerivedPpm, PPM_PERMISSION_MESSAGE } from './useBuildingPpm';

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);

const has = (calls: RecordedCall[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));

const line = {
  id: 'p1', building_id: 'b1', service_name: 'Lift service', contractor_id: null,
  recurrence: { every: 1, unit: 'month', monthDay: 1 }, sort_order: 0, is_active: true, notes: null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
};

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  state.calls = [];
  state.queries = [];
  state.rpcCalls = [];
  state.rpcResult = { data: 0, error: null };
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  state.result = (table) => {
    if (table === 'building_ppm_services') return { data: [line], error: null };
    if (table === 'ppm_monthly_status') {
      return { data: [{ ppm_service_id: 'p1', service_name: 'Lift service', period_month: '2026-09', status: 'due', done_on: null }], error: null };
    }
    return { data: [], error: null };
  };
});

describe('useBuildingPpm — plan lines', () => {
  it('reads the building plan ordered by sort_order', async () => {
    const { result } = renderHook(() => useBuildingPpm('b1'), { wrapper });
    await waitFor(() => expect(result.current.lines).toHaveLength(1));
    const q = state.queries.find((x) => x.table === 'building_ppm_services')!;
    expect(has(q.calls, 'eq', 'building_id', 'b1')).toBe(true);
    expect(has(q.calls, 'order', 'sort_order')).toBe(true);
    expect(result.current.lines[0].service_name).toBe('Lift service');
  });

  it('does not query without a building', () => {
    renderHook(() => useBuildingPpm(undefined), { wrapper });
    expect(state.queries.filter((x) => x.table === 'building_ppm_services')).toHaveLength(0);
  });

  it('createLine inserts a trimmed line with select(id) and refreshes the plan', async () => {
    let insertSeen = false;
    state.result = (table, calls) => {
      if (table === 'building_ppm_services' && has(calls, 'insert')) { insertSeen = true; return { data: [{ id: 'new' }], error: null }; }
      return { data: [line], error: null };
    };
    const { result } = renderHook(() => useBuildingPpm('b1'), { wrapper });
    await waitFor(() => expect(result.current.lines).toHaveLength(1));
    let id = '';
    await act(async () => {
      id = await result.current.createLine({ service_name: '  Generator service ', recurrence: { every: 3, unit: 'month', monthDay: 'last' }, contractor_id: 'c1', notes: ' quarterly ' });
    });
    expect(id).toBe('new');
    expect(insertSeen).toBe(true);
    const ins = state.calls.find((c) => c.method === 'insert')!;
    expect(ins.args[0]).toEqual({
      building_id: 'b1', service_name: 'Generator service', recurrence: { every: 3, unit: 'month', monthDay: 'last' },
      contractor_id: 'c1', notes: 'quarterly', sort_order: 0, is_active: true,
    });
    const insertQuery = state.queries.find((x) => x.table === 'building_ppm_services' && has(x.calls, 'insert'))!;
    expect(has(insertQuery.calls, 'select', 'id')).toBe(true);
  });

  it('a write that RLS filtered to zero rows surfaces as the permission message', async () => {
    state.result = (table, calls) => {
      if (table === 'building_ppm_services' && has(calls, 'update')) return { data: [], error: null };
      return { data: [line], error: null };
    };
    const { result } = renderHook(() => useBuildingPpm('b1'), { wrapper });
    await waitFor(() => expect(result.current.lines).toHaveLength(1));
    await expect(result.current.setActive('p1', false)).rejects.toThrow(PPM_PERMISSION_MESSAGE);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(PPM_PERMISSION_MESSAGE));
    const upd = state.calls.find((c) => c.method === 'update')!;
    expect(upd.args[0]).toMatchObject({ is_active: false });
    expect(has(state.calls, 'eq', 'id', 'p1')).toBe(true);
  });

  it('a 42501 from the database is the same permission message', async () => {
    state.result = (table, calls) => {
      if (table === 'building_ppm_services' && has(calls, 'insert')) return { data: null, error: { message: 'denied', code: '42501' } };
      return { data: [line], error: null };
    };
    const { result } = renderHook(() => useBuildingPpm('b1'), { wrapper });
    await waitFor(() => expect(result.current.lines).toHaveLength(1));
    await expect(result.current.createLine({ service_name: 'X', recurrence: { every: 1, unit: 'year', month: 1, monthDay: 1 } }))
      .rejects.toThrow(PPM_PERMISSION_MESSAGE);
  });
});

describe('useBuildingPpm — generateNow', () => {
  it('calls generate_ppm_tasks for the building with a 365-day horizon and invalidates plan, my-work and calendar', async () => {
    state.rpcResult = { data: 7, error: null };
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useBuildingPpm('b1'), { wrapper });
    await waitFor(() => expect(result.current.lines).toHaveLength(1));
    let n = 0;
    await act(async () => { n = await result.current.generateNow(); });
    expect(n).toBe(7);
    expect(state.rpcCalls).toEqual([{ fn: 'generate_ppm_tasks', args: { p_building: 'b1', p_horizon_days: 365 } }]);
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toEqual(expect.arrayContaining([
      JSON.stringify(['building-ppm']), JSON.stringify(['ppm-derived']), JSON.stringify(['my-work']), JSON.stringify(['calendar']),
    ]));
    expect(toastMock.success).toHaveBeenCalledWith('Generated 7 PPM occurrences for the next year.');
  });

  it('a permission error from the RPC is the plain permission message', async () => {
    state.rpcResult = { data: null, error: { message: 'admin or manager only', code: '42501' } };
    const { result } = renderHook(() => useBuildingPpm('b1'), { wrapper });
    await waitFor(() => expect(result.current.lines).toHaveLength(1));
    await expect(result.current.generateNow()).rejects.toThrow(PPM_PERMISSION_MESSAGE);
  });
});

describe('derived grid', () => {
  it('reads ppm_monthly_status for the building filtered to the window months', async () => {
    const months = ['2026-07', '2026-08', '2026-09'];
    const { result } = renderHook(() => useBuildingPpm('b1', months), { wrapper });
    await waitFor(() => expect(result.current.derived).toHaveLength(1));
    const q = state.queries.find((x) => x.table === 'ppm_monthly_status')!;
    expect(has(q.calls, 'select', 'ppm_service_id, service_name, period_month, status, done_on')).toBe(true);
    expect(has(q.calls, 'eq', 'building_id', 'b1')).toBe(true);
    expect(has(q.calls, 'in', 'period_month', months)).toBe(true);
    expect(result.current.derived[0]).toMatchObject({ ppm_service_id: 'p1', period_month: '2026-09', status: 'due' });
  });

  it('skips the view query when the window is empty', async () => {
    const { result } = renderHook(() => useBuildingPpm('b1'), { wrapper });
    await waitFor(() => expect(result.current.lines).toHaveLength(1));
    expect(state.queries.filter((x) => x.table === 'ppm_monthly_status')).toHaveLength(0);
    expect(result.current.derived).toEqual([]);
  });

  it('useDerivedPpm is usable on its own (the report section shares it)', async () => {
    const { result } = renderHook(() => useDerivedPpm('b1', ['2026-09']), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });
});
