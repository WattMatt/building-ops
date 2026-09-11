import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// recharts measures its container; in jsdom that is 0×0, so stub the components, keep the tree and
// record the props the axis/line were given so the wiring (not the drawing) is under test.
const charts = vi.hoisted(() => ({ chart: [] as Record<string, unknown>[], line: [] as Record<string, unknown>[], xAxis: [] as Record<string, unknown>[], yAxis: [] as Record<string, unknown>[], grid: [] as Record<string, unknown>[], tooltip: [] as Record<string, unknown>[], refLine: [] as Record<string, unknown>[] }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div data-testid="chart">{children}</div>,
  LineChart: ({ children, ...p }: { children: ReactNode }) => { charts.chart.push(p); return <div>{children}</div>; },
  CartesianGrid: (p: Record<string, unknown>) => { charts.grid.push(p); return null; },
  Line: (p: Record<string, unknown>) => { charts.line.push(p); return null; },
  ReferenceLine: (p: Record<string, unknown>) => { charts.refLine.push(p); return null; },
  Tooltip: (p: Record<string, unknown>) => { charts.tooltip.push(p); return null; },
  XAxis: (p: Record<string, unknown>) => { charts.xAxis.push(p); return null; },
  YAxis: (p: Record<string, unknown>) => { charts.yAxis.push(p); return null; },
}));

const state = vi.hoisted(() => ({
  portfolioDays: [] as number[],
  buildingsDays: [] as number[],
  portfolio: { data: [] as unknown[], isLoading: false, isError: false },
}));

const snap = (building_id: string, day: string, compliance_pct: number) => ({
  building_id, day, compliance_pct, task_completion_30d_pct: null, tasks_overdue: 0, issues_open: 0, issues_breached: 0, docs_expiring_30: 0, reconstructed: false, computed_at: `${day}T03:00:00Z`,
});
const portfolioRow = (day: string, reconstructed: boolean, over: Record<string, unknown> = {}) => ({
  day, buildings: 2, compliance_avg: '75.5', critical_avg: null, inspection_pass_avg: null, ppm_done_avg: null, task_completion_avg: null,
  tasks_overdue: 1, tasks_due_7d: 0, issues_open: 3, issues_breached: 0, issues_resolved_30d: 0, docs_expiring_30: 2, docs_expiring_60: 0, docs_expiring_90: 0,
  docs_expired: 0, assets_overdue: 0, contractor_docs_expiring_30: 5, contractor_docs_expiring_60: 0, contractor_docs_expiring_90: 0, contractor_docs_expired: 0, reconstructed, ...over,
});

vi.mock('@/hooks/usePortfolioTrend', () => ({
  usePortfolioTrend: (days: number) => { state.portfolioDays.push(days); return state.portfolio; },
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
      latest: {},
      isLoading: false,
    };
  },
}));
vi.mock('@/hooks/useBuildingNames', () => ({
  useBuildingNames: () => ({ data: [{ id: 'up', name: 'Alpha Mall' }, { id: 'down', name: 'Beta Centre' }], isLoading: false }),
}));
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
  state.portfolio = { data: [portfolioRow('2026-09-08', true), portfolioRow('2026-09-09', false), portfolioRow('2026-09-10', false)], isLoading: false, isError: false };
  for (const k of Object.keys(charts) as (keyof typeof charts)[]) charts[k] = [];
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
    expect(screen.queryByText(/All days in this range were reconstructed/)).not.toBeInTheDocument();
  });

  it('wires the charts: full-day x key with a MM-DD tick, 0–100 for the percentage only, gaps not bridged, theme-aware grid and tooltip', () => {
    renderPage();
    expect(charts.line).toHaveLength(4);
    expect(charts.line.every((p) => p.dataKey === 'value' && p.connectNulls === false)).toBe(true);
    // The axis is keyed on the full ISO day (so 2025-09-10 and 2026-09-10 never collide); the tick shortens it.
    expect(charts.xAxis.every((p) => p.dataKey === 'day')).toBe(true);
    expect((charts.xAxis[0].tickFormatter as (d: string) => string)('2026-09-10')).toBe('09-10');
    expect(charts.yAxis.map((p) => p.domain)).toEqual([[0, 100], ['auto', 'auto'], ['auto', 'auto'], ['auto', 'auto']]);
    // The boundary marker sits on the same full-day key.
    expect(charts.refLine.map((p) => p.x)).toEqual(['2026-09-09', '2026-09-09', '2026-09-09', '2026-09-09']);
    expect(charts.grid.every((p) => p.className === 'stroke-muted')).toBe(true);
    expect(charts.tooltip.every((p) => typeof (p.contentStyle as Record<string, unknown>)?.backgroundColor === 'string')).toBe(true);
  });

  it('plots building and contractor documents together on the expiring-documents chart', () => {
    state.portfolio = {
      data: [
        portfolioRow('2026-09-08', false),
        portfolioRow('2026-09-09', false, { docs_expiring_30: null, contractor_docs_expiring_30: 4 }),
        portfolioRow('2026-09-10', false, { docs_expiring_30: null, contractor_docs_expiring_30: null }),
      ],
      isLoading: false, isError: false,
    };
    renderPage();
    const values = (i: number) => (charts.chart[i].data as { day: string; value: number | null }[]).map((d) => d.value);
    // Chart order follows the titles: compliance, open issues, overdue tasks, documents.
    expect(values(0)).toEqual([75.5, 75.5, 75.5]);
    expect(values(1)).toEqual([3, 3, 3]);
    // 2 building + 5 contractor; a null on one side is not a gap; both null is.
    expect(values(3)).toEqual([7, 4, null]);
  });

  it('says so when every day in the range is a reconstruction', () => {
    state.portfolio = { data: [portfolioRow('2026-09-08', true), portfolioRow('2026-09-09', true)], isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText(/All days in this range were reconstructed/)).toBeInTheDocument();
    expect(screen.queryByText(/Days before/)).not.toBeInTheDocument();
    expect(charts.refLine).toHaveLength(0);
  });

  it('shows a skeleton while loading, not the "no snapshots yet" empty state', () => {
    state.portfolio = { data: [], isLoading: true, isError: false };
    renderPage();
    expect(screen.getByLabelText('Loading trends')).toBeInTheDocument();
    expect(screen.queryByText(/No snapshots yet/)).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('chart')).toHaveLength(0);
  });

  it('lists the biggest movers with their change', async () => {
    renderPage();
    expect(screen.getByText('Improved')).toBeInTheDocument();
    expect(screen.getByText('+12.4')).toBeInTheDocument();
    expect(screen.getByText('-5')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('ALPHA MALL')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'ALPHA MALL' })).toHaveAttribute('href', '/buildings/up');
  });

  it('re-queries both hooks when the range changes, from a labelled button group', () => {
    renderPage();
    expect(state.portfolioDays[0]).toBe(90);
    expect(state.buildingsDays[0]).toBe(90);
    const group = screen.getByRole('group', { name: 'Range' });
    expect(group).toContainElement(screen.getByRole('button', { name: '30 days' }));
    fireEvent.click(screen.getByRole('button', { name: '365 days' }));
    expect(state.portfolioDays).toContain(365);
    expect(state.buildingsDays).toContain(365);
    expect(screen.getByRole('button', { name: '365 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '90 days' })).toHaveAttribute('aria-pressed', 'false');
  });
});
