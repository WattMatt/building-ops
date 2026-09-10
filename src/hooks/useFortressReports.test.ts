import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: { message: string; code?: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & {
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
};

const state = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  queries: [] as { table: string; calls: RecordedCall[] }[],
  result: (() => ({ data: [], error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
  rpc: vi.fn<(...args: unknown[]) => Promise<{ error: { message: string; code?: string } | null }>>(async () => ({ error: null })),
}));

vi.mock('@/integrations/supabase/client', () => {
  const METHODS = ['select', 'eq', 'in', 'order', 'limit', 'insert', 'update', 'upsert', 'delete', 'maybeSingle', 'single'];
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
  return { supabase: { from, rpc: (...a: unknown[]) => state.rpc(...a) } };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' }, isAdminOrManager: true }) }));
vi.mock('@/lib/notify', () => ({ notify: vi.fn(async () => {}) }));

const seedMock = vi.hoisted(() => ({ seedPpmFromPlan: vi.fn(async () => ({ added: 2, linked: 0, skipped: 0 })) }));
vi.mock('@/hooks/useReportPpm', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useReportPpm')>('@/hooks/useReportPpm');
  return { describeSeed: actual.describeSeed, seedPpmFromPlan: seedMock.seedPpmFromPlan };
});

import { useCreateReport, useCarryForwardReport, useDiscardDraft, useSetBuildingReportTypes, discardErrorMessage, PPM_SEED_FAILED_MESSAGE } from './useFortressReports';

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
const has = (calls: RecordedCall[], method: string) => calls.some((c) => c.method === method);

const report = (over: Record<string, unknown> = {}) => ({
  id: 'rep1', building_id: 'b1', organization_id: 'o1', report_type: 'ops_monthly', report_period: '2026-09-01',
  title: 'Ops', status: 'draft', author_id: 'u1', author_name: 'A', inspection_date: null, ...over,
});

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  state.calls = [];
  state.queries = [];
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.warning.mockClear();
  state.rpc.mockClear();
  state.rpc.mockImplementation(async () => ({ error: null }));
  seedMock.seedPpmFromPlan.mockClear();
  seedMock.seedPpmFromPlan.mockImplementation(async () => ({ added: 2, linked: 0, skipped: 0 }));
  state.result = (table, calls) => {
    if (table === 'buildings') return { data: { organization_id: 'o1' }, error: null };
    if (table === 'profiles') return { data: { full_name: 'A' }, error: null };
    if (table === 'reports' && has(calls, 'insert')) {
      const body = calls.find((c) => c.method === 'insert')!.args[0] as Record<string, unknown>;
      return { data: report({ id: body.id, building_id: body.building_id, report_type: body.report_type }), error: null };
    }
    return { data: [], error: null };
  };
});

const input = { buildingId: 'b1', reportType: 'ops_monthly' as const, reportPeriod: '2026-09-01', title: 'Ops' };

describe('useCreateReport — PPM seeding', () => {
  it('seeds the PPM rows from the building plan after inserting an ops report', async () => {
    const { result } = renderHook(() => useCreateReport(), { wrapper });
    let created: { id: string } | undefined;
    await act(async () => { created = await result.current.mutateAsync(input); });
    expect(created?.id).toBeTruthy();
    expect(seedMock.seedPpmFromPlan).toHaveBeenCalledTimes(1);
    expect(seedMock.seedPpmFromPlan).toHaveBeenCalledWith(created!.id, 'b1');
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('does not seed report types without a PPM section', async () => {
    const { result } = renderHook(() => useCreateReport(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ ...input, reportType: 'cm_monthly' }); });
    expect(seedMock.seedPpmFromPlan).not.toHaveBeenCalled();
  });

  it('a refused seed keeps the created report and says how to recover', async () => {
    seedMock.seedPpmFromPlan.mockImplementation(async () => { throw new Error('denied'); });
    const { result } = renderHook(() => useCreateReport(), { wrapper });
    let created: { id: string } | undefined;
    await act(async () => { created = await result.current.mutateAsync(input); });
    expect(created?.id).toBeTruthy();
    expect(toastMock.error).toHaveBeenCalledWith(PPM_SEED_FAILED_MESSAGE);
  });

  it('a seed that had to skip a plan line says so instead of silently leaving it off the grid', async () => {
    seedMock.seedPpmFromPlan.mockImplementation(async () => ({ added: 1, linked: 0, skipped: 1 }));
    const { result } = renderHook(() => useCreateReport(), { wrapper });
    await act(async () => { await result.current.mutateAsync(input); });
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
    expect(toastMock.warning.mock.calls[0][0]).toContain('1 plan line was skipped');
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('never seeds when the report insert itself failed', async () => {
    state.result = (table, calls) => {
      if (table === 'reports' && has(calls, 'insert')) return { data: null, error: { message: 'dup', code: '23505' } };
      return { data: null, error: null };
    };
    const { result } = renderHook(() => useCreateReport(), { wrapper });
    await expect(result.current.mutateAsync(input)).rejects.toMatchObject({ code: '23505' });
    expect(seedMock.seedPpmFromPlan).not.toHaveBeenCalled();
  });
});

describe('useCarryForwardReport — PPM seeding', () => {
  it('seeds from the plan (idempotently) instead of cloning the prior report\'s ppm_services', async () => {
    seedMock.seedPpmFromPlan.mockImplementation(async () => ({ added: 1, linked: 0, skipped: 0 }));
    const { result } = renderHook(() => useCarryForwardReport(), { wrapper });
    let n = 0;
    await act(async () => { n = await result.current.mutateAsync({ newReport: report() as never, fromReportId: 'rep0' }); });
    expect(seedMock.seedPpmFromPlan).toHaveBeenCalledWith('rep1', 'b1');
    expect(n).toBe(1);
    // The prior report's PPM rows are not read or copied.
    expect(state.queries.some((q) => q.table === 'ppm_services')).toBe(false);
    expect(toastMock.success).toHaveBeenCalledWith('Carried forward 1 row from the previous report.');
  });

  it('skips seeding for report types without a PPM section', async () => {
    const { result } = renderHook(() => useCarryForwardReport(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ newReport: report({ report_type: 'cm_monthly' }) as never, fromReportId: 'rep0' }); });
    expect(seedMock.seedPpmFromPlan).not.toHaveBeenCalled();
  });
});

