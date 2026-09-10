import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DEFAULT_ORG_SETTINGS, type OrgSettings } from '@/lib/orgSettings';

// Populated in beforeEach: a hoisted block runs before the imports above are initialised.
const hook = vi.hoisted(() => ({ save: vi.fn(async (n: unknown) => n), settings: undefined as unknown as OrgSettings, isLoading: false, isSaving: false }));
vi.mock('@/hooks/useOrgSettings', () => ({ useOrgSettings: () => ({ settings: hook.settings, isLoading: hook.isLoading, isSaving: hook.isSaving, save: hook.save, organizationId: 'o1', isError: false }) }));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: () => {} }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ReportDueDayCard } from './ReportDueDayCard';

const input = () => screen.getByLabelText('Day of the following month (1–28)') as HTMLInputElement;

beforeEach(() => { hook.save.mockClear(); hook.settings = { ...DEFAULT_ORG_SETTINGS, report_due_day: 9 }; });

describe('ReportDueDayCard', () => {
  it('renders the current due day', () => {
    render(<ReportDueDayCard canEdit />);
    expect(input().value).toBe('9');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
  it('an out-of-range day shows the validation line and disables Save', () => {
    render(<ReportDueDayCard canEdit />);
    fireEvent.change(input(), { target: { value: '0' } });
    expect(screen.getByText('Enter a whole number from 1 to 28.')).toBeInTheDocument();
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(hook.save).not.toHaveBeenCalled();
  });
  it('saves the whole settings object with the new day', async () => {
    render(<ReportDueDayCard canEdit />);
    fireEvent.change(input(), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(hook.save).toHaveBeenCalledTimes(1));
    expect(hook.save.mock.calls[0][0]).toEqual({ ...hook.settings, report_due_day: 12 });
  });
  it('is read-only without canEdit', () => {
    render(<ReportDueDayCard canEdit={false} />);
    expect(input()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
