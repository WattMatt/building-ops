import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { mockViewport } from '@/test/mobile';
import type { CalendarEvent, CalendarKind } from '@/lib/calendar/events';
import type { UseCalendarEventsArgs } from '@/hooks/useCalendarEvents';

const TODAY = '2026-09-10';

const state = vi.hoisted(() => ({
  isAdminOrManager: true,
  events: [] as CalendarEvent[],
  calls: [] as UseCalendarEventsArgs[],
}));
const subscribeCard = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useCalendarEvents', () => ({
  useCalendarEvents: (args: UseCalendarEventsArgs) => {
    state.calls.push(args);
    return {
      events: state.events,
      byDate: new Map(),
      buildingNames: new Map(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      reschedule: vi.fn(async () => {}),
    };
  },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'u1' } }),
}));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/myWork', () => ({ todayInOperatingTz: () => TODAY }));
vi.mock('@/components/checklists/CompleteTaskDialog', () => ({ default: () => null }));
// The card has its own tests; here we only care that the dialog mounts it for this building.
vi.mock('@/components/calendar/SubscribeCard', () => ({
  SubscribeCard: (props: { buildingId: string | null; buildingName?: string }) => {
    subscribeCard(props);
    return <div>{`SubscribeCard building=${props.buildingId} name=${props.buildingName}`}</div>;
  },
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn() } }));

import BuildingCalendarTab, { summariseAssets } from './BuildingCalendarTab';

function ev(overrides: Partial<CalendarEvent> & { kind: CalendarKind; entityId: string; date: string }): CalendarEvent {
  return {
    id: `${overrides.kind}-${overrides.entityId}`,
    title: `${overrides.kind} ${overrides.entityId}`,
    buildingId: 'b1',
    buildingName: 'Alpha',
    href: '/buildings/b1?tab=assets',
    status: 'open',
    ...overrides,
  } as CalendarEvent;
}

const overdueAsset = ev({ kind: 'asset', entityId: 'a1', date: '2026-08-20', title: 'Lift service', status: 'overdue' });
const soonAsset = ev({ kind: 'asset', entityId: 'a2', date: '2026-09-25', title: 'Generator service' });
const laterAsset = ev({ kind: 'asset', entityId: 'a3', date: '2026-11-02', title: 'HVAC service' });
const task = ev({ kind: 'task', entityId: 't1', date: '2026-09-10', title: 'Check roof', href: '/buildings/b1?tab=checklists' });

function renderTab() {
  return render(
    <MemoryRouter initialEntries={['/buildings/b1?tab=maintenance']}>
      <BuildingCalendarTab buildingId="b1" buildingName="Alpha" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.isAdminOrManager = true;
  state.events = [overdueAsset, soonAsset, laterAsset, task];
  state.calls = [];
  subscribeCard.mockClear();
  try { window.localStorage.clear(); } catch { /* not available */ }
  mockViewport(1024);
});

afterEach(() => mockViewport(1024));

describe('summariseAssets', () => {
  it('splits asset services into overdue, due within 30 days and the next one up; ignores other kinds', () => {
    const s = summariseAssets([task, laterAsset, soonAsset, overdueAsset], TODAY);
    expect(s.overdue.map((e) => e.entityId)).toEqual(['a1']);
    expect(s.dueSoon.map((e) => e.entityId)).toEqual(['a2']);
    expect(s.next?.entityId).toBe('a2');
  });

  it('treats a past date as overdue even when the row says open, and a service today as due soon', () => {
    const s = summariseAssets([
      ev({ kind: 'asset', entityId: 'x', date: '2026-09-01' }),
      ev({ kind: 'asset', entityId: 'y', date: TODAY }),
    ], TODAY);
    expect(s.overdue.map((e) => e.entityId)).toEqual(['x']);
    expect(s.dueSoon.map((e) => e.entityId)).toEqual(['y']);
    expect(s.next?.entityId).toBe('y');
  });

  it('has no next service when nothing is upcoming', () => {
    expect(summariseAssets([overdueAsset], TODAY).next).toBeNull();
  });
});

describe('BuildingCalendarTab', () => {
  it('queries the building in a summary window and in the visible range', () => {
    renderTab();
    const scopes = state.calls.map((c) => c.scope);
    expect(scopes.every((s) => s.kind === 'building' && s.id === 'b1')).toBe(true);
    // A year back to 30 days ahead for the cards…
    expect(state.calls.some((c) => c.from === '2025-09-10' && c.to === '2026-10-10')).toBe(true);
    // …and the visible month ± 7 days for the grid.
    expect(state.calls.some((c) => c.from === '2026-08-25' && c.to === '2026-10-07')).toBe(true);
  });

  it('shows the overdue / due-in-30-days / next-service cards above the grid', () => {
    renderTab();
    const summary = screen.getByTestId('asset-summary');
    expect(within(summary).getByTestId('asset-overdue-count')).toHaveTextContent('1');
    expect(within(summary).getByTestId('asset-due-soon-count')).toHaveTextContent('1');
    expect(within(summary).getByTestId('asset-next')).toHaveTextContent('Generator service');
    expect(within(summary).getByText('Fri 25 Sep 2026')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-grid')).toBeInTheDocument();
    // The summary precedes the grid in the document.
    expect(summary.compareDocumentPosition(screen.getByTestId('calendar-grid')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says so when no service is scheduled', () => {
    state.events = [task];
    renderTab();
    expect(screen.getByText('None scheduled')).toBeInTheDocument();
    expect(screen.getByTestId('asset-overdue-count')).toHaveTextContent('0');
  });

  it('offers admins/managers a Subscribe button that opens the building feed dialog', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
    expect(await screen.findByRole('dialog', { name: "Subscribe to this building's calendar" })).toBeInTheDocument();
    expect(screen.getByText('SubscribeCard building=b1 name=Alpha')).toBeInTheDocument();
    expect(subscribeCard).toHaveBeenCalledWith(expect.objectContaining({ buildingId: 'b1', buildingName: 'Alpha' }));
  });

  it('hides Subscribe (and never mounts the card) for site roles', () => {
    state.isAdminOrManager = false;
    renderTab();
    expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull();
    expect(subscribeCard).not.toHaveBeenCalled();
    expect(screen.getByTestId('calendar-grid')).toBeInTheDocument();
  });

  it('starts in week view on a phone', () => {
    mockViewport(375);
    renderTab();
    expect(screen.getByTestId('calendar-week')).toBeInTheDocument();
    expect(screen.queryByTestId('calendar-grid')).toBeNull();
  });
});
