import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
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
  /** Per-table result the chain resolves with; a function gets the recorded call. */
  results: {} as Record<string, Result | ((call: RecordedCall) => Result)>,
  uploads: [] as { bucket: string; path: string; file: File; opts: unknown }[],
  removes: [] as { bucket: string; keys: string[] }[],
  uploadError: null as string | null,
  removeError: null as string | null,
}));

vi.mock('@/integrations/supabase/client', () => {
  function makeChain(table: string) {
    const call: RecordedCall = { table, ops: [] };
    state.calls.push(call);
    // The slice of PostgrestFilterBuilder these hooks touch: every builder method chains, and
    // the chain itself is awaitable (a thenable) the way the real builder is.
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
  return {
    supabase: {
      from: (table: string) => makeChain(table),
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string, file: File, opts: unknown) => {
            state.uploads.push({ bucket, path, file, opts });
            return { error: state.uploadError ? { message: state.uploadError } : null };
          },
          remove: async (keys: string[]) => {
            state.removes.push({ bucket, keys });
            return { error: state.removeError ? { message: state.removeError } : null };
          },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        }),
      },
    },
  };
});

const openStorageFile = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/integrations/supabase/storage', () => ({ openStorageFile }));

import {
  CONTRACTOR_PERMISSION_MESSAGE,
  contractorDocumentKey,
  contractorDocumentUrl,
  openContractorDocument,
  useContractorDocuments,
  useContractorHistory,
  useContractors,
  CONTRACTOR_EXISTS_MESSAGE,
  type ContractorInput,
} from './useContractors';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }) }, children);

const ops = (call: RecordedCall, name: string) => call.ops.filter(([m]) => m === name).map(([, args]) => args);
const callsFor = (table: string) => state.calls.filter((c) => c.table === table);

const INPUT: ContractorInput = {
  company_name: 'Sparks Electrical',
  trade: 'Electrical',
  default_trade_role: 'Electrical Contractor',
  contact_name: 'Thabo',
  contact_email: 't@sparks.co.za',
  contact_phone: '0821234567',
  address: '1 Main Rd',
  vat_number: '4123456789',
  notes: null,
  is_active: true,
};

beforeEach(() => {
  state.calls = [];
  state.results = {};
  state.uploads = [];
  state.removes = [];
  state.uploadError = null;
  state.removeError = null;
  openStorageFile.mockClear();
});

