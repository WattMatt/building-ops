import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));

import { useAssignablePeople, addablePeople, type AssignablePerson } from './useAssignablePeople';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

const people: AssignablePerson[] = [
  { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user', deactivated: false },
  { id: 'u2', full_name: 'Lerato K', avatar_url: null, role: 'manager', deactivated: false },
  { id: 'u3', full_name: 'Sipho N', avatar_url: null, role: 'user', deactivated: true },
  { id: 'u4', full_name: 'Ayanda D', avatar_url: null, role: 'user', deactivated: false },
  { id: 'u5', full_name: 'Root', avatar_url: null, role: 'admin', deactivated: false },
];

describe('useAssignablePeople', () => {
  beforeEach(() => rpc.mockReset());

  it('calls assignable_people and returns the rows', async () => {
    rpc.mockResolvedValueOnce({ data: people, error: null });
    const { result } = renderHook(() => useAssignablePeople(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(5));
    expect(rpc).toHaveBeenCalledWith('assignable_people');
  });

  it('does not call the RPC when disabled (non-managers get a 403 from it)', () => {
    const { result } = renderHook(() => useAssignablePeople(false), { wrapper });
    expect(result.current.isLoading).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces the RPC error message', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'assignable_people: admin or manager only' } });
    const { result } = renderHook(() => useAssignablePeople(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('assignable_people: admin or manager only');
  });
});

describe('addablePeople', () => {
  it('drops current members, admins, managers and deactivated accounts, keeping input order', () => {
    expect(addablePeople(people, new Set(['u1'])).map((p) => p.id)).toEqual(['u4']);
  });

  it('returns everyone eligible when nobody is a member yet', () => {
    expect(addablePeople(people, new Set()).map((p) => p.id)).toEqual(['u1', 'u4']);
  });
});
