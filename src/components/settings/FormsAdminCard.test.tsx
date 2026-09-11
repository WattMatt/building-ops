import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { FormTemplate } from '@/hooks/useFormTemplates';

const hook = vi.hoisted(() => ({
  all: [] as FormTemplate[],
  isLoading: false,
  isError: false,
  update: vi.fn(async () => ({ id: '1', name: 'Key Access Log', version: 3 })),
  setActive: vi.fn(async () => {}),
  reorder: vi.fn(async () => {}),
  isPending: false,
}));

vi.mock('@/hooks/useFormTemplates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useFormTemplates')>();
  return {
    ...actual,
    useFormTemplates: () => ({
      all: hook.all,
      templates: hook.all.filter((t) => t.is_active),
      byId: (id: string) => hook.all.find((t) => t.id === id) ?? null,
      isLoading: hook.isLoading,
      isError: hook.isError,
      refetch: vi.fn(),
    }),
    useFormTemplateMutations: () => ({
      update: hook.update,
      setActive: hook.setActive,
      reorder: hook.reorder,
      isPending: hook.isPending,
    }),
  };
});
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: () => {} }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { FormsAdminCard } from './FormsAdminCard';

const TEMPLATES: FormTemplate[] = [
  { id: '1', name: 'Key Access Log', description: 'Keys', category: 'Security', icon: 'key', fields: [{ label: 'Date', type: 'date' }], is_active: true, sort_order: 1, version: 2, updated_at: '' },
  { id: '2', name: 'Roof Access Journal', description: 'Roof', category: 'Maintenance', icon: 'hard-hat', fields: [], is_active: false, sort_order: 2, version: 1, updated_at: '' },
];

beforeEach(() => {
  hook.all = TEMPLATES.map((t) => ({ ...t, fields: [...t.fields] }));
  hook.isLoading = false;
  hook.isError = false;
  hook.isPending = false;
  hook.update.mockClear();
  hook.setActive.mockClear();
  hook.reorder.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
});

describe('FormsAdminCard', () => {
  it('lists every template, inactive ones included, with the switch reflecting is_active', () => {
    render(<FormsAdminCard />);
    expect(screen.getByText('Key Access Log')).toBeInTheDocument();
    expect(screen.getByText('Roof Access Journal')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Key Access Log active' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Roof Access Journal active' })).toHaveAttribute('aria-checked', 'false');
    expect(within(screen.getByTestId('template-1')).getByText('1 fields · v2')).toBeInTheDocument();
  });

  it('says so when the templates could not be loaded', () => {
    hook.isError = true;
    hook.all = [];
    render(<FormsAdminCard />);
    expect(screen.getByText('Could not load the form templates.')).toBeInTheDocument();
  });

  it('points at the migration when the table is empty', () => {
    hook.all = [];
    render(<FormsAdminCard />);
    expect(screen.getByText(/Apply the R4c migration/)).toBeInTheDocument();
  });

  it('toggling a switch off calls setActive(id, false)', async () => {
    render(<FormsAdminCard />);
    fireEvent.click(screen.getByRole('switch', { name: 'Key Access Log active' }));
    await waitFor(() => expect(hook.setActive).toHaveBeenCalledWith('1', false));
    expect(toast.success).toHaveBeenCalledWith('Key Access Log hidden from the library');
  });

  it('Move down on the first row reorders the ids', async () => {
    render(<FormsAdminCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Key Access Log down' }));
    await waitFor(() => expect(hook.reorder).toHaveBeenCalledWith(['2', '1']));
  });

  it('Move up is disabled on the first row and Move down on the last', () => {
    render(<FormsAdminCard />);
    expect(screen.getByRole('button', { name: 'Move Key Access Log up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Roof Access Journal down' })).toBeDisabled();
  });

  it('Edit opens the dialog with the template prefilled', () => {
    render(<FormsAdminCard />);
    fireEvent.click(within(screen.getByTestId('template-1')).getByRole('button', { name: /Edit/ }));
    expect(screen.getByLabelText('Name')).toHaveValue('Key Access Log');
    expect(screen.getByLabelText('Category')).toHaveValue('Security');
    expect(screen.getByLabelText('Label', { selector: '#f-0-label' })).toHaveValue('Date');
  });

  it('a blank label blocks the save and shows the guardrail', async () => {
    render(<FormsAdminCard />);
    fireEvent.click(within(screen.getByTestId('template-1')).getByRole('button', { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText('Label', { selector: '#f-0-label' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Every field needs a label')).toBeInTheDocument();
    expect(hook.update).not.toHaveBeenCalled();
  });

  it('saves the meta and the normalised fields, and names the new version', async () => {
    render(<FormsAdminCard />);
    fireEvent.click(within(screen.getByTestId('template-1')).getByRole('button', { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Key Issuance Log' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(hook.update).toHaveBeenCalledTimes(1));
    expect(hook.update).toHaveBeenCalledWith('1', {
      name: 'Key Issuance Log',
      description: 'Keys',
      category: 'Security',
      icon: 'key',
      fields: [{ label: 'Date', type: 'date' }],
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Key Access Log saved as version 3'));
  });

  it('Save is disabled until something changes', () => {
    render(<FormsAdminCard />);
    fireEvent.click(within(screen.getByTestId('template-1')).getByRole('button', { name: /Edit/ }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Key Issuance Log' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('surfaces a refused write as its message', async () => {
    hook.update.mockRejectedValueOnce(new Error('Only admins can change form templates.'));
    render(<FormsAdminCard />);
    fireEvent.click(within(screen.getByTestId('template-1')).getByRole('button', { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Key Issuance Log' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only admins can change form templates.'));
  });
});
