import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Builds a Postgrest-like chain: every filter method returns the same chain object, and the
// chain is itself thenable (mirroring supabase-js's PostgrestFilterBuilder, which executes on
// await regardless of how many `.eq()`/`.lt()`/`.in()`/`.order()`/`.limit()` calls preceded it).
// `head` is captured off the `.select(fields, { count, head })` call so the same chain can serve
// both the head-only count query and the row query for a table. Every chained call is also
// recorded in `state.calls` so tests can assert which filters were actually applied.
const state = vi.hoisted(() => {
  const calls: { table: string; method: string; args: any[] }[] = [];

  function fromFactory(getResult: (table: string, head: boolean) => Promise<{ data?: any[]; count?: number; error: null }>) {
    return (table: string) => {
      const chain: any = {};
      let head = false;
      const record = (method: string) => (...args: any[]) => {
        calls.push({ table, method, args });
        return chain;
      };
      chain.select = (...args: any[]) => {
        head = !!(args[1] && (args[1] as any).head);
        calls.push({ table, method: 'select', args });
        return chain;
      };
      chain.eq = record('eq');
      chain.lt = record('lt');
      chain.order = record('order');
      chain.limit = record('limit');
      chain.in = record('in');
      chain.then = (resolve: any, reject?: any) => getResult(table, head).then(resolve, reject);
      return chain;
    };
  }

  return {
    reports: [] as any[],
    reportsCount: 0,
    signoffRequests: [] as any[],
    signoffsCount: 0,
    formSubmissions: [] as any[],
    buildings: [] as any[],
    calls,
    fromFactory,
  };
});

// A chain factory whose queries always error, regardless of table — used to simulate one
// query source being broken while the other (built with the normal factory above) is fine.
function erroringFromFactory(message: string) {
  return (_table: string) => {
    const chain: any = {};
    const pass = () => chain;
    chain.select = pass;
    chain.eq = pass;
    chain.lt = pass;
    chain.order = pass;
    chain.limit = pass;
    chain.in = pass;
    chain.then = (resolve: any) => Promise.resolve({ data: null, count: null, error: { message } }).then(resolve);
    return chain;
  };
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: state.fromFactory(async (table, head) => {
      if (table === 'form_signoff_requests') {
        return head ? { count: state.signoffsCount, error: null } : { data: state.signoffRequests, error: null };
      }
      if (table === 'form_submissions') return { data: state.formSubmissions, error: null };
      if (table === 'buildings') return { data: state.buildings, error: null };
      return { data: [], error: null };
    }),
  },
}));

vi.mock('@/integrations/supabase/fortress-db', () => ({
  fdb: {
    from: state.fromFactory(async (table, head) => {
      if (table === 'reports') {
        return head ? { count: state.reportsCount, error: null } : { data: state.reports, error: null };
      }
      return { data: [], error: null };
    }),
  },
}));

import WaitingOnYouWidget from './WaitingOnYouWidget';
import { supabase } from '@/integrations/supabase/client';
import { fdb } from '@/integrations/supabase/fortress-db';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    createElement(MemoryRouter, null, children),
  );

