import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describeRule } from '@/lib/recurrence';

// Postgrest-like chain (same shape as useBuildingPpm.test.ts): every builder method records
// itself and returns the chain; awaiting the chain resolves `state.result(table, calls)`.
interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: { message: string; code?: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & {
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
};

const state = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  queries: [] as { table: string; calls: RecordedCall[] }[],
  result: (() => ({ data: [], error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
}));

vi.mock('@/integrations/supabase/client', () => {
  const METHODS = ['select', 'eq', 'in', 'order', 'insert', 'update', 'upsert', 'delete', 'maybeSingle', 'single'];
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
  return { supabase: { from } };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isAdminOrManager: true }) }));

import { useReportPpm, seedPpmFromPlan, REPORT_PPM_PERMISSION_MESSAGE } from './useReportPpm';

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);

const has = (calls: RecordedCall[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));
const callsOf = (method: string) => state.calls.filter((c) => c.method === method);

const MONTHS = ['2026-07', '2026-08', '2026-09'];
const EXISTING_OVERRIDE = { status: 'na' as const, note: 'Extinguishers replaced', by: 'u9', at: '2026-08-01T00:00:00Z' };
const r1 = {
  id: 'r1', report_id: 'rep1', building_id: 'b1', service_name: 'Lift service', frequency: 'Monthly', comment: null,
  sort_order: 1, months: {}, plan_service_id: 'p1', overrides: {}, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
};
const r2 = { ...r1, id: 'r2', service_name: 'Fire equipment', sort_order: 2, plan_service_id: 'p2', overrides: { '2026-08': EXISTING_OVERRIDE } };

const planLine = (id: string, service_name: string, sort_order = 0) => ({
  id, building_id: 'b1', service_name, contractor_id: null, recurrence: { every: 1, unit: 'month', monthDay: 1 },
  sort_order, is_active: true, notes: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
});

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  state.calls = [];
  state.queries = [];
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  state.result = (table, calls) => {
    if (table === 'ppm_services' && has(calls, 'update')) return { data: [{ id: 'r1' }], error: null };
    if (table === 'ppm_services' && has(calls, 'upsert')) return { data: null, error: null };
    if (table === 'ppm_services') return { data: [r1, r2], error: null };
    return { data: [], error: null };
  };
});

async function loaded() {
  const hook = renderHook(() => useReportPpm('rep1', 'b1', MONTHS), { wrapper });
  await waitFor(() => expect(hook.result.current.services).toHaveLength(2));
  return hook;
}

describe('useReportPpm — setOverride writes overrides only', () => {
  it('merges the new key {status, note, by, at} into the row\'s overrides and never touches months', async () => {
    const { result } = await loaded();
    await act(async () => { await result.current.setOverride('r1', '2026-08', { status: 'done', note: '  Serviced under warranty ' }); });
    const upd = callsOf('update');
    expect(upd).toHaveLength(1);
    const body = upd[0].args[0] as Record<string, unknown>;
    expect(body).toEqual({
      overrides: { '2026-08': { status: 'done', note: 'Serviced under warranty', by: 'u1', at: expect.any(String) } },
    });
    expect('months' in body).toBe(false);
    const q = state.queries.find((x) => x.table === 'ppm_services' && has(x.calls, 'update'))!;
    expect(has(q.calls, 'eq', 'id', 'r1')).toBe(true);
    expect(has(q.calls, 'select', 'id')).toBe(true);
  });

  it('keeps the other months\' overrides when adding one', async () => {
    const { result } = await loaded();
    await act(async () => { await result.current.setOverride('r2', '2026-09', { status: 'missed', note: 'No contractor' }); });
    const body = callsOf('update')[0].args[0] as { overrides: Record<string, unknown> };
    expect(Object.keys(body.overrides).sort()).toEqual(['2026-08', '2026-09']);
    expect(body.overrides['2026-08']).toEqual(EXISTING_OVERRIDE);
  });

  it('removing an override deletes just that key', async () => {
    const { result } = await loaded();
    await act(async () => { await result.current.setOverride('r2', '2026-08', null); });
    const body = callsOf('update')[0].args[0] as Record<string, unknown>;
    expect(body).toEqual({ overrides: {} });
    expect('months' in body).toBe(false);
  });

  it('an update RLS filtered to zero rows is the plain permission message', async () => {
    state.result = (table, calls) => {
      if (table === 'ppm_services' && has(calls, 'update')) return { data: [], error: null };
      if (table === 'ppm_services') return { data: [r1, r2], error: null };
      return { data: [], error: null };
    };
    const { result } = await loaded();
    await expect(result.current.setOverride('r1', '2026-08', { status: 'done', note: 'x' })).rejects.toThrow(REPORT_PPM_PERMISSION_MESSAGE);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(REPORT_PPM_PERMISSION_MESSAGE));
  });
});

