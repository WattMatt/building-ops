import { describe, it, expect, vi, beforeEach } from 'vitest';

// Postgrest-like chain (same shape as useBuildingPpm.test.ts): every builder method records
// itself and returns the chain; awaiting the chain resolves `state.result(table, calls)`.
interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: { message: string; code?: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & {
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
};

const state = vi.hoisted(() => ({
  queries: [] as { table: string; calls: RecordedCall[] }[],
  result: (() => ({ data: [], error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
}));

vi.mock('@/integrations/supabase/client', () => {
  const METHODS = ['select', 'eq', 'in', 'order'];
  const from = (table: string): Chain => {
    const own: RecordedCall[] = [];
    const chain = {} as Chain;
    for (const method of METHODS) {
      chain[method] = (...args: unknown[]) => { own.push({ table, method, args }); return chain; };
    }
    chain.then = (resolve, reject) => {
      state.queries.push({ table, calls: own });
      return Promise.resolve(state.result(table, own)).then(resolve, reject);
    };
    return chain;
  };
  return { supabase: { from } };
});

import { fetchDerivedPpm, fetchDerivedPpmForBuildings, fetchMergedPpmGrids } from './ppmGridFetch';

const has = (calls: RecordedCall[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));
const views = () => state.queries.filter((x) => x.table === 'ppm_monthly_status');

const months = ['2026-07', '2026-08', '2026-09'];

beforeEach(() => {
  state.queries = [];
  state.result = () => ({ data: [], error: null });
});

describe('fetchDerivedPpm', () => {
  it('reads the view for one building, filtered to the window months, with the five columns', async () => {
    state.result = () => ({ data: [{ ppm_service_id: 'p1', service_name: 'Lift', period_month: '2026-09', status: 'due', done_on: null }], error: null });
    const rows = await fetchDerivedPpm('b1', months);
    const q = views()[0];
    expect(has(q.calls, 'select', 'ppm_service_id, service_name, period_month, status, done_on')).toBe(true);
    expect(has(q.calls, 'eq', 'building_id', 'b1')).toBe(true);
    expect(has(q.calls, 'in', 'period_month', months)).toBe(true);
    expect(rows).toEqual([{ ppm_service_id: 'p1', service_name: 'Lift', period_month: '2026-09', status: 'due', done_on: null }]);
  });

  it('skips the query for an empty window', async () => {
    expect(await fetchDerivedPpm('b1', [])).toEqual([]);
    expect(views()).toHaveLength(0);
  });

  it('drops view rows without a plan line or a month (nullable in the generated view type)', async () => {
    state.result = () => ({
      data: [
        { ppm_service_id: null, service_name: null, period_month: '2026-09', status: 'due', done_on: null },
        { ppm_service_id: 'p1', service_name: 'Lift', period_month: null, status: 'due', done_on: null },
        { ppm_service_id: 'p1', service_name: 'Lift', period_month: '2026-08', status: 'done', done_on: '2026-08-12' },
      ],
      error: null,
    });
    const rows = await fetchDerivedPpm('b1', months);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ppm_service_id: 'p1', period_month: '2026-08', done_on: '2026-08-12' });
  });

  it('surfaces a view error', async () => {
    state.result = () => ({ data: null, error: { message: 'boom' } });
    await expect(fetchDerivedPpm('b1', months)).rejects.toMatchObject({ message: 'boom' });
  });
});

describe('fetchDerivedPpmForBuildings', () => {
  it('filters with in(building_id) and costs nothing for no buildings', async () => {
    await fetchDerivedPpmForBuildings(['b1', 'b2'], months);
    expect(has(views()[0].calls, 'in', 'building_id', ['b1', 'b2'])).toBe(true);
    state.queries = [];
    expect(await fetchDerivedPpmForBuildings([], months)).toEqual([]);
    expect(views()).toHaveLength(0);
  });
});

describe('fetchMergedPpmGrids (shared by K11, the PDF and the calendar)', () => {
  it("reads the view once for the plan-backed rows' buildings and merges every row", async () => {
    state.result = () => ({ data: [{ ppm_service_id: 'p1', period_month: '2026-08', status: 'done', done_on: '2026-08-12' }], error: null });
    const grids = await fetchMergedPpmGrids([
      { id: 'r1', building_id: 'b1', plan_service_id: 'p1', overrides: {}, months: {} },
      { id: 'r2', building_id: 'b2', plan_service_id: 'p9', overrides: {}, months: {} },
      { id: 'r3', building_id: 'b1', plan_service_id: null, months: { '2026-07': { status: 'done' } } },
    ], months);
    expect(views()).toHaveLength(1);
    expect(has(views()[0].calls, 'in', 'building_id', ['b1', 'b2'])).toBe(true);
    expect(has(views()[0].calls, 'in', 'period_month', months)).toBe(true);
    expect(grids.get('r1')!['2026-08']).toMatchObject({ status: 'done', source: 'derived' });
    expect(grids.get('r2')!['2026-08']).toMatchObject({ status: null, source: 'none' });
    expect(grids.get('r3')!['2026-07']).toMatchObject({ status: 'done', source: 'legacy' });
  });

  it('costs no view query when no row is plan-backed', async () => {
    const grids = await fetchMergedPpmGrids([{ id: 'r3', building_id: 'b1', plan_service_id: null, months: {} }], months);
    expect(views()).toHaveLength(0);
    expect(Object.keys(grids.get('r3')!)).toEqual(months);
  });

  it('surfaces a view error instead of an empty grid', async () => {
    state.result = () => ({ data: null, error: { message: 'boom' } });
    await expect(fetchMergedPpmGrids([{ id: 'r1', building_id: 'b1', plan_service_id: 'p1', months: {} }], months)).rejects.toMatchObject({ message: 'boom' });
  });
});
