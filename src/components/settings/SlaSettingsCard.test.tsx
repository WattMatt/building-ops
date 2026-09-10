import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DEFAULT_ORG_SETTINGS, type OrgSettings } from '@/lib/orgSettings';

// One stable settings object per test: the card re-syncs its draft whenever `settings.sla_hours` changes
// identity, so a fresh object on every render would wipe what the test typed.
const state = vi.hoisted(() => ({
  settings: null as unknown as OrgSettings,
  isLoading: false,
  isSaving: false,
  save: vi.fn(),
}));
vi.mock('@/hooks/useOrgSettings', () => ({
  useOrgSettings: () => ({
    settings: state.settings,
    organizationId: 'org1',
    isLoading: state.isLoading,
    isError: false,
    save: state.save,
    isSaving: state.isSaving,
  }),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));

import { SlaSettingsCard } from './SlaSettingsCard';

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe('SlaSettingsCard', () => {
  beforeEach(() => {
    state.settings = structuredClone(DEFAULT_ORG_SETTINGS);
    state.isLoading = false;
    state.isSaving = false;
    state.save = vi.fn().mockImplementation(async (next: OrgSettings) => next);
    toast.success.mockClear();
    toast.error.mockClear();
  });

  it('renders the four priorities pre-filled with the defaults', () => {
    render(<SlaSettingsCard canEdit />);
    expect(input('Critical (hours)').value).toBe('4');
    expect(input('High (hours)').value).toBe('24');
    expect(input('Medium (hours)').value).toBe('72');
    expect(input('Low (hours)').value).toBe('168');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.queryByText(/whole number of hours/)).not.toBeInTheDocument();
  });

  it('rejects an out-of-range value and disables Save until it is fixed', () => {
    render(<SlaSettingsCard canEdit />);
    fireEvent.change(input('Critical (hours)'), { target: { value: '0' } });
    expect(screen.getByText(/whole number of hours from 1 to 8760/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(input('Critical (hours)'), { target: { value: '3' } });
    expect(screen.queryByText(/whole number of hours/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('saves the edited hours with the rest of the settings untouched', async () => {
    render(<SlaSettingsCard canEdit />);
    fireEvent.change(input('Critical (hours)'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
    expect(state.save).toHaveBeenCalledWith({
      ...DEFAULT_ORG_SETTINGS,
      sla_hours: { critical: 2, high: 24, medium: 72, low: 168 },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('reports a failed save without throwing', async () => {
    state.save = vi.fn().mockRejectedValue(new Error('rls'));
    render(<SlaSettingsCard canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not save the SLA hours.'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('is read-only without canEdit: inputs disabled, no Save button', () => {
    render(<SlaSettingsCard canEdit={false} />);
    expect(input('Critical (hours)')).toBeDisabled();
    expect(input('Low (hours)')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});
