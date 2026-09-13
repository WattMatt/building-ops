import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { useMyWork } from '@/hooks/useMyWork';
import type { MyTask } from '@/lib/myWork';
import type { QueuedOp } from '@/lib/offline/types';

/** The card's whole data contract, so a field added to useMyWork fails here, not silently. */
type MyWork = ReturnType<typeof useMyWork>;

const state = vi.hoisted(() => ({
  work: {} as MyWork,
  hintsEnabled: true,
  queuedOps: [] as QueuedOp[],
}));
const track = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useMyWork', () => ({ useMyWork: () => state.work }));
// The real hook reaches for the Supabase client at import time; the card only cares whether
// hints are on, and toggling that is how we prove the coaching copy is a <Hint>.
vi.mock('@/hooks/useHints', () => ({
  useHints: () => ({ hintsEnabled: state.hintsEnabled, setHintsEnabled: vi.fn() }),
}));
vi.mock('@/lib/analytics', () => ({ track }));
// The queue hook reads IndexedDB through TanStack Query; the card only needs the ops list.
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
// The dialog has its own tests; here we care that the card opens it and reacts to success.
vi.mock('@/components/checklists/CompleteTaskDialog', () => ({
  default: ({ open, taskName, onSuccess }: { open: boolean; taskName: string; onSuccess?: () => void }) => (
    <div>
      {`CompleteTaskDialog open=${open} task=${taskName}`}
      <button onClick={onSuccess}>dialog success</button>
    </div>
  ),
}));

import MyWorkHere from './MyWorkHere';

const here = (over: Partial<MyTask>): MyTask => ({
  id: 't1',
  task_name: 'Check fire extinguishers',
  task_description: null,
  due_date: '2026-09-09',
  building_id: 'b1',
  building_name: 'Alpha Tower',
  requires_photo: true,
  requires_signature: false,
  status: 'overdue',
  ...over,
});

const overdueHere = here({ id: 't1', task_name: 'Check fire extinguishers', due_date: '2026-09-09', status: 'overdue' });
const todayHere = here({ id: 't2', task_name: 'Test the alarm panel', due_date: '2026-09-10', status: 'pending' });
const upcomingHere = here({ id: 't3', task_name: 'Service the generator', due_date: '2026-09-14', status: 'pending' });
const overdueElsewhere = here({ id: 't4', task_name: 'Clear the gutters', due_date: '2026-09-08', status: 'overdue', building_id: 'b2', building_name: 'Beta House' });
const todayElsewhere = here({ id: 't5', task_name: 'Read the water meter', due_date: '2026-09-10', status: 'pending', building_id: 'b2', building_name: 'Beta House' });

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

