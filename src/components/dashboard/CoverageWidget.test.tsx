import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CoverageRow } from '@/hooks/usePortfolioCoverage';

const state = vi.hoisted(() => ({
  rows: [] as CoverageRow[],
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
}));

vi.mock('@/hooks/usePortfolioCoverage', async (orig) => {
  const real = await orig<typeof import('@/hooks/usePortfolioCoverage')>();
  return {
    ...real,
    usePortfolioCoverage: () => ({
      data: state.isLoading || state.isError ? undefined : state.rows,
      isLoading: state.isLoading,
      isError: state.isError,
      isSuccess: !state.isLoading && !state.isError,
      isFetching: state.isFetching,
      refetch: state.refetch,
      gaps: real.coverageGaps(state.rows),
      unassignedOpen: state.rows.reduce((n, r) => n + r.unassigned_open, 0),
      byBuilding: new Map(state.rows.map((r) => [r.building_id, r])),
    }),
  };
});

import CoverageWidget, { gapReason, unassignedLine } from './CoverageWidget';

const row = (over: Partial<CoverageRow>): CoverageRow => ({
  building_id: 'b', building_name: 'B', field_members: 1, role_rules: 1, has_user_rule: true,
  unassigned_open: 0, overdue_open: 0, due_yesterday: 0, completed_yesterday: 0, ...over,
});
const renderWidget = () => render(<MemoryRouter><CoverageWidget /></MemoryRouter>);

beforeEach(() => {
  state.rows = [];
  state.isLoading = false;
  state.isError = false;
  state.isFetching = false;
  state.refetch.mockClear();
});

describe('CoverageWidget', () => {
  it('lists buildings needing a team, each linking to its Team tab, with the reason', () => {
    state.rows = [
      row({ building_id: 'b1', building_name: 'Alpha Court' }),
      row({ building_id: 'b2', building_name: 'Beta Place', field_members: 0, has_user_rule: false, unassigned_open: 3 }),
      row({ building_id: 'b3', building_name: 'Gamma House', has_user_rule: false, unassigned_open: 1 }),
    ];
    renderWidget();
    expect(screen.getByText('Buildings needing a team')).toBeInTheDocument();
    expect(screen.getByText('2 buildings')).toBeInTheDocument();
    // Building names render uppercased by product rule (formatBuildingName), hence the /i.
    const beta = screen.getByRole('link', { name: /Beta Place/i });
    expect(beta).toHaveAttribute('href', '/buildings/b2?tab=team');
    expect(beta).toHaveTextContent('No field staff and no default for daily tasks');
    expect(screen.getByRole('link', { name: /Gamma House/i })).toHaveTextContent('No default for daily tasks');
    expect(screen.queryByRole('link', { name: /Alpha Court/i })).toBeNull();
    expect(screen.getByText('4 open tasks have nobody assigned')).toBeInTheDocument();
  });

  it('shows the honest empty state', () => {
    state.rows = [row({ building_id: 'b1', building_name: 'Alpha Court' })];
    renderWidget();
    expect(screen.getByText('Every building has field staff and a daily-task default.')).toBeInTheDocument();
    expect(screen.getByText('No open tasks are waiting for an owner.')).toBeInTheDocument();
  });

  it('caps the list and points at the Buildings page for the rest', () => {
    state.rows = Array.from({ length: 8 }, (_, i) => row({ building_id: `b${i}`, building_name: `Building ${i}`, field_members: 0 }));
    renderWidget();
    expect(screen.getAllByRole('link', { name: /Building \d/i })).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'View all 8 in Buildings' })).toHaveAttribute('href', '/buildings');
  });

  it('renders skeletons while loading', () => {
    state.isLoading = true;
    renderWidget();
    expect(screen.getByRole('status', { name: 'Loading team coverage' })).toBeInTheDocument();
  });

  it('shows an error with retry', () => {
    state.isError = true;
    renderWidget();
    expect(screen.getByText('Could not load team coverage.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it('gapReason and unassignedLine word the three cases and the singular', () => {
    expect(gapReason(row({ field_members: 0 }))).toBe('No field staff');
    expect(gapReason(row({ has_user_rule: false }))).toBe('No default for daily tasks');
    expect(gapReason(row({ field_members: 0, has_user_rule: false }))).toBe('No field staff and no default for daily tasks');
    expect(unassignedLine(1)).toBe('1 open task has nobody assigned');
    expect(unassignedLine(0)).toBe('No open tasks are waiting for an owner.');
  });
});
