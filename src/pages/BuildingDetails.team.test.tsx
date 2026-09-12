import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const auth = vi.hoisted(() => ({ isAdminOrManager: true }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdminOrManager: auth.isAdminOrManager, user: { id: 'u1' } }) }));
vi.mock('@/hooks/useBuildingScore', () => ({ useBuildingScore: () => ({ ohsPct: 80, taskPct: 90 }) }));
vi.mock('@/hooks/useBuildingTrend', () => ({
  useBuildingTrend: () => ({ rows: [], series: { compliance: [], tasks: [], issuesOpen: [], tasksOverdue: [], docsExpiring30: [] }, latest: null, isLoading: false }),
}));
// Each tab has its own tests; here only the shell matters (same stubs as BuildingDetails.mobile.test.tsx:19-29).
vi.mock('@/components/building/TenantsTab', () => ({ default: () => <div>TenantsTab</div> }));
vi.mock('@/components/building/AssetsTab', () => ({ default: () => <div>AssetsTab</div> }));
vi.mock('@/components/building/PpmTab', () => ({ default: () => <div>PpmTab</div> }));
vi.mock('@/components/building/DocumentsTab', () => ({ default: () => <div>DocumentsTab</div> }));
vi.mock('@/components/building/BuildingCalendarTab', () => ({ default: () => <div>BuildingCalendarTab</div> }));
vi.mock('@/components/building/NotesTab', () => ({ default: () => <div>NotesTab</div> }));
vi.mock('@/components/building/OverviewWidgets', () => ({ default: () => <div>OverviewWidgets</div> }));
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

beforeEach(() => { auth.isAdminOrManager = true; Element.prototype.scrollIntoView = vi.fn(); });

const renderAt = (url: string) =>
  render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/buildings/:id" element={<BuildingDetails />} /></Routes></MemoryRouter>);

describe('BuildingDetails Team tab', () => {
  it('mounts a Team trigger between Checklists and Forms for a manager, and ?tab=team opens it', async () => {
    renderAt('/buildings/b1?tab=team');
    const tabs = (await screen.findAllByRole('tab')).map((t) => t.textContent);
    expect(tabs.indexOf('Team')).toBe(tabs.indexOf('Forms') - 1);
    expect(tabs.indexOf('Team')).toBeGreaterThan(tabs.findIndex((t) => t?.includes('Checklists')));
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Team');
    expect(screen.getByText('TeamTab')).toBeInTheDocument();
  });

  it('does not mount the trigger for a field user, and ?tab=team falls back to Overview', async () => {
    auth.isAdminOrManager = false;
    renderAt('/buildings/b1?tab=team');
    await screen.findByRole('tablist');
    expect(screen.queryByRole('tab', { name: 'Team' })).toBeNull();
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Overview');
    expect(screen.queryByText('TeamTab')).toBeNull();
  });
});
