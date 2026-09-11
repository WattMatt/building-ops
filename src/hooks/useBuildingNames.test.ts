import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({
  calls: [] as { method: string; args: unknown[] }[],
  result: { data: [] as unknown[] | null, error: null as { message: string } | null },
}));

vi.mock('@/integrations/supabase/client', () => {
  const chain = {
    select: (...args: unknown[]) => { state.calls.push({ method: 'select', args }); return chain; },
    order: async (...args: unknown[]) => { state.calls.push({ method: 'order', args }); return state.result; },
  };
  return { supabase: { from: (table: string) => { state.calls.push({ method: 'from', args: [table] }); return chain; } } };
});

import { useBuildingNames } from './useBuildingNames';

const makeWrapper = (client: QueryClient) => ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);

beforeEach(() => {
  state.calls = [];
  state.result = { data: [{ id: 'b2', name: 'Beta' }, { id: 'b1', name: 'Alpha' }], error: null };
});

describe('useBuildingNames', () => {
  it('selects only id and name, ordered by name, under its own cache key', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useBuildingNames(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.calls).toEqual([
      { method: 'from', args: ['buildings'] },
      { method: 'select', args: ['id, name'] },
      { method: 'order', args: ['name'] },
    ]);
    expect(result.current.data).toEqual([{ id: 'b2', name: 'Beta' }, { id: 'b1', name: 'Alpha' }]);
    // Not the reports page's key: that one selects report_types too and must not be fed these rows.
    expect(client.getQueryData(['buildings-names'])).toBeTruthy();
    expect(client.getQueryData(['buildings-for-reports'])).toBeUndefined();
    expect((client.getQueryCache().find({ queryKey: ['buildings-names'] })?.options as { staleTime?: number } | undefined)?.staleTime).toBe(10 * 60_000);
  });

  it('surfaces a read error rather than an empty list', async () => {
    state.result = { data: null, error: { message: 'permission denied' } };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useBuildingNames(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
