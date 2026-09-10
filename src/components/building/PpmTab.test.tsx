import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BuildingPpmLine } from '@/hooks/useBuildingPpm';
import type { RecurrenceRule } from '@/lib/recurrence';

const state = vi.hoisted(() => ({
  isAdminOrManager: true,
  lines: [] as BuildingPpmLine[],
  derived: [] as { ppm_service_id: string; period_month: string; status: string; done_on?: string | null }[],
  createLine: vi.fn(async () => 'new'),
  updateLine: vi.fn(async () => {}),
  setActive: vi.fn(async () => {}),
  generateNow: vi.fn(async () => 3),
  exportCsv: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'u1' } }) }));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));
vi.mock('@/lib/myWork', () => ({ todayInOperatingTz: () => '2026-09-10' }));
vi.mock('@/lib/exportCsv', () => ({ exportCsv: state.exportCsv }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useBuildingPpm', () => ({
  useBuildingPpm: () => ({
    lines: state.lines, isLoading: false, isError: false, error: null,
    createLine: state.createLine, updateLine: state.updateLine, setActive: state.setActive, isSaving: false,
    generateNow: state.generateNow, isGenerating: false, derived: state.derived, derivedLoading: false,
  }),
}));
// The picker has its own tests; a plain select stands in so onChange can be driven.
vi.mock('@/components/contractors/ContractorPicker', () => ({
  ContractorPicker: ({ value, onChange, 'aria-label': label }: { value: string | null; onChange: (id: string | null) => void; 'aria-label'?: string }) => (
    <select aria-label={label ?? 'Contractor'} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">None</option>
      <option value="c1">Otis</option>
    </select>
  ),
}));
// The editor has its own tests; here two buttons emit a month rule and a week rule.
vi.mock('@/components/checklists/RecurrenceEditor', async () => {
  const actual = await vi.importActual<typeof import('@/components/checklists/RecurrenceEditor')>('@/components/checklists/RecurrenceEditor');
  return {
    ...actual,
    default: ({ value, onChange }: { value: RecurrenceRule; onChange: (r: RecurrenceRule, ok: boolean) => void }) => (
      <div>
        <span data-testid="rule">{JSON.stringify(value)}</span>
        <button type="button" onClick={() => onChange({ every: 3, unit: 'month', monthDay: 'last' }, true)}>quarterly</button>
        <button type="button" onClick={() => onChange({ every: 1, unit: 'week', weekdays: [1] }, true)}>weekly</button>
      </div>
    ),
  };
});
// The tab reads contractor names off the shared register query (the one the picker holds).
vi.mock('@/hooks/useContractors', () => ({
  useContractors: () => ({
    contractors: [{ id: 'c1', company_name: 'Otis', trade: 'Lifts', is_active: true }],
    isLoading: false,
    isError: false,
  }),
}));

import PpmTab from './PpmTab';

const line = (over: Partial<BuildingPpmLine> = {}): BuildingPpmLine => ({
  id: 'p1', building_id: 'b1', service_name: 'Lift service', contractor_id: 'c1',
  recurrence: { every: 1, unit: 'month', monthDay: 1 }, sort_order: 0, is_active: true, notes: null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...over,
});

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={qc}><PpmTab buildingId="b1" /></QueryClientProvider>), qc };
}

beforeEach(() => {
  state.isAdminOrManager = true;
  state.lines = [line(), line({ id: 'p2', service_name: 'Fire equipment', recurrence: { every: 1, unit: 'year', month: 3, monthDay: 15 }, is_active: false, sort_order: 1 })];
  state.derived = [
    { ppm_service_id: 'p1', period_month: '2026-08', status: 'done', done_on: '2026-08-12' },
    { ppm_service_id: 'p1', period_month: '2026-09', status: 'due' },
  ];
  state.createLine.mockClear(); state.updateLine.mockClear(); state.setActive.mockClear();
  state.generateNow.mockClear(); state.exportCsv.mockClear();
});

describe('PpmTab — plan lines', () => {
  it('lists each line with its cadence in words, and dims inactive lines', () => {
    renderTab();
    expect(screen.getAllByText('Lift service').length).toBeGreaterThan(0);
    expect(screen.getByText('Monthly on the 1st')).toBeInTheDocument();
    expect(screen.getByText('Yearly on 15 Mar')).toBeInTheDocument();
    expect(screen.getByText('2 services · 1 inactive')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Fire equipment active' })).toHaveAttribute('aria-checked', 'false');
  });

  it('the active switch and the contractor picker write through the hook', () => {
    renderTab();
    fireEvent.click(screen.getByRole('switch', { name: 'Lift service active' }));
    expect(state.setActive).toHaveBeenCalledWith('p1', false);
    fireEvent.change(screen.getByRole('combobox', { name: 'Contractor for Lift service' }), { target: { value: '' } });
    expect(state.updateLine).toHaveBeenCalledWith('p1', { contractor_id: null });
  });

  it('Generate now runs generation for the building', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Generate now/ }));
    expect(state.generateNow).toHaveBeenCalledTimes(1);
  });

  it('Export CSV hands the plan lines to the shared exporter with cadence and contractor columns', () => {
    renderTab();
    type Col = { key: string; header: string; format?: (v: unknown) => string };
    // The contractor column resolves names through `useContractors` (mocked above), not a query of its own.
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    expect(state.exportCsv).toHaveBeenCalledTimes(1);
    const [rows, columns, filename] = state.exportCsv.mock.calls[0] as unknown as [BuildingPpmLine[], Col[], string];
    expect(columns[2].format!('c1')).toBe('Otis');
    expect(rows).toHaveLength(2);
    expect(columns.map((c) => c.header)).toEqual(['Service', 'Cadence', 'Contractor', 'Active', 'Notes']);
    expect(columns[1].format!(rows[0].recurrence)).toBe('Monthly on the 1st');
    expect(columns[2].format!(null)).toBe('');
    expect(columns[3].format!(false)).toBe('No');
    expect(filename).toBe('ppm-plan-b1.csv');
  });

  it('hides the write controls from site users', async () => {
    state.isAdminOrManager = false;
    renderTab();
    expect(screen.queryByRole('button', { name: /Add service/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Generate now/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Lift service' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Lift service active' })).toBeDisabled();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(await screen.findAllByText('Otis')).toHaveLength(2);
  });

  it('shows the hint about nightly generation', () => {
    renderTab();
    expect(screen.getByText(/generated every night for the next year/)).toBeInTheDocument();
  });
});

