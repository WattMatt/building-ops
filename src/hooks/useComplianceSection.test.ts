import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Postgrest-like chain (same shape as useBuildingScore.test.ts): every builder method records
// itself and returns the chain; the chain is thenable so the hook can `await` it. Results are
// chosen per table, and for compliance_responses by whether the chain carried an upsert.
interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: { message: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & {
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
};

const state = vi.hoisted(() => ({
  queries: [] as { table: string; calls: RecordedCall[] }[],
  responses: [] as Record<string, unknown>[],
  upsertError: null as { message: string } | null,
  /** When true an upsert stays pending until the matching entry in `release` is called. */
  holdUpserts: false,
  release: [] as (() => void)[],
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/integrations/supabase/fortress-db', () => {
  const METHODS = ['select', 'eq', 'order', 'limit', 'maybeSingle', 'single', 'insert', 'upsert'];
  const result = (table: string, calls: RecordedCall[]): QueryResult | Promise<QueryResult> => {
    if (table === 'compliance_templates') return { data: { id: 'tpl1', name: 'OHS Act Report', active: true, version: 3 }, error: null };
    if (table === 'compliance_template_items') {
      return { data: [{ id: 'i1', template_id: 'tpl1', item_no: '1.1', prompt: 'Fire extinguishers serviced', section_no: '1', section_title: 'Fire', is_scored: true, is_critical: false, group_code: 'A', group_weight: 1, weight: 1, sort_order: 1 }], error: null };
    }
    if (table === 'compliance_assessments') return { data: { id: 'as1', report_id: 'rep1', building_id: 'b1', template_id: 'tpl1' }, error: null };
    if (table === 'compliance_responses') {
      if (calls.some((c) => c.method === 'upsert')) {
        const done: QueryResult = { data: null, error: state.upsertError };
        return state.holdUpserts ? new Promise<QueryResult>((res) => state.release.push(() => res(done))) : done;
      }
      return { data: state.responses, error: null };
    }
    return { data: [], error: null };
  };
  const from = (table: string): Chain => {
    const own: RecordedCall[] = [];
    const chain = {} as Chain;
    for (const method of METHODS) chain[method] = (...args: unknown[]) => { own.push({ table, method, args }); return chain; };
    chain.then = (resolve, reject) => {
      state.queries.push({ table, calls: own });
      return Promise.resolve(result(table, own)).then(resolve, reject);
    };
    return chain;
  };
  return { fdb: { from } };
});

import { useComplianceSection } from './useComplianceSection';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

/** Every upsert the hook sent to compliance_responses, in the order they were issued. */
const upserts = () =>
  state.queries
    .filter((x) => x.table === 'compliance_responses' && x.calls.some((c) => c.method === 'upsert'))
    .map((q) => { const call = q.calls.find((c) => c.method === 'upsert')!; return { payload: call.args[0] as Record<string, unknown>, opts: call.args[1] }; });

/** The payload + options of the one upsert the hook sent to compliance_responses. */
function upsertSent(): { payload: Record<string, unknown>; opts: unknown } {
  const all = upserts();
  expect(all, 'exactly one upsert to compliance_responses').toHaveLength(1);
  return all[0];
}

beforeEach(() => {
  state.queries = [];
  state.responses = [];
  state.upsertError = null;
  state.holdUpserts = false;
  state.release = [];
});

describe('useComplianceSection.setResponse', () => {
  it('writes a comment with no answer as a row whose response is null, leaving id to the column default', async () => {
    const { result } = renderHook(() => useComplianceSection('rep1', 'b1'), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => { await result.current.setResponse('i1', null, 'Extinguisher tag missing'); });

    const { payload, opts } = upsertSent();
    expect(payload).toEqual({ assessment_id: 'as1', template_item_id: 'i1', response: null, comment: 'Extinguisher tag missing' });
    expect(opts).toEqual({ onConflict: 'assessment_id,template_item_id' });
  });

  it('writes for the same item land in call order even while the first is still in flight', async () => {
    const { result } = renderHook(() => useComplianceSection('rep1', 'b1'), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    state.holdUpserts = true;

    // Blur (comment, no answer) then the toggle (answer) before the blur's round trip returns.
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = result.current.setResponse('i1', null, 'Tag missing');
      second = result.current.setResponse('i1', 'yes', 'Tag missing');
    });
    expect(upserts()).toHaveLength(1);
    expect(upserts()[0].payload.response).toBeNull();

    state.release.shift()!();
    await waitFor(() => expect(upserts()).toHaveLength(2));
    expect(upserts()[1].payload.response).toBe('yes');
    state.release.shift()!();
    await act(async () => { await Promise.all([first, second]); });
    expect(upserts().map((u) => u.payload.response)).toEqual([null, 'yes']);
  });

  it('keeps the saved comment when an answer arrives without one, and never counted the comment-only row as answered', async () => {
    state.responses = [{ id: 'resp1', assessment_id: 'as1', template_item_id: 'i1', response: null, comment: 'Tag missing', score: null }];
    const { result } = renderHook(() => useComplianceSection('rep1', 'b1'), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.answered).toBe(0);
    expect(result.current.responseMap.i1).toBeUndefined();

    await act(async () => { await result.current.setResponse('i1', 'yes'); });

    const { payload } = upsertSent();
    expect(payload).toMatchObject({ response: 'yes', comment: 'Tag missing' });
    expect(payload).not.toHaveProperty('id');
  });
});
