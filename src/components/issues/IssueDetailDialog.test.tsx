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
// The picker has its own tests; a native select keeps Radix out of jsdom here.
vi.mock('@/components/contractors/ContractorPicker', () => ({
  ContractorPicker: ({ value, onChange, id, disabled }: { value: string | null; onChange: (id: string | null) => void; id?: string; disabled?: boolean }) => (
    <select id={id} aria-label="Contractor" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">None</option>
      <option value="c1">Sparks</option>
      <option value="c2">Flow Plumbing</option>
    </select>
  ),
}));
// The resolve dialog is tested on its own; here it only needs to expose which contractor it was given.
vi.mock('@/components/issues/ResolveIssueDialog', () => ({
  ResolveIssueDialog: ({ contractorId }: { contractorId?: string | null }) => <div data-testid="resolve-dialog">contractor={contractorId ?? 'none'}</div>,
}));

import IssueDetailDialog from './IssueDetailDialog';
import { formatSlaInstant } from '@/lib/slaState';

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

  describe('tenant reports', () => {
    it('shows the reference and the reporter for an issue that came through the intake form', async () => {
      render(
        <IssueDetailDialog
          issue={{
            ...issue,
            source: 'tenant_intake' as const,
            reference: 'FO-ABC234',
            category: 'Lighting',
            reporter: { name: 'Thandi', shop: 'Kool Kids', shop_number: '12', unit: null, phone: '0821234567', email: null },
          }}
          open onOpenChange={() => {}} canManage onUpdated={() => {}}
        />,
      );
      const block = await screen.findByTestId('tenant-report');
      expect(block).toHaveTextContent('Tenant report');
      expect(block).toHaveTextContent('FO-ABC234');
      expect(block).toHaveTextContent('Thandi · Kool Kids (Shop 12)');
      expect(screen.getByRole('link', { name: '0821234567' })).toHaveAttribute('href', 'tel:0821234567');
      // The category the tenant chose on the form is shown, not just written to the CSV export.
      expect(screen.getByTestId('tenant-category')).toHaveTextContent('Lighting');
    });

    it('leaves the category chip out when the tenant did not pick one', async () => {
      render(
        <IssueDetailDialog
          issue={{
            ...issue,
            source: 'tenant_intake' as const,
            reference: 'FO-ABC234',
            category: null,
            reporter: { name: 'Thandi', shop: null, shop_number: null, unit: null, phone: null, email: null },
          }}
          open onOpenChange={() => {}} canManage onUpdated={() => {}}
        />,
      );
      await screen.findByTestId('tenant-report');
      expect(screen.queryByTestId('tenant-category')).toBeNull();
    });

    it('is absent on an issue the app created', async () => {
      render(<IssueDetailDialog issue={issue} open onOpenChange={() => {}} canManage onUpdated={() => {}} />);
      await screen.findByRole('heading', { name: /leaking tap in kitchen/i });
      expect(screen.queryByTestId('tenant-report')).toBeNull();
    });
  });

  describe('SLA', () => {
    it('shows the live chip and the due and first-response instants in SAST', async () => {
      // Reported half an hour ago with a 24 h target: 23.5 h left, floored to whole hours.
      const created = new Date(Date.now() - 30 * 60_000);
      const firstResponse = new Date(created.getTime() + 10 * 60_000);
      const due = new Date(created.getTime() + 24 * 3_600_000);
      render(
        <IssueDetailDialog
          issue={{ ...issue, created_at: created.toISOString(), sla_target_hours: 24, first_response_at: firstResponse.toISOString() }}
          open onOpenChange={() => {}} canManage onUpdated={() => {}}
        />,
      );
      expect(await screen.findByText('Due in 23h')).toHaveAttribute('data-sla', 'ok');
      const line = screen.getByText(/SLA target 24 h/);
      expect(line.textContent).toContain(`due ${formatSlaInstant(due)}`);
      expect(line.textContent).toContain(`first response ${formatSlaInstant(firstResponse)}`);
    });

    it('shows no SLA line or chip without a target', async () => {
      render(<IssueDetailDialog issue={issue} open onOpenChange={() => {}} canManage onUpdated={() => {}} />);
      await screen.findByRole('heading', { name: /leaking tap in kitchen/i });
      expect(screen.queryByText(/SLA target/)).not.toBeInTheDocument();
      expect(document.querySelector('[data-sla]')).toBeNull();
    });
  });

  describe('contractor (admin/manager)', () => {
    const row = { estimated_cost: null, actual_cost: null, contractor_id: 'c2' };

    it('loads contractor_id with the cost columns, shows it, and hands it to the resolve dialog', async () => {
      state.result = (table) => (table === 'issues' ? { data: [row], error: null } : { data: [], error: null });
      render(<IssueDetailDialog issue={issue} open onOpenChange={() => {}} canManage onUpdated={() => {}} />);
      const picker = await screen.findByLabelText('Contractor');
      await waitFor(() => expect(picker).toHaveValue('c2'));
      const select = state.calls.find((c) => c.table === 'issues' && c.method === 'select');
      expect(String(select?.args[0])).toContain('contractor_id');
      expect(screen.getByTestId('resolve-dialog')).toHaveTextContent('contractor=c2');
      // Coaching copy goes through <Hint>.
      expect(screen.getByText(/assign the contractor doing the work/i)).toBeInTheDocument();
    });

    it('writes contractor_id with a row-returning update when a contractor is chosen', async () => {
      state.result = (table, calls) => {
        if (table !== 'issues') return { data: [], error: null };
        return isUpdate(calls) ? { data: [{ id: 'i1' }], error: null } : { data: [{ ...row, contractor_id: null }], error: null };
      };
      render(<IssueDetailDialog issue={issue} open onOpenChange={() => {}} canManage onUpdated={() => {}} />);
      const picker = await screen.findByLabelText('Contractor');
      await waitFor(() => expect(picker).not.toBeDisabled());

      fireEvent.change(picker, { target: { value: 'c1' } });

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Contractor assigned'));
      const update = state.calls.find((c) => c.table === 'issues' && c.method === 'update');
      expect(update?.args[0]).toEqual({ contractor_id: 'c1' });
      const after = state.calls.slice(state.calls.indexOf(update!));
      expect(after.some((c) => c.method === 'eq' && c.args[0] === 'id' && c.args[1] === 'i1')).toBe(true);
      expect(after.some((c) => c.method === 'select' && c.args[0] === 'id')).toBe(true);
      expect(picker).toHaveValue('c1');
      expect(screen.getByTestId('resolve-dialog')).toHaveTextContent('contractor=c1');
    });

    it('treats a zero-row update as a permission refusal and reverts the picker', async () => {
      state.result = (table, calls) => {
        if (table !== 'issues') return { data: [], error: null };
        return isUpdate(calls) ? { data: [], error: null } : { data: [row], error: null };
      };
      render(<IssueDetailDialog issue={issue} open onOpenChange={() => {}} canManage onUpdated={() => {}} />);
      const picker = await screen.findByLabelText('Contractor');
      await waitFor(() => expect(picker).toHaveValue('c2'));

      fireEvent.change(picker, { target: { value: 'c1' } });

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You do not have permission to change this issue's contractor."));
      expect(picker).toHaveValue('c2');
    });

    it('keeps the picker disabled until the issue row has been read, so a pick cannot be overwritten by it', async () => {
      // The issues read never answers; nothing else is affected.
      state.result = (table) => (table === 'issues' ? (new Promise(() => {}) as never) : { data: [], error: null });
      render(<IssueDetailDialog issue={issue} open onOpenChange={() => {}} canManage onUpdated={() => {}} />);
      const picker = await screen.findByLabelText('Contractor');
      await new Promise((r) => setTimeout(r, 0));
      expect(picker).toBeDisabled();
      expect(picker).toHaveValue('');
    });

    it('is hidden when the viewer cannot manage the issue', async () => {
      render(<IssueDetailDialog issue={issue} open onOpenChange={() => {}} canManage={false} onUpdated={() => {}} />);
      await screen.findByRole('heading', { name: /leaking tap in kitchen/i });
      expect(screen.queryByLabelText('Contractor')).toBeNull();
    });
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
