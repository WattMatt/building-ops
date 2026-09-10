import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  const METHODS = ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit', 'range', 'maybeSingle', 'single'];
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
// The PDF module drags in pdfmake and storage at import time; none of that is under test here.
const pdf = vi.hoisted(() => ({ docs: [] as { content: unknown }[] }));
vi.mock('pdfmake/build/pdfmake', () => ({
  default: { vfs: {}, createPdf: vi.fn((doc: { content: unknown }) => { pdf.docs.push(doc); return { getBlob: async () => new Blob(['pdf']), download: async () => {} }; }) },
}));
vi.mock('@/lib/analytics', () => ({ reportError: vi.fn() }));
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: { vfs: {} } }));
vi.mock('@/integrations/supabase/storage', () => ({ resolveStorageUrl: vi.fn(async () => null) }));
vi.mock('@/integrations/supabase/insight-linker', () => ({ fetchReportElectricalCompliance: vi.fn(async () => []) }));

import { fetchPpmForPdf, generateReportPdf } from './fortressReportPdf';
import { reportError } from '@/lib/analytics';

const label = (mk: string) => new Date(`${mk}-01T00:00:00`).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' });
const has = (calls: RecordedCall[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));

const planRow = { id: 'r1', building_id: 'b1', report_id: 'rep1', service_name: 'Lift service', frequency: 'Monthly', sort_order: 1, plan_service_id: 'p1', overrides: {}, months: {} };
const legacyRow = { id: 'r2', building_id: 'b1', report_id: 'rep1', service_name: 'Pest control', frequency: null, sort_order: 2, plan_service_id: null, overrides: {}, months: { '2026-07': { status: 'done' }, '2026-08': { status: 'due' } } };

beforeEach(() => {
  state.queries = [];
  pdf.docs = [];
  vi.mocked(reportError).mockClear();
  state.result = () => ({ data: [], error: null });
});

