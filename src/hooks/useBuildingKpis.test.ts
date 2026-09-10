import { describe, it, expect, vi, beforeEach } from 'vitest';

// Records every chained call so the test can assert the filter was applied,
// and the table name so the test can assert the read hits `reports`. Each `from()` is its
// own thenable chain, so `state.result(table, calls)` can answer per table.
interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: unknown };
const calls = vi.hoisted(() => ({
  eq: [] as [string, unknown][],
  from: [] as string[],
  limitResult: { data: [] as unknown[], error: null as unknown },
  queries: [] as { table: string; calls: RecordedCall[] }[],
  result: (() => ({ data: [], error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
}));
vi.mock('@/integrations/supabase/fortress-db', () => {
  const from = (table: string) => {
    calls.from.push(table);
    const own: RecordedCall[] = [];
    const record = (method: string, args: unknown[]) => { own.push({ table, method, args }); return builder; };
    const builder: Record<string, (...a: never[]) => unknown> = {
      select: (...a: unknown[]) => record('select', a),
      eq: (c: string, v: unknown) => { calls.eq.push([c, v]); return record('eq', [c, v]); },
      in: (...a: unknown[]) => record('in', a),
      order: (...a: unknown[]) => record('order', a),
      limit: () => Promise.resolve(calls.limitResult),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => {
        calls.queries.push({ table, calls: own });
        return Promise.resolve(calls.result(table, own)).then(resolve, reject);
      },
    };
    return builder;
  };
  return { fdb: { from } };
});
// fetchMergedPpmGrids lives in useBuildingPpm, which talks to the same client through fdb.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { latestApprovedReport, ppmServicedKpi } from './useBuildingKpis';
import { fiscalWindow } from '@/lib/ppmGrid';

const has = (rc: RecordedCall[], method: string, ...args: unknown[]) =>
  rc.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));

describe('ppmServicedKpi (K11 over the merged grid)', () => {
  const ops = { id: 'ops1', report_period: '2026-09-01' };
  const planRow = (id: string, plan: string) => ({ id, building_id: 'b1', report_id: 'ops1', plan_service_id: plan, overrides: {}, months: {} });

  beforeEach(() => {
    calls.queries.length = 0;
    calls.result = () => ({ data: [], error: null });
  });

  it('a plan-backed row with empty months but a derived done cell counts as serviced', async () => {
    calls.result = (table) => {
      if (table === 'ppm_services') return { data: [planRow('r1', 'p1'), planRow('r2', 'p2')], error: null };
      if (table === 'ppm_monthly_status') return { data: [{ ppm_service_id: 'p1', period_month: '2026-08', status: 'done', done_on: '2026-08-12' }], error: null };
      return { data: [], error: null };
    };
    expect(await ppmServicedKpi(ops)).toEqual({ value: 50, sub: '1/2' });
    const view = calls.queries.find((q) => q.table === 'ppm_monthly_status')!;
    expect(has(view.calls, 'in', 'building_id', ['b1'])).toBe(true);
    expect(has(view.calls, 'in', 'period_month', fiscalWindow('2026-09-01'))).toBe(true);
    expect(has(calls.queries.find((q) => q.table === 'ppm_services')!.calls, 'eq', 'report_id', 'ops1')).toBe(true);
  });

  it('an override done counts, an override hiding a done does not, a legacy done still counts', async () => {
    calls.result = (table) => {
      if (table === 'ppm_services') {
        return { data: [
          { ...planRow('r1', 'p1'), overrides: { '2026-10': { status: 'done', note: 'ad hoc' } } },
          { ...planRow('r2', 'p2'), overrides: { '2026-08': { status: 'na', note: 'decommissioned' } } },
          { id: 'r3', building_id: 'b1', report_id: 'ops1', plan_service_id: null, overrides: {}, months: { '2026-07': { status: 'done' } } },
        ], error: null };
      }
      if (table === 'ppm_monthly_status') return { data: [{ ppm_service_id: 'p2', period_month: '2026-08', status: 'done', done_on: '2026-08-12' }], error: null };
      return { data: [], error: null };
    };
    expect(await ppmServicedKpi(ops)).toEqual({ value: 67, sub: '2/3' });
  });

  it('rows with nothing in any layer are "Not captured", not 0%', async () => {
    calls.result = (table) => (table === 'ppm_services' ? { data: [planRow('r1', 'p1')], error: null } : { data: [], error: null });
    expect(await ppmServicedKpi(ops)).toEqual({ value: null, sub: 'Not captured' });
  });

  it('no rows → null with no sub-label and no view query', async () => {
    expect(await ppmServicedKpi(ops)).toEqual({ value: null, sub: undefined });
    expect(calls.queries.some((q) => q.table === 'ppm_monthly_status')).toBe(false);
  });
});

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
