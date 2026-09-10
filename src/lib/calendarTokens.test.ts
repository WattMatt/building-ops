import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** One `from('calendar_tokens')` call: which verb it used and every filter it applied. */
interface RecordedCall {
  verb: 'select' | 'insert' | 'update';
  payload?: Record<string, unknown>;
  eq: [string, unknown][];
  is: [string, unknown][];
  order?: [string, { ascending: boolean }];
  limit?: number;
}

const state = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  /** What the read path's maybeSingle resolves with. */
  row: null as { id: string; token: string } | null,
  /** What `.select('id')` after a write resolves with (zero rows = RLS filtered it). */
  writeRows: [{ id: 'new' }] as { id: string }[],
  writeError: null as { message: string } | null,
}));

vi.mock('@/integrations/supabase/client', () => {
  function makeChain() {
    const call: RecordedCall = { verb: 'select', eq: [], is: [] };
    let wrote = false;
    const chain = {
      select: () => {
        if (wrote) {
          state.calls.push(call);
          return Promise.resolve({ data: state.writeError ? null : state.writeRows, error: state.writeError });
        }
        return chain;
      },
      insert: (payload: Record<string, unknown>) => { call.verb = 'insert'; call.payload = payload; wrote = true; return chain; },
      update: (payload: Record<string, unknown>) => { call.verb = 'update'; call.payload = payload; wrote = true; return chain; },
      eq: (col: string, val: unknown) => { call.eq.push([col, val]); return chain; },
      is: (col: string, val: unknown) => { call.is.push([col, val]); return chain; },
      order: (col: string, opts: { ascending: boolean }) => { call.order = [col, opts]; return chain; },
      limit: (n: number) => { call.limit = n; return chain; },
      maybeSingle: () => { state.calls.push(call); return Promise.resolve({ data: state.row, error: null }); },
    };
    return chain;
  }
  return { supabase: { from: (table: string) => { if (table !== 'calendar_tokens') throw new Error(`unexpected table ${table}`); return makeChain(); } } };
});

const trackMock = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => trackMock(...a) }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me' } }),
}));

import { mintToken, feedUrl, webcalUrl, useCalendarToken, PERMISSION_MESSAGE } from './calendarTokens';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe('mintToken', () => {
  it('returns 43 base64url characters with no padding', () => {
    const t = mintToken();
    expect(t).toHaveLength(43);
    expect(t).toMatch(BASE64URL);
    expect(t).not.toContain('=');
  });

  it('is random', () => {
    const seen = new Set(Array.from({ length: 20 }, () => mintToken()));
    expect(seen.size).toBe(20);
  });

  it('never emits the standard-alphabet characters + or /', () => {
    // 200 draws of 32 bytes make a `+` or `/` overwhelmingly likely in plain base64.
    for (let i = 0; i < 200; i++) expect(mintToken()).toMatch(BASE64URL);
  });
});

