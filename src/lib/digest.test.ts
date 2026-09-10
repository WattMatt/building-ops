import { describe, it, expect } from 'vitest';
import { composeDigest } from '../../supabase/functions/_shared/digest';

const TODAY = '2026-09-11';

const empty = { today: TODAY, tasks: [], issues: [], unread: 0 };

describe('composeDigest', () => {
  it('returns null when there is nothing to say', () => {
    expect(composeDigest(empty)).toBeNull();
  });

  it('splits tasks into overdue and due-today by the today string', () => {
    const sections = composeDigest({
      ...empty,
      tasks: [
        { id: 't1', task_name: 'Fire extinguisher check', due_date: '2026-09-09', building_name: 'Alpha Court' },
        { id: 't2', task_name: 'Roof inspection', due_date: '2026-09-10', building_name: null },
        { id: 't3', task_name: 'Generator run-up', due_date: TODAY, building_name: 'Beta Place' },
      ],
    });
    expect(sections).not.toBeNull();
    expect(sections!.map((s) => s.heading)).toEqual(['2 overdue tasks', '1 due today']);
    expect(sections![0].lines).toEqual(['Fire extinguisher check — Alpha Court', 'Roof inspection']);
    expect(sections![1].lines).toEqual(['Generator run-up — Beta Place']);
  });

  it('singularises a lone overdue task', () => {
    const sections = composeDigest({
      ...empty,
      tasks: [{ id: 't1', task_name: 'Roof inspection', due_date: '2026-09-01', building_name: null }],
    });
    expect(sections!.map((s) => s.heading)).toEqual(['1 overdue task']);
  });

  it('lists open issues with priority and building', () => {
    const sections = composeDigest({
      ...empty,
      issues: [
        { id: 'i1', title: 'Lift stuck', priority: 'high', building_name: 'Alpha Court' },
        { id: 'i2', title: 'Leaking tap', priority: 'low', building_name: null },
      ],
    });
    expect(sections!.map((s) => s.heading)).toEqual(['2 open issues assigned to you']);
    expect(sections![0].lines).toEqual(['Lift stuck (high) — Alpha Court', 'Leaking tap (low)']);
  });

  it('gives an unread-only digest one section with no lines', () => {
    const sections = composeDigest({ ...empty, unread: 3 });
    expect(sections).toHaveLength(1);
    expect(sections![0]).toEqual({ heading: '3 unread notifications', lines: [] });
  });

  it('singularises a lone unread notification', () => {
    const sections = composeDigest({ ...empty, unread: 1 });
    expect(sections![0].heading).toBe('1 unread notification');
  });

  it('ignores tasks due after today', () => {
    expect(
      composeDigest({
        ...empty,
        tasks: [{ id: 't1', task_name: 'Later', due_date: '2026-09-20', building_name: null }],
      }),
    ).toBeNull();
  });

  it('orders the sections overdue, today, issues, unread', () => {
    const sections = composeDigest({
      today: TODAY,
      tasks: [
        { id: 't1', task_name: 'Old', due_date: '2026-09-01', building_name: null },
        { id: 't2', task_name: 'Now', due_date: TODAY, building_name: null },
      ],
      issues: [{ id: 'i1', title: 'Lift stuck', priority: 'high', building_name: null }],
      unread: 2,
    });
    expect(sections!.map((s) => s.heading)).toEqual([
      '1 overdue task',
      '1 due today',
      '1 open issue assigned to you',
      '2 unread notifications',
    ]);
  });
});
