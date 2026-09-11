import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** One `supabase.from(table)` chain: every builder call in order, for assertions. */
interface RecordedCall {
  table: string;
  ops: [string, unknown[]][];
}

type Result = { data: unknown; error: { message: string; code?: string } | null };

const state = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  results: {} as Record<string, Result | ((call: RecordedCall) => Result)>,
}));

vi.mock('@/integrations/supabase/client', () => {
  function makeChain(table: string) {
    const call: RecordedCall = { table, ops: [] };
    state.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'insert', 'update', 'delete']) {
      chain[m] = (...args: unknown[]) => { call.ops.push([m, args]); return chain; };
    }
    chain.then = (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) => {
      const r = state.results[table];
      const value = typeof r === 'function' ? r(call) : r ?? { data: [], error: null };
      return Promise.resolve(value).then(resolve, reject);
    };
    return chain;
  }
  return { supabase: { from: (table: string) => makeChain(table) } };
});

import {
  FORM_TEMPLATE_PERMISSION_MESSAGE,
  fetchFormTemplates,
  formCategoryClass,
  mapTemplate,
  parseFields,
  useFormTemplateMutations,
  useFormTemplates,
} from './useFormTemplates';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }) },
    children,
  );

const ops = (call: RecordedCall, name: string) => call.ops.filter(([m]) => m === name).map(([, args]) => args);
const callsFor = (table: string) => state.calls.filter((c) => c.table === table);

const ROWS = [
  { id: '1', name: 'Key Access Log', description: 'Keys', category: 'Security', icon: 'key', fields: [{ label: 'Date', type: 'date' }], is_active: true, sort_order: 1, version: 2, updated_at: '2026-09-01T00:00:00Z' },
  { id: '3', name: 'Handover', description: '', category: 'Operations', icon: 'clipboard-list', fields: [], is_active: false, sort_order: 3, version: 1, updated_at: '2026-09-01T00:00:00Z' },
];

beforeEach(() => {
  state.calls.length = 0;
  state.results = { form_templates: { data: ROWS, error: null } };
});

describe('parseFields / mapTemplate', () => {
  it('treats anything that is not an array of labelled fields as an empty form', () => {
    expect(parseFields(null)).toEqual([]);
    expect(parseFields({ label: 'x' })).toEqual([]);
    expect(parseFields([{ label: 'Date', type: 'date' }, null, { type: 'text' }, { label: 5, type: 'text' }]))
      .toEqual([{ label: 'Date', type: 'date' }]);
  });

  it('defaults a missing icon, a null is_active and a non-array fields value', () => {
    const t = mapTemplate({ id: '9', name: 'X', category: 'Safety', fields: 'nope', is_active: null });
    expect(t).toMatchObject({ id: '9', icon: 'file-text', fields: [], is_active: true, description: '', sort_order: 0, version: 1 });
  });
});

describe('fetchFormTemplates', () => {
  it('orders by sort_order then id', async () => {
    const rows = await fetchFormTemplates();
    expect(rows.map((r) => r.id)).toEqual(['1', '3']);
    const call = callsFor('form_templates')[0];
    expect(ops(call, 'order')).toEqual([
      ['sort_order', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(String(ops(call, 'select')[0][0])).toContain('fields');
  });

  it('throws what the client returned', async () => {
    state.results = { form_templates: { data: null, error: { message: 'boom' } } };
    await expect(fetchFormTemplates()).rejects.toMatchObject({ message: 'boom' });
  });
});

describe('useFormTemplates', () => {
  it('keeps inactive rows in `all` and hides them from `templates`', async () => {
    const { result } = renderHook(() => useFormTemplates(), { wrapper });
    await waitFor(() => expect(result.current.all).toHaveLength(2));
    expect(result.current.templates.map((t) => t.id)).toEqual(['1']);
    expect(result.current.byId('3')?.name).toBe('Handover');
    expect(result.current.byId('nope')).toBeNull();
    expect(result.current.byId(null)).toBeNull();
  });
});

describe('useFormTemplateMutations', () => {
  it('sends the patch, selects the row back and returns the mapped template', async () => {
    state.results = { form_templates: (call) => (call.ops.some(([m]) => m === 'update') ? { data: [{ ...ROWS[0], version: 3 }], error: null } : { data: ROWS, error: null }) };
    const { result } = renderHook(() => useFormTemplateMutations(), { wrapper });
    const saved = await result.current.update('1', { name: 'Renamed' });
    expect(saved.version).toBe(3);
    const call = callsFor('form_templates')[0];
    expect(ops(call, 'update')[0][0]).toEqual({ name: 'Renamed' });
    expect(ops(call, 'eq')[0]).toEqual(['id', '1']);
    expect(String(ops(call, 'select')[0][0])).toContain('version');
  });

  it('setActive patches only is_active', async () => {
    state.results = { form_templates: { data: [{ ...ROWS[0], is_active: false }], error: null } };
    const { result } = renderHook(() => useFormTemplateMutations(), { wrapper });
    await result.current.setActive('1', false);
    expect(ops(callsFor('form_templates')[0], 'update')[0][0]).toEqual({ is_active: false });
  });

  it('reads zero rows back as a permission failure', async () => {
    state.results = { form_templates: { data: [], error: null } };
    const { result } = renderHook(() => useFormTemplateMutations(), { wrapper });
    await expect(result.current.update('1', { name: 'x' })).rejects.toThrow(FORM_TEMPLATE_PERMISSION_MESSAGE);
  });

  it('turns a 42501 into the same plain message', async () => {
    state.results = { form_templates: { data: null, error: { message: 'denied', code: '42501' } } };
    const { result } = renderHook(() => useFormTemplateMutations(), { wrapper });
    await expect(result.current.update('1', { name: 'x' })).rejects.toThrow(FORM_TEMPLATE_PERMISSION_MESSAGE);
  });

  it('reorder issues one update per id with sort_order = position', async () => {
    state.results = { form_templates: { data: [{ id: 'x' }], error: null } };
    const { result } = renderHook(() => useFormTemplateMutations(), { wrapper });
    await result.current.reorder(['2', '1']);
    const calls = callsFor('form_templates');
    expect(calls).toHaveLength(2);
    expect(ops(calls[0], 'update')[0][0]).toEqual({ sort_order: 1 });
    expect(ops(calls[0], 'eq')[0]).toEqual(['id', '2']);
    expect(ops(calls[1], 'update')[0][0]).toEqual({ sort_order: 2 });
    expect(ops(calls[1], 'eq')[0]).toEqual(['id', '1']);
  });
});

describe('formCategoryClass', () => {
  it('maps the known categories and falls back to muted', () => {
    expect(formCategoryClass('Security')).toContain('bg-primary');
    expect(formCategoryClass('Compliance')).toContain('bg-destructive');
    expect(formCategoryClass('Nope')).toBe('bg-muted text-muted-foreground');
  });
});
