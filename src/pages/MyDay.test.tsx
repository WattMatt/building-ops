import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { mockViewport } from '@/test/mobile';
import type { useMyWork } from '@/hooks/useMyWork';
import type { QueuedOp } from '@/lib/offline/types';

/** The page's whole data contract, so a field added to useMyWork fails here, not silently. */
type MyWork = ReturnType<typeof useMyWork>;

const state = vi.hoisted(() => ({
  work: {} as MyWork,
  isAdminOrManager: false,
  fullName: 'Thabo Mokoena' as string | null,
  hintsEnabled: true,
  queuedOps: [] as QueuedOp[],
}));

const track = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useMyWork', () => ({ useMyWork: () => state.work }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'u1' } }),
}));
vi.mock('@/hooks/useUserProfile', () => ({
  useUserProfile: () => ({ profile: { full_name: state.fullName }, loading: false }),
}));
// The real hook reaches for the Supabase client at import time; the page only cares
// whether hints are on, and toggling that is how we prove the coaching copy is a <Hint>.
vi.mock('@/hooks/useHints', () => ({
  useHints: () => ({ hintsEnabled: state.hintsEnabled, setHintsEnabled: vi.fn() }),
}));
vi.mock('@/lib/analytics', () => ({ track }));
// The queue hook reads IndexedDB through TanStack Query; the page only needs the ops list.
vi.mock('@/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({
    ops: state.queuedOps,
    pending: state.queuedOps.filter((o) => o.status === 'pending').length,
    failed: state.queuedOps.filter((o) => o.status === 'failed').length,
    retry: vi.fn(),
    discard: vi.fn(),
    retryAll: vi.fn(),
  }),
}));
// The install offer has its own hooks and tests; My Day only needs to mount it. A marker
// div rather than null so the push prompt's position relative to it can be asserted.
vi.mock('@/components/pwa/InstallCard', () => ({ InstallCard: () => <div>InstallCard</div> }));
// The push offer owns its own subscription state and tests; My Day only has to mount it for
// the signed-in user, above the week strip.
vi.mock('@/components/pwa/PushPromptCard', () => ({
  PushPromptCard: ({ userId }: { userId: string | undefined }) => <div>{`PushPromptCard userId=${userId}`}</div>,
}));

// The dialogs are exercised by their own tests; here we only care that My Day opens them.
vi.mock('@/components/checklists/CompleteTaskDialog', () => ({
  default: ({ open, taskName }: { open: boolean; taskName: string }) => (
    <div>{`CompleteTaskDialog open=${open} task=${taskName}`}</div>
  ),
}));
vi.mock('@/components/issues/IssueDetailDialog', () => ({
  default: ({ open, issue }: { open: boolean; issue: { title: string } }) => (
    <div>{`IssueDetailDialog open=${open} issue=${issue.title}`}</div>
  ),
}));

import MyDay from './MyDay';

const task = {
  id: 't1',
  task_name: 'Check fire extinguishers',
  task_description: null,
  due_date: '2026-09-09',
  building_id: 'b1',
  building_name: 'Alpha Tower',
  requires_photo: true,
  requires_signature: false,
  status: 'overdue' as const,
};

const upcomingTask = {
  ...task,
  id: 't2',
  task_name: 'Service the generator',
  due_date: '2026-09-14',
  status: 'pending' as const,
};

const issue = {
  id: 'i1',
  title: 'Leaking pipe',
  priority: 'high' as const,
  status: 'open' as const,
  deadline: null,
  building_id: 'b1',
  building_name: 'Alpha Tower',
  created_at: '2026-09-01T08:00:00Z',
  reported_by: 'u2',
  assigned_to: 'u1',
  description: 'Water on the floor',
  corrective_action: null,
  photo_urls: null,
  task_instance_id: null,
};

const queuedCompletion = (taskInstanceId: string, status: QueuedOp['status'] = 'pending'): QueuedOp => ({
  id: `op-${taskInstanceId}`,
  uid: 'u1',
  createdAt: Date.now(),
  attempts: 0,
  status,
  lastError: status === 'failed' ? 'permission denied' : null,
  photos: [],
  payload: {
    kind: 'task_complete',
    completionId: `c-${taskInstanceId}`,
    taskInstanceId,
    taskName: 'Check fire extinguishers',
    notes: null,
    signatureConfirmed: false,
  },
});

