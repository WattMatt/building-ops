import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { todayInOperatingTz } from '@/lib/myWork';

interface RecordedCall { table: string; method: string; args: unknown[] }
type Result = { data: unknown[] | null; error: { message: string } | null };

const state = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  result: (() => ({ data: [], error: null })) as (calls: RecordedCall[]) => Result,
}));

// Postgrest-like chain: every filter returns the chain, and awaiting the chain yields
// `state.result` for the filters chained so far. Mirrors the OverviewWidgets test stub.
vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    const own: RecordedCall[] = [];
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
      chain[m] = (...args: unknown[]) => {
        const call = { table, method: m, args };
        own.push(call);
        state.calls.push(call);
        return chain;
      };
    }
    chain.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(state.result(own)).then(resolve, reject);
    return chain;
  };
  return { supabase: { from } };
});

const exportCsv = vi.hoisted(() => vi.fn());
vi.mock('@/lib/exportCsv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/exportCsv')>()),
  exportCsv,
}));

import MonthCostsCard, { currentMonth, lastMonths, formatRand, monthLabel } from './MonthCostsCard';

const month = todayInOperatingTz().slice(0, 7);
const hasIn = (calls: RecordedCall[]) => calls.some((c) => c.method === 'in');

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MonthCostsCard buildingId="b1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.calls.length = 0;
  state.result = () => ({ data: [], error: null });
  exportCsv.mockClear();
});

describe('formatRand', () => {
  it('groups thousands with spaces and drops decimals unless cents exist', () => {
    expect(formatRand(12345)).toBe('R 12 345');
    expect(formatRand(1234567.5)).toBe('R 1 234 567,50');
    expect(formatRand(0)).toBe('R 0');
    expect(formatRand(null)).toBe('R 0');
    expect(formatRand(999.999)).toBe('R 1 000');
    expect(formatRand(-250)).toBe('-R 250');
  });
});

describe('month helpers', () => {
  it('derives the current SAST month from the operating-timezone date', () => {
    expect(currentMonth(new Date('2026-09-30T23:30:00Z'))).toBe('2026-10'); // 01:30 SAST on 1 Oct
    expect(currentMonth(new Date('2026-09-10T10:00:00Z'))).toBe('2026-09');
  });

  it('lists the last N months newest first, crossing the year boundary', () => {
    expect(lastMonths('2026-02', 6)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11', '2025-10', '2025-09']);
  });

  it('labels a month for people', () => {
    expect(monthLabel('2026-09')).toMatch(/Sep(t)? 2026/);
  });
});

describe('MonthCostsCard', () => {
  it('reads the current month from building_month_costs and shows the sums', async () => {
    state.result = (calls) =>
      hasIn(calls)
        ? { data: [], error: null }
        : { data: [{ building_id: 'b1', month, issues_actual: 12000, services_cost: 345, total: 12345 }], error: null };
    renderCard();

    expect(await screen.findByText('R 12 345 this month')).toBeInTheDocument();
    expect(screen.getByText('issues R 12 000 · services R 345')).toBeInTheDocument();

    const viewCalls = state.calls.filter((c) => c.table === 'building_month_costs');
    expect(viewCalls.length).toBeGreaterThan(0);
    expect(viewCalls.some((c) => c.method === 'eq' && c.args[0] === 'building_id' && c.args[1] === 'b1')).toBe(true);
    expect(viewCalls.some((c) => c.method === 'eq' && c.args[0] === 'month' && c.args[1] === month)).toBe(true);
    // Collapsed: the six-month history is not fetched yet.
    expect(hasIn(viewCalls)).toBe(false);
  });

  it('shows the zero state when there is no row for the month', async () => {
    renderCard();
    expect(await screen.findByText('No costs recorded this month')).toBeInTheDocument();
  });

  it('shows a plain error line when the view read fails', async () => {
    state.result = () => ({ data: null, error: { message: 'permission denied for view' } });
    renderCard();
    expect(await screen.findByText("Couldn't load costs")).toBeInTheDocument();
    expect(screen.queryByText('No costs recorded this month')).toBeNull();
  });

  it('expands to the last six months on tap and exports them as CSV', async () => {
    const [m0, m1] = lastMonths(month, 2);
    state.result = (calls) =>
      hasIn(calls)
        ? {
            data: [
              { building_id: 'b1', month: m0, issues_actual: 100, services_cost: 50, total: 150 },
              { building_id: 'b1', month: m1, issues_actual: 0, services_cost: 2000, total: 2000 },
            ],
            error: null,
          }
        : { data: [{ building_id: 'b1', month, issues_actual: 100, services_cost: 50, total: 150 }], error: null };
    renderCard();

    const toggle = await screen.findByRole('button', { name: /this month's costs/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Six rows: the two returned months plus four zero-filled ones.
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(7)); // header + 6
    expect(screen.getAllByText('R 2 000')).toHaveLength(2); // services + total for that month
    const inCall = state.calls.find((c) => c.table === 'building_month_costs' && c.method === 'in');
    expect(inCall?.args[0]).toBe('month');
    expect(inCall?.args[1]).toEqual(lastMonths(month, 6));

    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    expect(exportCsv).toHaveBeenCalledTimes(1);
    const [rows, columns, filename] = exportCsv.mock.calls[0];
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ month: m0, total: 150 });
    expect(rows[2]).toMatchObject({ issues_actual: 0, services_cost: 0, total: 0 });
    expect(columns.map((c: { header: string }) => c.header)).toEqual(['Month', 'Issues (R)', 'Services (R)', 'Total (R)']);
    // Through the shared ExportCsvButton now, so the filename carries the export date like every
    // other surface: `building-costs-2026-09_2026-09-11.csv`.
    expect(filename).toBe(`building-costs-${month}_${todayInOperatingTz()}.csv`);
  });
});
