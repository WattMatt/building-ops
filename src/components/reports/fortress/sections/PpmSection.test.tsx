import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PpmServiceRow } from '@/hooks/useReportPpm';
import type { DerivedRow } from '@/lib/ppmGrid';

const state = vi.hoisted(() => ({
  isAdminOrManager: true,
  services: [] as PpmServiceRow[],
  derived: [] as DerivedRow[],
  upsertService: vi.fn(async () => {}),
  removeService: vi.fn(async () => {}),
  setOverride: vi.fn(async () => {}),
  seedFromPlan: vi.fn(async () => ({ added: 2, linked: 0 })),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'u1' } }) }));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useReportPpm', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useReportPpm')>('@/hooks/useReportPpm');
  return {
    ...actual,
    useReportPpm: () => ({
      services: state.services, isLoading: false, derived: state.derived, derivedLoading: false,
      upsertService: state.upsertService, isSaving: false, removeService: state.removeService,
      setOverride: state.setOverride, seedFromPlan: state.seedFromPlan, isSeeding: false,
    }),
  };
});
// Only the report period is read directly: from('reports').select('report_period').eq('id', id).maybeSingle()
vi.mock('@/integrations/supabase/client', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'in']) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: { report_period: '2026-09-01' }, error: null });
  return { supabase: { from: () => chain } };
});

import PpmSection from './PpmSection';

const row = (over: Partial<PpmServiceRow> = {}): PpmServiceRow => ({
  id: 'r1', report_id: 'rep1', building_id: 'b1', service_name: 'Lift service', frequency: 'Monthly on the 1st',
  comment: null, sort_order: 1, months: {}, plan_service_id: 'p1', overrides: {},
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...over,
});

function renderSection(readOnly = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PpmSection reportId="rep1" buildingId="b1" readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.isAdminOrManager = true;
  state.services = [
    row(),
    row({ id: 'r2', service_name: 'Fire equipment', plan_service_id: 'p2', overrides: { '2026-08': { status: 'na', note: 'Extinguishers replaced, no service due', by: 'u9', at: '2026-09-01T00:00:00Z' } } }),
    row({ id: 'r3', service_name: 'Old pest control', plan_service_id: null, sort_order: 3, months: { '2026-07': { status: 'due' } } }),
  ];
  state.derived = [
    { ppm_service_id: 'p1', period_month: '2026-07', status: 'done', done_on: '2026-07-03' },
    { ppm_service_id: 'p1', period_month: '2026-08', status: 'missed' },
    { ppm_service_id: 'p1', period_month: '2026-09', status: 'due' },
    { ppm_service_id: 'p2', period_month: '2026-08', status: 'missed' },
  ];
  state.upsertService.mockClear(); state.setOverride.mockClear(); state.seedFromPlan.mockClear(); state.removeService.mockClear();
});

