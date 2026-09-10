import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// recharts measures its container; in jsdom that is 0×0, so stub the components and only keep the tree.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div data-testid="chart">{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Line: () => null,
  ReferenceLine: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const state = vi.hoisted(() => ({
  portfolioDays: [] as number[],
  buildingsDays: [] as number[],
}));

const snap = (building_id: string, day: string, compliance_pct: number) => ({
  building_id, day, compliance_pct, critical_pct: null, inspection_pass_pct: null, compliance_period: null, ohs_open_nc: null, ppm_done_pct: null,
  task_completion_30d_pct: null, tasks_overdue: 0, tasks_due_7d: 0, issues_open: 0, issues_open_by_priority: null, issues_breached: 0, issues_resolved_30d: 0,
  docs_expiring_30: 0, docs_expiring_60: 0, docs_expiring_90: 0, docs_expired: 0, assets_overdue: 0, report_state: null, reconstructed: false, computed_at: `${day}T03:00:00Z`,
});
const portfolioRow = (day: string, reconstructed: boolean) => ({
  day, buildings: 2, compliance_avg: '75.5', critical_avg: null, inspection_pass_avg: null, ppm_done_avg: null, task_completion_avg: null,
  tasks_overdue: 1, tasks_due_7d: 0, issues_open: 3, issues_breached: 0, issues_resolved_30d: 0, docs_expiring_30: 2, docs_expiring_60: 0, docs_expiring_90: 0,
  docs_expired: 0, assets_overdue: 0, contractor_docs_expiring_30: 0, contractor_docs_expiring_60: 0, contractor_docs_expiring_90: 0, contractor_docs_expired: 0, reconstructed,
});

vi.mock('@/hooks/usePortfolioTrend', () => ({
  usePortfolioTrend: (days: number) => {
    state.portfolioDays.push(days);
    return { data: [portfolioRow('2026-09-08', true), portfolioRow('2026-09-09', false), portfolioRow('2026-09-10', false)], isLoading: false, isError: false };
  },
}));
vi.mock('@/hooks/useBuildingTrend', () => ({
  useBuildingsTrends: (days: number) => {
    state.buildingsDays.push(days);
    return {
      rows: {
        up: [snap('up', '2026-09-08', 60), snap('up', '2026-09-10', 72.4)],
        down: [snap('down', '2026-09-08', 90), snap('down', '2026-09-10', 85)],
      },
      byBuilding: {},
      isLoading: false,
    };
  },
}));
vi.mock('@/integrations/supabase/client', () => {
  const query = { select: vi.fn(), order: vi.fn() };
  query.select.mockReturnValue(query);
  query.order.mockResolvedValue({ data: [{ id: 'up', name: 'Alpha Mall' }, { id: 'down', name: 'Beta Centre' }], error: null });
  return { supabase: { from: vi.fn(() => query) } };
});
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));
vi.mock('@/lib/exportCsv', () => ({ exportCsv: vi.fn() }));

import Trends from './Trends';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Trends /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.portfolioDays = [];
  state.buildingsDays = [];
});

describe('Trends', () => {
  it('renders the four portfolio charts and names the reconstruction boundary', () => {
    renderPage();
    expect(screen.getByText('OHS compliance (portfolio average)')).toBeInTheDocument();
    expect(screen.getByText('Open issues')).toBeInTheDocument();
    expect(screen.getByText('Overdue tasks')).toBeInTheDocument();
    expect(screen.getByText('Documents expiring within 30 days')).toBeInTheDocument();
    expect(screen.getAllByTestId('chart')).toHaveLength(4);
    expect(screen.getByText(/Days before 2026-09-09 were reconstructed/)).toBeInTheDocument();
  });

  it('lists the biggest movers with their change', async () => {
    renderPage();
    expect(screen.getByText('Improved')).toBeInTheDocument();
    expect(screen.getByText('+12.4')).toBeInTheDocument();
    expect(screen.getByText('-5')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('ALPHA MALL')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'ALPHA MALL' })).toHaveAttribute('href', '/buildings/up');
  });

  it('re-queries both hooks when the range changes', () => {
    renderPage();
    expect(state.portfolioDays[0]).toBe(90);
    expect(state.buildingsDays[0]).toBe(90);
    fireEvent.click(screen.getByRole('button', { name: '365 d' }));
    expect(state.portfolioDays).toContain(365);
    expect(state.buildingsDays).toContain(365);
    expect(screen.getByRole('button', { name: '365 d' })).toHaveAttribute('aria-pressed', 'true');
  });
});