const returnedReport = {
  id: 'r1',
  title: 'August OPS report',
  building_id: 'b1',
  report_period: '2026-08-01',
  review_notes: 'Add the water readings',
};

function baseWork(overrides: Partial<MyWork> = {}): MyWork {
  return {
    today: '2026-09-10',
    buckets: { overdue: [task], today: [], upcoming: [] },
    issues: [issue],
    signoffs: [],
    returnedReports: [returnedReport],
    unread: 3,
    isLoading: false,
    isError: false,
    error: null,
    isEmpty: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <MyDay />
    </MemoryRouter>,
  );

describe('MyDay', () => {
  beforeEach(() => {
    track.mockClear();
    state.isAdminOrManager = false;
    state.fullName = 'Thabo Mokoena';
    state.hintsEnabled = true;
    state.queuedOps = [];
    state.work = baseWork();
  });

  afterEach(() => mockViewport(1024));

  it('greets the signed-in person by first name', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Good (morning|afternoon|evening), Thabo/);
  });

  it('renders each section heading with its count', () => {
    renderPage();
    expect(screen.getByText('Overdue (1)')).toBeInTheDocument();
    expect(screen.getByText('Issues assigned to me (1)')).toBeInTheDocument();
    expect(screen.getByText('Reports returned to me (1)')).toBeInTheDocument();
    expect(screen.getByText('Check fire extinguishers')).toBeInTheDocument();
    // The reviewer's note is the reason the report came back — it has to be on the row.
    expect(screen.getByText(/Add the water readings/)).toBeInTheDocument();
    expect(screen.getByText('3 unread')).toBeInTheDocument();
  });

  it('opens the complete dialog for the clicked task', () => {
    renderPage();
    expect(screen.queryByText(/CompleteTaskDialog/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /complete/i }));
    expect(screen.getByText('CompleteTaskDialog open=true task=Check fire extinguishers')).toBeInTheDocument();
  });

  it('shows a Queued chip instead of Complete while the completion waits to sync', () => {
    state.queuedOps = [queuedCompletion('t1')];
    renderPage();
    expect(screen.getByText('Check fire extinguishers')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /complete/i })).not.toBeInTheDocument();
    // Still counted in its bucket: the server has not accepted it yet.
    expect(screen.getByText('Overdue (1)')).toBeInTheDocument();
  });

  it('says a rejected completion needs attention, and leaves other rows actionable', () => {
    state.queuedOps = [queuedCompletion('t1', 'failed')];
    state.work = baseWork({ buckets: { overdue: [task], today: [{ ...upcomingTask, status: 'pending' }], upcoming: [] } });
    renderPage();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.queryByText('Queued')).not.toBeInTheDocument();
    // t2 is not queued, so its Complete button is the only one left.
    expect(screen.getAllByRole('button', { name: /complete/i })).toHaveLength(1);
  });

  it('opens the issue dialog for the clicked issue', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^open$/i }));
    expect(screen.getByText('IssueDetailDialog open=true issue=Leaking pipe')).toBeInTheDocument();
  });

  it('shows the empty state when nothing is assigned', () => {
    state.work = baseWork({
      buckets: { overdue: [], today: [], upcoming: [] },
      issues: [],
      returnedReports: [],
      unread: 0,
      isEmpty: true,
    });
    renderPage();
    expect(screen.getByText('Nothing waiting on you')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse buildings/i })).toHaveAttribute('href', '/buildings');
  });

  it('offers a retry rather than an empty day when the load fails', () => {
    state.work = baseWork({
      isError: true,
      isEmpty: false,
      error: new Error('permission denied for table task_instances'),
    });
    renderPage();
    expect(screen.getByText('Your day could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    // The reason, not just the fact — otherwise a report to support says only "it broke".
    expect(screen.getByText('permission denied for table task_instances')).toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  it('tracks the view exactly once, with the counts', () => {
    const { rerender } = renderPage();
    rerender(
      <MemoryRouter>
        <MyDay />
      </MemoryRouter>,
    );
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('my_day_viewed', { overdue: 1, today: 0, issues: 1 });
  });

  it('does not track the view while the work is still loading', () => {
    state.work = baseWork({ isLoading: true });
    renderPage();
    expect(track).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Loading your day')).toBeInTheDocument();
  });

  it('keeps Upcoming collapsed until it is opened', () => {
    state.work = baseWork({
      buckets: { overdue: [task], today: [], upcoming: [upcomingTask] },
    });
    renderPage();

    // The count is visible while collapsed — the reader has to know there is something there.
    expect(screen.getByText('Upcoming (1)')).toBeInTheDocument();
    expect(screen.queryByText('Service the generator')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /upcoming \(1\)/i }));
    expect(screen.getByText('Service the generator')).toBeInTheDocument();
  });

  it('says a past due date is past', () => {
    renderPage();
    // Overdue rows read "Was due …", not a bare date that looks like any other deadline.
    expect(screen.getByText(/Was due Wed 9 Sep/)).toBeInTheDocument();
  });

  it('renders the week strip with seven day links and counts today from the fixtures', () => {
    state.work = baseWork({
      buckets: {
        overdue: [task],
        today: [{ ...task, id: 't-today', due_date: '2026-09-10', status: 'pending' }],
        upcoming: [upcomingTask],
      },
      issues: [{ ...issue, deadline: '2026-09-10' }],
    });
    renderPage();
    const dayLinks = screen.getAllByRole('link', { name: /^\w{3} \d{1,2} \w{3}: / });
    expect(dayLinks).toHaveLength(7);
    // Today: the one task due today plus the issue deadline. The overdue task (9 Sep) is
    // outside the window and must not be counted anywhere.
    expect(dayLinks[0]).toHaveAccessibleName('Thu 10 Sep: 1 task, 1 issue');
    expect(dayLinks[0]).toHaveAttribute('href', '/calendar?date=2026-09-10&view=week');
    expect(screen.getByRole('link', { name: 'Mon 14 Sep: 1 task' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fri 11 Sep: nothing due' })).toBeInTheDocument();
  });

  it('leaves the week strip out while loading and after a failed load', () => {
    state.work = baseWork({ isLoading: true });
    const { unmount } = renderPage();
    expect(screen.queryByText('This week')).not.toBeInTheDocument();
    unmount();

    state.work = baseWork({ isError: true, error: new Error('boom') });
    renderPage();
    expect(screen.queryByText('This week')).not.toBeInTheDocument();
  });

  it('routes the section coaching copy through the hints toggle', () => {
    const { unmount } = renderPage();
    expect(screen.getByText('Past their due date — clear these first.')).toBeInTheDocument();
    unmount();

    // Hints off: the coaching line goes, the heading, count and rows stay.
    state.hintsEnabled = false;
    renderPage();
    expect(screen.queryByText('Past their due date — clear these first.')).not.toBeInTheDocument();
    expect(screen.getByText('Overdue (1)')).toBeInTheDocument();
    expect(screen.getByText('Check fire extinguishers')).toBeInTheDocument();
  });

  it('mounts the push prompt for the signed-in user, after the install card and above the week strip', () => {
    renderPage();
    const install = screen.getByText('InstallCard');
    const card = screen.getByText('PushPromptCard userId=u1');
    const strip = screen.getByText('This week');
    // DOCUMENT_POSITION_FOLLOWING: the argument comes after the receiver in document order.
    expect(install.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers a floating Report issue button on a phone only (spec §8)', () => {
    mockViewport(375);
    const { unmount } = renderPage();
    const fab = screen.getByRole('link', { name: 'Report issue' });
    expect(fab).toHaveAttribute('href', '/issues/new');
    expect(fab.className).toMatch(/\bfixed\b/);
    expect(fab.className).toMatch(/\bh-14\b/);
    expect(fab.className).toMatch(/\bw-14\b/);
    unmount();

    mockViewport(1024);
    renderPage();
    expect(screen.queryByRole('link', { name: 'Report issue' })).toBeNull();
  });
});
