import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Report } from '@/integrations/supabase/fortress-db';

const state = vi.hoisted(() => ({
  report: null as Record<string, unknown> | null,
  /** Every reports.update the header sent: payload + the .eq filters it chained. */
  updates: [] as { table: string; payload: Record<string, unknown>; filters: unknown[][] }[],
  updateError: null as { message: string } | null,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock('sonner', () => ({ toast }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useParams: () => ({ id: 'rep1' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isAdmin: false, isAdminOrManager: true }) }));
vi.mock('@/hooks/useOrganization', () => ({
  useOrganization: () => ({ organization: { id: 'o1', name: 'Acme', primary_color: '#2563eb', logo_url: null }, loading: false }),
}));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));
vi.mock('@/hooks/useOrgSettings', () => ({ useFeature: () => false }));
vi.mock('@/hooks/useReportSectionCounts', () => ({ useReportSectionCounts: () => ({ data: undefined }) }));
vi.mock('@/hooks/useFortressReports', () => ({
  useFortressReport: () => ({ data: state.report, isLoading: false }),
  useReportLifecycle: () => ({ mutate: vi.fn(), isPending: false }),
  useDiscardDraft: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/reportArtifacts', () => ({
  listReportArtifactsForSource: async () => ({ data: [], error: null }),
  saveReportArtifact: vi.fn(),
}));
// pdfmake is dragged in at import time by the PDF module; the header saves never reach it.
vi.mock('@/lib/fortressReportPdf', () => ({ generateReportPdf: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/components/reports/fortress/ReportSavedVersions', () => ({ ReportSavedVersions: () => null }));
vi.mock('@/components/reports/fortress/ShareReportDialog', () => ({ ShareReportDialog: () => null }));
vi.mock('@/components/reports/fortress/DiscardDraftDialog', () => ({ DiscardDraftDialog: () => null }));
vi.mock('./sections/registry', () => ({ getSectionComponent: () => undefined }));
// fdb is the same client re-typed, so mocking the client covers fdb.from('reports').update(...).eq(...).
vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => ({
    update: (payload: Record<string, unknown>) => {
      const filters: unknown[][] = [];
      const chain = {
        eq: (...args: unknown[]) => { filters.push(args); return chain; },
        then: (resolve: (r: { error: { message: string } | null }) => unknown) => {
          state.updates.push({ table, payload, filters });
          return Promise.resolve({ error: state.updateError }).then(resolve);
        },
      };
      return chain;
    },
  });
  return { supabase: { from } };
});

import FortressReportEditor from './FortressReportEditor';

const report = (over: Partial<Report> = {}): Report => ({
  id: 'rep1', building_id: 'b1', organization_id: 'o1', report_type: 'ops_monthly', report_period: '2026-09-01',
  title: 'Ops — Test', status: 'draft', author_id: 'u1', author_name: 'Thandi', prepared_for: null,
  asset_manager: null, ops_manager: null, centre_manager: null, cloned_from_report_id: null, inspection_date: null,
  meta: {}, review_notes: null, reviewed_by: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  ...over,
});

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><FortressReportEditor /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.report = report();
  state.updates = [];
  state.updateError = null;
  toast.error.mockClear();
});

describe('FortressReportEditor — manager names in the header', () => {
  it.each([
    ['Asset manager', 'asset_manager'],
    ['Operations manager', 'ops_manager'],
    ['Centre manager', 'centre_manager'],
  ])('saves "%s" on blur as reports.%s, trimmed', async (label, column) => {
    renderEditor();
    const input = screen.getByLabelText(label);
    fireEvent.change(input, { target: { value: '  Naledi Dlamini ' } });
    fireEvent.blur(input);
    await waitFor(() => expect(state.updates).toHaveLength(1));
    expect(state.updates[0]).toEqual({ table: 'reports', payload: { [column]: 'Naledi Dlamini' }, filters: [['id', 'rep1']] });
  });

  it('does not write when the value is unchanged, and writes null when cleared', async () => {
    state.report = report({ asset_manager: 'Thandi M.' });
    renderEditor();
    const input = screen.getByLabelText('Asset manager');
    expect(input).toHaveValue('Thandi M.');
    fireEvent.blur(input);
    expect(state.updates).toHaveLength(0);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    await waitFor(() => expect(state.updates).toHaveLength(1));
    expect(state.updates[0].payload).toEqual({ asset_manager: null });
  });

  it('names the field in the failure toast and restores the saved value', async () => {
    state.report = report({ ops_manager: 'Sipho' });
    state.updateError = { message: 'permission denied' };
    renderEditor();
    const input = screen.getByLabelText('Operations manager');
    fireEvent.change(input, { target: { value: 'Someone Else' } });
    fireEvent.blur(input);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not save “Operations manager”.'));
    await waitFor(() => expect(input).toHaveValue('Sipho'));
  });

  it('prints the names read-only on a locked report, only the ones that are set', () => {
    state.report = report({ status: 'approved', asset_manager: 'Thandi M.', ops_manager: null, centre_manager: 'Naledi', prepared_for: 'Capital Propfund' });
    renderEditor();
    expect(screen.queryByLabelText('Asset manager')).toBeNull();
    expect(screen.getByText('Asset manager: Thandi M.')).toBeInTheDocument();
    expect(screen.getByText('Centre manager: Naledi')).toBeInTheDocument();
    expect(screen.queryByText(/Operations manager/)).toBeNull();
    expect(screen.getByText('Prepared for Capital Propfund')).toBeInTheDocument();
  });
});
