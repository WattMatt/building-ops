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
    const call: RecordedCall = { table, select: null, update: null, eq: [], gte: [], lte: [], in: [], not: [] };
    const chain: Chain = {
      select: (cols) => { call.select = cols ?? '*'; return chain; },
      update: (values) => { call.update = values; return chain; },
      eq: (col, val) => { call.eq.push([col, val]); return chain; },
      gte: (col, val) => { call.gte.push([col, val]); return chain; },
      lte: (col, val) => { call.lte.push([col, val]); return chain; },
      in: (col, vals) => { call.in.push([col, vals]); return chain; },
      not: (col, op, val) => { call.not.push([col, op, val]); return chain; },
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

import { useCalendarEvents } from './useCalendarEvents';
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

describe('useCalendarEvents', () => {
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
