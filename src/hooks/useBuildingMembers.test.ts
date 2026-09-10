import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));

import { useBuildingMembers, memberDisplayName } from './useBuildingMembers';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

describe('useBuildingMembers', () => {
  it('calls building_members with the building id and returns members', async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' }], error: null });
    const { result } = renderHook(() => useBuildingMembers('b1'), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(rpc).toHaveBeenCalledWith('building_members', { b: 'b1' });
    expect(result.current.byId.get('u1')?.full_name).toBe('Thabo M');
  });

  it('is disabled without a building id', () => {
    const { result } = renderHook(() => useBuildingMembers(undefined), { wrapper });
    expect(result.current.isLoading).toBe(false);
    expect(rpc).not.toHaveBeenCalledWith('building_members', { b: undefined });
  });
});

describe('memberDisplayName', () => {
  it('falls back sensibly', () => {
    expect(memberDisplayName({ id: 'x', full_name: null, avatar_url: null, role: 'user' })).toBe('Unnamed user');
    expect(memberDisplayName({ id: 'x', full_name: '  Ann ', avatar_url: null, role: 'user' })).toBe('Ann');
  });
});
