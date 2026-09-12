import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));

import { usePortfolioCoverage, needsTeam, coverageGaps, type CoverageRow } from './usePortfolioCoverage';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

const row = (over: Partial<CoverageRow>): CoverageRow => ({
  building_id: 'b', building_name: 'B', field_members: 1, role_rules: 1, has_user_rule: true,
  unassigned_open: 0, overdue_open: 0, due_yesterday: 0, completed_yesterday: 0, ...over,
});

const rows: CoverageRow[] = [
  row({ building_id: 'b1', building_name: 'Alpha Court' }),
  row({ building_id: 'b2', building_name: 'Beta Place', field_members: 0, has_user_rule: false, unassigned_open: 3 }),
  row({ building_id: 'b3', building_name: 'Gamma House', field_members: 2, has_user_rule: false, unassigned_open: 1 }),
];

describe('usePortfolioCoverage', () => {
  beforeEach(() => rpc.mockReset());

  it('calls portfolio_coverage and derives the gaps and the unassigned total', async () => {
    rpc.mockResolvedValueOnce({ data: rows, error: null });
    const { result } = renderHook(() => usePortfolioCoverage(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(3));
    expect(rpc).toHaveBeenCalledWith('portfolio_coverage');
    expect(result.current.gaps.map((r) => r.building_id)).toEqual(['b2', 'b3']);
    expect(result.current.unassignedOpen).toBe(4);
    expect(result.current.byBuilding.get('b2')?.field_members).toBe(0);
  });

  it('does not call the RPC when disabled', () => {
    const { result } = renderHook(() => usePortfolioCoverage(false), { wrapper });
    expect(result.current.isLoading).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces the RPC error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => usePortfolioCoverage(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.gaps).toEqual([]);
    expect(result.current.unassignedOpen).toBe(0);
  });
});

describe('needsTeam / coverageGaps', () => {
  it('flags a building with no field members OR no user rule', () => {
    expect(needsTeam(row({}))).toBe(false);
    expect(needsTeam(row({ field_members: 0 }))).toBe(true);
    expect(needsTeam(row({ has_user_rule: false }))).toBe(true);
  });

  it('coverageGaps keeps the RPC order', () => {
    expect(coverageGaps(rows).map((r) => r.building_name)).toEqual(['Beta Place', 'Gamma House']);
  });
});
