import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DEFAULT_ORG_SETTINGS, type OrgSettings } from '@/lib/orgSettings';

// Populated in beforeEach: a hoisted block runs before the imports above are initialised.
const hook = vi.hoisted(() => ({ save: vi.fn(async (n: unknown) => n), settings: undefined as unknown as OrgSettings, isLoading: false, isError: false, isSaving: false }));
vi.mock('@/hooks/useOrgSettings', () => ({ useOrgSettings: () => ({ settings: hook.settings, isLoading: hook.isLoading, isSaving: hook.isSaving, save: hook.save, organizationId: 'o1', isError: hook.isError }) }));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: () => {} }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { FeatureFlagsCard } from './FeatureFlagsCard';

beforeEach(() => { hook.save.mockClear(); hook.settings = DEFAULT_ORG_SETTINGS; hook.isLoading = false; hook.isError = false; });

describe('FeatureFlagsCard', () => {
  it('renders one switch per feature, off by default', () => {
    render(<FeatureFlagsCard canEdit />);
    expect(screen.getAllByRole('switch')).toHaveLength(3);
    expect(screen.getByRole('switch', { name: 'Share links' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Changes save immediately/)).toBeInTheDocument();
  });
  it('saves the whole settings object with the toggled flag', async () => {
    render(<FeatureFlagsCard canEdit />);
    fireEvent.click(screen.getByRole('switch', { name: 'Tenant intake' }));
    await waitFor(() => expect(hook.save).toHaveBeenCalledTimes(1));
    expect(hook.save.mock.calls[0][0]).toEqual({ ...DEFAULT_ORG_SETTINGS, features: { ...DEFAULT_ORG_SETTINGS.features, tenant_intake: true } });
  });
  it('is read-only without canEdit', () => {
    render(<FeatureFlagsCard canEdit={false} />);
    for (const s of screen.getAllByRole('switch')) expect(s).toBeDisabled();
  });
  it('locks the switches while the settings are loading, without the load-error line', () => {
    hook.isLoading = true;
    render(<FeatureFlagsCard canEdit />);
    for (const s of screen.getAllByRole('switch')) expect(s).toBeDisabled();
    expect(screen.queryByText('Settings could not be loaded')).not.toBeInTheDocument();
  });
  it('says so and locks every switch when the settings could not be loaded', () => {
    hook.isError = true;
    render(<FeatureFlagsCard canEdit />);
    expect(screen.getByText('Settings could not be loaded')).toBeInTheDocument();
    for (const s of screen.getAllByRole('switch')) expect(s).toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Tenant intake' }));
    expect(hook.save).not.toHaveBeenCalled();
  });
});
