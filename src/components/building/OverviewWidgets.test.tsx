import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { todayInOperatingTz } from '@/lib/myWork';

// Postgrest-like chain: every filter returns the same chain, and the chain is thenable so the
// widgets can `await` it after any number of `.eq()/.in()/.lte()/.lt()/.neq()/.order()/.limit()`
// calls (mirrors PostgrestFilterBuilder). Each chain records its calls so tests can assert the
// filters, and `state.result` decides what a table's head-count query answers with.
type QueryResult = { data?: unknown[] | null; count?: number | null; error: { message: string } | null };

interface Chain {
  select: (...args: unknown[]) => Chain;
  eq: (...args: unknown[]) => Chain;
  neq: (...args: unknown[]) => Chain;
  in: (...args: unknown[]) => Chain;
  lt: (...args: unknown[]) => Chain;
  lte: (...args: unknown[]) => Chain;
  gte: (...args: unknown[]) => Chain;
  not: (...args: unknown[]) => Chain;
  order: (...args: unknown[]) => Chain;
  limit: (...args: unknown[]) => Chain;
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
}

interface RecordedCall { table: string; method: string; args: unknown[] }

const state = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  /** Answers a head-count query for `table`, given the filters that were chained before it ran. */
  result: (() => ({ count: 0, error: null })) as (
    table: string,
    calls: RecordedCall[],
  ) => QueryResult,
}));

vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string): Chain => {
    const chain = {} as Chain;
    const own: RecordedCall[] = [];
    const record = (method: string) => (...args: unknown[]) => {
      const call = { table, method, args };
      own.push(call);
      state.calls.push(call);
      return chain;
    };
    chain.select = record('select');
    chain.eq = record('eq');
    chain.neq = record('neq');
    chain.in = record('in');
    chain.lt = record('lt');
    chain.lte = record('lte');
    chain.gte = record('gte');
    chain.not = record('not');
    chain.order = record('order');
    chain.limit = record('limit');
    chain.then = (resolve, reject) => {
      const isHead = own.some((c) => c.method === 'select' && !!(c.args[1] as { head?: boolean } | undefined)?.head);
      // Head-count queries come from the compact widgets; the legacy alert widgets just need
      // an empty, non-erroring row set so they settle into their "all clear" states.
      const r: QueryResult = isHead ? state.result(table, own) : { data: [], error: null };
      return Promise.resolve(r).then(resolve, reject);
    };
    return chain;
  };
  return { supabase: { from } };
});

import OverviewWidgets from './OverviewWidgets';

const has = (calls: RecordedCall[], method: string, col: string) =>
  calls.some((c) => c.method === method && c.args[0] === col);

function renderWidgets(onTabChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;
  render(
    wrap(
      <MemoryRouter initialEntries={['/buildings/b1']}>
        <Routes>
          <Route path="/buildings/:id" element={<OverviewWidgets buildingId="b1" onTabChange={onTabChange} />} />
          <Route path="/issues" element={<div>IssuesPage</div>} />
        </Routes>
      </MemoryRouter>,
    ),
  );
  return { onTabChange };
}

beforeEach(() => {
  state.calls.length = 0;
  state.result = () => ({ count: 0, error: null });
});

