import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: { message: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & { then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown };
const state = vi.hoisted(() => ({
  queries: [] as { table: string; calls: RecordedCall[] }[],
  result: (() => ({ data: null, error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string): Chain => {
      const own: RecordedCall[] = [];
      const chain = {} as Chain;
      for (const m of ['select', 'limit', 'maybeSingle', 'update', 'eq']) chain[m] = (...args: unknown[]) => { own.push({ table, method: m, args }); return chain; };
      chain.then = (resolve, reject) => { state.queries.push({ table, calls: own }); return Promise.resolve(state.result(table, own)).then(resolve, reject); };
      return chain;
    },
  },
}));

import { useOrgSettings, useFeature, mergeOrgSettings, ORG_SETTINGS_KEY } from './useOrgSettings';
import { DEFAULT_ORG_SETTINGS } from '@/lib/orgSettings';

// One client per test: a client created inside the wrapper would be rebuilt on every re-render, and the
// hook would attach to an empty cache after the mutation's setQueryData.
let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);

/** A row store: selects read it, updates write it — so the post-save refetch sees what was saved. */
function rowStore(initial: Record<string, unknown>) {
  let settings = initial;
  state.result = (_t, calls) => {
    const upd = calls.find((c) => c.method === 'update');
    if (upd) { settings = (upd.args[0] as { settings: Record<string, unknown> }).settings; return { data: null, error: null }; }
    return { data: { id: 'o1', settings }, error: null };
  };
  return { get: () => settings };
}
const updateQuery = () => state.queries.find((q) => q.calls.some((c) => c.method === 'update'))!;
const savedPayload = () => (updateQuery().calls.find((c) => c.method === 'update')!.args[0] as { settings: Record<string, unknown> }).settings;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  state.queries = [];
  state.result = () => ({ data: null, error: null });
});

describe('mergeOrgSettings', () => {
  it('lays the parsed object over the stored jsonb, one level down for sla_hours and features', () => {
    const raw = { report_due_day: 5, future_key: 'x', sla_hours: { critical: 2, future_hours: 9 }, features: { share_links: true, future_flag: true } };
    const merged = mergeOrgSettings(raw, { ...DEFAULT_ORG_SETTINGS, report_due_day: 3 });
    expect(merged.future_key).toBe('x');
    expect(merged.report_due_day).toBe(3);
    expect(merged.sla_hours).toEqual({ ...DEFAULT_ORG_SETTINGS.sla_hours, future_hours: 9 });
    expect(merged.features).toEqual({ ...DEFAULT_ORG_SETTINGS.features, future_flag: true });
  });
  it('tolerates a stored sla_hours / features that is not an object', () => {
    const merged = mergeOrgSettings({ sla_hours: 'bad', features: null }, DEFAULT_ORG_SETTINGS);
    expect(merged.sla_hours).toEqual(DEFAULT_ORG_SETTINGS.sla_hours);
    expect(merged.features).toEqual(DEFAULT_ORG_SETTINGS.features);
  });
});

describe('useOrgSettings', () => {
  it('selects only id and settings, parses with defaults and exposes the organization id', async () => {
    rowStore({ report_due_day: 12 });
    const { result } = renderHook(() => useOrgSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(state.queries[0].calls.find((c) => c.method === 'select')!.args).toEqual(['id, settings']);
    expect(result.current.organizationId).toBe('o1');
    expect(result.current.settings.report_due_day).toBe(12);
    expect(result.current.settings.sla_hours).toEqual(DEFAULT_ORG_SETTINGS.sla_hours);
  });
  it('save writes the merged object to the organization row and updates the cache', async () => {
    rowStore({});
    const { result } = renderHook(() => useOrgSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const next = { ...DEFAULT_ORG_SETTINGS, report_due_day: 3 };
    await act(async () => { await result.current.save(next); });
    expect(savedPayload()).toEqual(next);
    expect(updateQuery().calls.find((c) => c.method === 'eq')!.args).toEqual(['id', 'o1']);
    await waitFor(() => expect(result.current.settings.report_due_day).toBe(3));
  });
  it('save keeps unknown top-level keys and unknown feature flags that are already stored', async () => {
    const store = rowStore({ report_due_day: 5, future_key: 'x', features: { share_links: true, future_flag: true }, sla_hours: { critical: 2 } });
    const { result } = renderHook(() => useOrgSettings(), { wrapper });
    await waitFor(() => expect(result.current.settings.report_due_day).toBe(5));
    await act(async () => { await result.current.save({ ...result.current.settings, report_due_day: 3 }); });
    const payload = savedPayload();
    expect(payload.future_key).toBe('x');
    expect(payload.report_due_day).toBe(3);
    expect(payload.features).toEqual({ share_links: true, report_schedules: false, tenant_intake: false, future_flag: true });
    expect(payload.sla_hours).toEqual({ critical: 2, high: 24, medium: 72, low: 168 });
    expect(store.get()).toEqual(payload);
    // The cache keeps the raw base for the next merge.
    expect(qc.getQueryData<{ raw: Record<string, unknown> }>(ORG_SETTINGS_KEY)?.raw.future_key).toBe('x');
  });
  it('save cancels an in-flight read first and refetches once settled', async () => {
    rowStore({});
    const cancel = vi.spyOn(qc, 'cancelQueries');
    const { result } = renderHook(() => useOrgSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const reads = () => state.queries.filter((q) => q.calls.some((c) => c.method === 'select')).length;
    expect(reads()).toBe(1);
    await act(async () => { await result.current.save({ ...DEFAULT_ORG_SETTINGS, report_due_day: 4 }); });
    expect(cancel).toHaveBeenCalledWith({ queryKey: ORG_SETTINGS_KEY });
    await waitFor(() => expect(reads()).toBe(2));
    expect(result.current.settings.report_due_day).toBe(4);
  });
  it('save refuses without an organization row', async () => {
    state.result = () => ({ data: null, error: null });
    const { result } = renderHook(() => useOrgSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await expect(act(async () => { await result.current.save(DEFAULT_ORG_SETTINGS); })).rejects.toThrow('No organization row');
    expect(state.queries.some((q) => q.calls.some((c) => c.method === 'update'))).toBe(false);
  });
  it('useFeature is false while loading and true once the flag is on', async () => {
    rowStore({ features: { share_links: true } });
    const { result } = renderHook(() => useFeature('share_links'), { wrapper });
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });
});
