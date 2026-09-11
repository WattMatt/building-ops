import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { useIssues } from '@/hooks/useIssues';
import type { QueuedOp } from '@/lib/offline/types';

type IssuesData = ReturnType<typeof useIssues>;

const state = vi.hoisted(() => ({
  data: {} as IssuesData,
  queuedOps: [] as QueuedOp[],
}));

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
/** The queue emitter, captured so a test can fire it the way a background sync would. */
const queueListeners = vi.hoisted(() => new Set<() => void>());

vi.mock('@/hooks/useIssues', () => ({ useIssues: () => state.data }));
vi.mock('@/lib/offline/queue', () => ({
  subscribeQueue: (fn: () => void) => { queueListeners.add(fn); return () => { queueListeners.delete(fn); }; },
}));
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
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAdminOrManager: false, user: { id: 'u1' } }),
}));
vi.mock('@/components/issues/IssueDetailDialog', () => ({
  default: ({ open, issue }: { open: boolean; issue: { title: string } }) => (
    <div>{`IssueDetailDialog open=${open} issue=${issue.title}`}</div>
  ),
}));
vi.mock('sonner', () => ({ toast }));

import { queryClient } from '@/lib/queryClient';
import type { MyTask } from '@/lib/myWork';
import Issues from './Issues';

const liveIssue: IssuesData['issues'][number] = {
  id: 'i1',
  title: 'Leaking pipe',
  description: 'Water on the floor',
  priority: 'high',
  status: 'open',
  category: 'plumbing',
  deadline: null,
  created_at: '2026-09-01T08:00:00Z',
  building_id: 'b1',
  building_name: 'Alpha Tower',
  reported_by: 'u2',
  assigned_to: 'u1',
  corrective_action: null,
  photo_urls: null,
  task_instance_id: null,
  sla_target_hours: null,
  sla_breached_at: null,
  first_response_at: null,
  resolved_at: null,
};

const queuedIssueOp = (status: QueuedOp['status'] = 'pending', buildingId = 'b1'): QueuedOp => ({
  id: 'op-1',
  uid: 'u1',
  createdAt: Date.UTC(2026, 8, 10, 8, 0, 0),
  attempts: 0,
  status,
  lastError: status === 'failed' ? 'row-level security' : null,
  photos: [],
  payload: {
    kind: 'issue_create',
    issueId: 'q1',
    row: {
      title: 'Broken gate motor',
      description: 'Gate stuck open',
      priority: 'critical',
      status: 'open',
      building_id: buildingId,
      deadline: null,
      corrective_action: null,
      reported_by: 'u1',
      assigned_to: null,
      task_instance_id: null,
    },
    markTaskIssueLogged: null,
  },
});

function baseData(overrides: Partial<IssuesData> = {}): IssuesData {
  return {
    issues: [liveIssue],
    stats: { total: 1, open: 1, inProgress: 0, escalated: 0, resolved: 0 },
    loading: false,
    error: null,
    refetch: vi.fn(),
    createIssue: vi.fn(),
    updateIssue: vi.fn(),
    ...overrides,
  };
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <Issues />
    </MemoryRouter>,
  );