describe("OverviewWidgets — Today's tasks", () => {
  it('shows the due and overdue counts and opens the checklists tab on tap', async () => {
    state.result = (table, calls) => {
      if (table !== 'task_instances') return { count: 0, error: null };
      // total = due_date <= today, overdue = due_date < today
      return { count: has(calls, 'lt', 'due_date') ? 1 : 3, error: null };
    };
    const { onTabChange } = renderWidgets();

    const card = await screen.findByRole('button', { name: /today's tasks/i });
    await waitFor(() => expect(card).toHaveTextContent('3 due · 1 overdue'));

    fireEvent.click(card);
    expect(onTabChange).toHaveBeenCalledWith('checklists');
  });

  it('is keyboard operable (Enter)', async () => {
    const { onTabChange } = renderWidgets();
    const card = await screen.findByRole('button', { name: /today's tasks/i });
    expect(card).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onTabChange).toHaveBeenCalledWith('checklists');
  });

  it('filters by building, open statuses and today in the operating timezone', async () => {
    renderWidgets();
    await screen.findByText('Nothing due today');

    const taskCalls = state.calls.filter((c) => c.table === 'task_instances');
    expect(taskCalls.some((c) => c.method === 'eq' && c.args[0] === 'building_id' && c.args[1] === 'b1')).toBe(true);
    expect(taskCalls.some((c) => c.method === 'in' && c.args[0] === 'status')).toBe(true);
    expect((taskCalls.find((c) => c.method === 'in' && c.args[0] === 'status')?.args[1] as string[]).sort()).toEqual(['overdue', 'pending']);
    expect(taskCalls.some((c) => c.method === 'lte' && c.args[0] === 'due_date' && c.args[1] === todayInOperatingTz())).toBe(true);
    expect(taskCalls.some((c) => c.method === 'lt' && c.args[0] === 'due_date' && c.args[1] === todayInOperatingTz())).toBe(true);
    // Exact head-only counts, never row fetches.
    expect(taskCalls.filter((c) => c.method === 'select').every((c) => (c.args[1] as { head?: boolean; count?: string }).head && (c.args[1] as { count?: string }).count === 'exact')).toBe(true);
  });

  it('shows the zero state when nothing is due', async () => {
    renderWidgets();
    expect(await screen.findByText('Nothing due today')).toBeInTheDocument();
  });

  it('shows a plain "Couldn\'t load" line when the count query fails', async () => {
    state.result = (table) =>
      table === 'task_instances' ? { count: null, error: { message: 'boom' } } : { count: 0, error: null };
    renderWidgets();
    const card = await screen.findByRole('button', { name: /today's tasks/i });
    await waitFor(() => expect(card).toHaveTextContent("Couldn't load"));
    expect(card).not.toHaveTextContent('Nothing due today');
  });
});

describe('OverviewWidgets — Open issues', () => {
  it('shows open and high-priority counts and navigates to /issues on tap', async () => {
    state.result = (table, calls) => {
      if (table !== 'issues') return { count: 0, error: null };
      return { count: has(calls, 'in', 'priority') ? 2 : 4, error: null };
    };
    renderWidgets();

    const card = await screen.findByRole('button', { name: /open issues/i });
    await waitFor(() => expect(card).toHaveTextContent('4 open · 2 high priority'));

    const issueCalls = state.calls.filter((c) => c.table === 'issues');
    expect(issueCalls.some((c) => c.method === 'neq' && c.args[0] === 'status' && c.args[1] === 'resolved')).toBe(true);
    expect((issueCalls.find((c) => c.method === 'in' && c.args[0] === 'priority')?.args[1] as string[]).sort()).toEqual(['critical', 'high']);

    fireEvent.click(card);
    expect(await screen.findByText('IssuesPage')).toBeInTheDocument();
  });

  it('omits the high-priority suffix when there are none, and shows the zero state', async () => {
    state.result = (table, calls) =>
      table === 'issues' ? { count: has(calls, 'in', 'priority') ? 0 : 2, error: null } : { count: 0, error: null };
    renderWidgets();
    const card = await screen.findByRole('button', { name: /open issues/i });
    await waitFor(() => expect(card).toHaveTextContent('2 open'));
    expect(card).not.toHaveTextContent('high priority');
  });

  it('shows "No open issues" at zero', async () => {
    renderWidgets();
    expect(await screen.findByText('No open issues')).toBeInTheDocument();
  });
});

describe('OverviewWidgets — order', () => {
  it("renders Today's tasks and Open issues before the alert widgets", async () => {
    renderWidgets();
    const tasks = await screen.findByRole('button', { name: /today's tasks/i });
    const issues = screen.getByRole('button', { name: /open issues/i });
    const docs = await screen.findByText('Document Expiry Alerts');
    // DOCUMENT_POSITION_FOLLOWING (4): `docs` comes after `tasks`/`issues` in the DOM.
    expect(tasks.compareDocumentPosition(issues) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(issues.compareDocumentPosition(docs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("mounts the month-cost card right after the two compact widgets and before the alerts", async () => {
    renderWidgets();
    const issues = await screen.findByRole('button', { name: /open issues/i });
    const costs = await screen.findByRole('button', { name: /this month's costs/i });
    const docs = await screen.findByText('Document Expiry Alerts');
    expect(issues.compareDocumentPosition(costs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(costs.compareDocumentPosition(docs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // It reads the view for this building's current month.
    await waitFor(() =>
      expect(state.calls.some((c) => c.table === 'building_month_costs' && c.method === 'eq' && c.args[0] === 'month')).toBe(true),
    );
  });
});
