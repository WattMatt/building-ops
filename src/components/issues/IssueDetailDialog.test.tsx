import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { mockViewport } from '@/test/mobile';

// A chainable, thenable query stub: any builder call returns itself and awaiting it yields
// `state.result` for the calls chained so far (recorded so tests can assert write shapes).
interface RecordedCall { table: string; method: string; args: unknown[] }
const state = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  result: (() => ({ data: [], error: null })) as (table: string, calls: RecordedCall[]) => { data: unknown[] | null; error: { message: string } | null },
}));
vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => {
    const c: Record<string, unknown> = {};
    const own: RecordedCall[] = [];
    for (const m of ['select', 'eq', 'order', 'update', 'insert', 'in', 'limit', 'single', 'maybeSingle']) {
      c[m] = (...args: unknown[]) => {
        const call = { table, method: m, args };
        own.push(call);
        state.calls.push(call);
        return c;
      };
    }
    c.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(state.result(table, own)).then(resolve, reject);
    return c;
  };
  return { supabase: { from, storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) } } };
});
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isAdminOrManager: true }) }));
vi.mock('@/hooks/useBuildingMembers', () => ({
  useBuildingMembers: () => ({ data: [], byId: new Map() }),
  memberDisplayName: (m: { full_name: string | null }) => m.full_name ?? 'Unnamed user',
}));
// The comment composer and resolve dialog inside write through the offline queue.
vi.mock('@/lib/offline/enqueueAndRun', () => ({ enqueueAndRun: vi.fn().mockResolvedValue({ status: 'synced', result: {} }) }));
vi.mock('@/lib/notify', () => ({ notify: async () => {} }));
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import IssueDetailDialog from './IssueDetailDialog';

const issue = {
  id: 'i1',
  title: 'Leaking tap in kitchen',
  description: 'Steady drip under the sink.',
  priority: 'medium' as const,
  status: 'open' as const,
  deadline: null,
  created_at: '2026-09-01T08:00:00.000Z',
  building_id: 'b1',
  building_name: 'North Tower',
  reported_by: 'u1',
  assigned_to: null,
  corrective_action: null,
  photo_urls: null,
  task_instance_id: null,
};

const isUpdate = (calls: RecordedCall[]) => calls.some((c) => c.method === 'update');

describe('IssueDetailDialog', () => {
  beforeEach(() => {
    state.calls.length = 0;
    state.result = () => ({ data: [], error: null });
    toast.success.mockClear();
    toast.error.mockClear();
  });
  afterEach(() => mockViewport(1024));

  it('opens as a bottom sheet on a phone with the issue title', async () => {
    mockViewport(375);
    render(<IssueDetailDialog issue={issue} open onOpenChange={() => {}} canManage onUpdated={() => {}} />);
    expect(await screen.findByRole('heading', { name: /leaking tap in kitchen/i })).toBeInTheDocument();
    expect(document.querySelector('[data-vaul-drawer]')).not.toBeNull();
  });

  describe('costs (admin/manager)', () => {
    const costRow = { estimated_cost: 1200, actual_cost: null };

    it('loads the cost columns itself and saves the actual cost on blur with a row-returning update', async () => {
      state.result = (table, calls) => {
        if (table !== 'issues') return { data: [], error: null };
        return isUpdate(calls) ? { data: [{ id: 'i1' }], error: null } : { data: [costRow], error: null };
      };
      render(<IssueDetailDialog issue={issue} open onOpenChange={() => {}} canManage onUpdated={() => {}} />);

      const estimated = await screen.findByLabelText(/estimated cost/i);
      await waitFor(() => expect(estimated).toHaveValue(1200));
      const actual = screen.getByLabelText(/actual cost/i);

      fireEvent.change(actual, { target: { value: '950.25' } });
      fireEvent.blur(actual);

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Actual cost saved'));
      const update = state.calls.find((c) => c.table === 'issues' && c.method === 'update');
      expect(update?.args[0]).toEqual({ actual_cost: 950.25 });
      const after = state.calls.slice(state.calls.indexOf(update!));
      expect(after.some((c) => c.method === 'eq' && c.args[0] === 'id' && c.args[1] === 'i1')).toBe(true);
      expect(after.some((c) => c.method === 'select' && c.args[0] === 'id')).toBe(true);
      // The hint is coaching copy, rendered through <Hint>.
      expect(screen.getByText(/fill in the actual cost when the work is done/i)).toBeInTheDocument();
    });

    it('does not write when the value is unchanged', async () => {
      state.result = (table) => (table === 'issues' ? { data: [costRow], error: null } : { data: [], error: null });
      render(<IssueDetailDialog issue={issue} open onOpenChange={() => {}} canManage onUpdated={() => {}} />);
      const estimated = await screen.findByLabelText(/estimated cost/i);
      await waitFor(() => expect(estimated).toHaveValue(1200));
      fireEvent.blur(estimated);
      await new Promise((r) => setTimeout(r, 0));
      expect(state.calls.some((c) => c.method === 'update')).toBe(false);
    });

    it('treats a zero-row update as a permission refusal and reverts the field', async () => {
      state.result = (table, calls) => {
        if (table !== 'issues') return { data: [], error: null };
        return isUpdate(calls) ? { data: [], error: null } : { data: [costRow], error: null };
      };
      render(<IssueDetailDialog issue={issue} open onOpenChange={() => {}} canManage onUpdated={() => {}} />);
      const estimated = await screen.findByLabelText(/estimated cost/i);
      await waitFor(() => expect(estimated).toHaveValue(1200));

      fireEvent.change(estimated, { target: { value: '1500' } });
      fireEvent.blur(estimated);

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You do not have permission to change this issue's costs."));
      expect(estimated).toHaveValue(1200);
    });

    it('is hidden when the viewer cannot manage the issue', async () => {
      render(<IssueDetailDialog issue={issue} open onOpenChange={() => {}} canManage={false} onUpdated={() => {}} />);
      await screen.findByRole('heading', { name: /leaking tap in kitchen/i });
      expect(screen.queryByLabelText(/estimated cost/i)).toBeNull();
      expect(state.calls.some((c) => c.method === 'select' && String(c.args[0]).includes('estimated_cost'))).toBe(false);
    });
  });
});