describe('urls', () => {
  it('feedUrl points at the ics-feed function with the token in the query', () => {
    const url = feedUrl('abc');
    expect(url).toBe(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ics-feed?t=abc`);
    expect(url).toMatch(/^https?:\/\//);
  });

  it('webcalUrl swaps the scheme and leaves the rest alone', () => {
    expect(webcalUrl('https://x.supabase.co/functions/v1/ics-feed?t=abc')).toBe('webcal://x.supabase.co/functions/v1/ics-feed?t=abc');
    expect(webcalUrl('http://localhost:54321/functions/v1/ics-feed?t=abc')).toBe('webcal://localhost:54321/functions/v1/ics-feed?t=abc');
  });
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

/**
 * Runs a mutation inside `act` and returns what it rejected with (or undefined when it resolved).
 * `await expect(act(...)).rejects` cannot be used here: React's `act` returns a thenable whose
 * `then` returns undefined, so vitest's `.rejects` resolves at once and the assertion never runs.
 */
async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
  let rejection: unknown;
  await act(async () => {
    await run().catch((e: unknown) => { rejection = e; });
  });
  return rejection;
}

describe('useCalendarToken', () => {
  beforeEach(() => {
    state.calls.length = 0;
    state.row = null;
    state.writeRows = [{ id: 'new' }];
    state.writeError = null;
    trackMock.mockReset();
  });

  it('reads the caller\'s newest active row for the "me" scope', async () => {
    state.row = { id: 'r1', token: 'tok' };
    const { result } = renderHook(() => useCalendarToken(null), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.token).toBe('tok');
    expect(result.current.url).toBe(feedUrl('tok'));
    const read = state.calls[0];
    expect(read.verb).toBe('select');
    expect(read.eq).toEqual([['user_id', 'me']]);
    expect(read.is).toEqual([['revoked_at', null], ['building_id', null]]);
    expect(read.order).toEqual(['created_at', { ascending: false }]);
    expect(read.limit).toBe(1);
  });

  it('filters by building for a building scope and reports no token when none exists', async () => {
    const { result } = renderHook(() => useCalendarToken('b1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.token).toBeNull();
    expect(result.current.url).toBeNull();
    const read = state.calls[0];
    expect(read.eq).toEqual([['user_id', 'me'], ['building_id', 'b1']]);
    expect(read.is).toEqual([['revoked_at', null]]);
  });

  it('create inserts a minted token for the scope and tracks it', async () => {
    const { result } = renderHook(() => useCalendarToken('b1', 'Building · Alpha'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    state.calls.length = 0;

    await act(() => result.current.create());

    const insert = state.calls.find((c) => c.verb === 'insert');
    expect(insert).toBeDefined();
    expect(insert!.payload).toMatchObject({ user_id: 'me', building_id: 'b1', label: 'Building · Alpha' });
    expect(insert!.payload!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(trackMock).toHaveBeenCalledWith('calendar_feed', { action: 'create', scope: 'building' });
    // The write invalidated the scope, so the row was re-read.
    await waitFor(() => expect(state.calls.some((c) => c.verb === 'select')).toBe(true));
  });

  it('rotate inserts the new row first, then revokes the current one', async () => {
    state.row = { id: 'r1', token: 'old' };
    const { result } = renderHook(() => useCalendarToken(null), { wrapper });
    await waitFor(() => expect(result.current.token).toBe('old'));
    state.calls.length = 0;

    await act(() => result.current.rotate());

    const writes = state.calls.filter((c) => c.verb !== 'select');
    expect(writes.map((c) => c.verb)).toEqual(['insert', 'update']);
    expect(writes[0].payload).toMatchObject({ user_id: 'me', building_id: null, label: 'My calendar' });
    expect(writes[0].payload!.token).not.toBe('old');
    expect(writes[1].eq).toEqual([['id', 'r1']]);
    expect(typeof writes[1].payload!.revoked_at).toBe('string');
    expect(trackMock).toHaveBeenCalledWith('calendar_feed', { action: 'rotate', scope: 'me' });
  });

  it('rotate leaves the current row active when the insert fails', async () => {
    state.row = { id: 'r1', token: 'old' };
    const { result } = renderHook(() => useCalendarToken(null), { wrapper });
    await waitFor(() => expect(result.current.token).toBe('old'));
    state.calls.length = 0;
    state.writeError = { message: 'boom' };

    expect(await rejectionOf(() => result.current.rotate())).toMatchObject({ message: 'boom' });

    const writes = state.calls.filter((c) => c.verb !== 'select');
    expect(writes.map((c) => c.verb)).toEqual(['insert']);
    expect(trackMock).not.toHaveBeenCalled();
    expect(result.current.token).toBe('old');
  });

  it('rotate with no current row only inserts', async () => {
    const { result } = renderHook(() => useCalendarToken(null), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    state.calls.length = 0;

    await act(() => result.current.rotate());

    expect(state.calls.filter((c) => c.verb !== 'select').map((c) => c.verb)).toEqual(['insert']);
  });

  it('revoke stamps revoked_at on the current row only', async () => {
    state.row = { id: 'r1', token: 'old' };
    const { result } = renderHook(() => useCalendarToken(null), { wrapper });
    await waitFor(() => expect(result.current.token).toBe('old'));
    state.calls.length = 0;

    await act(() => result.current.revoke());

    const writes = state.calls.filter((c) => c.verb !== 'select');
    expect(writes).toHaveLength(1);
    expect(writes[0].verb).toBe('update');
    expect(writes[0].eq).toEqual([['id', 'r1']]);
    expect(trackMock).toHaveBeenCalledWith('calendar_feed', { action: 'revoke', scope: 'me' });
  });

  it('treats a write that RLS filtered to zero rows as a permission error', async () => {
    state.writeRows = [];
    const { result } = renderHook(() => useCalendarToken(null), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(await rejectionOf(() => result.current.create())).toMatchObject({ message: PERMISSION_MESSAGE });
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('surfaces a database error from a write', async () => {
    state.writeError = { message: 'boom' };
    const { result } = renderHook(() => useCalendarToken(null), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(await rejectionOf(() => result.current.create())).toMatchObject({ message: 'boom' });
    expect(state.calls.filter((c) => c.verb !== 'select').map((c) => c.verb)).toEqual(['insert']);
  });
});
