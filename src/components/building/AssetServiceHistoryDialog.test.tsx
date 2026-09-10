import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// jsdom lacks the Pointer Events capture API Radix's Select opens with; polyfill so the
// service-type combobox is drivable here.
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

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
    for (const m of ['select', 'eq', 'order', 'update', 'insert', 'delete']) {
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
  return { supabase: { from } };
});
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isAdminOrManager: true }) }));
vi.mock('@/hooks/useContractors', () => ({
  useContractors: () => ({
    contractors: [
      { id: 'c1', company_name: 'Sparks', trade: 'Electrical', is_active: true },
      { id: 'c2', company_name: 'Flow Plumbing', trade: 'Plumbing', is_active: true },
    ],
    isLoading: false,
    isError: false,
  }),
}));
// The picker has its own tests; a native select keeps a second Radix Select out of jsdom.
vi.mock('@/components/contractors/ContractorPicker', () => ({
  ContractorPicker: ({ value, onChange, id }: { value: string | null; onChange: (id: string | null) => void; id?: string }) => (
    <select id={id} aria-label="Contractor" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">None</option>
      <option value="c1">Sparks</option>
      <option value="c2">Flow Plumbing</option>
    </select>
  ),
}));

import AssetServiceHistoryDialog from './AssetServiceHistoryDialog';

const asset = { id: 'a1', name: 'Lift 1', category: 'lift' };

const record = {
  id: 'r1', asset_id: 'a1', service_date: '2026-08-14', service_type: 'repair', description: 'Replaced ropes',
  performed_by: null, contractor_id: 'c1', contractors: { company_name: 'Sparks' }, cost: 1500,
  next_service_date: null, notes: null, created_at: '2026-08-14T10:00:00.000Z',
};

const isInsert = (calls: RecordedCall[]) => calls.some((c) => c.method === 'insert');

async function openForm() {
  render(<AssetServiceHistoryDialog asset={asset} open onOpenChange={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /add service record/i }));
  await screen.findByLabelText('Contractor');
}

function chooseServiceType(label: RegExp) {
  const trigger = screen.getByRole('combobox', { name: /service type/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  const option = screen.getByRole('option', { name: label });
  fireEvent.pointerUp(option);
  fireEvent.click(option);
}

describe('AssetServiceHistoryDialog', () => {
  beforeEach(() => {
    state.calls.length = 0;
    state.result = () => ({ data: [], error: null });
    toast.success.mockClear();
    toast.error.mockClear();
  });

  it('joins the contractor company into the history table', async () => {
    state.result = (table) => (table === 'asset_service_history' ? { data: [record], error: null } : { data: [], error: null });
    render(<AssetServiceHistoryDialog asset={asset} open onOpenChange={() => {}} />);
    expect(await screen.findByText('Sparks')).toBeInTheDocument();
    const select = state.calls.find((c) => c.table === 'asset_service_history' && c.method === 'select');
    expect(String(select?.args[0])).toContain('contractors(company_name)');
  });

  it('prefills an empty "Performed by" with the company when a contractor is chosen, but leaves typed text alone', async () => {
    await openForm();
    const performedBy = screen.getByLabelText(/performed by/i);
    const picker = screen.getByLabelText('Contractor');

    fireEvent.change(picker, { target: { value: 'c1' } });
    expect(performedBy).toHaveValue('Sparks');

    fireEvent.change(performedBy, { target: { value: 'Joe (site tech)' } });
    fireEvent.change(picker, { target: { value: 'c2' } });
    expect(performedBy).toHaveValue('Joe (site tech)');
  });

  it('swaps a prefilled "Performed by" when the contractor is switched, and clears it when the pick is removed', async () => {
    await openForm();
    const performedBy = screen.getByLabelText(/performed by/i);
    const picker = screen.getByLabelText('Contractor');

    fireEvent.change(picker, { target: { value: 'c1' } });
    expect(performedBy).toHaveValue('Sparks');
    fireEvent.change(picker, { target: { value: 'c2' } });
    expect(performedBy).toHaveValue('Flow Plumbing');
    fireEvent.change(picker, { target: { value: '' } });
    expect(performedBy).toHaveValue('');

    // Once the user has edited the prefill it is theirs: a later switch leaves it alone.
    fireEvent.change(picker, { target: { value: 'c1' } });
    fireEvent.change(performedBy, { target: { value: 'Sparks (Joe)' } });
    fireEvent.change(picker, { target: { value: 'c2' } });
    expect(performedBy).toHaveValue('Sparks (Joe)');
  });

  it('shows the company as a sub-line only when "Performed by" names someone else', async () => {
    const byTech = { ...record, id: 'r2', service_date: '2026-08-15', performed_by: 'Joe (site tech)' };
    const byCompany = { ...record, id: 'r3', service_date: '2026-08-16', performed_by: 'Sparks' };
    state.result = (table) => (table === 'asset_service_history' ? { data: [byTech, byCompany], error: null } : { data: [], error: null });
    render(<AssetServiceHistoryDialog asset={asset} open onOpenChange={() => {}} />);

    const tech = await screen.findByText('Joe (site tech)');
    const subLine = tech.closest('td')?.querySelector('p');
    expect(subLine).toHaveTextContent('Sparks');
    expect(subLine?.className).toMatch(/text-xs/);

    // performed_by equal to the company: the cell says Sparks once, with no sub-line.
    const rows = screen.getAllByRole('row');
    const companyRow = rows.find((r) => r.textContent?.includes('16 Aug 2026'))!;
    const cell = companyRow.querySelectorAll('td')[3];
    expect(cell).toHaveTextContent(/^Sparks$/);
    expect(cell.querySelector('p')).toBeNull();
  });

  it('writes contractor_id on the inserted record', async () => {
    state.result = (table, calls) => {
      if (table === 'asset_service_history' && isInsert(calls)) return { data: [{ id: 'new' }], error: null };
      return { data: [], error: null };
    };
    await openForm();
    chooseServiceType(/^repair$/i);
    fireEvent.change(screen.getByLabelText('Contractor'), { target: { value: 'c1' } });
    fireEvent.click(screen.getByRole('button', { name: /add record/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Service record added successfully'));
    const insert = state.calls.find((c) => c.table === 'asset_service_history' && c.method === 'insert');
    expect(insert?.args[0]).toMatchObject({
      asset_id: 'a1', service_type: 'repair', contractor_id: 'c1', performed_by: 'Sparks', created_by: 'u1',
    });
  });

  it('writes a null contractor_id when none is picked', async () => {
    await openForm();
    chooseServiceType(/inspection/i);
    fireEvent.change(screen.getByLabelText(/performed by/i), { target: { value: 'In-house' } });
    fireEvent.click(screen.getByRole('button', { name: /add record/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const insert = state.calls.find((c) => c.table === 'asset_service_history' && c.method === 'insert');
    expect(insert?.args[0]).toMatchObject({ contractor_id: null, performed_by: 'In-house' });
  });
});
