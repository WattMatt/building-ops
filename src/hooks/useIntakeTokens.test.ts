import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** One `supabase.from(table)` chain: every builder call in order, for assertions. */
interface RecordedCall { table: string; ops: [string, unknown[]][] }
type Result = { data: unknown; error: { message: string; code?: string } | null };

const state = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  /** Resolves each chain; sees the recorded call so a test can answer per operation. */
  result: (() => ({ data: [], error: null })) as (call: RecordedCall) => Result,
}));

vi.mock('@/integrations/supabase/client', () => {
  function makeChain(table: string) {
    const call: RecordedCall = { table, ops: [] };
    state.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'maybeSingle', 'insert', 'update']) {
      chain[m] = (...args: unknown[]) => { call.ops.push([m, args]); return chain; };
    }
    chain.then = (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(state.result(call)).then(resolve, reject);
    return chain;
  }
  return { supabase: { from: (table: string) => makeChain(table) } };
});
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

import { INTAKE_PERMISSION_MESSAGE, readActiveToken, useIntakeTokens } from './useIntakeTokens';

const row = {
  id: 'tok1',
  building_id: 'b1',
  token: 'a'.repeat(43),
  label: 'Tenant intake',
  is_active: true,
  created_by: 'u1',
  created_at: '2026-09-01T08:00:00.000Z',
  last_used_at: null,
  submissions_count: 3,
};

const has = (call: RecordedCall, method: string) => call.ops.find(([m]) => m === method);
const inserts = () => state.calls.filter((c) => has(c, 'insert'));
const updates = () => state.calls.filter((c) => has(c, 'update'));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('readActiveToken', () => {
  beforeEach(() => { state.calls.length = 0; state.result = () => ({ data: null, error: null }); });

  it('asks for the building\'s newest active row only', async () => {
    state.result = () => ({ data: row, error: null });
    await expect(readActiveToken('b1')).resolves.toEqual(row);
    const [call] = state.calls;
    expect(call.table).toBe('intake_tokens');
    expect(call.ops.filter(([m]) => m === 'eq')).toEqual([
      ['eq', ['building_id', 'b1']],
      ['eq', ['is_active', true]],
    ]);
    expect(has(call, 'order')).toEqual(['order', ['created_at', { ascending: false }]]);
    expect(has(call, 'limit')).toEqual(['limit', [1]]);
    expect(has(call, 'maybeSingle')).toBeTruthy();
    expect(String((has(call, 'select') as [string, unknown[]])[1][0])).toContain('submissions_count');
  });

  it('answers null when the building has no live link', async () => {
    await expect(readActiveToken('b1')).resolves.toBeNull();
  });
});

describe('useIntakeTokens', () => {
  beforeEach(() => { state.calls.length = 0; state.result = () => ({ data: null, error: null }); });

  it('creates a 43-character token owned by the signed-in user and reads the row back', async () => {
    state.result = (call) => (has(call, 'insert') ? { data: [row], error: null } : { data: null, error: null });
    const { result } = renderHook(() => useIntakeTokens('b1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.create(); });

    const [insert] = inserts();
    const payload = (has(insert, 'insert') as [string, unknown[]])[1][0] as Record<string, unknown>;
    expect(payload.building_id).toBe('b1');
    expect(payload.label).toBe('Tenant intake');
    expect(payload.created_by).toBe('u1');
    expect(String(payload.token)).toHaveLength(43);
    expect(String(payload.token)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(has(insert, 'select')).toBeTruthy();
  });

  it('rotating mints the new link before it disables the old one', async () => {
    const order: string[] = [];
    state.result = (call) => {
      if (has(call, 'insert')) { order.push('insert'); return { data: [{ ...row, id: 'tok2' }], error: null }; }
      if (has(call, 'update')) { order.push('update'); return { data: [{ id: 'tok1' }], error: null }; }
      return { data: row, error: null };
    };
    const { result } = renderHook(() => useIntakeTokens('b1'), { wrapper });
    await waitFor(() => expect(result.current.token?.id).toBe('tok1'));

    await act(async () => { await result.current.rotate(); });

    expect(order).toEqual(['insert', 'update']);
    const [update] = updates();
    expect(has(update, 'update')).toEqual(['update', [{ is_active: false }]]);
    expect(has(update, 'eq')).toEqual(['eq', ['id', 'tok1']]);
  });

  it('reports a write RLS filtered to nothing as a permission problem', async () => {
    state.result = (call) => (has(call, 'insert') ? { data: [], error: null } : { data: null, error: null });
    const { result } = renderHook(() => useIntakeTokens('b1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.create()).rejects.toThrow(INTAKE_PERMISSION_MESSAGE);
  });

  it('disabling with no live link writes nothing', async () => {
    const { result } = renderHook(() => useIntakeTokens('b1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.disable(); });

    expect(updates()).toHaveLength(0);
  });

  it('exposes the public URL for the active token', async () => {
    state.result = () => ({ data: row, error: null });
    const { result } = renderHook(() => useIntakeTokens('b1'), { wrapper });
    await waitFor(() => expect(result.current.token).not.toBeNull());
    expect(result.current.url).toBe(`${window.location.origin}/intake/${row.token}`);
  });
});