describe('Issues', () => {
  beforeEach(() => {
    toast.mockClear();
    queueListeners.clear();
    queryClient.clear();
    state.queuedOps = [];
    state.data = baseData();
  });

  it('lists the live issues and opens the detail dialog on click', () => {
    renderPage();
    expect(screen.getByText('Leaking pipe')).toBeInTheDocument();
    expect(screen.queryByText('Queued')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Leaking pipe'));
    expect(screen.getByText('IssueDetailDialog open=true issue=Leaking pipe')).toBeInTheDocument();
  });

  it('shows the SLA clock on an issue that has a target', () => {
    // Reported half an hour ago with a 72 h target: 71.5 h left, floored to whole days.
    const created = new Date(Date.now() - 30 * 60_000).toISOString();
    state.data = baseData({ issues: [{ ...liveIssue, id: 'i2', title: 'Slow lift', sla_target_hours: 72, created_at: created }] });
    renderPage();
    expect(screen.getByText('Due in 2d')).toHaveAttribute('data-sla', 'ok');
  });

  it('prepends a queued issue with a Queued chip before the live rows', () => {
    state.queuedOps = [queuedIssueOp()];
    renderPage();

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Broken gate motor', 'Leaking pipe']);

    const queuedCard = screen.getByTestId('queued-issue');
    expect(within(queuedCard).getByText('Queued')).toBeInTheDocument();
    // Building name resolved from the live list, rendered through the uppercase rule.
    expect(within(queuedCard).getByText('ALPHA TOWER')).toBeInTheDocument();
  });

  it('does not open a dialog for a queued issue; it says the issue is waiting to sync', () => {
    state.queuedOps = [queuedIssueOp()];
    renderPage();
    fireEvent.click(screen.getByText('Broken gate motor'));
    expect(screen.queryByText(/IssueDetailDialog/)).not.toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith('This issue is waiting to sync');
  });

  it('marks a rejected queued issue as needing attention', () => {
    state.queuedOps = [queuedIssueOp('failed')];
    renderPage();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.queryByText('Queued')).not.toBeInTheDocument();
  });

  it('keeps queued rows inside the list filters', () => {
    state.queuedOps = [queuedIssueOp()];
    renderPage();
    // Search is the filter we can drive without opening a Radix select in jsdom.
    fireEvent.change(screen.getByPlaceholderText('Search issues...'), { target: { value: 'pipe' } });
    expect(screen.queryByText('Broken gate motor')).not.toBeInTheDocument();
    expect(screen.getByText('Leaking pipe')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search issues...'), { target: { value: 'gate' } });
    expect(screen.getByText('Broken gate motor')).toBeInTheDocument();
    expect(screen.queryByText('Leaking pipe')).not.toBeInTheDocument();
  });

  it('names the building of a queued issue from the persisted My Day cache when the live list lacks it', () => {
    const cachedTask: MyTask = {
      id: 't1', task_name: 'Check gate', task_description: null, due_date: '2026-09-10',
      building_id: 'b2', building_name: 'Beta House', requires_photo: false, requires_signature: false, status: 'pending',
    };
    queryClient.setQueryData<MyTask[]>(['my-work', 'tasks', 'u1'], [cachedTask]);
    state.queuedOps = [queuedIssueOp('pending', 'b2')];
    renderPage();
    const queuedCard = screen.getByTestId('queued-issue');
    expect(within(queuedCard).getByText('BETA HOUSE')).toBeInTheDocument();
  });

  it('leaves the building blank when neither the live list nor the My Day cache knows it', () => {
    state.queuedOps = [queuedIssueOp('pending', 'b9')];
    renderPage();
    const queuedCard = screen.getByTestId('queued-issue');
    expect(within(queuedCard).queryByText(/ALPHA TOWER|BETA HOUSE/)).toBeNull();
  });

  it('refetches the live list whenever the queue changes, so a background sync replaces the queued row', () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    state.data = baseData({ refetch });
    renderPage();
    expect(queueListeners.size).toBe(1);
    expect(refetch).not.toHaveBeenCalled();
    act(() => { for (const fn of queueListeners) fn(); });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the queued row even when the server list is empty', () => {
    state.data = baseData({ issues: [], stats: { total: 0, open: 0, inProgress: 0, escalated: 0, resolved: 0 } });
    state.queuedOps = [queuedIssueOp()];
    renderPage();
    expect(screen.getByText('Broken gate motor')).toBeInTheDocument();
    expect(screen.queryByText('No issues found')).not.toBeInTheDocument();
  });

  it('shows the queued row together with the error card when the live list cannot be loaded', () => {
    // Offline after reporting: NewIssue navigates here, the fetch fails, the issue is only in the queue.
    state.data = baseData({ issues: [], error: new Error('Failed to fetch') });
    state.queuedOps = [queuedIssueOp()];
    renderPage();
    expect(screen.getByText('Failed to load issues')).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
    const queuedCard = screen.getByTestId('queued-issue');
    expect(within(queuedCard).getByText('Broken gate motor')).toBeInTheDocument();
    expect(within(queuedCard).getByText('Queued')).toBeInTheDocument();
    // The card is above the queued row, not instead of it.
    expect(screen.getByText('Failed to load issues').compareDocumentPosition(queuedCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the queued row while the live list is still loading', () => {
    state.data = baseData({ issues: [], loading: true });
    state.queuedOps = [queuedIssueOp()];
    renderPage();
    expect(screen.getByText('Broken gate motor')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading issues');
  });

  it('still replaces the page with the spinner or the error card when nothing is queued', () => {
    state.data = baseData({ issues: [], error: new Error('Failed to fetch') });
    const { unmount } = renderPage();
    expect(screen.getByText('Failed to load issues')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search issues...')).not.toBeInTheDocument();
    unmount();

    state.data = baseData({ issues: [], loading: true });
    renderPage();
    expect(screen.queryByPlaceholderText('Search issues...')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading issues')).not.toBeInTheDocument();
  });

  it('does not refetch on a queue change while offline: the fetch would only fail and flash the spinner', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      const refetch = vi.fn().mockResolvedValue(undefined);
      state.data = baseData({ refetch });
      renderPage();
      expect(queueListeners.size).toBe(1);
      act(() => { for (const fn of queueListeners) fn(); });
      expect(refetch).not.toHaveBeenCalled();
    } finally {
      onLine.mockRestore();
    }
  });
});
