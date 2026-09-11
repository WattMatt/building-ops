import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MyTask } from '@/lib/myWork';
import type { MyIssue } from '@/hooks/useMyWork';
import type { MySignoff } from '@/hooks/useMySignoffs';

// The real hook reaches for the Supabase client; the strip only needs to know hints are on.
vi.mock('@/hooks/useHints', () => ({
  useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }),
}));

import { WeekStrip, weekCounts, dayLabel } from './WeekStrip';

const task = (id: string, due_date: string): MyTask => ({
  id,
  task_name: `Task ${id}`,
  task_description: null,
  due_date,
  building_id: 'b1',
  building_name: 'Alpha Tower',
  requires_photo: false,
  requires_signature: false,
  status: 'pending',
});

const issue = (id: string, deadline: string | null): MyIssue => ({
  id,
  title: `Issue ${id}`,
  priority: 'high',
  status: 'open',
  deadline,
  building_id: 'b1',
  building_name: 'Alpha Tower',
  created_at: '2026-09-01T08:00:00Z',
  reported_by: 'u2',
  assigned_to: 'u1',
  description: '',
  corrective_action: null,
  photo_urls: null,
  task_instance_id: null,
});

const signoff = (id: string, due_at: string | null): MySignoff => ({
  id,
  submission_id: `s-${id}`,
  due_at,
  sequence_order: 1,
  form_name: 'Fire drill',
  building_name: 'Alpha Tower',
});

const TODAY = '2026-09-10';

describe('weekCounts', () => {
  it('returns seven consecutive days starting today, each with zero counts by default', () => {
    const days = weekCounts(TODAY, [], [], []);
    expect(days.map((d) => d.date)).toEqual([
      '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16',
    ]);
    expect(days.every((d) => d.tasks === 0 && d.issues === 0 && d.signoffs === 0)).toBe(true);
  });

  it('crosses a month end without skipping or repeating a day', () => {
    const days = weekCounts('2026-09-28', [], [], []);
    expect(days.map((d) => d.date)).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
  });

  it('counts tasks, issue deadlines and sign-offs under the right day and ignores the rest', () => {
    const days = weekCounts(
      TODAY,
      [task('t1', TODAY), task('t2', TODAY), task('t3', '2026-09-12'), task('old', '2026-09-09'), task('far', '2026-09-17')],
      [issue('i1', '2026-09-12'), issue('i2', null), issue('i3', '2026-09-30')],
      [
        // 23:30 UTC on the 11th is 01:30 SAST on the 12th — the operating day wins.
        signoff('s1', '2026-09-11T23:30:00Z'),
        signoff('s2', '2026-09-10T06:00:00Z'),
        signoff('s3', null),
        signoff('s4', 'not a date'),
      ],
    );
    expect(days[0]).toEqual({ date: TODAY, tasks: 2, issues: 0, signoffs: 1 });
    expect(days[2]).toEqual({ date: '2026-09-12', tasks: 1, issues: 1, signoffs: 1 });
    const total = days.reduce((n, d) => n + d.tasks + d.issues + d.signoffs, 0);
    expect(total).toBe(6);
  });
});

describe('dayLabel', () => {
  it('spells out the breakdown with plurals, and says when nothing is due', () => {
    expect(dayLabel({ date: '2026-09-16', tasks: 3, issues: 1, signoffs: 0 })).toBe('Wed 16 Sep: 3 tasks, 1 issue');
    expect(dayLabel({ date: '2026-09-16', tasks: 1, issues: 0, signoffs: 2 })).toBe('Wed 16 Sep: 1 task, 2 sign-offs');
    expect(dayLabel({ date: '2026-09-16', tasks: 0, issues: 0, signoffs: 0 })).toBe('Wed 16 Sep: nothing due');
  });
});

describe('WeekStrip', () => {
  const renderStrip = (props: Partial<Parameters<typeof WeekStrip>[0]> = {}) =>
    render(
      <MemoryRouter>
        <WeekStrip today={TODAY} tasks={[]} issues={[]} signoffs={[]} {...props} />
      </MemoryRouter>,
    );

  it('renders seven day links into the calendar week view, today first and marked current', () => {
    renderStrip();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(7);
    expect(links[0]).toHaveAttribute('href', '/calendar?date=2026-09-10&view=week');
    expect(links[0]).toHaveAttribute('aria-current', 'date');
    expect(links[6]).toHaveAttribute('href', '/calendar?date=2026-09-16&view=week');
    expect(links[1]).not.toHaveAttribute('aria-current');
  });

  it('puts the counts in the accessible name and the total in the column', () => {
    renderStrip({
      tasks: [task('t1', '2026-09-16'), task('t2', '2026-09-16'), task('t3', '2026-09-16')],
      issues: [issue('i1', '2026-09-16')],
    });
    const wed = screen.getByRole('link', { name: 'Wed 16 Sep: 3 tasks, 1 issue' });
    expect(wed).toHaveTextContent('4');
    expect(screen.getByRole('link', { name: 'Thu 10 Sep: nothing due' })).toBeInTheDocument();
  });

  it('lets the page decide where a day goes', () => {
    renderStrip({ onDayHref: (date) => `/elsewhere/${date}` });
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', '/elsewhere/2026-09-10');
  });

  it('shows the coaching line through the hints layer', () => {
    renderStrip();
    expect(screen.getByText('Tap a day to open it in the calendar.')).toBeInTheDocument();
  });
});
