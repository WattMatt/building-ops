import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** Every filter call the hook makes against one table, recorded for assertions. */
interface RecordedCall {
  eq: [string, unknown][];
  neq: [string, unknown][];
  in: [string, unknown[]][];
}

/** The slice of PostgrestFilterBuilder these queries touch: filters chain, `order` resolves. */
interface Chain {
  select: () => Chain;
  eq: (col: string, val: unknown) => Chain;
  neq: (col: string, val: unknown) => Chain;
  in: (col: string, vals: unknown[]) => Chain;
  order: () => Promise<{ data: Record<string, unknown>[]; error: null }>;
}

const state = vi.hoisted(() => ({
  tasksCalls: [] as RecordedCall[],
  issuesCalls: [] as RecordedCall[],
  reportsCalls: [] as RecordedCall[],
  tasks: [] as Record<string, unknown>[],
  issues: [] as Record<string, unknown>[],
  reports: [] as Record<string, unknown>[],
  /** Non-null makes the useMySignoffs mock report a failed load. */
  signoffError: null as string | null,
}));

vi.mock('@/integrations/supabase/client', () => {
  function makeChain(table: string): Chain {
    const call: RecordedCall = { eq: [], neq: [], in: [] };
    const chain: Chain = {
      select: () => chain,
      eq: (col, val) => { call.eq.push([col, val]); return chain; },
      neq: (col, val) => { call.neq.push([col, val]); return chain; },
      in: (col, vals) => { call.in.push([col, vals]); return chain; },
      order: () => {
        if (table === 'task_instances') { state.tasksCalls.push(call); return Promise.resolve({ data: state.tasks, error: null }); }
        if (table === 'issues') { state.issuesCalls.push(call); return Promise.resolve({ data: state.issues, error: null }); }
        return Promise.resolve({ data: [], error: null });
      },
    };
    return chain;
  }
  return { supabase: { from: (table: string) => makeChain(table) } };
});

vi.mock('@/integrations/supabase/fortress-db', () => {
  function makeChain(): Chain {
    const call: RecordedCall = { eq: [], neq: [], in: [] };
    const chain: Chain = {
      select: () => chain,
      eq: (col, val) => { call.eq.push([col, val]); return chain; },
      neq: (col, val) => { call.neq.push([col, val]); return chain; },
      in: (col, vals) => { call.in.push([col, vals]); return chain; },
      order: () => { state.reportsCalls.push(call); return Promise.resolve({ data: state.reports, error: null }); },
    };
    return chain;
  }
  return { fdb: { from: () => makeChain() } };
});

vi.mock('@/hooks/useMySignoffs', () => ({
  useMySignoffs: () => ({ items: [], loading: false, error: state.signoffError, reload: vi.fn() }),
}));

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ unread: 0 }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me' } }),
}));

import { useMyWork } from './useMyWork';
import { todayInOperatingTz } from '@/lib/myWork';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

beforeEach(() => {
  state.tasksCalls = [];
  state.issuesCalls = [];
  state.reportsCalls = [];
  state.tasks = [];
  state.issues = [];
  state.reports = [];
  state.signoffError = null;
});

describe('useMyWork', () => {
  it('filters tasks by assigned_to = me and status in pending,overdue', async () => {
    const { result } = renderHook(() => useMyWork(), { wrapper });
    await waitFor(() => expect(state.tasksCalls.length).toBeGreaterThan(0));
    const call = state.tasksCalls[0];
    expect(call.eq).toContainEqual(['assigned_to', 'me']);
    expect(call.in).toContainEqual(['status', ['pending', 'overdue']]);
    expect(result.current).toBeDefined();
  });

  it('filters issues by assigned_to = me and status != resolved', async () => {
    renderHook(() => useMyWork(), { wrapper });
    await waitFor(() => expect(state.issuesCalls.length).toBeGreaterThan(0));
    const call = state.issuesCalls[0];
    expect(call.eq).toContainEqual(['assigned_to', 'me']);
    expect(call.neq).toContainEqual(['status', 'resolved']);
  });

  it('filters returned reports by author_id = me and status = rejected', async () => {
    renderHook(() => useMyWork(), { wrapper });
    await waitFor(() => expect(state.reportsCalls.length).toBeGreaterThan(0));
    const call = state.reportsCalls[0];
    expect(call.eq).toContainEqual(['author_id', 'me']);
    expect(call.eq).toContainEqual(['status', 'rejected']);
  });

  it('returns buckets, issues, signoffs, returnedReports, unread and isEmpty true when everything is empty', async () => {
    const { result } = renderHook(() => useMyWork(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.buckets).toEqual({ overdue: [], today: [], upcoming: [] });
    expect(result.current.issues).toEqual([]);
    expect(result.current.signoffs).toEqual([]);
    expect(result.current.returnedReports).toEqual([]);
    expect(result.current.unread).toBe(0);
    expect(result.current.isEmpty).toBe(true);
  });

  it('maps building_name from the joined buildings row and strips the buildings key', async () => {
    const today = todayInOperatingTz();
    state.tasks = [{
      id: 't1', task_name: 'Check roof', task_description: null, due_date: today, building_id: 'b1',
      requires_photo: false, requires_signature: false, status: 'pending', buildings: { name: 'Block A' },
    }];
    state.issues = [{
      id: 'i1', title: 'Leak', priority: 'high', status: 'open', deadline: null, building_id: 'b2',
      created_at: '2026-01-01', reported_by: 'u1', assigned_to: 'me', description: 'desc',
      corrective_action: null, photo_urls: null, task_instance_id: null, buildings: { name: 'Block B' },
    }];

    const { result } = renderHook(() => useMyWork(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.buckets.today).toHaveLength(1);
    expect(result.current.buckets.today[0].building_name).toBe('Block A');
    expect(result.current.buckets.today[0]).not.toHaveProperty('buildings');

    expect(result.current.issues).toHaveLength(1);
    expect(result.current.issues[0].building_name).toBe('Block B');
    expect(result.current.issues[0]).not.toHaveProperty('buildings');

    expect(result.current.isEmpty).toBe(false);
  });

  // useMySignoffs is not a TanStack query, so its failure has to be folded in by hand.
  // The regression this guards: a denied sign-off read used to render as a cheerful
  // "you're all caught up" instead of an error.
  it('reports a sign-off load failure as an error, not as an empty day', async () => {
    state.signoffError = 'permission denied for table form_signoff_requests';

    const { result } = renderHook(() => useMyWork(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isError).toBe(true);
    expect(result.current.error?.message).toBe('permission denied for table form_signoff_requests');
    expect(result.current.isEmpty).toBe(false);
  });
});
