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

import { useOrgSettings, useFeature } from './useOrgSettings';
import { DEFAULT_ORG_SETTINGS } from '@/lib/orgSettings';

// One client per test: a client created inside the wrapper would be rebuilt on every re-render, and the
// hook would attach to an empty cache after the mutation's setQueryData.
let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  state.queries = [];
  state.result = () => ({ data: null, error: null });
});

describe('useOrgSettings', () => {
  it('parses the row with defaults and exposes the organization id', async () => {
    state.result = (_t, calls) => calls.some((c) => c.method === 'select')
      ? { data: { id: 'o1', name: 'Org', settings: { report_due_day: 12 } }, error: null } : { data: null, error: null };
    const { result } = renderHook(() => useOrgSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.organizationId).toBe('o1');
    expect(result.current.settings.report_due_day).toBe(12);
    expect(result.current.settings.sla_hours).toEqual(DEFAULT_ORG_SETTINGS.sla_hours);
  });
  it('save writes the whole object to the organization row and updates the cache', async () => {
    state.result = (_t, calls) => calls.some((c) => c.method === 'select')
      ? { data: { id: 'o1', settings: {} }, error: null } : { data: null, error: null };
    const { result } = renderHook(() => useOrgSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const next = { ...DEFAULT_ORG_SETTINGS, report_due_day: 3 };
    await act(async () => { await result.current.save(next); });
    const upd = state.queries.find((q) => q.calls.some((c) => c.method === 'update'))!;
    expect((upd.calls.find((c) => c.method === 'update')!.args[0] as { settings: unknown }).settings).toEqual(next);
    expect(upd.calls.find((c) => c.method === 'eq')!.args).toEqual(['id', 'o1']);
    await waitFor(() => expect(result.current.settings.report_due_day).toBe(3));
  });
  it('useFeature is false while loading and true once the flag is on', async () => {
    state.result = () => ({ data: { id: 'o1', settings: { features: { share_links: true } } }, error: null });
    const { result } = renderHook(() => useFeature('share_links'), { wrapper });
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });
});
