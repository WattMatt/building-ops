import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ExpiringItem } from '@/lib/expiry';

const state = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => state.rpc(...args) },
}));

import { useExpiringItems } from './useExpiringItems';

const rows: ExpiringItem[] = [
  {
    kind: 'building_document', entity_type: 'document', entity_id: 'd1', parent_id: null, building_id: 'b1',
    building_name: 'Alpha Court', name: 'Fire certificate', detail: 'Certificate', expiry_date: '2026-09-20', days_left: 10,
  },
  {
    kind: 'asset_service', entity_type: 'asset', entity_id: 'a1', parent_id: null, building_id: 'b1',
    building_name: 'Alpha Court', name: 'Generator', detail: 'Power', expiry_date: '2026-09-01', days_left: -9,
  },
];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

describe('useExpiringItems', () => {
  beforeEach(() => {
    state.rpc.mockReset();
  });

  it('calls expiring_items with the window and returns the rows', async () => {
    state.rpc.mockResolvedValue({ data: rows, error: null });
    const { result } = renderHook(() => useExpiringItems(60), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenCalledWith('expiring_items', { p_days: 60 });
    expect(result.current.data).toEqual(rows);
  });

  it('defaults to a 90-day window and an empty list for null data', async () => {
    state.rpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useExpiringItems(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.rpc).toHaveBeenCalledWith('expiring_items', { p_days: 90 });
    expect(result.current.data).toEqual([]);
  });

  it('surfaces an rpc error as a failed query', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    const { result } = renderHook(() => useExpiringItems(30), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as { message: string }).message).toBe('permission denied');
  });
});
