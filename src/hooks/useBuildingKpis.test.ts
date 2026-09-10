import { describe, it, expect, vi } from 'vitest';

// Records every chained call so the test can assert the filter was applied.
const calls = vi.hoisted(() => ({ eq: [] as [string, unknown][] }));
vi.mock('@/integrations/supabase/fortress-db', () => {
  const builder: any = {
    select: () => builder,
    eq: (c: string, v: unknown) => { calls.eq.push([c, v]); return builder; },
    in: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return { fdb: { from: () => builder } };
});

import { latestApprovedReport } from './useBuildingKpis';

describe('latestApprovedReport', () => {
  it('only considers approved reports', async () => {
    calls.eq.length = 0;
    await latestApprovedReport('b1', 'ops_monthly');
    expect(calls.eq).toContainEqual(['status', 'approved']);
  });
});