beforeEach(() => {
  state.reports = [];
  state.reportsCount = 0;
  state.signoffRequests = [];
  state.signoffsCount = 0;
  state.formSubmissions = [];
  state.buildings = [];
  state.calls.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WaitingOnYouWidget', () => {
  it('renders counts and rows from each list, filtering reports by submitted+reviewed and sign-offs by due date', async () => {
    state.reportsCount = 2;
    state.reports = [
      {
        id: 'r1',
        title: 'August Ops Report',
        status: 'submitted',
        report_period: '2026-08-01',
        updated_at: '2026-09-09T10:00:00Z',
        buildings: { name: 'Sandton Central' },
      },
      {
        id: 'r2',
        title: 'July Ops Report',
        status: 'reviewed',
        report_period: '2026-07-01',
        updated_at: '2026-09-08T10:00:00Z',
        buildings: { name: 'Some Building' },
      },
    ];
    state.signoffsCount = 1;
    state.signoffRequests = [{ id: 's1', submission_id: 'sub1', due_at: '2026-09-01T00:00:00Z' }];
    state.formSubmissions = [{ id: 'sub1', form_name: 'Fire Safety Checklist', building_id: 'b2' }];
    state.buildings = [{ id: 'b2', name: 'Rosebank Mall' }];

    render(createElement(WaitingOnYouWidget), { wrapper });

    await waitFor(() => expect(screen.getByText('2 to approve')).toBeInTheDocument());
    expect(screen.getByText('1 overdue')).toBeInTheDocument();

    expect(screen.getByText('August Ops Report')).toBeInTheDocument();
    expect(screen.getByText(/SANDTON CENTRAL/)).toBeInTheDocument();
    expect(screen.getByText(/August 2026/)).toBeInTheDocument();
    expect(screen.getByText('submitted')).toBeInTheDocument();
    expect(screen.getByText('reviewed')).toBeInTheDocument();

    expect(screen.getByText('Fire Safety Checklist')).toBeInTheDocument();
    expect(screen.getByText(/ROSEBANK MALL/)).toBeInTheDocument();

    // Link hrefs.
    const reportLink = screen.getByText('August Ops Report').closest('a');
    expect(reportLink).toHaveAttribute('href', '/reports/fortress/r1');
    const signoffLink = screen.getByText('Fire Safety Checklist').closest('a');
    expect(signoffLink).toHaveAttribute('href', '/buildings/b2?tab=forms');

    // The reports query filtered by status in('submitted', 'reviewed'), applied to both the
    // count and row queries.
    const reportInCalls = state.calls.filter((c) => c.table === 'reports' && c.method === 'in');
    expect(reportInCalls.length).toBeGreaterThanOrEqual(2);
    reportInCalls.forEach((c) => expect(c.args).toEqual(['status', ['submitted', 'reviewed']]));

    // The sign-offs query filtered by due_at < now, applied to both the count and row queries.
    const signoffLtCalls = state.calls.filter((c) => c.table === 'form_signoff_requests' && c.method === 'lt');
    expect(signoffLtCalls.length).toBeGreaterThanOrEqual(2);
    signoffLtCalls.forEach((c) => {
      expect(c.args[0]).toBe('due_at');
      expect(typeof c.args[1]).toBe('string');
      expect(new Date(c.args[1] as string).toISOString()).toBe(c.args[1]);
    });
  });

  it('shows the empty state only when both queries succeed with zero rows', async () => {
    render(createElement(WaitingOnYouWidget), { wrapper });

    await waitFor(() => expect(screen.getByText('Nothing waiting on you')).toBeInTheDocument());
  });

  it('shows a "View all N" link per section when the count exceeds the rows shown', async () => {
    state.reportsCount = 7;
    state.reports = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`,
      title: `Report ${i}`,
      status: 'submitted',
      report_period: '2026-08-01',
      updated_at: '2026-09-09T10:00:00Z',
      buildings: { name: 'Sandton Central' },
    }));
    state.signoffsCount = 8;
    state.signoffRequests = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      submission_id: `sub${i}`,
      due_at: '2026-09-01T00:00:00Z',
    }));
    state.formSubmissions = state.signoffRequests.map((r) => ({
      id: r.submission_id,
      form_name: `Form ${r.id}`,
      building_id: null,
    }));

    render(createElement(WaitingOnYouWidget), { wrapper });

    const reportsViewAll = await screen.findByRole('link', { name: /View all 7 reports/ });
    expect(reportsViewAll).toHaveAttribute('href', '/reports/fortress');

    const signoffsViewAll = await screen.findByRole('link', { name: /View all 8 sign-offs/ });
    expect(signoffsViewAll).toHaveAttribute('href', '/forms');
  });

  it('shows an error with a retry, disabled while fetching, that refetches only the failed query', async () => {
    state.signoffsCount = 1;
    state.signoffRequests = [{ id: 's1', submission_id: 'sub1', due_at: '2026-09-01T00:00:00Z' }];
    state.formSubmissions = [{ id: 'sub1', form_name: 'Fire Safety Checklist', building_id: null }];

    const fdbFromSpy = vi.spyOn(fdb, 'from').mockImplementation(erroringFromFactory('boom') as any);
    const supabaseFromSpy = vi.spyOn(supabase, 'from');

    render(createElement(WaitingOnYouWidget), { wrapper });

    await waitFor(() => expect(screen.getByText('Could not load reports waiting on you.')).toBeInTheDocument());
    // The other section is unaffected by the reports failure.
    expect(screen.getByText('Fire Safety Checklist')).toBeInTheDocument();

    const tryAgain = screen.getByRole('button', { name: 'Try again' });
    const callsBefore = fdbFromSpy.mock.calls.length;
    const supabaseCallsBefore = supabaseFromSpy.mock.calls.length;

    fireEvent.click(tryAgain);

    await waitFor(() => expect(fdbFromSpy.mock.calls.length).toBeGreaterThan(callsBefore));
    // Only the reports source was re-invoked — sign-offs were not refetched.
    expect(supabaseFromSpy.mock.calls.length).toBe(supabaseCallsBefore);
  });

  it('still renders sign-off rows when reports errors but sign-offs succeed', async () => {
    state.signoffsCount = 1;
    state.signoffRequests = [{ id: 's1', submission_id: 'sub1', due_at: '2026-09-01T00:00:00Z' }];
    state.formSubmissions = [{ id: 'sub1', form_name: 'Fire Safety Checklist', building_id: 'b2' }];
    state.buildings = [{ id: 'b2', name: 'Rosebank Mall' }];

    vi.spyOn(fdb, 'from').mockImplementation(erroringFromFactory('boom') as any);

    render(createElement(WaitingOnYouWidget), { wrapper });

    await waitFor(() => expect(screen.getByText('Could not load reports waiting on you.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Fire Safety Checklist')).toBeInTheDocument();
    const signoffLink = screen.getByText('Fire Safety Checklist').closest('a');
    expect(signoffLink).toHaveAttribute('href', '/buildings/b2?tab=forms');
  });
});