function baseWork(overrides: Partial<MyWork> = {}): MyWork {
  return {
    today: '2026-09-10',
    buckets: { overdue: [overdueHere, overdueElsewhere], today: [todayHere, todayElsewhere], upcoming: [upcomingHere] },
    issues: [],
    signoffs: [],
    returnedReports: [],
    unread: 0,
    isLoading: false,
    isError: false,
    error: null,
    isEmpty: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

const renderCard = () => render(<MyWorkHere buildingId="b1" />);

describe('MyWorkHere', () => {
  beforeEach(() => {
    track.mockClear();
    state.hintsEnabled = true;
    state.queuedOps = [];
    state.work = baseWork();
  });

  it("shows only this building's tasks, in the three buckets, without the building name", () => {
    renderCard();
    expect(screen.getByText('My work here')).toBeInTheDocument();
    expect(screen.getByText('Overdue (1)')).toBeInTheDocument();
    expect(screen.getByText('Today (1)')).toBeInTheDocument();
    expect(screen.getByText('Next 7 days (1)')).toBeInTheDocument();
    expect(screen.getByText('Check fire extinguishers')).toBeInTheDocument();
    expect(screen.getByText('Test the alarm panel')).toBeInTheDocument();
    expect(screen.getByText('Service the generator')).toBeInTheDocument();
    // The other building's tasks are My Day's business, not this card's.
    expect(screen.queryByText('Clear the gutters')).toBeNull();
    expect(screen.queryByText('Read the water meter')).toBeNull();
    // The page is the building, so the row does not repeat it.
    expect(screen.queryByText(/ALPHA TOWER/)).toBeNull();
    expect(screen.getByText('Was due Wed 9 Sep')).toBeInTheDocument();
  });

  it('opens the complete dialog for the clicked task', () => {
    renderCard();
    expect(screen.queryByText(/CompleteTaskDialog/)).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /complete/i })[0]);
    expect(screen.getByText('CompleteTaskDialog open=true task=Check fire extinguishers')).toBeInTheDocument();
  });

  it('closes the dialog, refetches and tracks after a completion', () => {
    const refetch = vi.fn();
    state.work = baseWork({ refetch });
    renderCard();
    fireEvent.click(screen.getAllByRole('button', { name: /complete/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'dialog success' }));
    expect(screen.queryByText(/CompleteTaskDialog/)).toBeNull();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('task_completed', { taskId: 't1', surface: 'my_work_here' });
  });

  it('shows a Queued chip instead of Complete while the completion waits to sync', () => {
    state.queuedOps = [queuedCompletion('t1')];
    renderCard();
    expect(screen.getByText('Queued')).toBeInTheDocument();
    // t2 and t3 are not queued, so two Complete buttons remain.
    expect(screen.getAllByRole('button', { name: /complete/i })).toHaveLength(2);
    // Still counted: the server has not accepted it yet.
    expect(screen.getByText('Overdue (1)')).toBeInTheDocument();
  });

  it('says a rejected completion needs attention', () => {
    state.queuedOps = [queuedCompletion('t1', 'failed')];
    renderCard();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.queryByText('Queued')).toBeNull();
  });

  it('shows the empty state when nothing in this building is mine, even if My Day is not empty', () => {
    state.work = baseWork({ buckets: { overdue: [overdueElsewhere], today: [todayElsewhere], upcoming: [] }, isEmpty: false });
    renderCard();
    expect(screen.getByText('Nothing assigned to you here')).toBeInTheDocument();
    expect(screen.queryByText(/\(\d+\)/)).toBeNull();
  });

  it('shows a spinner while loading, not an empty card', () => {
    state.work = baseWork({ isLoading: true, buckets: { overdue: [], today: [], upcoming: [] } });
    renderCard();
    expect(screen.getByLabelText('Loading your work here')).toBeInTheDocument();
    expect(screen.queryByText('Nothing assigned to you here')).toBeNull();
  });

  it('offers a retry rather than an empty card when the load fails', () => {
    const refetch = vi.fn();
    state.work = baseWork({
      isError: true,
      error: new Error('permission denied for table task_instances'),
      buckets: { overdue: [], today: [], upcoming: [] },
      refetch,
    });
    renderCard();
    expect(screen.getByText('Your work here could not be loaded')).toBeInTheDocument();
    // The reason, not just the fact — otherwise a report to support says only "it broke".
    expect(screen.getByText('permission denied for table task_instances')).toBeInTheDocument();
    expect(screen.queryByText('Nothing assigned to you here')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('routes the coaching copy through the hints toggle', () => {
    const { unmount } = renderCard();
    expect(screen.getByText('Tasks assigned to you in this building. Everything else that is yours is on My Day.')).toBeInTheDocument();
    expect(screen.getByText('Past their due date — clear these first.')).toBeInTheDocument();
    unmount();

    // Hints off: the coaching lines go, the headings, counts and rows stay.
    state.hintsEnabled = false;
    renderCard();
    expect(screen.queryByText(/Everything else that is yours is on My Day/)).toBeNull();
    expect(screen.queryByText('Past their due date — clear these first.')).toBeNull();
    expect(screen.getByText('Overdue (1)')).toBeInTheDocument();
    expect(screen.getByText('Check fire extinguishers')).toBeInTheDocument();
  });
});
