import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Mirrors the real supabase-js chain used by fetchActivityFeed: `.select().gte().order().limit()`,
// with `.limit()` resolving the query. Each filter call is recorded so tests can assert the
// query shape, and the error test drives `.limit()` to reject instead.
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  error: null as { message: string } | null,
  calls: { gte: [] as unknown[], order: [] as unknown[], limit: [] as unknown[] },
  fromSpy: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  chain.select = () => chain;
  chain.gte = (...args: unknown[]) => {
    state.calls.gte.push(args);
    return chain;
  };
  chain.order = (...args: unknown[]) => {
    state.calls.order.push(args);
    return chain;
  };
  chain.limit = (...args: unknown[]) => {
    state.calls.limit.push(args);
    return state.error
      ? Promise.resolve({ data: null, error: state.error })
      : Promise.resolve({ data: state.rows, error: null });
  };
  return {
    supabase: {
      from: (...args: unknown[]) => {
        state.fromSpy(...args);
        return chain;
      },
    },
  };
});

import ActivityFeedCard from './ActivityFeedCard';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    createElement(MemoryRouter, null, children),
  );

beforeEach(() => {
  state.rows = [];
  state.error = null;
  state.calls = { gte: [], order: [], limit: [] };
  state.fromSpy.mockClear();
});

describe('ActivityFeedCard', () => {
  it('shows a loading skeleton, then rows grouped under "Today" with author, description and a working link', async () => {
    state.rows = [
      {
        id: 'a1',
        issue_id: 'i1',
        activity_type: 'comment',
        old_value: null,
        new_value: null,
        comment: 'Checked the valve.',
        author_name: 'Thabo Mokoena',
        created_at: new Date().toISOString(),
        issues: { title: 'Leaking pipe', building_id: 'b1', buildings: { name: 'Sandton Tower' } },
      },
    ];

    render(createElement(ActivityFeedCard), { wrapper });

    // Loading state: the short card description only appears before data resolves.
    expect(screen.getByText('Recent issue activity')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Today')).toBeInTheDocument());

    expect(screen.getByText('Thabo Mokoena')).toBeInTheDocument();
    expect(screen.getByText('commented: Checked the valve.')).toBeInTheDocument();

    const link = screen.getByText('Thabo Mokoena').closest('a');
    expect(link).toHaveAttribute('href', '/issues?open=i1');

    expect(state.calls.gte).toHaveLength(1);
    expect(state.calls.order).toHaveLength(1);
    expect(state.calls.limit).toHaveLength(1);
    expect(state.calls.limit[0]).toEqual([30]);
  });

  it('shows the empty state when there is no recent activity', async () => {
    render(createElement(ActivityFeedCard), { wrapper });

    await waitFor(() => expect(screen.getByText('Quiet week so far')).toBeInTheDocument());
  });

  it('shows an error state with a "Try again" that re-invokes the query', async () => {
    state.error = { message: 'boom' };

    render(createElement(ActivityFeedCard), { wrapper });

    await waitFor(() => expect(screen.getByText('Failed to load activity')).toBeInTheDocument());
    expect(state.fromSpy).toHaveBeenCalledTimes(1);

    screen.getByText('Try again').click();

    await waitFor(() => expect(state.fromSpy).toHaveBeenCalledTimes(2));
  });
});
