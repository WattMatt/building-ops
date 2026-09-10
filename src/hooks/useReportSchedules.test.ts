import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: { message: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & { then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown };
const state = vi.hoisted(() => ({
  queries: [] as { table: string; calls: RecordedCall[] }[],
  result: (() => ({ data: [], error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
  invoke: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string): Chain => {
      const own: RecordedCall[] = [];
      const chain = {} as Chain;
      for (const m of ['select', 'order', 'limit', 'eq', 'insert', 'update', 'delete']) {
        chain[m] = (...args: unknown[]) => { own.push({ table, method: m, args }); return chain; };
      }
      chain.then = (resolve, reject) => { state.queries.push({ table, calls: own }); return Promise.resolve(state.result(table, own)).then(resolve, reject); };
      return chain;
    },
    functions: { invoke: (...args: unknown[]) => state.invoke(...args) },
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isAdminOrManager: true }) }));

import { useReportSchedules, useScheduleDistributions, isEmail, SCHEDULE_PERMISSION_MESSAGE, type ScheduleInput } from './useReportSchedules';

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
const callsOn = (table: string, method: string) => state.queries.filter((q) => q.table === table).flatMap((q) => q.calls).filter((c) => c.method === method);

const INPUT: ScheduleInput = {
  report_type: 'ops_monthly',
  building_ids: null,
  recipients: [{ email: 'client@example.com', name: 'Client' }, { user_id: '00000000-0000-0000-0000-000000000001', name: 'Ann' }],
  send_day: 7,
  remind_days_before: 3,
  is_active: true,
};

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  state.queries = [];
  state.result = () => ({ data: [], error: null });
  state.invoke = vi.fn().mockResolvedValue({ data: { ok: true, dryRun: true, today: '2026-10-07', schedules: [], counts: {} }, error: null });
});

describe('isEmail', () => {
  it('accepts a plain address and rejects the shapes report_recipients_valid rejects', () => {
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('First.Last+tag@sub.example.org')).toBe(true);
    expect(isEmail('nope')).toBe(false);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('a b@c.co')).toBe(false);
    expect(isEmail('a@@b.co')).toBe(false);
    expect(isEmail('')).toBe(false);
  });
});

