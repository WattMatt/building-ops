import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { mockViewport } from '@/test/mobile';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAdminOrManager: true, user: { id: 'u1' } }),
}));
vi.mock('@/hooks/useBuildingScore', () => ({
  useBuildingScore: () => ({ ohsPct: 80, taskPct: 90 }),
}));

// Each tab has its own tests; here we only care about the page shell on a phone.
vi.mock('@/components/building/TenantsTab', () => ({ default: () => <div>TenantsTab</div> }));
vi.mock('@/components/building/AssetsTab', () => ({ default: () => <div>AssetsTab</div> }));
vi.mock('@/components/building/DocumentsTab', () => ({ default: () => <div>DocumentsTab</div> }));
vi.mock('@/components/building/MaintenanceCalendarTab', () => ({ default: () => <div>MaintenanceCalendarTab</div> }));
vi.mock('@/components/building/NotesTab', () => ({ default: () => <div>NotesTab</div> }));
vi.mock('@/components/building/OverviewWidgets', () => ({ default: () => <div>OverviewWidgets</div> }));
vi.mock('@/components/building/ChecklistsTab', () => ({ default: () => <div>ChecklistsTab</div> }));
vi.mock('@/components/building/FormsTab', () => ({ default: () => <div>FormsTab</div> }));
vi.mock('@/components/building/ReportsTab', () => ({ default: () => <div>ReportsTab</div> }));
vi.mock('@/components/building/InsightLinkerTab', () => ({ default: () => <div>InsightLinkerTab</div> }));
vi.mock('@/components/building/BuildingAvatar', () => ({ BuildingAvatar: () => <div>BuildingAvatar</div> }));
vi.mock('@/components/building/BuildingAvatarDialog', () => ({ BuildingAvatarDialog: () => null }));
vi.mock('@/components/building/BuildingScoreChips', () => ({ BuildingScoreChips: () => <div>BuildingScoreChips</div> }));

const building = {
  id: 'b1',
  name: 'Alpha',
  address: '1 Road',
  city: 'Cape Town',
  logo_url: null,
  logo_position: null,
  avatar_color: null,
  emergency_contacts: null,
  created_at: '2026-01-01T00:00:00Z',
};

// fetchBuilding: from('buildings').select('*').eq('id', id).maybeSingle()
vi.mock('@/integrations/supabase/client', () => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: building, error: null })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return { supabase: { from: vi.fn(() => query) } };
});

import BuildingDetails from './BuildingDetails';

const scrollIntoView = vi.fn();

beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  mockViewport(1024);
  scrollIntoView.mockClear();
});

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/buildings/:id" element={<BuildingDetails />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BuildingDetails on a phone', () => {
  it('renders the tabs as a horizontally scrollable strip and scrolls the active tab into view', async () => {
    mockViewport(375);
    renderAt('/buildings/b1?tab=documents');

    const tablist = await screen.findByRole('tablist');
    expect(tablist.className).toContain('overflow-x-auto');

    const active = tablist.querySelector('[data-state="active"]');
    expect(active).not.toBeNull();
    expect(active).toHaveTextContent('Docs');

    expect(scrollIntoView).toHaveBeenCalled();
  });
});