describe('fetchPpmForPdf — the PDF grid reads the merged grid', () => {
  it('a plan-backed row with empty months prints the months its completed occurrences fell in', async () => {
    state.result = (table) => {
      if (table === 'ppm_services') return { data: [planRow, legacyRow], error: null };
      if (table === 'ppm_monthly_status') {
        return { data: [
          { ppm_service_id: 'p1', period_month: '2026-08', status: 'done', done_on: '2026-08-12' },
          { ppm_service_id: 'p1', period_month: '2026-09', status: 'due', done_on: null },
        ], error: null };
      }
      return { data: [], error: null };
    };
    const { ppm, ppmStatusNote } = await fetchPpmForPdf('rep1', '2026-09-01');
    expect(ppm).toEqual([
      { service: 'Lift service', frequency: 'Monthly', servicedMonths: [label('2026-08')] },
      { service: 'Pest control', frequency: null, servicedMonths: [label('2026-07')] },
    ]);
    expect(ppmStatusNote).toBeNull();
    const view = state.queries.find((q) => q.table === 'ppm_monthly_status')!;
    expect(has(view.calls, 'in', 'building_id', ['b1'])).toBe(true);
    expect(has(view.calls, 'in', 'period_month', ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06'])).toBe(true);
  });

  it('an override wins over execution in the printed months', async () => {
    state.result = (table) => {
      if (table === 'ppm_services') return { data: [{ ...planRow, overrides: { '2026-08': { status: 'na', note: 'decommissioned' }, '2026-10': { status: 'done', note: 'ad hoc' } } }], error: null };
      if (table === 'ppm_monthly_status') return { data: [{ ppm_service_id: 'p1', period_month: '2026-08', status: 'done', done_on: '2026-08-12' }], error: null };
      return { data: [], error: null };
    };
    const { ppm } = await fetchPpmForPdf('rep1', '2026-09-01');
    expect(ppm[0].servicedMonths).toEqual([label('2026-10')]);
  });

  it('keeps the "no status recorded" note when no layer filled any cell, and drops it once one did', async () => {
    state.result = (table) => (table === 'ppm_services' ? { data: [planRow, { ...legacyRow, months: {} }], error: null } : { data: [], error: null });
    const none = await fetchPpmForPdf('rep1', '2026-09-01');
    expect(none.ppm.every((p) => p.servicedMonths.length === 0)).toBe(true);
    expect(none.ppmStatusNote).toMatch(/no month can be reported/);

    state.queries = [];
    state.result = (table) => {
      if (table === 'ppm_services') return { data: [planRow], error: null };
      if (table === 'ppm_monthly_status') return { data: [{ ppm_service_id: 'p1', period_month: '2026-09', status: 'due', done_on: null }], error: null };
      return { data: [], error: null };
    };
    const some = await fetchPpmForPdf('rep1', '2026-09-01');
    expect(some.ppmStatusNote).toBeNull();
  });

  it('no rows → empty table, no note, no view query', async () => {
    const out = await fetchPpmForPdf('rep1', '2026-09-01');
    expect(out).toEqual({ ppm: [], ppmStatusNote: null });
    expect(state.queries.some((q) => q.table === 'ppm_monthly_status')).toBe(false);
  });

  it('fails the export loudly when the schedule cannot be read', async () => {
    state.result = (table) => (table === 'ppm_services' ? { data: null, error: { message: 'permission denied' } } : { data: [], error: null });
    await expect(fetchPpmForPdf('rep1', '2026-09-01')).rejects.toThrow('Could not load the PPM schedule for this report: permission denied');
  });
});

describe('generateReportPdf — the trend section is not allowed to fail the export', () => {
  const opsReport = { id: 'rep1', building_id: 'b1', report_type: 'ops_monthly', report_period: '2026-08-01', title: 'August OPS', status: 'approved', asset_manager: null, ops_manager: null, centre_manager: null, prepared_for: null };
  const withReport = (extra: (table: string, calls: RecordedCall[]) => QueryResult | null) => (table: string, calls: RecordedCall[]): QueryResult => {
    if (table === 'reports') return { data: opsReport, error: null };
    return extra(table, calls) ?? { data: [], error: null };
  };

  it('still builds the PDF, minus the Trend section, when the snapshot read errors — and reports the error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.result = withReport((table) => (table === 'building_metrics_daily' ? { data: null, error: { message: 'relation "building_metrics_daily" does not exist', code: '42P01' } } : null));

    const out = await generateReportPdf('rep1', { name: 'Org', primaryColor: '#2563eb' });
    expect(out.fileName).toBe('August_OPS.pdf');
    expect(out.reportStatus).toBe('approved');
    expect(pdf.docs).toHaveLength(1);
    expect(JSON.stringify(pdf.docs[0].content)).not.toContain('Trend (12 months)');
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportError).mock.calls[0][1]).toEqual({ where: 'generateReportPdf.trend', reportId: 'rep1' });
    expect((vi.mocked(reportError).mock.calls[0][0] as Error).message).toContain('Could not read the trend snapshots');
    warn.mockRestore();
  });

  it('reads the trend columns for the twelve months up to the report period and prints the section when rows exist', async () => {
    state.result = withReport((table) => (table === 'building_metrics_daily'
      ? { data: [{ building_id: 'b1', day: '2026-08-31', compliance_pct: '77', task_completion_30d_pct: 50, issues_open: 2, tasks_overdue: 1, docs_expiring_30: 0, issues_breached: 0, reconstructed: false, computed_at: '2026-08-31T03:00:00Z' }], error: null }
      : null));

    await generateReportPdf('rep1', { name: 'Org', primaryColor: '#2563eb' });
    const snapQ = state.queries.filter((q) => q.table === 'building_metrics_daily');
    expect(snapQ).toHaveLength(1);
    expect(has(snapQ[0].calls, 'eq', 'building_id', 'b1')).toBe(true);
    expect(has(snapQ[0].calls, 'gte', 'day', '2025-09-01')).toBe(true);
    expect(has(snapQ[0].calls, 'lte', 'day', '2026-08-31')).toBe(true);
    expect(has(snapQ[0].calls, 'range', 0, 999)).toBe(true);
    expect(snapQ[0].calls.find((c) => c.method === 'select')?.args[0]).not.toBe('*');
    expect(JSON.stringify(pdf.docs[0].content)).toContain('Trend (12 months)');
    expect(reportError).not.toHaveBeenCalled();
  });

  it('every other section still fails the export loudly', async () => {
    state.result = withReport((table) => (table === 'compliance_scores' ? { data: null, error: { message: 'permission denied' } } : null));
    await expect(generateReportPdf('rep1', { name: 'Org', primaryColor: '#2563eb' })).rejects.toThrow('Could not load the compliance score for this report: permission denied');
    expect(pdf.docs).toHaveLength(0);
  });
});
