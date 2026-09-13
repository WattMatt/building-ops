import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const auth = vi.hoisted(() => ({ isAdminOrManager: false }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdminOrManager: auth.isAdminOrManager, user: { id: 'u1' } }) }));
const score = vi.hoisted(() => ({ calls: [] as (string | undefined)[] }));
vi.mock('@/hooks/useBuildingScore', () => ({
  useBuildingScore: (id: string | undefined) => { score.calls.push(id); return { ohsPct: 80, taskPct: 90, asOf: null }; },
}));
vi.mock('@/hooks/useBuildingTrend', () => ({
  useBuildingTrend: () => ({ rows: [], series: { compliance: [], tasks: [], issuesOpen: [], tasksOverdue: [], docsExpiring30: [] }, latest: null, isLoading: false }),
}));
// Each tab has its own tests; here only the shell matters (same stubs as BuildingDetails.team.test.tsx:12-26).
vi.mock('@/components/building/TenantsTab', () => ({ default: () => <div>TenantsTab</div> }));
vi.mock('@/components/building/AssetsTab', () => ({ default: () => <div>AssetsTab</div> }));
vi.mock('@/components/building/PpmTab', () => ({ default: () => <div>PpmTab</div> }));
vi.mock('@/components/building/DocumentsTab', () => ({ default: () => <div>DocumentsTab</div> }));
vi.mock('@/components/building/BuildingCalendarTab', () => ({ default: () => <div>BuildingCalendarTab</div> }));
vi.mock('@/components/building/NotesTab', () => ({ default: () => <div>NotesTab</div> }));
// Echoes the role prop so the page's one decision is visible from here.
vi.mock('@/components/building/OverviewWidgets', () => ({
  default: ({ isAdminOrManager }: { isAdminOrManager: boolean }) => <div>{`OverviewWidgets isAdminOrManager=${isAdminOrManager}`}</div>,
}));
vi.mock('@/components/building/ChecklistsTab', () => ({ default: () => <div>ChecklistsTab</div> }));
vi.mock('@/components/building/FormsTab', () => ({ default: () => <div>FormsTab</div> }));
vi.mock('@/components/building/ReportsTab', () => ({ default: () => <div>ReportsTab</div> }));
vi.mock('@/components/building/InsightLinkerTab', () => ({ default: () => <div>InsightLinkerTab</div> }));
vi.mock('@/components/building/team/TeamTab', () => ({ default: () => <div>TeamTab</div> }));
vi.mock('@/components/building/BuildingAvatar', () => ({ BuildingAvatar: () => <div>BuildingAvatar</div> }));
vi.mock('@/components/building/BuildingAvatarDialog', () => ({ BuildingAvatarDialog: () => null }));
vi.mock('@/components/building/BuildingScoreChips', () => ({ BuildingScoreChips: () => <div>BuildingScoreChips</div> }));

const building = { id: 'b1', name: 'Alpha', address: '1 Road', city: 'Cape Town', logo_url: null, logo_position: null, avatar_color: null, emergency_contacts: null, created_at: '2026-01-01T00:00:00Z' };
vi.mock('@/integrations/supabase/client', () => {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: building, error: null })) };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return { supabase: { from: vi.fn(() => query) } };
});

import BuildingDetails from './BuildingDetails';

beforeEach(() => { auth.isAdminOrManager = false; score.calls = []; Element.prototype.scrollIntoView = vi.fn(); });

const renderAt = (url: string) =>
  render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/buildings/:id" element={<BuildingDetails />} /></Routes></MemoryRouter>);

/** Every tab value a field user must not reach (spec pilot-field §4.1). */
const MANAGEMENT_TABS = ['team', 'reports', 'tenants', 'assets', 'ppm', 'maintenance', 'electrical', 'documents'];
const MANAGEMENT_CONTENT = /TeamTab|ReportsTab|TenantsTab|AssetsTab|PpmTab|BuildingCalendarTab|InsightLinkerTab|DocumentsTab/;

describe('BuildingDetails for a field user (spec pilot-field §4)', () => {
  it('mounts only Overview, Tasks, Forms and Notes, and hands the overview the role', async () => {
    renderAt('/buildings/b1');
    const tabs = (await screen.findAllByRole('tab')).map((t) => t.textContent);
    // Overview and Checklists carry two responsive labels each; the strip is exactly these four.
    expect(tabs).toEqual(['OverviewInfo', 'ChecklistsTasks', 'Forms', 'Notes']);
    expect(screen.getByText('OverviewWidgets isAdminOrManager=false')).toBeInTheDocument();
    expect(screen.queryByText(MANAGEMENT_CONTENT)).toBeNull();
  });

  it('sends every management ?tab= value to Overview', async () => {
    for (const tab of MANAGEMENT_TABS) {
      const { unmount } = renderAt(`/buildings/b1?tab=${tab}`);
      await screen.findByRole('tablist');
      expect(screen.getByRole('tab', { selected: true }), tab).toHaveTextContent('Overview');
      expect(screen.queryByText(MANAGEMENT_CONTENT), tab).toBeNull();
      unmount();
    }
  });

  it('still deep-links to a field tab', async () => {
    renderAt('/buildings/b1?tab=notes');
    await screen.findByRole('tablist');
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Notes');
    expect(screen.getByText('NotesTab')).toBeInTheDocument();
  });

  it('leaves the score chips out and does not read the snapshot for them', async () => {
    renderAt('/buildings/b1');
    await screen.findByRole('tablist');
    expect(screen.queryByText('BuildingScoreChips')).toBeNull();
    // The hook is still called (hooks cannot be conditional) but with no id, which disables its query.
    expect(score.calls.every((id) => id === undefined)).toBe(true);
  });
});

describe('BuildingDetails for a manager (unchanged)', () => {
  it('keeps all eleven tabs plus Team, the score chips and the management overview', async () => {
    auth.isAdminOrManager = true;
    renderAt('/buildings/b1?tab=ppm');
    const tabs = (await screen.findAllByRole('tab')).map((t) => t.textContent);
    expect(tabs).toEqual([
      'OverviewInfo', 'ChecklistsTasks', 'Team', 'Forms', 'Reports', 'Tenants', 'Assets', 'PPM',
      'CalendarCal.', 'Electrical & ComplianceElec.', 'DocumentsDocs', 'Notes',
    ]);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('PPM');
    expect(screen.getByText('PpmTab')).toBeInTheDocument();
    expect(screen.getByText('BuildingScoreChips')).toBeInTheDocument();
    expect(score.calls).toContain('b1');
    // The overview is not mounted while PPM is active; switch to it through the URL.
    expect(screen.queryByText(/OverviewWidgets/)).toBeNull();
  });
});
