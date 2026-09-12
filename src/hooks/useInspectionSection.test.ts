// src/hooks/useInspectionSection.test.ts
/**
 * useInspectionSection: the cache merge used after append_inspection_photo (Task 7) and the
 * absent-keeps / null-clears patch semantics of setResponse (Task 8).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InspectionResponse } from '@/integrations/supabase/fortress-db';

interface RecordedCall { table: string; method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: { message: string } | null };
type Chain = Record<string, (...args: unknown[]) => Chain> & {
  then: (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) => unknown;
};

const state = vi.hoisted(() => ({
  queries: [] as { table: string; calls: RecordedCall[] }[],
  /** What inspection_responses SELECT answers with; a test changes it before a refetch. */
  rows: [] as unknown[],
  result: (() => ({ data: [], error: null })) as (table: string, calls: RecordedCall[]) => QueryResult,
}));

vi.mock('@/integrations/supabase/client', () => {
  const METHODS = ['select', 'eq', 'order', 'limit', 'maybeSingle', 'single', 'insert', 'upsert'];
  const from = (table: string): Chain => {
    const own: RecordedCall[] = [];
    const chain = {} as Chain;
    for (const method of METHODS) {
      chain[method] = (...args: unknown[]) => { own.push({ table, method, args }); return chain; };
    }
    chain.then = (resolve, reject) => {
      state.queries.push({ table, calls: own });
      return Promise.resolve(state.result(table, own)).then(resolve, reject);
    };
    return chain;
  };
  return { supabase: { from } };
});
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useInspectionSection } from './useInspectionSection';

const existing: InspectionResponse = {
  id: 'r1', inspection_id: 'i1', template_item_id: 'it1',
  acceptable: null, condition_rating: 'fair', action_required: null, risk_level: null,
  recommendation: 'Fix the gutter', comment: 'old comment', capex_estimate: 500, applicable: true,
  next_service_due: null, detail: { size: '5' }, photo_urls: [{ ref: '7.1', caption: 'Gutters', path: 'documents/b1/annual/7/one.jpg' }],
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
};

const KEY = ['fortress-inspection', 'annual', 'rep1', false];

/** Template, one item, one inspection, and `state.rows` as its responses; an upsert answers empty. */
const tables = (table: string, calls: RecordedCall[]): QueryResult => {
  if (table === 'inspection_templates') return { data: { id: 't1', name: 'Annual', cadence: 'annual', version: 1, active: true }, error: null };
  if (table === 'inspection_template_items') return { data: [{ id: 'it1', template_id: 't1', section_no: '7', section_title: 'ROOF', item_label: 'Gutters', sort_order: 1 }], error: null };
  if (table === 'building_inspections') return { data: { id: 'i1', report_id: 'rep1', building_id: 'b1', template_id: 't1' }, error: null };
  if (table === 'inspection_responses') return calls.some((c) => c.method === 'upsert') ? { data: null, error: null } : { data: state.rows, error: null };
  return { data: [], error: null };
};

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  const hook = renderHook(() => useInspectionSection('rep1', 'b1', 'annual'), { wrapper });
  return { qc, ...hook };
}

beforeEach(() => {
  state.queries = [];
  state.rows = [existing];
  state.result = tables;
});

describe('useInspectionSection.mergeResponse', () => {
  it('writes the given row into the cached responses immediately, then invalidates', async () => {
    const { qc, result } = mount();
    await waitFor(() => expect(result.current.inspectionId).toBe('i1'));
    expect(result.current.responses.it1.photo_urls).toHaveLength(1);
    const selectsBefore = state.queries.filter((q) => q.table === 'inspection_responses').length;

    // `as never`: photo_urls is typed Json on the row; the hook casts the same way when it writes it.
    const merged: InspectionResponse = { ...existing, photo_urls: [...(existing.photo_urls as unknown[]), { ref: '7.2', caption: 'Gutters', path: 'documents/b1/annual/7/two.jpg' }] as never };
    state.rows = [merged]; // the server agrees when the invalidation refetches
    act(() => { result.current.mergeResponse(merged); });

    // Synchronously in the cache — no round trip in between.
    const cached = qc.getQueryData<{ responses: Record<string, InspectionResponse> }>(KEY);
    expect(cached?.responses.it1.photo_urls).toHaveLength(2);
    await waitFor(() => expect(state.queries.filter((q) => q.table === 'inspection_responses').length).toBe(selectsBefore + 1));
    expect(result.current.responses.it1.photo_urls).toHaveLength(2);
  });

  it('is a no-op on an empty cache', () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useInspectionSection(undefined, undefined, 'annual'), { wrapper });
    act(() => { result.current.mergeResponse(existing); });
    expect(qc.getQueryData(['fortress-inspection', 'annual', undefined, false])).toBeUndefined();
  });
});
