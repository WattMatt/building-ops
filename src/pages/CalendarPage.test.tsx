import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { mockViewport } from '@/test/mobile';
import type { CalendarEvent, CalendarKind } from '@/lib/calendar/events';
import type { UseCalendarEventsArgs } from '@/hooks/useCalendarEvents';

// Radix Select drives itself with pointer capture and scrollIntoView, which jsdom lacks.
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const TODAY = '2026-09-10';

const state = vi.hoisted(() => ({
  isAdminOrManager: true,
  events: [] as CalendarEvent[],
  /** Every argument object the page handed to useCalendarEvents, in render order. */
  calls: [] as UseCalendarEventsArgs[],
  isLoading: false,
  isError: false,
  reschedule: vi.fn<(taskId: string, date: string) => Promise<void>>(async () => {}),
  refetch: vi.fn(),
}));
const track = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const db = vi.hoisted(() => ({
  from: vi.fn(),
  maybeSingle: vi.fn(async () => ({
    data: { id: 't1', task_name: 'Check roof', task_description: null, requires_photo: true, requires_signature: false },
    error: null,
  })),
}));

vi.mock('@/hooks/useCalendarEvents', () => ({
  useCalendarEvents: (args: UseCalendarEventsArgs) => {
    state.calls.push(args);
    return {
      events: state.events,
      byDate: new Map(),
      buildingNames: new Map(),
      isLoading: state.isLoading,
      isError: state.isError,
      error: null,
      refetch: state.refetch,
      reschedule: state.reschedule,
    };
  },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'u1' } }),
}));
vi.mock('@/hooks/useBuildings', () => ({
  useBuildings: () => ({
    buildings: [{ id: 'b1', name: 'Block A' }, { id: 'b2', name: 'Block B' }],
    loading: false,
    error: null,
    refetch: vi.fn(),
    deleteBuilding: vi.fn(),
  }),
}));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({ track }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/myWork', () => ({ todayInOperatingTz: () => TODAY }));
// The dialog has its own tests (and pulls in PhotoCapture); here we only care that it opens with the task's requirements.
vi.mock('@/components/checklists/CompleteTaskDialog', () => ({
  default: ({ open, taskName, requiresPhoto, requiresSignature }: { open: boolean; taskName: string; requiresPhoto: boolean; requiresSignature: boolean }) => (
    <div>{`CompleteTaskDialog open=${open} task=${taskName} photo=${requiresPhoto} signature=${requiresSignature}`}</div>
  ),
}));
// Opening a task: from('task_instances').select(...).eq('id', id).maybeSingle()
vi.mock('@/integrations/supabase/client', () => {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: db.maybeSingle };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  db.from.mockImplementation(() => query);
  return { supabase: { from: db.from } };
});

import CalendarPage, { defaultViewMode, rangeFor, stepDate } from './CalendarPage';

function ev(overrides: Partial<CalendarEvent> & { kind: CalendarKind; entityId: string; date: string }): CalendarEvent {
  return {
    id: `${overrides.kind}-${overrides.entityId}`,
    title: `${overrides.kind} ${overrides.entityId}`,
    buildingId: 'b1',
    buildingName: 'Block A',
    href: '/buildings/b1',
    status: 'open',
    ...overrides,
  } as CalendarEvent;
}

