import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { TaskInstance } from '@/components/building/TasksList';
import type { BuildingMember } from '@/hooks/useBuildingMembers';

vi.mock('@/hooks/useBuildingMembers', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useBuildingMembers')>()),
  useBuildingMembers: () => ({ data: [], byId: new Map(), isLoading: false, isError: false }),
}));

import { UpcomingTasks, groupUpcoming, mondayOf, weekLabel, addDaysIso } from './UpcomingTasks';

// Thursday. Its ISO week is Mon 7 – Sun 13 Sep; the 30-day horizon ends Sat 10 Oct.
const TODAY = '2026-09-10';

function task(id: string, due: string, extra: Partial<TaskInstance> = {}): TaskInstance {
  return {
    id, task_name: `Task ${id}`, task_description: null, frequency: 'weekly', status: 'pending', due_date: due,
    requires_photo: false, requires_signature: false, responsible_role: 'user', building_id: 'b1', category: null,
    assigned_to: null, ...extra,
  };
}

const members = new Map<string, BuildingMember>([['u1', { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' }]]);

describe('date helpers', () => {
  it('mondayOf finds the ISO-week Monday, including for a Sunday', () => {
    expect(mondayOf('2026-09-10')).toBe('2026-09-07');
    expect(mondayOf('2026-09-13')).toBe('2026-09-07');
    expect(mondayOf('2026-09-14')).toBe('2026-09-14');
  });

  it('addDaysIso crosses month ends', () => {
    expect(addDaysIso('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysIso('2026-09-10', 30)).toBe('2026-10-10');
  });

  it('weekLabel names this/next week, then ranges within or across a month', () => {
    expect(weekLabel('2026-09-07', TODAY)).toBe('This week');
    expect(weekLabel('2026-09-14', TODAY)).toBe('Next week');
    expect(weekLabel('2026-09-21', TODAY)).toBe('21–27 Sep');
    expect(weekLabel('2026-09-28', TODAY)).toBe('28 Sep–4 Oct');
  });
});

describe('groupUpcoming', () => {
  it('groups open tasks by Mon–Sun week inside the 30-day window, overdue first', () => {
    const weeks = groupUpcoming([
      task('late', '2026-09-08'),
      task('today', '2026-09-10'),
      task('sat', '2026-09-12'),
      task('next', '2026-09-15', { status: 'overdue' }),
      task('w3', '2026-09-22'),
      task('w4', '2026-10-01'),
      task('edge-in', '2026-10-10'),
      task('edge-out', '2026-10-11'),
      task('done', '2026-09-11', { status: 'completed' }),
      task('issue', '2026-09-11', { status: 'issue_logged' }),
    ], TODAY);

    expect(weeks.map((w) => [w.label, w.tasks.map((t) => t.id)])).toEqual([
      ['Overdue', ['late']],
      ['This week', ['today', 'sat']],
      ['Next week', ['next']],
      ['21–27 Sep', ['w3']],
      ['28 Sep–4 Oct', ['w4']],
      ['5–11 Oct', ['edge-in']],
    ]);
  });

  it('returns nothing when no open task is inside the window', () => {
    expect(groupUpcoming([task('far', '2026-12-01'), task('done', TODAY, { status: 'completed' })], TODAY)).toEqual([]);
  });
});

describe('UpcomingTasks', () => {
  it('renders week headers with counts, due labels and assignee chips', () => {
    render(
      <UpcomingTasks
        today={TODAY}
        members={members}
        onComplete={() => {}}
        tasks={[task('a', '2026-09-10', { assigned_to: 'u1' }), task('b', '2026-09-11'), task('c', '2026-09-16')]}
      />,
    );
    expect(screen.getByRole('heading', { name: /This week · 2/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Next week · 1/ })).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Today')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Thabo M')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Tomorrow')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Unassigned')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Wed 16 Sep')).toBeInTheDocument();
  });

  it('marks overdue tasks and calls onComplete for the clicked task', () => {
    const onComplete = vi.fn();
    render(<UpcomingTasks today={TODAY} members={members} onComplete={onComplete} tasks={[task('late', '2026-09-08'), task('a', TODAY)]} />);
    expect(screen.getByRole('heading', { name: /Overdue · 1/ })).toHaveClass('text-destructive');
    fireEvent.click(screen.getByRole('button', { name: 'Complete Task late' }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 'late' }));
  });

  it('only offers the assignee change when canAssign allows it', () => {
    const { rerender } = render(<UpcomingTasks today={TODAY} members={members} onComplete={() => {}} onAssign={() => {}} tasks={[task('a', TODAY)]} />);
    expect(screen.queryByRole('button', { name: /Change assignee/ })).toBeNull();
    rerender(<UpcomingTasks today={TODAY} members={members} onComplete={() => {}} onAssign={() => {}} canAssign={() => true} tasks={[task('a', TODAY)]} />);
    expect(screen.getByRole('button', { name: 'Change assignee for Task a' })).toBeInTheDocument();
  });

  it('shows the empty state when nothing is due', () => {
    render(<UpcomingTasks today={TODAY} members={members} onComplete={() => {}} tasks={[]} />);
    expect(screen.getByText('Nothing due in the next 30 days.')).toBeInTheDocument();
  });
});
