import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** Every filter call the hook makes against one table, recorded for assertions. */
interface RecordedCall {
  table: string;
  select: string | null;
  update: Record<string, unknown> | null;
  eq: [string, unknown][];
  gte: [string, unknown][];
  lte: [string, unknown][];
  in: [string, unknown[]][];
  not: [string, string, unknown][];
  /** Raw `or=(...)` bodies, as handed to PostgREST. */
  or: string[];
}

type Row = Record<string, unknown>;
interface Response { data: Row[] | null; error: { message: string; code?: string } | null }

/**
 * The slice of PostgrestFilterBuilder these queries touch. Every method chains; awaiting the
 * chain (it is a thenable, like the real builder) records the call and resolves the response
 * seeded for that table — or the update response when `.update()` was in the chain.
 */
interface Chain {
  select: (cols?: string) => Chain;
  update: (values: Record<string, unknown>) => Chain;
  eq: (col: string, val: unknown) => Chain;
  gte: (col: string, val: unknown) => Chain;
  lte: (col: string, val: unknown) => Chain;
  in: (col: string, vals: unknown[]) => Chain;
  not: (col: string, op: string, val: unknown) => Chain;
  or: (filters: string) => Chain;
  order: () => Chain;
  then: <T>(onFulfilled: (r: Response) => T, onRejected?: (e: unknown) => T) => Promise<T>;
}

const state = vi.hoisted(() => {
  const st = {
    calls: [] as RecordedCall[],
    data: {} as Record<string, Row[]>,
    updateResponse: { data: [], error: null } as Response,
    isAdminOrManager: false,
    makeChain: ((): Chain => { throw new Error('unset'); }) as (table: string) => Chain,
  };
  st.makeChain = (table: string): Chain => {
    const call: RecordedCall = { table, select: null, update: null, eq: [], gte: [], lte: [], in: [], not: [], or: [] };
    const chain: Chain = {
      select: (cols) => { call.select = cols ?? '*'; return chain; },
      update: (values) => { call.update = values; return chain; },
      eq: (col, val) => { call.eq.push([col, val]); return chain; },
      gte: (col, val) => { call.gte.push([col, val]); return chain; },
      lte: (col, val) => { call.lte.push([col, val]); return chain; },
      in: (col, vals) => { call.in.push([col, vals]); return chain; },
      not: (col, op, val) => { call.not.push([col, op, val]); return chain; },
      or: (filters) => { call.or.push(filters); return chain; },
      order: () => chain,
      then: (onFulfilled, onRejected) => {
        st.calls.push(call);
        const response: Response = call.update ? st.updateResponse : { data: st.data[table] ?? [], error: null };
        return Promise.resolve(response).then(onFulfilled, onRejected);
      },
    };
    return chain;
  };
  return st;
});

// Both clients share one Postgres; the Fortress view is the same connection re-typed.
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => state.makeChain(table) } }));
vi.mock('@/integrations/supabase/fortress-db', () => ({ fdb: { from: (table: string) => state.makeChain(table) } }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me' }, isAdminOrManager: state.isAdminOrManager }),
}));

import { monthKeysBetween, ppmMonthsFilter, ppmRowsFilter, PPM_CALENDAR_COLUMNS, useCalendarEvents } from './useCalendarEvents';
import { todayInOperatingTz } from '@/lib/myWork';

const callsFor = (table: string) => state.calls.filter((c) => c.table === table && !c.update);

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

const FROM = '2026-09-01';
const TO = '2026-09-30';
const SOURCE_TABLES = ['task_instances', 'issues', 'building_documents', 'building_assets', 'ppm_services', 'form_signoff_requests', 'reports'];

beforeEach(() => {
  state.calls = [];
  state.data = {};
  state.updateResponse = { data: [], error: null };
  state.isAdminOrManager = false;
});