describe('useContractors', () => {
  it('lists the whole register (inactive included) ordered by company name', async () => {
    state.results.contractors = { data: [{ id: 'c1', company_name: 'A', is_active: false }], error: null };
    const { result } = renderHook(() => useContractors(), { wrapper });
    await waitFor(() => expect(result.current.contractors).toHaveLength(1));
    const call = callsFor('contractors')[0];
    expect(ops(call, 'select')).toEqual([['*']]);
    expect(ops(call, 'order')).toEqual([['company_name', { ascending: true }]]);
    expect(ops(call, 'eq')).toEqual([]);
  });

  it('create inserts the payload and reads the id back', async () => {
    state.results.contractors = (call) => (call.ops.some(([m]) => m === 'insert') ? { data: [{ id: 'new1' }], error: null } : { data: [], error: null });
    const { result } = renderHook(() => useContractors(), { wrapper });
    let id = '';
    await act(async () => { id = await result.current.create.mutateAsync(INPUT); });
    expect(id).toBe('new1');
    const call = callsFor('contractors').find((c) => c.ops.some(([m]) => m === 'insert'))!;
    expect(ops(call, 'insert')).toEqual([[INPUT]]);
    expect(ops(call, 'select')).toEqual([['id']]);
  });

  it('update writes by id and treats zero rows as a permission problem', async () => {
    state.results.contractors = (call) => (call.ops.some(([m]) => m === 'update') ? { data: [], error: null } : { data: [], error: null });
    const { result } = renderHook(() => useContractors(), { wrapper });
    await expect(result.current.update.mutateAsync({ id: 'c1', ...INPUT })).rejects.toThrow(CONTRACTOR_PERMISSION_MESSAGE);
    const call = callsFor('contractors').find((c) => c.ops.some(([m]) => m === 'update'))!;
    expect(ops(call, 'update')).toEqual([[INPUT]]);
    expect(ops(call, 'eq')).toEqual([['id', 'c1']]);
    expect(ops(call, 'select')).toEqual([['id']]);
  });

  it('setActive flips is_active on one row', async () => {
    state.results.contractors = (call) => (call.ops.some(([m]) => m === 'update') ? { data: [{ id: 'c1' }], error: null } : { data: [], error: null });
    const { result } = renderHook(() => useContractors(), { wrapper });
    await act(async () => { await result.current.setActive.mutateAsync({ id: 'c1', is_active: false }); });
    const call = callsFor('contractors').find((c) => c.ops.some(([m]) => m === 'update'))!;
    expect(ops(call, 'update')).toEqual([[{ is_active: false }]]);
    expect(ops(call, 'eq')).toEqual([['id', 'c1']]);
  });

  it('surfaces a database error message when the code has no plain copy', async () => {
    state.results.contractors = (call) => (call.ops.some(([m]) => m === 'insert') ? { data: null, error: { message: 'duplicate key' } } : { data: [], error: null });
    const { result } = renderHook(() => useContractors(), { wrapper });
    await expect(result.current.create.mutateAsync(INPUT)).rejects.toThrow('duplicate key');
  });

  it('reads a 23505 as "that name already exists" and a 42501 as the permission message', async () => {
    state.results.contractors = (call) => (call.ops.some(([m]) => m === 'insert')
      ? { data: null, error: { message: 'duplicate key value violates unique constraint "contractors_company_name_key"', code: '23505' } }
      : { data: [], error: null });
    const { result } = renderHook(() => useContractors(), { wrapper });
    await expect(result.current.create.mutateAsync(INPUT)).rejects.toThrow(CONTRACTOR_EXISTS_MESSAGE);

    state.results.contractors = (call) => (call.ops.some(([m]) => m === 'update')
      ? { data: null, error: { message: 'new row violates row-level security policy', code: '42501' } }
      : { data: [], error: null });
    await expect(result.current.update.mutateAsync({ id: 'c1', ...INPUT })).rejects.toThrow(CONTRACTOR_PERMISSION_MESSAGE);
  });
});

