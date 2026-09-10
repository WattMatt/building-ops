import { describe, it, expect, vi, beforeEach } from 'vitest';

// Records every chained call so the test can assert the filter was applied,
// and the table name so the test can assert the read hits `reports`.
const calls = vi.hoisted(() => ({
  eq: [] as [string, unknown][],
  from: [] as string[],
  limitResult: { data: [] as unknown[], error: null as unknown },
}));
vi.mock('@/integrations/supabase/fortress-db', () => {
  const builder: any = {
    select: () => builder,
    eq: (c: string, v: unknown) => { calls.eq.push([c, v]); return builder; },
    in: () => builder,
    order: () => builder,
    limit: () => Promise.resolve(calls.limitResult),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return { fdb: { from: (table: string) => { calls.from.push(table); return builder; } } };
});

import { latestApprovedReport } from './useBuildingKpis';

describe('latestApprovedReport', () => {
  beforeEach(() => {
    calls.eq.length = 0;
    calls.from.length = 0;
    calls.limitResult = { data: [], error: null };
  });

  it('only considers approved reports on the reports table', async () => {
    calls.limitResult = { data: [{ id: 'r1', status: 'approved' }], error: null };
    await latestApprovedReport('b1', 'ops_monthly');
    expect(calls.from).toContain('reports');
    expect(calls.eq).toContainEqual(['status', 'approved']);
  });

  it('returns the approved report row when one is found', async () => {
    calls.limitResult = { data: [{ id: 'r1', status: 'approved' }], error: null };
    const result = await latestApprovedReport('b1', 'ops_monthly');
    expect(result).toEqual({ id: 'r1', status: 'approved' });
  });

  it('returns null when no approved report is found', async () => {
    calls.limitResult = { data: [], error: null };
    const result = await latestApprovedReport('b1', 'ops_monthly');
    expect(result).toBeNull();
  });
});