describe('PpmTab — add service sheet', () => {
  it('creates a line with the name, rule, contractor and notes, sorted after the existing ones', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add service/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Service'), { target: { value: 'Generator service' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'quarterly' }));
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Contractor' }), { target: { value: 'c1' } });
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: 'Load test' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add service' }));
    await waitFor(() => expect(state.createLine).toHaveBeenCalledTimes(1));
    expect(state.createLine).toHaveBeenCalledWith({
      service_name: 'Generator service', recurrence: { every: 3, unit: 'month', monthDay: 'last' },
      contractor_id: 'c1', notes: 'Load test', sort_order: 2,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('refuses a weekly rule with a plain message and keeps Save disabled', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add service/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Service'), { target: { value: 'Pest control' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'weekly' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('PPM services repeat monthly or yearly. Choose months or years.');
    expect(within(dialog).getByRole('button', { name: 'Add service' })).toBeDisabled();
    expect(state.createLine).not.toHaveBeenCalled();
  });

  it('refuses a duplicate service name for the building', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add service/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Service'), { target: { value: 'lift service' } });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('A service with that name already exists for this building');
    expect(within(dialog).getByRole('button', { name: 'Add service' })).toBeDisabled();
  });

  it('editing a line saves through updateLine with the existing values seeded, and says the reschedule is immediate', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Lift service' }));
    const dialog = await screen.findByRole('dialog');
    // The _05 trigger reschedules synchronously; the sheet must not promise "from tonight".
    expect(within(dialog).getByText('Future untouched occurrences are rescheduled now.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/from tonight/)).toBeNull();
    expect(within(dialog).getByLabelText('Service')).toHaveValue('Lift service');
    expect(within(dialog).getByTestId('rule')).toHaveTextContent('"unit":"month"');
    fireEvent.change(within(dialog).getByLabelText('Service'), { target: { value: 'Lift service (Otis)' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.updateLine).toHaveBeenCalledWith('p1', {
      service_name: 'Lift service (Otis)', recurrence: { every: 1, unit: 'month', monthDay: 1 }, contractor_id: 'c1', notes: null,
    }));
  });
});

describe('PpmTab — derived grid', () => {
  it('renders the fiscal-year grid from the view, read-only, with the shared status colours', () => {
    renderTab();
    expect(screen.getByText('Fiscal year 2026/27')).toBeInTheDocument();
    const grid = screen.getByRole('table', { name: 'PPM month grid' });
    const done = within(grid).getByRole('img', { name: 'Lift service 2026-08: Done on 2026-08-12' });
    expect(done.className).toContain('bg-emerald-500');
    expect(done).toHaveTextContent('✓');
    expect(within(grid).getByRole('img', { name: 'Lift service 2026-09: Due' }).className).toContain('bg-amber-400');
    expect(within(grid).getByRole('img', { name: 'Lift service 2026-10: No occurrence' })).toBeInTheDocument();
    expect(within(grid).queryAllByRole('button')).toHaveLength(0);
    // a11y: column headers and the service-name row header are real headers
    expect(within(grid).getByRole('columnheader', { name: 'Service' })).toHaveAttribute('scope', 'col');
    expect(within(grid).getByRole('rowheader', { name: 'Lift service' })).toHaveAttribute('scope', 'row');
    // the shared legend explains a blank as "No occurrence" and offers no override entry
    const legend = screen.getByTestId('ppm-legend');
    expect(legend).toHaveTextContent('No occurrence');
    expect(legend).not.toHaveTextContent('Override');
  });

  it('a month with several occurrences reads Missed when one was missed, and the title says how many', () => {
    state.derived = [
      { ppm_service_id: 'p1', period_month: '2026-08', status: 'done', done_on: '2026-08-12' },
      { ppm_service_id: 'p1', period_month: '2026-08', status: 'missed' },
    ];
    renderTab();
    const grid = screen.getByRole('table', { name: 'PPM month grid' });
    const cell = within(grid).getByRole('img', { name: 'Lift service 2026-08: Missed (2 occurrences: 1 done, 1 missed)' });
    expect(cell.className).toContain('bg-destructive');
  });

  it('shows the empty state without a grid when the plan is empty', () => {
    state.lines = [];
    renderTab();
    expect(screen.getByText('No PPM services planned for this building yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'PPM month grid' })).toBeNull();
    expect(screen.getByRole('button', { name: /Add the first service/ })).toBeInTheDocument();
  });
});