describe('useReportSchedules', () => {
  it('lists schedules with select(*) ordered by created_at', async () => {
    state.result = () => ({ data: [{ id: 's1', report_type: 'ops_monthly' }], error: null });
    const { result } = renderHook(() => useReportSchedules(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.schedules).toEqual([{ id: 's1', report_type: 'ops_monthly' }]);
    expect(callsOn('report_schedules', 'select')[0].args).toEqual(['*']);
    expect(callsOn('report_schedules', 'order')[0].args[0]).toBe('created_at');
  });

  it('create inserts the six fields plus created_by and selects id', async () => {
    state.result = (_t, calls) => (calls.some((c) => c.method === 'insert') ? { data: [{ id: 's-new' }], error: null } : { data: [], error: null });
    const { result } = renderHook(() => useReportSchedules(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await result.current.create(INPUT); });
    const insert = callsOn('report_schedules', 'insert')[0];
    expect(insert.args[0]).toEqual({ ...INPUT, created_by: 'u1' });
    const q = state.queries.find((x) => x.calls.some((c) => c.method === 'insert'))!;
    expect(q.calls.map((c) => c.method)).toEqual(['insert', 'select']);
    expect(q.calls[1].args).toEqual(['id']);
  });

  it('create surfaces the permission message when RLS swallows the insert (zero rows, no error)', async () => {
    state.result = () => ({ data: [], error: null });
    const { result } = renderHook(() => useReportSchedules(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await expect(result.current.create(INPUT)).rejects.toThrow(SCHEDULE_PERMISSION_MESSAGE);
  });

  it('update writes only the editable columns, filtered by id, and guards on the returned row', async () => {
    state.result = (_t, calls) => (calls.some((c) => c.method === 'update') ? { data: [{ id: 's1' }], error: null } : { data: [], error: null });
    const { result } = renderHook(() => useReportSchedules(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.update('s1', { is_active: false, send_day: 9, last_run_on: '2026-10-07', created_by: 'x', id: 'zzz' } as never);
    });
    const q = state.queries.find((x) => x.calls.some((c) => c.method === 'update'))!;
    expect(q.calls[0].args[0]).toEqual({ is_active: false, send_day: 9 });
    expect(q.calls.map((c) => c.method)).toEqual(['update', 'eq', 'select']);
    expect(q.calls[1].args).toEqual(['id', 's1']);
  });

  it('update with zero rows back is the permission message', async () => {
    state.result = () => ({ data: [], error: null });
    const { result } = renderHook(() => useReportSchedules(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await expect(result.current.update('s1', { is_active: false })).rejects.toThrow(SCHEDULE_PERMISSION_MESSAGE);
  });

  it('remove deletes by id', async () => {
    state.result = (_t, calls) => (calls.some((c) => c.method === 'delete') ? { data: [{ id: 's1' }], error: null } : { data: [], error: null });
    const { result } = renderHook(() => useReportSchedules(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await result.current.remove('s1'); });
    const q = state.queries.find((x) => x.calls.some((c) => c.method === 'delete'))!;
    expect(q.calls.map((c) => c.method)).toEqual(['delete', 'eq', 'select']);
    expect(q.calls[1].args).toEqual(['id', 's1']);
  });

  it('runNow invokes report-distribution with the schedule id, dryRun and optional period', async () => {
    const { result } = renderHook(() => useReportSchedules(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let res: unknown;
    await act(async () => { res = await result.current.runNow({ scheduleId: 's1', dryRun: true }); });
    expect(state.invoke).toHaveBeenCalledWith('report-distribution', { body: { scheduleId: 's1', dryRun: true } });
    expect((res as { dryRun: boolean }).dryRun).toBe(true);
    await act(async () => { await result.current.runNow({ scheduleId: 's1', dryRun: false, period: '2026-09-01' }); });
    expect(state.invoke).toHaveBeenLastCalledWith('report-distribution', { body: { scheduleId: 's1', dryRun: false, period: '2026-09-01' } });
  });

  it('a real run invalidates the schedules and that schedule\'s distributions; a dry run does not', async () => {
    const { result } = renderHook(() => useReportSchedules(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await act(async () => { await result.current.runNow({ scheduleId: 's1', dryRun: true }); });
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => { await result.current.runNow({ scheduleId: 's1', dryRun: false }); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['report-schedules'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['report-distributions', 's1'] });
  });

  it('runNow throws the function error message', async () => {
    state.invoke = vi.fn().mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'forbidden' }) } } });
    const { result } = renderHook(() => useReportSchedules(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await expect(result.current.runNow({ scheduleId: 's1', dryRun: true })).rejects.toThrow('forbidden');
  });
});

describe('useScheduleDistributions', () => {
  it('reads the last 100 rows for the schedule, newest first', async () => {
    state.result = () => ({ data: [{ id: 'd1', status: 'sent' }], error: null });
    const { result } = renderHook(() => useScheduleDistributions('s1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([{ id: 'd1', status: 'sent' }]);
    const q = state.queries.find((x) => x.table === 'report_distributions')!;
    expect(q.calls.find((c) => c.method === 'eq')!.args).toEqual(['schedule_id', 's1']);
    expect(q.calls.find((c) => c.method === 'order')!.args).toEqual(['sent_at', { ascending: false }]);
    expect(q.calls.find((c) => c.method === 'limit')!.args).toEqual([100]);
  });

  it('is disabled without a schedule id', () => {
    const { result } = renderHook(() => useScheduleDistributions(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(state.queries).toHaveLength(0);
  });
});