describe('useContractorDocuments', () => {
  it('lists documents for the contractor, newest first, and does nothing without one', async () => {
    state.results.contractor_documents = { data: [{ id: 'd1' }], error: null };
    const { result } = renderHook(() => useContractorDocuments('c1'), { wrapper });
    await waitFor(() => expect(result.current.documents).toHaveLength(1));
    const call = callsFor('contractor_documents')[0];
    expect(ops(call, 'eq')).toEqual([['contractor_id', 'c1']]);
    expect(ops(call, 'order')).toEqual([['uploaded_at', { ascending: false }]]);

    state.calls = [];
    renderHook(() => useContractorDocuments(null), { wrapper });
    expect(callsFor('contractor_documents')).toHaveLength(0);
  });

  it('uploads under contractor-docs/<id>/<uuid>.<ext> and stores the path in file_url', async () => {
    state.results.contractor_documents = (call) => (call.ops.some(([m]) => m === 'insert') ? { data: [{ id: 'd9' }], error: null } : { data: [], error: null });
    const { result } = renderHook(() => useContractorDocuments('c1'), { wrapper });
    const file = new File(['%PDF'], 'Liability.PDF', { type: 'application/pdf' });
    await act(async () => {
      await result.current.upload.mutateAsync({ file, meta: { document_name: 'Public liability', document_type: 'Insurance', expiry_date: '2027-01-31', notes: 'R10m cover' } });
    });
    expect(state.uploads).toHaveLength(1);
    const up = state.uploads[0];
    expect(up.bucket).toBe('tenant-documents');
    expect(up.path).toMatch(/^contractor-docs\/c1\/[0-9a-f-]{36}\.pdf$/);
    expect(up.opts).toEqual({ contentType: 'application/pdf' });
    const call = callsFor('contractor_documents').find((c) => c.ops.some(([m]) => m === 'insert'))!;
    expect(ops(call, 'insert')).toEqual([[{
      contractor_id: 'c1',
      document_name: 'Public liability',
      document_type: 'Insurance',
      expiry_date: '2027-01-31',
      notes: 'R10m cover',
      file_url: up.path,
    }]]);
    expect(ops(call, 'select')).toEqual([['id']]);
    expect(state.removes).toHaveLength(0);
  });

  it('removes the uploaded object when the row insert is refused', async () => {
    state.results.contractor_documents = { data: [], error: null };
    const { result } = renderHook(() => useContractorDocuments('c1'), { wrapper });
    const file = new File(['x'], 'cert.png', { type: 'image/png' });
    await expect(
      result.current.upload.mutateAsync({ file, meta: { document_name: 'Cert', document_type: 'Certification', expiry_date: null } }),
    ).rejects.toThrow(CONTRACTOR_PERMISSION_MESSAGE);
    expect(state.removes).toEqual([{ bucket: 'tenant-documents', keys: [state.uploads[0].path] }]);
  });

  it('does not insert a row when the upload itself fails', async () => {
    state.uploadError = 'new row violates row-level security policy';
    const { result } = renderHook(() => useContractorDocuments('c1'), { wrapper });
    const file = new File(['x'], 'cert.png', { type: 'image/png' });
    await expect(
      result.current.upload.mutateAsync({ file, meta: { document_name: 'Cert', document_type: 'Certification', expiry_date: null } }),
    ).rejects.toThrow('Upload failed');
    expect(callsFor('contractor_documents').some((c) => c.ops.some(([m]) => m === 'insert'))).toBe(false);
  });

  it('setVerified updates one row by id', async () => {
    state.results.contractor_documents = (call) => (call.ops.some(([m]) => m === 'update') ? { data: [{ id: 'd1' }], error: null } : { data: [], error: null });
    const { result } = renderHook(() => useContractorDocuments('c1'), { wrapper });
    await act(async () => { await result.current.setVerified.mutateAsync({ id: 'd1', is_verified: true }); });
    const call = callsFor('contractor_documents').find((c) => c.ops.some(([m]) => m === 'update'))!;
    expect(ops(call, 'update')).toEqual([[{ is_verified: true }]]);
    expect(ops(call, 'eq')).toEqual([['id', 'd1']]);
    expect(ops(call, 'select')).toEqual([['id']]);
  });

  it('remove deletes the row, then the storage object (path or legacy URL form)', async () => {
    state.results.contractor_documents = (call) => (call.ops.some(([m]) => m === 'delete') ? { data: [{ id: 'd1' }], error: null } : { data: [], error: null });
    const { result } = renderHook(() => useContractorDocuments('c1'), { wrapper });
    await act(async () => { await result.current.remove.mutateAsync({ id: 'd1', file_url: 'contractor-docs/c1/abc.pdf' }); });
    await act(async () => {
      await result.current.remove.mutateAsync({ id: 'd1', file_url: 'https://x.supabase.co/storage/v1/object/public/tenant-documents/contractor-docs/c1/def.pdf' });
    });
    const call = callsFor('contractor_documents').find((c) => c.ops.some(([m]) => m === 'delete'))!;
    expect(ops(call, 'delete')).toEqual([[]]);
    expect(ops(call, 'eq')).toEqual([['id', 'd1']]);
    expect(ops(call, 'select')).toEqual([['id']]);
    expect(state.removes).toEqual([
      { bucket: 'tenant-documents', keys: ['contractor-docs/c1/abc.pdf'] },
      { bucket: 'tenant-documents', keys: ['contractor-docs/c1/def.pdf'] },
    ]);
  });

  it('refuses to delete the file when the row delete was filtered away', async () => {
    state.results.contractor_documents = { data: [], error: null };
    const { result } = renderHook(() => useContractorDocuments('c1'), { wrapper });
    await expect(result.current.remove.mutateAsync({ id: 'd1', file_url: 'contractor-docs/c1/abc.pdf' })).rejects.toThrow(CONTRACTOR_PERMISSION_MESSAGE);
    expect(state.removes).toHaveLength(0);
  });

  it('still refreshes the list when the row is gone but the storage delete fails', async () => {
    state.results.contractor_documents = (call) => (call.ops.some(([m]) => m === 'delete') ? { data: [{ id: 'd1' }], error: null } : { data: [], error: null });
    state.removeError = 'bucket offline';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const spiedWrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useContractorDocuments('c1'), { wrapper: spiedWrapper });
    await expect(result.current.remove.mutateAsync({ id: 'd1', file_url: 'contractor-docs/c1/abc.pdf' }))
      .rejects.toThrow('The record was removed but the file could not be deleted from storage: bucket offline');
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['contractor-documents', 'c1'] }));
  });
});

