import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MyTask } from '@/lib/myWork';
import { TaskRow, dueLabel, queuedStateFor } from './TaskRow';

const task: MyTask = {
  id: 't1',
  task_name: 'Check fire extinguishers',
  task_description: null,
  due_date: '2026-09-09',
  building_id: 'b1',
  building_name: 'Alpha Tower',
  requires_photo: true,
  requires_signature: false,
  status: 'overdue',
};
const TODAY = '2026-09-10';

describe('dueLabel', () => {
  it('reads today, a past date and a future date against the operating day', () => {
    expect(dueLabel('2026-09-10', TODAY)).toBe('Due today');
    expect(dueLabel('2026-09-09', TODAY)).toBe('Was due Wed 9 Sep');
    expect(dueLabel('2026-09-14', TODAY)).toBe('Due Mon 14 Sep');
  });

  it('falls back to the raw value when the date does not parse', () => {
    expect(dueLabel('not-a-date', TODAY)).toBe('not-a-date');
  });
});

describe('queuedStateFor', () => {
  it('is none, queued or failed — and failed wins over queued', () => {
    expect(queuedStateFor('t1', new Set(), new Set())).toBe('none');
    expect(queuedStateFor('t1', new Set(['t1']), new Set())).toBe('queued');
    expect(queuedStateFor('t1', new Set(['t1']), new Set(['t1']))).toBe('failed');
    expect(queuedStateFor('t2', new Set(['t1']), new Set(['t1']))).toBe('none');
  });
});

describe('TaskRow', () => {
  it('shows the task, the building and the due line, and hands the task to onComplete', () => {
    const onComplete = vi.fn();
    render(<TaskRow task={task} today={TODAY} queued="none" onComplete={onComplete} showBuilding />);
    expect(screen.getByText('Check fire extinguishers')).toBeInTheDocument();
    // One <p> made of several text nodes, exactly as My Day renders it.
    expect(screen.getByText(/ALPHA TOWER · Was due Wed 9 Sep/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /complete/i }));
    expect(onComplete).toHaveBeenCalledWith(task);
  });

  it('leaves the building out when the page already is the building', () => {
    render(<TaskRow task={task} today={TODAY} queued="none" onComplete={vi.fn()} showBuilding={false} />);
    expect(screen.getByText('Was due Wed 9 Sep')).toBeInTheDocument();
    expect(screen.queryByText(/ALPHA TOWER/)).toBeNull();
  });

  it('replaces Complete with a Queued chip while the completion waits to sync', () => {
    render(<TaskRow task={task} today={TODAY} queued="queued" onComplete={vi.fn()} showBuilding />);
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /complete/i })).toBeNull();
  });

  it('says a rejected completion needs attention', () => {
    render(<TaskRow task={task} today={TODAY} queued="failed" onComplete={vi.fn()} showBuilding />);
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.queryByText('Queued')).toBeNull();
    expect(screen.queryByRole('button', { name: /complete/i })).toBeNull();
  });

  it('keeps the 56 px phone tap target on the row and 40 px on the action', () => {
    const { container } = render(<TaskRow task={task} today={TODAY} queued="none" onComplete={vi.fn()} showBuilding />);
    expect(container.firstElementChild?.className).toMatch(/\bmin-h-14\b/);
    expect(screen.getByRole('button', { name: /complete/i }).className).toMatch(/\bh-10\b/);
  });
});
