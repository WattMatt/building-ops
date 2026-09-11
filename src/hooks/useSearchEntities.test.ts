import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSearchEntities, type SearchHit } from './useSearchEntities';

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => state.rpc(...args) },
}));

const rows: SearchHit[] = [
  { kind: 'building', id: 'b1', building_id: 'b1', title: 'Fifth Avenue Tower', subtitle: '5 Fifth Ave' },
  { kind: 'issue', id: 'i1', building_id: 'b1', title: 'Fire door jammed', subtitle: null },
];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

describe('useSearchEntities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.rpc.mockReset();
    state.rpc.mockResolvedValue({ data: rows, error: null });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never calls the rpc below two characters', () => {
    const { result } = renderHook(() => useSearchEntities('f'), { wrapper });
    act(() => { vi.advanceTimersByTime(500); });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('debounces 200 ms, then calls search_entities once and exposes the rows', async () => {
    const { result } = renderHook(() => useSearchEntities('fi'), { wrapper });
    act(() => { vi.advanceTimersByTime(150); });
    expect(state.rpc).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(50); });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenCalledWith('search_entities', { q: 'fi', lim: 20 });

    vi.useRealTimers();
    await waitFor(() => expect(result.current.data).toEqual(rows));
  });

  it('throws the rpc error into the query', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useSearchEntities('fi'), { wrapper });
    act(() => { vi.advanceTimersByTime(200); });
    vi.useRealTimers();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('boom');
  });
});
