import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Builds a Postgrest-like chain: every filter method returns the same chain object, and the
// chain is itself thenable (mirroring supabase-js's PostgrestFilterBuilder, which executes on
// await regardless of how many `.eq()`/`.order()`/`.limit()` calls preceded it). `head` is
// captured off the `.select(fields, { count, head })` call so the same chain can serve both
// the head-only count query and the row query for a table.
const state = vi.hoisted(() => {
  function fromFactory(getResult: (table: string, head: boolean) => Promise<{ data?: any[]; count?: number; error: null }>) {
    return (table: string) => ({
      select: (..._args: any[]) => {
        const head = !!(_args[1] && (_args[1] as any).head);
        const chain: any = {};
        const pass = () => chain;
        chain.select = pass;
        chain.eq = pass;
        chain.lt = pass;
        chain.order = pass;
        chain.limit = pass;
        chain.in = pass;
        chain.then = (resolve: any, reject?: any) => getResult(table, head).then(resolve, reject);
        return chain;
      },
    });
  }
  return {
    reports: [] as any[],
    reportsCount: 0,
    signoffRequests: [] as any[],
    signoffsCount: 0,
    formSubmissions: [] as any[],
    buildings: [] as any[],
    fromFactory,
  };
});

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
});

describe('WaitingOnYouWidget', () => {
  it('renders counts and one row from each list', async () => {
    state.reportsCount = 3;
    state.reports = [
      {
        id: 'r1',
        title: 'August Ops Report',
        building_id: 'b1',
        report_period: '2026-08-01',
        updated_at: '2026-09-09T10:00:00Z',
        buildings: { name: 'Sandton Central' },
      },
    ];
    state.signoffsCount = 2;
    state.signoffRequests = [{ id: 's1', submission_id: 'sub1', due_at: '2026-09-01T00:00:00Z' }];
    state.formSubmissions = [{ id: 'sub1', form_name: 'Fire Safety Checklist', building_id: 'b2' }];
    state.buildings = [{ id: 'b2', name: 'Rosebank Mall' }];

    render(createElement(WaitingOnYouWidget), { wrapper });

    await waitFor(() => expect(screen.getByText('3 to review')).toBeInTheDocument());
    expect(screen.getByText('2 overdue')).toBeInTheDocument();

    expect(screen.getByText('August Ops Report')).toBeInTheDocument();
    expect(screen.getByText(/SANDTON CENTRAL/)).toBeInTheDocument();
    expect(screen.getByText(/August 2026/)).toBeInTheDocument();

    expect(screen.getByText('Fire Safety Checklist')).toBeInTheDocument();
    expect(screen.getByText(/ROSEBANK MALL/)).toBeInTheDocument();
  });

  it('shows the empty state when nothing is waiting', async () => {
    render(createElement(WaitingOnYouWidget), { wrapper });

    await waitFor(() => expect(screen.getByText('Nothing waiting on you')).toBeInTheDocument());
  });

  it('shows an error with a retry that refetches both lists', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const errorFactory = (message: string) => (_table: string) => ({
      select: () => {
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
      },
    });

    const { fdb } = await import('@/integrations/supabase/fortress-db');
    const original = (fdb as any).from;
    (fdb as any).from = errorFactory('boom');

    const errWrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, children));

    render(createElement(WaitingOnYouWidget), { wrapper: errWrapper });

    await waitFor(() => expect(screen.getByText('Failed to load')).toBeInTheDocument());
    expect(screen.getByText('Try again')).toBeInTheDocument();

    (fdb as any).from = original;
  });
});
