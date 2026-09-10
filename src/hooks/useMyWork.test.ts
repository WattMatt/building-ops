import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({
  tasksCalls: [] as { eq: [string, unknown][]; in: [string, unknown[]][] }[],
  issuesCalls: [] as { eq: [string, unknown][]; neq: [string, unknown][] }[],
  reportsCalls: [] as { eq: [string, unknown][] }[],
  tasks: [] as Record<string, unknown>[],
  issues: [] as Record<string, unknown>[],
  reports: [] as Record<string, unknown>[],
}));

vi.mock('@/integrations/supabase/client', () => {
  function makeChain(table: string) {
    const call: any = { eq: [], neq: [], in: [] };
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: unknown) => { call.eq.push([col, val]); return chain; },
      neq: (col: string, val: unknown) => { call.neq.push([col, val]); return chain; },
      in: (col: string, vals: unknown[]) => { call.in.push([col, vals]); return chain; },
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
  function makeChain() {
    const call: any = { eq: [] };
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: unknown) => { call.eq.push([col, val]); return chain; },
      order: () => { state.reportsCalls.push(call); return Promise.resolve({ data: state.reports, error: null }); },
    };
    return chain;
  }
  return { fdb: { from: () => makeChain() } };
});

vi.mock('@/hooks/useMySignoffs', () => ({
  useMySignoffs: () => ({ items: [], loading: false, reload: vi.fn() }),
}));

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ unread: 0 }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me' } }),
}));

import { useMyWork } from './useMyWork';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

beforeEach(() => {
  state.tasksCalls = [];
  state.issuesCalls = [];
  state.reportsCalls = [];
  state.tasks = [];
  state.issues = [];
  state.reports = [];
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
});
