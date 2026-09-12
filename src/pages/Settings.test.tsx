// src/pages/Settings.test.tsx
/**
 * The logo control on the Branding tab. SVG used to be accepted and recommended (and WebP
 * accepted), but pdfmake embeds only PNG and JPEG, so every report PDF silently printed without
 * the logo (Task 3 now skips it with a warning). Settings must stop offering both and say why.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
// Typed parameters so `upload.mock.calls[0][0]` below is not indexing an empty tuple.
const storage = vi.hoisted(() => ({
  upload: vi.fn(async (_path: string, _file: File, _opts?: { upsert?: boolean }) => ({ error: null as { message: string } | null })),
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdmin: true, isAdminOrManager: true, user: { id: 'u1' } }) }));
vi.mock('@/hooks/useOrganization', () => ({
  useOrganization: () => ({ organization: { id: 'o1', name: 'Fortress', email: 'ops@example.com', logo_url: null, primary_color: '#2563eb' }, loading: false }),
}));
vi.mock('@/hooks/useOrgSettings', () => ({ useFeature: () => false }));
vi.mock('@/components/settings/SlaSettingsCard', () => ({ SlaSettingsCard: () => null }));
vi.mock('@/components/settings/ReportDueDayCard', () => ({ ReportDueDayCard: () => null }));
vi.mock('@/components/settings/FeatureFlagsCard', () => ({ FeatureFlagsCard: () => null }));
vi.mock('@/components/settings/ReportDistributionCard', () => ({ ReportDistributionCard: () => null }));
vi.mock('@/components/settings/FormsAdminCard', () => ({ FormsAdminCard: () => null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: { from: () => ({ upload: storage.upload, getPublicUrl: (p: string) => ({ data: { publicUrl: `https://x/${p}` } }) }) },
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  },
}));

import Settings from './Settings';

const HELPER = 'Recommended: 200x200px, PNG or JPEG. SVG and WebP logos cannot be printed into PDF reports.';
const REJECTED = 'Please upload a PNG or JPEG image. SVG and WebP logos cannot be printed into PDF reports.';

/** Radix Tabs activate on mouse-down, not click. */
const openBranding = () => fireEvent.mouseDown(screen.getByRole('tab', { name: /branding/i }), { button: 0 });
const logoInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

beforeEach(() => {
  toast.success.mockClear();
  toast.error.mockClear();
  storage.upload.mockClear();
});

describe('Settings — logo upload', () => {
  it('recommends PNG or JPEG, says SVG and WebP cannot print, and accepts only PNG and JPEG in the picker', () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    openBranding();
    expect(screen.getByText(HELPER)).toBeInTheDocument();
    expect(screen.queryByText(/PNG or SVG/)).not.toBeInTheDocument();
    expect(logoInput()).toHaveAttribute('accept', 'image/png,image/jpeg');
  });

  it('refuses an SVG file with the same explanation and never uploads it', async () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    openBranding();
    fireEvent.change(logoInput(), { target: { files: [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REJECTED));
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('refuses a WebP file the same way (pdfmake embeds only PNG and JPEG)', async () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    openBranding();
    fireEvent.change(logoInput(), { target: { files: [new File(['webp'], 'logo.webp', { type: 'image/webp' })] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REJECTED));
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('still uploads a PNG', async () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    openBranding();
    fireEvent.change(logoInput(), { target: { files: [new File(['png'], 'logo.png', { type: 'image/png' })] } });
    await waitFor(() => expect(storage.upload).toHaveBeenCalledTimes(1));
    expect(storage.upload.mock.calls[0][0]).toMatch(/^logos\/org-logo-\d+\.png$/);
    expect(toast.success).toHaveBeenCalledWith('Logo uploaded and saved successfully');
  });
});