describe('document url helpers', () => {
  it('recovers the object key from a path or the public-URL form', () => {
    expect(contractorDocumentKey('contractor-docs/c1/a.pdf')).toBe('contractor-docs/c1/a.pdf');
    expect(contractorDocumentKey('https://x/storage/v1/object/public/tenant-documents/contractor-docs/c1/a%20b.pdf')).toBe('contractor-docs/c1/a b.pdf');
    expect(contractorDocumentKey(null)).toBeNull();
  });

  it('opens through the public-URL form that openStorageFile re-signs', async () => {
    expect(contractorDocumentUrl('contractor-docs/c1/a.pdf')).toBe('https://x.supabase.co/storage/v1/object/public/tenant-documents/contractor-docs/c1/a.pdf');
    await openContractorDocument('contractor-docs/c1/a.pdf');
    expect(openStorageFile).toHaveBeenCalledWith('https://x.supabase.co/storage/v1/object/public/tenant-documents/contractor-docs/c1/a.pdf');
  });
});

describe('useContractorHistory', () => {
  it('reads issues, services and ratings by contractor_id and flattens the joins', async () => {
    state.results.issues = {
      data: [{ id: 'i1', title: 'Leak', status: 'open', priority: 'high', created_at: '2026-09-01', resolved_at: null, actual_cost: 1200, building_id: 'b1', buildings: { name: 'Block A' } }],
      error: null,
    };
    state.results.asset_service_history = {
      data: [{ id: 's1', service_date: '2026-08-15', service_type: 'Service', description: null, cost: 800, next_service_date: null, asset_id: 'a1', building_assets: { name: 'Chiller 1', building_id: 'b1' } }],
      error: null,
    };
    state.results.contractor_ratings = {
      data: [{ id: 'r1', contractor_id: 'c1', issue_id: 'i1', rating: 4, comment: 'Quick', rated_by: 'u1', created_at: '2026-09-02' }],
      error: null,
    };
    const { result } = renderHook(() => useContractorHistory('c1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    for (const table of ['issues', 'asset_service_history', 'contractor_ratings']) {
      const call = callsFor(table)[0];
      expect(call, table).toBeDefined();
      expect(ops(call, 'eq'), table).toEqual([['contractor_id', 'c1']]);
    }
    expect(ops(callsFor('issues')[0], 'select')[0][0]).toContain('buildings(name)');
    expect(ops(callsFor('asset_service_history')[0], 'select')[0][0]).toContain('building_assets(name, building_id)');

    expect(result.current.issues).toEqual([expect.objectContaining({ id: 'i1', building_name: 'Block A', actual_cost: 1200 })]);
    expect(result.current.issues[0]).not.toHaveProperty('buildings');
    expect(result.current.services).toEqual([expect.objectContaining({ id: 's1', asset_name: 'Chiller 1', building_id: 'b1' })]);
    expect(result.current.ratings).toEqual([expect.objectContaining({ id: 'r1', rating: 4 })]);
  });

  it('runs no queries without a contractor', () => {
    renderHook(() => useContractorHistory(null), { wrapper });
    expect(state.calls).toHaveLength(0);
  });
});