describe('monthKeysBetween / ppmMonthsFilter', () => {
  it('lists every month key the range touches, across a year boundary', () => {
    expect(monthKeysBetween('2026-09-01', '2026-09-30')).toEqual(['2026-09']);
    expect(monthKeysBetween('2026-08-25', '2026-10-07')).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(monthKeysBetween('2026-12-15', '2027-01-03')).toEqual(['2026-12', '2027-01']);
    expect(monthKeysBetween('2026-10-01', '2026-09-01')).toEqual([]);
  });

  it('builds one not-null jsonb path test per key, in PostgREST or-tree syntax', () => {
    expect(ppmMonthsFilter('2026-08-25', '2026-10-07'))
      .toBe('months->2026-08.not.is.null,months->2026-09.not.is.null,months->2026-10.not.is.null');
    expect(ppmMonthsFilter('2026-10-01', '2026-09-01')).toBe('');
    expect(ppmRowsFilter('2026-10-01', '2026-09-01')).toBe('overrides.neq.{}');
  });
});

describe('useCalendarEvents', () => {
  it('limits the PPM query server-side to rows with a cell in one of the months in range', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useCalendarEvents({ scope: { kind: 'portfolio' }, from: '2026-08-25', to: '2026-10-07' }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const ppm = callsFor('ppm_services')[0];
    expect(ppm.or).toHaveLength(1);
    for (const key of ['2026-08', '2026-09', '2026-10']) expect(ppm.or[0]).toContain(`months->${key}.not.is.null`);
    // Plan-backed rows are fetched only when a manager pinned a month (non-empty overrides);
    // their derived months are already on the calendar as tasks.
    expect(ppm.or[0]).toBe(`overrides.neq.{},${ppmMonthsFilter('2026-08-25', '2026-10-07')}`);
    expect(ppm.or[0]).toBe(ppmRowsFilter('2026-08-25', '2026-10-07'));
    // A narrow select, with the report's period embedded for ranking rows of the same plan line.
    expect(ppm.select).toBe(PPM_CALENDAR_COLUMNS);
    expect(ppm.select).toContain('reports(report_period)');
    // No other source uses an or-tree.
    for (const table of ['task_instances', 'issues', 'building_documents', 'building_assets', 'reports']) {
      expect(callsFor(table)[0].or, table).toEqual([]);
    }
  });

  it('still drops PPM cells outside the day range after the month filter (second guard)', async () => {
    state.data.buildings = [{ id: 'b1', name: 'Block A' }];
    state.data.ppm_services = [{
      id: 'p1', building_id: 'b1', service_name: 'Lift service', report_id: null,
      months: { '2026-09': { status: 'due', date: '2026-09-02' }, '2026-10': { status: 'due', date: '2026-10-09' } },
    }];
    const client = makeClient();
    // A week in September: the month filter fetches the row (it has a 2026-09 cell), but both
    // cells fall outside 7–13 Sep, so the day-level guard must drop them.
    const { result } = renderHook(() => useCalendarEvents({ scope: { kind: 'building', id: 'b1' }, from: '2026-09-07', to: '2026-09-13' }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(callsFor('ppm_services')[0].or[0]).toBe('overrides.neq.{},months->2026-09.not.is.null');
    expect(result.current.events.filter((e) => e.kind === 'ppm')).toEqual([]);

    const wide = makeClient();
    const w = renderHook(() => useCalendarEvents({ scope: { kind: 'building', id: 'b1' }, from: '2026-09-01', to: '2026-09-30' }), { wrapper: wrapperFor(wide) });
    await waitFor(() => expect(w.result.current.isLoading).toBe(false));
    expect(w.result.current.events.filter((e) => e.kind === 'ppm').map((e) => e.date)).toEqual(['2026-09-02']);
  });

  it('fans out to all seven sources and the buildings list, filtered to the building in scope', async () => {
    state.data.form_signoff_requests = [{ id: 's1', submission_id: 'sub1', due_at: '2026-09-10T08:00:00Z', status: 'pending', active: true, assigned_to: 'me' }];
    state.data.form_submissions = [{ id: 'sub1', form_name: 'Fire check', building_id: 'b1' }];
    const client = makeClient();
    const { result } = renderHook(() => useCalendarEvents({ scope: { kind: 'building', id: 'b1' }, from: FROM, to: TO }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    for (const table of SOURCE_TABLES) expect(callsFor(table).length, table).toBeGreaterThan(0);
    expect(callsFor('buildings')[0].eq).toContainEqual(['id', 'b1']);
    for (const table of ['task_instances', 'issues', 'building_documents', 'building_assets', 'ppm_services', 'reports']) {
      expect(callsFor(table)[0].eq, table).toContainEqual(['building_id', 'b1']);
    }
    // Sign-offs are mine only, scoped to the building through their submission.
    expect(callsFor('form_signoff_requests')[0].eq).toContainEqual(['assigned_to', 'me']);
    expect(callsFor('form_submissions')[0].eq).toContainEqual(['building_id', 'b1']);

    // Date-columned sources are range-limited server-side.
    expect(callsFor('task_instances')[0].gte).toContainEqual(['due_date', FROM]);
    expect(callsFor('task_instances')[0].lte).toContainEqual(['due_date', TO]);
    expect(callsFor('reports')[0].gte).toContainEqual(['report_period', FROM]);
  });

  it('sends no building filter for portfolio scope (RLS scopes the rows)', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useCalendarEvents({ scope: { kind: 'portfolio' }, from: FROM, to: TO }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    for (const table of ['task_instances', 'issues', 'ppm_services', 'reports']) {
      expect(callsFor(table)[0].eq.map(([c]) => c), table).not.toContain('building_id');
    }
    expect(callsFor('buildings')[0].eq).toEqual([]);
  });

  it('groups mapped events by date with building names from the one buildings select', async () => {
    const today = todayInOperatingTz();
    state.data.buildings = [{ id: 'b1', name: 'Block A' }];
    state.data.task_instances = [{ id: 't1', task_name: 'Check roof', due_date: '2026-09-10', status: 'pending', building_id: 'b1', assigned_to: 'me', template_item_id: null }];
    state.data.issues = [{ id: 'i1', title: 'Leak', deadline: '2026-09-10', status: 'open', building_id: 'b1', priority: 'high' }];
    state.data.building_documents = [{ id: 'd1', name: 'Fire cert', expiry_date: '2026-09-12', building_id: 'b1', document_type: 'certificate' }];
    state.data.building_assets = [{ id: 'a1', name: 'Lift', next_service_date: '2026-10-05', building_id: 'b1', category: 'lift' }];

    const client = makeClient();
    const { result } = renderHook(() => useCalendarEvents({ scope: { kind: 'building', id: 'b1' }, from: FROM, to: TO }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.byDate.get('2026-09-10')?.map((e) => e.kind).sort()).toEqual(['issue', 'task']);
    expect(result.current.byDate.get('2026-09-12')?.map((e) => e.kind)).toEqual(['document']);
    // Outside the range: the asset service in October does not appear.
    expect(result.current.events.some((e) => e.kind === 'asset')).toBe(false);
    expect(result.current.events.every((e) => e.buildingName === 'Block A')).toBe(true);
    expect(result.current.buildingNames.get('b1')).toBe('Block A');
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('opts a building scope into the offline read cache, but not a manager portfolio', async () => {
    state.isAdminOrManager = true;
    const building = makeClient();
    const b = renderHook(() => useCalendarEvents({ scope: { kind: 'building', id: 'b1' }, from: FROM, to: TO }), { wrapper: wrapperFor(building) });
    await waitFor(() => expect(b.result.current.isLoading).toBe(false));
    const bq = building.getQueryCache().find({ queryKey: ['calendar', 'building:b1', 'tasks', FROM, TO] });
    expect(bq?.meta?.persist).toBe(true);
    expect(bq?.options.networkMode).toBe('offlineFirst');

    const portfolio = makeClient();
    const p = renderHook(() => useCalendarEvents({ scope: { kind: 'portfolio' }, from: FROM, to: TO }), { wrapper: wrapperFor(portfolio) });
    await waitFor(() => expect(p.result.current.isLoading).toBe(false));
    const pq = portfolio.getQueryCache().find({ queryKey: ['calendar', 'portfolio', 'tasks', FROM, TO] });
    expect(pq).toBeDefined();
    expect(pq?.meta?.persist).toBeUndefined();
    expect(pq?.options.networkMode).not.toBe('offlineFirst');
  });

  it("persists a caretaker's own portfolio (it is only their buildings)", async () => {
    state.isAdminOrManager = false;
    const client = makeClient();
    const { result } = renderHook(() => useCalendarEvents({ scope: { kind: 'portfolio' }, from: FROM, to: TO }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const q = client.getQueryCache().find({ queryKey: ['calendar', 'portfolio', 'issues', FROM, TO] });
    expect(q?.meta?.persist).toBe(true);
  });

  describe('reschedule', () => {
    it('updates due_date, selects the id, and invalidates calendar, my-work and building-overview', async () => {
      state.updateResponse = { data: [{ id: 't1' }], error: null };
      const client = makeClient();
      const spy = vi.spyOn(client, 'invalidateQueries');
      const { result } = renderHook(() => useCalendarEvents({ scope: { kind: 'building', id: 'b1' }, from: FROM, to: TO }), { wrapper: wrapperFor(client) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await result.current.reschedule('t1', '2026-09-15');

      const update = state.calls.find((c) => c.update);
      expect(update?.table).toBe('task_instances');
      expect(update?.update).toEqual({ due_date: '2026-09-15' });
      expect(update?.eq).toContainEqual(['id', 't1']);
      expect(update?.select).toBe('id');
      const keys = spy.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey);
      expect(keys).toContainEqual(['calendar']);
      expect(keys).toContainEqual(['my-work']);
      expect(keys).toContainEqual(['building-overview']);
    });

    it('reports zero updated rows as a permission problem', async () => {
      state.updateResponse = { data: [], error: null };
      const client = makeClient();
      const { result } = renderHook(() => useCalendarEvents({ scope: { kind: 'building', id: 'b1' }, from: FROM, to: TO }), { wrapper: wrapperFor(client) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await expect(result.current.reschedule('t1', '2026-09-15')).rejects.toThrow('You do not have permission to move this task.');
    });

    it('reports a unique-index violation as an existing occurrence on that day', async () => {
      state.updateResponse = { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
      const client = makeClient();
      const { result } = renderHook(() => useCalendarEvents({ scope: { kind: 'building', id: 'b1' }, from: FROM, to: TO }), { wrapper: wrapperFor(client) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await expect(result.current.reschedule('t1', '2026-09-15')).rejects.toThrow('That task already has an occurrence on that day.');
    });

    it('passes any other database error message through', async () => {
      state.updateResponse = { data: null, error: { message: 'network down' } };
      const client = makeClient();
      const { result } = renderHook(() => useCalendarEvents({ scope: { kind: 'building', id: 'b1' }, from: FROM, to: TO }), { wrapper: wrapperFor(client) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await expect(result.current.reschedule('t1', '2026-09-15')).rejects.toThrow('network down');
    });
  });
});

describe('useCalendarEvents — plan-backed PPM rows: overrides only, tasks carry the rest', () => {
  const planRow = (id: string, plan: string, period: string | null, extra: Row = {}) => ({
    id, building_id: 'b1', service_name: 'Lift service', report_id: `rep-${id}`, plan_service_id: plan, overrides: {}, months: {},
    reports: period ? { report_period: period } : null, ...extra,
  });

  it('derived due/missed cells produce NO month event: each is already a task on its real due date, and the view is never read', async () => {
    state.data.buildings = [{ id: 'b1', name: 'Block A' }];
    state.data.ppm_services = [planRow('r1', 'p1', '2026-09-01')];
    // Even if the view had rows for this line, the calendar must not turn them into month events.
    state.data.ppm_monthly_status = [
      { ppm_service_id: 'p1', period_month: '2026-10', status: 'due', done_on: null },
      { ppm_service_id: 'p1', period_month: '2026-08', status: 'missed', done_on: null },
    ];
    // The occurrence itself is a task_instances row generated from the plan line.
    state.data.task_instances = [{ id: 't1', task_name: 'Lift service', due_date: '2026-10-05', status: 'pending', building_id: 'b1', source_ppm_id: 'p1' }];
    const client = makeClient();
    const { result } = renderHook(() => useCalendarEvents({ scope: { kind: 'building', id: 'b1' }, from: '2026-08-01', to: '2026-10-31' }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.events.filter((e) => e.kind === 'ppm')).toEqual([]);
    expect(result.current.events.filter((e) => e.kind === 'task').map((e) => [e.date, e.title])).toEqual([['2026-10-05', 'Lift service']]);
    expect(callsFor('ppm_monthly_status')).toHaveLength(0);
  });

  it('an override reading due/missed IS a month event (no task stands behind a pinned month); done/na overrides are not', async () => {
    state.data.buildings = [{ id: 'b1', name: 'Block A' }];
    state.data.ppm_services = [
      planRow('r2', 'p2', '2026-09-01', { service_name: 'Generator', overrides: { '2026-09': { status: 'missed', note: 'No contractor' } } }),
      planRow('r3', 'p3', '2026-09-01', { service_name: 'Fire equipment', overrides: { '2026-09': { status: 'na', note: 'Replaced' } } }),
      planRow('r4', 'p4', '2026-09-01', { service_name: 'Borehole', overrides: { '2026-09': { status: 'done', note: 'Ad hoc' } } }),
      planRow('r5', 'p5', '2026-09-01', { service_name: 'Gutters', overrides: { '2026-09': { status: 'due', note: 'Booked' } } }),
    ];
    const client = makeClient();
    const { result } = renderHook(() => useCalendarEvents({ scope: { kind: 'building', id: 'b1' }, from: FROM, to: TO }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const ppm = result.current.events.filter((e) => e.kind === 'ppm');
    expect(ppm.map((e) => [e.title, e.date, e.href]).sort()).toEqual([
      ['Generator', '2026-09-01', '/reports/fortress/rep-r2'],
      ['Gutters', '2026-09-01', '/reports/fortress/rep-r5'],
    ]);
    expect(ppm.find((e) => e.title === 'Generator')?.status).toBe('overdue');
  });

  it('a plan-backed row\'s legacy months produce no month events either (only its overrides can)', async () => {
    state.data.buildings = [{ id: 'b1', name: 'Block A' }];
    state.data.ppm_services = [planRow('r1', 'p1', '2026-09-01', { months: { '2026-09': { status: 'due', date: '2026-09-15' } } })];
    const client = makeClient();
    const { result } = renderHook(() => useCalendarEvents({ scope: { kind: 'building', id: 'b1' }, from: FROM, to: TO }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.events.filter((e) => e.kind === 'ppm')).toEqual([]);
  });

  it('one event per plan line when several reports carry a row for it: the row on the latest report PERIOD speaks, whatever was created last', async () => {
    state.data.buildings = [{ id: 'b1', name: 'Block A' }];
    const pinned = { '2026-09': { status: 'missed', note: 'No contractor' } };
    state.data.ppm_services = [
      // The August report's row was (re)created later — created_at must not decide.
      planRow('aug', 'p1', '2026-08-01', { overrides: pinned, created_at: '2026-09-20T00:00:00Z' }),
      planRow('sep', 'p1', '2026-09-01', { overrides: pinned, created_at: '2026-09-01T00:00:00Z' }),
      planRow('none', 'p1', null, { overrides: pinned, created_at: '2026-09-25T00:00:00Z' }),
    ];
    const client = makeClient();
    const { result } = renderHook(() => useCalendarEvents({ scope: { kind: 'building', id: 'b1' }, from: FROM, to: TO }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const ppm = result.current.events.filter((e) => e.kind === 'ppm');
    expect(ppm).toHaveLength(1);
    expect(ppm[0].href).toBe('/reports/fortress/rep-sep');
  });

  it('legacy rows still expand their own months and cost no view query', async () => {
    state.data.buildings = [{ id: 'b1', name: 'Block A' }];
    state.data.ppm_services = [{ id: 'l1', building_id: 'b1', service_name: 'Pest control', report_id: null, plan_service_id: null, overrides: {}, months: { '2026-09': { status: 'due', date: '2026-09-15' } }, reports: null }];
    const client = makeClient();
    const { result } = renderHook(() => useCalendarEvents({ scope: { kind: 'building', id: 'b1' }, from: FROM, to: TO }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.events.filter((e) => e.kind === 'ppm').map((e) => e.date)).toEqual(['2026-09-15']);
    expect(callsFor('ppm_monthly_status')).toHaveLength(0);
  });
});