describe('useDiscardDraft', () => {
  it('calls delete_empty_report with the id and invalidates the list', async () => {
    const { result } = renderHook(() => useDiscardDraft(), { wrapper });
    await act(async () => { await result.current.mutateAsync('rep1'); });
    expect(state.rpc).toHaveBeenCalledWith('delete_empty_report', { p_report: 'rep1' });
    expect(toastMock.success).toHaveBeenCalledWith('Draft discarded.');
  });
  it('maps the "saved rows" refusal to plain copy when only the message is available', async () => {
    state.rpc.mockResolvedValueOnce({ error: { message: 'delete_empty_report: this draft has 3 saved row(s); clear its sections before discarding it' } });
    const { result } = renderHook(() => useDiscardDraft(), { wrapper });
    await act(async () => { await result.current.mutateAsync('rep1').catch(() => {}); });
    expect(toastMock.error).toHaveBeenCalledWith('This draft has saved content. Clear its sections before discarding it.');
  });
  it('maps by SQLSTATE first, whatever the message says', async () => {
    state.rpc.mockResolvedValueOnce({ error: { code: 'PR002', message: 'delete_empty_report: refused' } });
    const { result } = renderHook(() => useDiscardDraft(), { wrapper });
    await act(async () => { await result.current.mutateAsync('rep1').catch(() => {}); });
    expect(toastMock.error).toHaveBeenCalledWith('This draft has saved PDF versions and cannot be discarded.');
  });
  it('a report that is already gone refreshes the list', async () => {
    state.rpc.mockResolvedValueOnce({ error: { code: 'P0002', message: 'delete_empty_report: report not found' } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDiscardDraft(), { wrapper });
    await act(async () => { await result.current.mutateAsync('rep1').catch(() => {}); });
    expect(toastMock.error).toHaveBeenCalledWith('That report no longer exists.');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['fortress-reports'] });
  });
});

describe('discardErrorMessage', () => {
  it('knows every code the function raises', () => {
    expect(discardErrorMessage({ code: '42501', message: 'x' })).toBe('Only an admin can discard a draft.');
    expect(discardErrorMessage({ code: 'P0002', message: 'x' })).toBe('That report no longer exists.');
    expect(discardErrorMessage({ code: 'PR001', message: 'x' })).toBe('Only a draft can be discarded.');
    expect(discardErrorMessage({ code: 'PR002', message: 'x' })).toBe('This draft has saved PDF versions and cannot be discarded.');
    expect(discardErrorMessage({ code: 'PR003', message: 'x' })).toBe('This draft has saved content. Clear its sections before discarding it.');
  });
  it('falls back to the message, then to a generic line', () => {
    expect(discardErrorMessage({ code: '42501', message: 'delete_empty_report: only a draft can be discarded (this report is approved)' })).toBe('Only an admin can discard a draft.');
    expect(discardErrorMessage({ message: 'delete_empty_report: only a draft can be discarded (this report is approved)' })).toBe('Only a draft can be discarded.');
    expect(discardErrorMessage({ message: 'delete_empty_report: admin only' })).toBe('Only an admin can discard a draft.');
    expect(discardErrorMessage({ code: 'XX000', message: 'boom' })).toBe('Could not discard the draft.');
    expect(discardErrorMessage(null)).toBe('Could not discard the draft.');
  });
});

describe('useSetBuildingReportTypes', () => {
  it('writes report_types on the building and refreshes the buildings list', async () => {
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSetBuildingReportTypes(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ buildingId: 'b1', reportTypes: ['ops_monthly', 'annual_inspection'] }); });
    const q = state.queries.find((x) => x.table === 'buildings' && has(x.calls, 'update'))!;
    expect(q.calls.find((c) => c.method === 'update')!.args[0]).toEqual({ report_types: ['ops_monthly', 'annual_inspection'] });
    expect(q.calls.find((c) => c.method === 'eq')!.args).toEqual(['id', 'b1']);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['buildings-for-reports'] });
    expect(toastMock.error).not.toHaveBeenCalled();
  });
  it('a refused write says so', async () => {
    state.result = (table) => table === 'buildings' ? { data: null, error: { message: 'permission denied' } } : { data: [], error: null };
    const { result } = renderHook(() => useSetBuildingReportTypes(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ buildingId: 'b1', reportTypes: [] }).catch(() => {}); });
    expect(toastMock.error).toHaveBeenCalledWith('Could not update the report types for that building.');
  });
});
