import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Contractor } from '@/hooks/useContractors';

// Radix Select drives itself with pointer capture and scrollIntoView, which jsdom lacks.
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
// Radix Switch measures its hidden form input with ResizeObserver, which jsdom lacks.
if (!('ResizeObserver' in globalThis)) {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
}
// Pin "today" so the expired-document chip in the sheet test is deterministic.
vi.mock('@/lib/myWork', () => ({ todayInOperatingTz: () => '2026-09-10' }));

const contractor = (over: Partial<Contractor>): Contractor => ({
  id: 'c1',
  company_name: 'Sparks Electrical',
  trade: 'Electrical',
  contact_name: 'Thabo',
  contact_email: null,
  contact_phone: '082 123 4567',
  rating: 4.5,
  notes: null,
  is_active: true,
  organization_id: null,
  created_at: null,
  updated_at: null,
  address: null,
  vat_number: null,
  default_trade_role: null,
  ...over,
});

const state = vi.hoisted(() => ({
  isAdminOrManager: true,
  contractors: [] as unknown[],
  isLoading: false,
  isError: false,
}));
const create = vi.hoisted(() => vi.fn(async () => 'new1'));
const update = vi.hoisted(() => vi.fn(async () => 'c1'));
const setActive = vi.hoisted(() => vi.fn(async () => 'c1'));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'u1' } }),
}));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/useContractors', () => ({
  useContractors: () => ({
    contractors: state.contractors,
    isLoading: state.isLoading,
    isError: state.isError,
    create: { mutateAsync: create },
    update: { mutateAsync: update },
    setActive: { mutateAsync: setActive },
  }),
  useContractorDocuments: () => ({
    documents: [
      { id: 'd1', contractor_id: 'c1', document_name: 'Public liability', document_type: 'Insurance', expiry_date: '2020-01-01', file_url: 'contractor-docs/c1/a.pdf', is_verified: false, uploaded_at: null, notes: null },
    ],
    isLoading: false,
    isError: false,
    upload: { mutateAsync: vi.fn(), isPending: false },
    setVerified: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
  useContractorHistory: () => ({
    issues: [{ id: 'i1', title: 'Blown DB', status: 'open', priority: 'high', created_at: '2026-09-01', resolved_at: null, actual_cost: null, building_id: 'b1', building_name: 'Block A' }],
    services: [],
    ratings: [],
    isLoading: false,
    isError: false,
  }),
  openContractorDocument: vi.fn(),
}));

import Contractors, { filterContractors } from './Contractors';

beforeEach(() => {
  state.isAdminOrManager = true;
  state.isLoading = false;
  state.isError = false;
  state.contractors = [
    contractor({}),
    contractor({ id: 'c2', company_name: 'Flow Plumbing', trade: 'Plumbing', contact_name: 'Lerato', rating: null }),
    contractor({ id: 'c3', company_name: 'Old Volts', trade: 'Electrical', is_active: false }),
  ];
  create.mockClear();
  update.mockClear();
  setActive.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
});