const task = ev({ kind: 'task', entityId: 't1', date: '2026-09-10', title: 'Check roof', href: '/buildings/b1?tab=checklists' });
const issue = ev({ kind: 'issue', entityId: 'i1', date: '2026-09-12', title: 'Leak', href: '/issues?open=i1' });
const document_ = ev({ kind: 'document', entityId: 'd1', date: '2026-09-15', title: 'Fire cert', href: '/buildings/b1?tab=documents' });

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <LocationProbe />
      <Routes>
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="*" element={<div>elsewhere</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const lastCall = () => state.calls[state.calls.length - 1];
/** The task's chip in its month cell (the side panel lists today's task too). */
const taskChip = () => within(screen.getByTestId('day-2026-09-10')).getByRole('button', { name: /Task: Check roof/ });
const location = () => screen.getByTestId('location').textContent;

beforeEach(() => {
  state.isAdminOrManager = true;
  state.events = [task, issue, document_];
  state.calls = [];
  state.isLoading = false;
  state.isError = false;
  state.reschedule.mockReset();
  state.reschedule.mockResolvedValue(undefined);
  state.refetch.mockClear();
  track.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
  db.from.mockClear();
  db.maybeSingle.mockClear();
  try { window.localStorage.clear(); } catch { /* not available */ }
  mockViewport(1024);
});

afterEach(() => mockViewport(1024));

describe('view helpers', () => {
  it('starts in week view below 640 px and month view from there up', () => {
    expect(defaultViewMode(375)).toBe('week');
    expect(defaultViewMode(639)).toBe('week');
    expect(defaultViewMode(640)).toBe('month');
    expect(defaultViewMode(1024)).toBe('month');
  });

  it('queries the visible month ± 7 days, or exactly the visible Monday-first week', () => {
    expect(rangeFor('month', '2026-09-10')).toEqual({ from: '2026-08-25', to: '2026-10-07' });
    expect(rangeFor('week', '2026-09-10')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('steps a month to the first of the neighbouring month and a week by seven days', () => {
    expect(stepDate('month', '2026-09-10', 1)).toBe('2026-10-01');
    expect(stepDate('month', '2026-09-10', -1)).toBe('2026-08-01');
    expect(stepDate('week', '2026-09-10', 1)).toBe('2026-09-17');
    expect(stepDate('week', '2026-09-10', -1)).toBe('2026-09-03');
  });
});

describe('CalendarPage', () => {
  it('renders the month grid on desktop, queries the month ± 7 days and tracks the view once', () => {
    renderAt('/calendar');
    expect(screen.getByTestId('calendar-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('calendar-week')).toBeNull();
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
    expect(lastCall()).toEqual({ scope: { kind: 'portfolio' }, from: '2026-08-25', to: '2026-10-07' });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('calendar_viewed', { scope: 'portfolio', view: 'month' });
    // Events land in their cells.
    expect(within(screen.getByTestId('day-2026-09-10')).getByText('Check roof')).toBeInTheDocument();
    expect(within(screen.getByTestId('day-2026-09-12')).getByText('Leak')).toBeInTheDocument();
  });

  it('defaults to the week view on a phone when the link does not say otherwise', () => {
    mockViewport(375);
    renderAt('/calendar');
    expect(screen.getByTestId('calendar-week')).toBeInTheDocument();
    expect(screen.queryByTestId('calendar-grid')).toBeNull();
    expect(lastCall()).toEqual({ scope: { kind: 'portfolio' }, from: '2026-09-07', to: '2026-09-13' });
    expect(track).toHaveBeenCalledWith('calendar_viewed', { scope: 'portfolio', view: 'week' });
  });

  it('honours ?view=week&date= (the My Day week strip link) and steps the week through the URL', () => {
    renderAt('/calendar?date=2026-09-21&view=week');
    expect(screen.getByTestId('calendar-week')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '21 Sep – 27 Sep 2026' })).toBeInTheDocument();
    expect(lastCall()).toEqual({ scope: { kind: 'portfolio' }, from: '2026-09-21', to: '2026-09-27' });

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(location()).toBe('/calendar?date=2026-09-28&view=week');
    expect(lastCall()).toEqual({ scope: { kind: 'portfolio' }, from: '2026-09-28', to: '2026-10-04' });

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(location()).toBe('/calendar?date=2026-09-10&view=week');

    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(location()).toBe('/calendar?date=2026-09-10&view=month');
    expect(screen.getByTestId('calendar-grid')).toBeInTheDocument();
  });

  it('ignores a malformed ?date and ?view', () => {
    renderAt('/calendar?date=yesterday&view=agenda');
    expect(screen.getByTestId('calendar-grid')).toBeInTheDocument();
    expect(lastCall()).toEqual({ scope: { kind: 'portfolio' }, from: '2026-08-25', to: '2026-10-07' });
  });

  it('narrows the scope to ?building and the building picker writes the URL', () => {
    renderAt('/calendar?building=b2');
    expect(lastCall().scope).toEqual({ kind: 'building', id: 'b2' });
    const trigger = screen.getByRole('combobox', { name: 'Building' });
    expect(trigger).toHaveTextContent('Block B');
    expect(track).toHaveBeenCalledWith('calendar_viewed', { scope: 'building', view: 'month' });

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    const option = screen.getByRole('option', { name: 'All buildings' });
    fireEvent.pointerUp(option);
    fireEvent.click(option);
    expect(location()).toBe('/calendar');
    expect(lastCall().scope).toEqual({ kind: 'portfolio' });
  });

  it('lets an admin/manager drop a task on another day and reports the move', async () => {
    renderAt('/calendar');
    expect(screen.getByText(/Drag a task to another day/)).toBeInTheDocument();
    fireEvent.drop(screen.getByTestId('day-2026-09-12'), { dataTransfer: { getData: () => 't1' } });
    await waitFor(() => expect(state.reschedule).toHaveBeenCalledWith('t1', '2026-09-12'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Task moved to Sat 12 Sep'));
    expect(track).toHaveBeenCalledWith('task_rescheduled', { scope: 'portfolio' });
  });

  it('shows the hook\'s message when a move is refused', async () => {
    state.reschedule.mockRejectedValueOnce(new Error('That task already has an occurrence on that day.'));
    renderAt('/calendar');
    fireEvent.drop(screen.getByTestId('day-2026-09-12'), { dataTransfer: { getData: () => 't1' } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That task already has an occurrence on that day.'));
    expect(track).not.toHaveBeenCalledWith('task_rescheduled', expect.anything());
  });

  it('keeps the grid read-only for site roles: no drag hint, a drop does nothing', () => {
    state.isAdminOrManager = false;
    renderAt('/calendar');
    expect(screen.queryByText(/Drag a task to another day/)).toBeNull();
    expect(taskChip()).not.toHaveAttribute('draggable');
    fireEvent.drop(screen.getByTestId('day-2026-09-12'), { dataTransfer: { getData: () => 't1' } });
    expect(state.reschedule).not.toHaveBeenCalled();
  });

  it('routes an event tap: issue → /issues?open=, others → their href', () => {
    renderAt('/calendar');
    fireEvent.click(screen.getByRole('button', { name: /Issue: Leak/ }));
    expect(location()).toBe('/issues?open=i1');
  });

  it('routes a document tap to the building documents tab', () => {
    renderAt('/calendar');
    fireEvent.click(screen.getByRole('button', { name: /Document expiry: Fire cert/ }));
    expect(location()).toBe('/buildings/b1?tab=documents');
  });

  it('opens the completion dialog for a task with its photo/signature requirements fetched on tap', async () => {
    renderAt('/calendar');
    fireEvent.click(taskChip());
    expect(await screen.findByText('CompleteTaskDialog open=true task=Check roof photo=true signature=false')).toBeInTheDocument();
    expect(db.from).toHaveBeenCalledWith('task_instances');
    expect(location()).toBe('/calendar');
  });

  it('sends a completed task to its checklist instead of the completion dialog', () => {
    state.events = [{ ...task, status: 'done' }];
    renderAt('/calendar');
    fireEvent.click(taskChip());
    expect(location()).toBe('/buildings/b1?tab=checklists');
    expect(db.from).not.toHaveBeenCalled();
  });

  it('tells the user when the task cannot be read', async () => {
    db.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'nope' } } as never);
    renderAt('/calendar');
    fireEvent.click(taskChip());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not open that task. Try again.'));
    expect(screen.queryByText(/CompleteTaskDialog/)).toBeNull();
  });

  it('lists the selected day in a side panel on desktop, today by default', () => {
    renderAt('/calendar');
    const panel = screen.getByRole('complementary', { name: 'Selected day' });
    expect(within(panel).getByRole('heading', { name: 'Thursday 10 September' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Task: Check roof/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Saturday 12 September' }));
    expect(within(panel).getByRole('heading', { name: 'Saturday 12 September' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Issue: Leak/ })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /Task: Check roof/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open Monday 14 September' }));
    expect(within(panel).getByText('Nothing due on 14 September.')).toBeInTheDocument();
  });

  it('opens the selected day as a bottom sheet on a phone in month view', async () => {
    mockViewport(375);
    renderAt('/calendar?view=month');
    expect(screen.queryByRole('complementary', { name: 'Selected day' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Saturday 12 September' }));
    expect(await screen.findByText('Saturday 12 September')).toBeInTheDocument();
    expect(document.querySelector('[data-vaul-drawer]')).not.toBeNull();
    const rows = screen.getByRole('list', { name: 'Events on Saturday 12 September' });
    expect(within(rows).getByRole('button', { name: /Issue: Leak/ })).toBeInTheDocument();
  });

  it('hides a source when its filter chip is toggled off', () => {
    renderAt('/calendar');
    fireEvent.click(screen.getByRole('button', { name: /^Issue \d/ }));
    expect(within(screen.getByTestId('day-2026-09-12')).queryByText('Leak')).toBeNull();
    expect(within(screen.getByTestId('day-2026-09-10')).getByText('Check roof')).toBeInTheDocument();
  });

  it('shows a plain error with Retry when the hook fails', () => {
    state.isError = true;
    renderAt('/calendar');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the calendar.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.refetch).toHaveBeenCalled();
  });
});
