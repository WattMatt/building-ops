import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { useIssues } from '@/hooks/useIssues';
import type { QueuedOp } from '@/lib/offline/types';

type IssuesData = ReturnType<typeof useIssues>;

const state = vi.hoisted(() => ({
  data: {} as IssuesData,
  queuedOps: [] as QueuedOp[],
}));

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));

vi.mock('@/hooks/useIssues', () => ({ useIssues: () => state.data }));
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

import Issues from './Issues';

const liveIssue: IssuesData['issues'][number] = {
  id: 'i1',
  title: 'Leaking pipe',
  description: 'Water on the floor',
  priority: 'high',
  status: 'open',
  deadline: null,
  created_at: '2026-09-01T08:00:00Z',
  building_id: 'b1',
  building_name: 'Alpha Tower',
  reported_by: 'u2',
  assigned_to: 'u1',
  corrective_action: null,
  photo_urls: null,
  task_instance_id: null,
};

const queuedIssueOp = (status: QueuedOp['status'] = 'pending'): QueuedOp => ({
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
      building_id: 'b1',
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

  it('shows the queued row even when the server list is empty', () => {
    state.data = baseData({ issues: [], stats: { total: 0, open: 0, inProgress: 0, escalated: 0, resolved: 0 } });
    state.queuedOps = [queuedIssueOp()];
    renderPage();
    expect(screen.getByText('Broken gate motor')).toBeInTheDocument();
    expect(screen.queryByText('No issues found')).not.toBeInTheDocument();
  });
});