describe('useReportPpm — upsertService and months', () => {
  it('omits months from the payload when the caller does not pass it (plan-backed rows)', async () => {
    const { result } = await loaded();
    await act(async () => { await result.current.upsertService({ id: 'r1', service_name: 'Lift service', comment: 'Checked', sort_order: 1 }); });
    const body = callsOf('upsert')[0].args[0] as Record<string, unknown>;
    expect(body).toMatchObject({ id: 'r1', report_id: 'rep1', building_id: 'b1', service_name: 'Lift service', comment: 'Checked' });
    expect('months' in body).toBe(false);
  });

  it('sends months when the caller passes it (legacy rows)', async () => {
    const { result } = await loaded();
    await act(async () => { await result.current.upsertService({ id: 'r3', service_name: 'Old pest control', months: { '2026-07': { status: 'done' } } }); });
    const body = callsOf('upsert')[0].args[0] as Record<string, unknown>;
    expect(body.months).toEqual({ '2026-07': { status: 'done' } });
  });
});

describe('seedPpmFromPlan', () => {
  it('inserts a plan-backed row per new plan line and links an existing same-name row instead of duplicating it', async () => {
    const lines = [planLine('p1', 'Lift Service', 0), planLine('p2', 'Generator service', 1)];
    const existing = [{ ...r1, service_name: 'lift service', plan_service_id: null, sort_order: 4 }];
    state.result = (table, calls) => {
      if (table === 'building_ppm_services') return { data: lines, error: null };
      if (table === 'ppm_services' && has(calls, 'update')) return { data: [{ id: 'r1' }], error: null };
      if (table === 'ppm_services' && has(calls, 'insert')) return { data: [{ id: 'new' }], error: null };
      if (table === 'ppm_services') return { data: existing, error: null };
      return { data: [], error: null };
    };
    const out = await seedPpmFromPlan('rep1', 'b1');
    expect(out).toEqual({ added: 1, linked: 1 });

    const plan = state.queries.find((x) => x.table === 'building_ppm_services')!;
    expect(has(plan.calls, 'eq', 'building_id', 'b1')).toBe(true);
    expect(has(plan.calls, 'eq', 'is_active', true)).toBe(true);

    const upd = state.queries.find((x) => x.table === 'ppm_services' && has(x.calls, 'update'))!;
    expect(has(upd.calls, 'update', { plan_service_id: 'p1' })).toBe(true);
    expect(has(upd.calls, 'eq', 'id', 'r1')).toBe(true);

    const ins = callsOf('insert')[0].args[0] as Record<string, unknown>[];
    expect(ins).toHaveLength(1);
    expect(ins[0]).toMatchObject({
      report_id: 'rep1', building_id: 'b1', service_name: 'Generator service', plan_service_id: 'p2',
      months: {}, overrides: {}, comment: null, sort_order: 5, frequency: describeRule(lines[1].recurrence as never),
    });
    expect(typeof ins[0].id).toBe('string');
  });

  it('is idempotent: a report that already has every line gets no writes', async () => {
    state.result = (table) => {
      if (table === 'building_ppm_services') return { data: [planLine('p1', 'Lift service'), planLine('p2', 'Fire equipment')], error: null };
      if (table === 'ppm_services') return { data: [r1, r2], error: null };
      return { data: [], error: null };
    };
    expect(await seedPpmFromPlan('rep1', 'b1')).toEqual({ added: 0, linked: 0 });
    expect(callsOf('insert')).toHaveLength(0);
    expect(callsOf('update')).toHaveLength(0);
  });

  it('a building with no active plan lines costs one read and changes nothing', async () => {
    expect(await seedPpmFromPlan('rep1', 'b1')).toEqual({ added: 0, linked: 0 });
    expect(state.queries.map((q) => q.table)).toEqual(['building_ppm_services']);
  });

  it('an insert RLS refused (42501) is the plain permission message', async () => {
    state.result = (table, calls) => {
      if (table === 'building_ppm_services') return { data: [planLine('p3', 'Borehole pump')], error: null };
      if (table === 'ppm_services' && has(calls, 'insert')) return { data: null, error: { message: 'denied', code: '42501' } };
      if (table === 'ppm_services') return { data: [r1, r2], error: null };
      return { data: [], error: null };
    };
    await expect(seedPpmFromPlan('rep1', 'b1')).rejects.toThrow(REPORT_PPM_PERMISSION_MESSAGE);
  });

  it('the hook\'s seedFromPlan runs the same function and refreshes the rows', async () => {
    state.result = (table, calls) => {
      if (table === 'building_ppm_services') return { data: [planLine('p1', 'Lift service'), planLine('p3', 'Borehole pump')], error: null };
      if (table === 'ppm_services' && has(calls, 'insert')) return { data: [{ id: 'new' }], error: null };
      if (table === 'ppm_services') return { data: [r1, r2], error: null };
      return { data: [], error: null };
    };
    const { result } = await loaded();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    await act(async () => { await result.current.seedFromPlan(); });
    expect(callsOf('insert')).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['fortress-ppm-services', 'rep1'] });
    expect(toastMock.success).toHaveBeenCalledWith('Added 1 service from the building plan.');
  });
});
