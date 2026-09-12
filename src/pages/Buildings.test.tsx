import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CoverageRow } from '@/hooks/usePortfolioCoverage';

const state = vi.hoisted(() => ({
  isAdminOrManager: true,
  coverage: [] as CoverageRow[],
  coverageEnabledArg: [] as unknown[],
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'me' } }) }));
vi.mock('@/hooks/useBuildings', () => ({
  useBuildings: () => ({
    buildings: [
      { id: 'b1', name: 'Alpha Court', address: '1 Road', city: 'Cape Town', logo_url: null, logo_position: null, avatar_color: null },
      { id: 'b2', name: 'Beta Place', address: '2 Road', city: 'Durban', logo_url: null, logo_position: null, avatar_color: null },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
    deleteBuilding: vi.fn(),
  }),
}));
vi.mock('@/hooks/useBuildingsScores', () => ({ useBuildingsScores: () => ({ scores: {} }), chipValues: () => ({}) }));
// Mirrors the real return shape: the page reads both `latest` (chips) and `byBuilding` (sparklines).
vi.mock('@/hooks/useBuildingTrend', () => ({ useBuildingsTrends: () => ({ rows: {}, byBuilding: {}, latest: {}, isLoading: false }) }));
vi.mock('@/hooks/usePortfolioCoverage', () => ({
  usePortfolioCoverage: (enabled: boolean) => {
    state.coverageEnabledArg.push(enabled);
    return { data: state.coverage, isLoading: false, isError: false, byBuilding: new Map(state.coverage.map((r) => [r.building_id, r])), gaps: [], unassignedOpen: 0 };
  },
}));
vi.mock('@/components/building/BuildingAvatar', () => ({ BuildingAvatar: () => <div>Avatar</div> }));
vi.mock('@/components/building/BuildingAvatarDialog', () => ({ BuildingAvatarDialog: () => null }));
vi.mock('@/components/building/BuildingImportDialog', () => ({ default: () => null }));
vi.mock('@/components/building/BuildingScoreChips', () => ({ BuildingScoreChips: () => null }));
vi.mock('@/components/ui/export-csv-button', () => ({ ExportCsvButton: () => null }));

import Buildings from './Buildings';

const row = (over: Partial<CoverageRow>): CoverageRow => ({
  building_id: 'b', building_name: 'B', field_members: 1, role_rules: 1, has_user_rule: true,
  unassigned_open: 0, overdue_open: 0, due_yesterday: 0, completed_yesterday: 0, ...over,
});
const renderPage = () => render(<MemoryRouter><Buildings /></MemoryRouter>);

beforeEach(() => {
  state.isAdminOrManager = true;
  state.coverage = [row({ building_id: 'b1', building_name: 'Alpha Court' }), row({ building_id: 'b2', building_name: 'Beta Place', field_members: 0 })];
  state.coverageEnabledArg = [];
});

describe('Buildings "No team" badge', () => {
  it('marks a card whose building has no field members, for a manager', () => {
    renderPage();
    // Building names render uppercased by product rule (formatBuildingName).
    const beta = screen.getByText('BETA PLACE').closest('[data-testid^="building-card-"]') as HTMLElement;
    expect(within(beta).getByText('No team')).toBeInTheDocument();
    const alpha = screen.getByText('ALPHA COURT').closest('[data-testid^="building-card-"]') as HTMLElement;
    expect(within(alpha).queryByText('No team')).toBeNull();
    expect(state.coverageEnabledArg[0]).toBe(true);
  });

  it('never shows the badge to a field user and does not query coverage for them', () => {
    state.isAdminOrManager = false;
    renderPage();
    expect(screen.queryByText('No team')).toBeNull();
    expect(state.coverageEnabledArg[0]).toBe(false);
  });
});