describe('PpmSection — plan-backed rows', () => {
  it('renders derived cells in the usual colours and an override cell with its chip and note', async () => {
    renderSection();
    const done = await screen.findByRole('button', { name: 'Lift service 2026-07: Done on 2026-07-03' });
    expect(done.className).toContain('bg-emerald-500');
    expect(screen.getByRole('button', { name: 'Lift service 2026-08: Missed' }).className).toContain('bg-destructive');
    expect(screen.getByRole('button', { name: 'Lift service 2026-10: No occurrence' })).toBeInTheDocument();
    const overridden = screen.getByRole('button', { name: /Fire equipment 2026-08: N\/A \(override — execution says Missed\): Extinguishers replaced/ });
    expect(overridden.className).toContain('bg-muted');
    expect(within(overridden).getByTestId('override-chip')).toBeInTheDocument();
    // plan-backed rows show their name as text, not an input; the frequency comes from the plan
    expect(screen.queryByDisplayValue('Lift service')).toBeNull();
    expect(screen.getAllByText('Monthly on the 1st').length).toBeGreaterThan(0);
  });

  it('a cell popover saves an override with a required note, or keeps the derived value', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Lift service 2026-08: Missed' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Execution says: Missed')).toBeInTheDocument();
    const save = within(dialog).getByRole('button', { name: 'Save override' });
    expect(save).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(save).toBeDisabled(); // still no note
    fireEvent.change(within(dialog).getByLabelText('Why (required)'), { target: { value: 'Serviced under warranty' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(state.setOverride).toHaveBeenCalledWith('r1', '2026-08', { status: 'done', note: 'Serviced under warranty' }));
    expect(within(dialog).getByRole('button', { name: 'Keep derived (Missed)' })).toBeDisabled(); // nothing to clear yet
  });

  it('"Keep derived" clears an existing override', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /Fire equipment 2026-08: N\/A/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Why (required)')).toHaveValue('Extinguishers replaced, no service due');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep derived (Missed)' }));
    await waitFor(() => expect(state.setOverride).toHaveBeenCalledWith('r2', '2026-08', null));
  });

  it('never cycles a plan-backed cell through months', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Lift service 2026-09: Due' }));
    await screen.findByRole('dialog');
    expect(state.upsertService).not.toHaveBeenCalled();
  });

  it('counts K11 from the merged grid: derived done, override done and legacy done all count', async () => {
    state.services[2] = row({ id: 'r3', service_name: 'Old pest control', plan_service_id: null, months: { '2026-07': { status: 'done' } } });
    renderSection();
    // r1 has a derived done (Jul); r2 has only missed + an N/A override; r3 legacy done → 2 of 3
    expect(await screen.findByText('3 services · 2/3 serviced')).toBeInTheDocument();
  });

  it('read-only renders the cells as images, no popover, note still in the title', async () => {
    renderSection(true);
    const cell = await screen.findByRole('img', { name: /Fire equipment 2026-08: N\/A \(override/ });
    expect(cell).toHaveAttribute('title', expect.stringContaining('Extinguishers replaced'));
    expect(screen.queryByRole('button', { name: /Lift service 2026-07/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Sync with the PPM plan/ })).toBeNull();
  });
});

describe('PpmSection — legacy rows', () => {
  it('keeps the click-cycling on months for rows without a plan line', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Old pest control 2026-07: Due' }));
    expect(state.upsertService).toHaveBeenCalledWith(expect.objectContaining({
      id: 'r3', service_name: 'Old pest control', months: { '2026-07': { status: 'done' } },
    }));
    expect(state.setOverride).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Old pest control')).toBeInTheDocument(); // name stays editable
  });
});

describe('PpmSection — syncing with the plan', () => {
  it('admins and managers can sync the report with the building plan', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /Sync with the PPM plan/ }));
    expect(state.seedFromPlan).toHaveBeenCalledTimes(1);
  });

  it('offers the sync in the empty state', async () => {
    state.services = [];
    renderSection();
    expect(await screen.findByText('No services on this report yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sync with the PPM plan/ })).toBeInTheDocument();
  });

  it('hides the sync from site users', async () => {
    state.isAdminOrManager = false;
    renderSection();
    await screen.findByRole('button', { name: 'Lift service 2026-09: Due' });
    expect(screen.queryByRole('button', { name: /Sync with the PPM plan/ })).toBeNull();
  });
});

/** The mocked upsertService takes no typed params; read its first call's payload untyped. */
const firstUpsertPayload = () => (state.upsertService.mock.calls as unknown[][])[0][0] as Record<string, unknown>;

describe('PpmSection — text edits and months', () => {
  it('a plan-backed row\'s comment edit sends no months (its grid is derived + overrides)', async () => {
    renderSection();
    await screen.findByRole('button', { name: 'Lift service 2026-09: Due' });
    const comment = screen.getAllByPlaceholderText('Comment')[0]; // r1, plan-backed
    fireEvent.change(comment, { target: { value: 'Contractor changed' } });
    fireEvent.blur(comment);
    await waitFor(() => expect(state.upsertService).toHaveBeenCalledTimes(1));
    const payload = firstUpsertPayload();
    expect(payload).toMatchObject({ id: 'r1', service_name: 'Lift service', comment: 'Contractor changed' });
    expect('months' in payload).toBe(false);
  });

  it('a legacy row\'s text edit still carries its months', async () => {
    renderSection();
    await screen.findByRole('button', { name: 'Lift service 2026-09: Due' });
    const comment = screen.getAllByPlaceholderText('Comment')[2]; // r3, legacy
    fireEvent.change(comment, { target: { value: 'Quarterly' } });
    fireEvent.blur(comment);
    await waitFor(() => expect(state.upsertService).toHaveBeenCalledTimes(1));
    expect(firstUpsertPayload()).toMatchObject({ id: 'r3', comment: 'Quarterly', months: { '2026-07': { status: 'due' } } });
  });
});