describe('Contractors page gating', () => {
  it('shows nothing of the register to a site user', () => {
    state.isAdminOrManager = false;
    render(<Contractors />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(screen.queryByText('Sparks Electrical')).toBeNull();
    expect(screen.queryByRole('button', { name: /New contractor/ })).toBeNull();
  });
});

describe('Contractors list', () => {
  it('lists active contractors with trade, contact and rating; inactive only on request', () => {
    render(<Contractors />);
    expect(screen.getByText('Sparks Electrical')).toBeInTheDocument();
    expect(screen.getByText('Flow Plumbing')).toBeInTheDocument();
    expect(screen.queryByText('Old Volts')).toBeNull();
    expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5' })).toBeInTheDocument();
    expect(screen.getByText('Not rated')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: /Show inactive \(1\)/ }));
    expect(screen.getByText('Old Volts')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('search narrows by company, trade or contact', () => {
    render(<Contractors />);
    const search = screen.getByRole('textbox', { name: 'Search contractors' });
    fireEvent.change(search, { target: { value: 'lerato' } });
    expect(screen.queryByText('Sparks Electrical')).toBeNull();
    expect(screen.getByText('Flow Plumbing')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No contractors match.')).toBeInTheDocument();
  });

  it('the trade filter lists each trade once', () => {
    render(<Contractors />);
    const trigger = screen.getByRole('combobox', { name: 'Trade' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['All trades', 'Electrical', 'Plumbing']);
    const plumbing = screen.getByRole('option', { name: 'Plumbing' });
    fireEvent.pointerUp(plumbing);
    fireEvent.click(plumbing);
    expect(screen.queryByText('Sparks Electrical')).toBeNull();
    expect(screen.getByText('Flow Plumbing')).toBeInTheDocument();
  });

  it('says so when the register is empty or failed to load', () => {
    state.contractors = [];
    const { unmount } = render(<Contractors />);
    expect(screen.getByText('No contractors yet. Add the first one.')).toBeInTheDocument();
    unmount();
    state.isError = true;
    render(<Contractors />);
    expect(screen.getByText('Could not load the contractor register.')).toBeInTheDocument();
  });
});

describe('ContractorDialog through the page', () => {
  it('New → fill in → Add sends the trimmed payload with nulls for blanks and active on', async () => {
    render(<Contractors />);
    fireEvent.click(screen.getByRole('button', { name: /New contractor/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('New contractor')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Company name'), { target: { value: '  Cool Air  ' } });
    fireEvent.change(within(dialog).getByLabelText('Trade'), { target: { value: 'HVAC' } });
    fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '0119998888' } });
    fireEvent.change(within(dialog).getByLabelText('VAT number'), { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add contractor' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      company_name: 'Cool Air',
      trade: 'HVAC',
      default_trade_role: null,
      contact_name: null,
      contact_email: null,
      contact_phone: '0119998888',
      address: null,
      vat_number: null,
      notes: null,
      is_active: true,
    });
    expect(toast.success).toHaveBeenCalledWith('Contractor added');
  });

  it('refuses to save without a company name and shows a write failure inline', async () => {
    create.mockRejectedValueOnce(new Error('Only admins and managers can change the contractor register.'));
    render(<Contractors />);
    fireEvent.click(screen.getByRole('button', { name: /New contractor/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add contractor' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Company name is required.');
    expect(create).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Company name'), { target: { value: 'X' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add contractor' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Only admins and managers can change the contractor register.'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('ContractorSheet through the page', () => {
  it('a row opens the sheet with details, documents (expiry chip) and history', async () => {
    render(<Contractors />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Sparks Electrical' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Sparks Electrical' })).toBeInTheDocument();
    expect(within(dialog).getByText('082 123 4567')).toBeInTheDocument();
    expect(within(dialog).getByText('Public liability')).toBeInTheDocument();
    expect(within(dialog).getByText('expired')).toBeInTheDocument();
    expect(within(dialog).getByRole('tab', { name: 'Issues (1)' })).toBeInTheDocument();
    expect(within(dialog).getByText('Blown DB')).toBeInTheDocument();
  });

  it('Edit inside the sheet reuses the dialog and updates by id', async () => {
    render(<Contractors />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Sparks Electrical' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: /Edit details/ }));
    const form = await screen.findByLabelText('Company name');
    expect(form).toHaveValue('Sparks Electrical');
    fireEvent.change(form, { target: { value: 'Sparks Electrical (Pty) Ltd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', company_name: 'Sparks Electrical (Pty) Ltd', trade: 'Electrical', contact_phone: '082 123 4567', is_active: true }));
  });

  it('the active switch in the sheet calls setActive', async () => {
    render(<Contractors />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Sparks Electrical' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('switch', { name: 'Active' }));
    await waitFor(() => expect(setActive).toHaveBeenCalledWith({ id: 'c1', is_active: false }));
  });
});

describe('filterContractors', () => {
  const rows = [
    contractor({}),
    contractor({ id: 'c2', company_name: 'Flow Plumbing', trade: 'plumbing', contact_name: 'Lerato' }),
    contractor({ id: 'c3', company_name: 'Old Volts', trade: 'Electrical', is_active: false }),
  ];
  it('hides inactive rows unless asked, matches trade case-insensitively and searches several fields', () => {
    expect(filterContractors(rows, { search: '', trade: '__all__', showInactive: false }).map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(filterContractors(rows, { search: '', trade: '__all__', showInactive: true }).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(filterContractors(rows, { search: '', trade: 'Plumbing', showInactive: false }).map((c) => c.id)).toEqual(['c2']);
    expect(filterContractors(rows, { search: 'LERATO', trade: '__all__', showInactive: false }).map((c) => c.id)).toEqual(['c2']);
    expect(filterContractors(rows, { search: '082 123', trade: '__all__', showInactive: true }).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });
});
