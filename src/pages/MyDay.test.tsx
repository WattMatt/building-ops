import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  work: {} as any,
  isAdminOrManager: false,
  fullName: 'Thabo Mokoena' as string | null,
}));

const track = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useMyWork', () => ({ useMyWork: () => state.work }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAdminOrManager: state.isAdminOrManager, user: { id: 'u1' } }),
}));
vi.mock('@/hooks/useUserProfile', () => ({
  useUserProfile: () => ({ profile: { full_name: state.fullName }, loading: false }),
}));
vi.mock('@/lib/analytics', () => ({ track }));

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

const returnedReport = {
  id: 'r1',
  title: 'August OPS report',
  building_id: 'b1',
  report_period: '2026-08-01',
  review_notes: 'Add the water readings',
};

function baseWork(overrides: Record<string, unknown> = {}) {
  return {
    today: '2026-09-10',
    buckets: { overdue: [task], today: [], upcoming: [] },
    issues: [issue],
    signoffs: [],
    returnedReports: [returnedReport],
    unread: 3,
    isLoading: false,
    isError: false,
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
    state.work = baseWork();
  });

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
    state.work = baseWork({ isError: true, isEmpty: false });
    renderPage();
    expect(screen.getByText('Your day could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
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
});
