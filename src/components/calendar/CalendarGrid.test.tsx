import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, fireEvent, within } from '@testing-library/react';
import type { CalendarEvent, CalendarKind } from '@/lib/calendar/events';

vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));

import { CalendarGrid, monthCells } from './CalendarGrid';
import { CalendarWeek, weekDays } from './CalendarWeek';
import { SourceFilters, applyFilters, useSourceFilters, filtersStorageKey } from './SourceFilters';

const TODAY = '2026-09-10';

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

/** The page-level wiring the grid expects: filter chips above, filtered events below. */
function Harness({ events, uid = 'me' }: { events: CalendarEvent[]; uid?: string }) {
  const { hidden, toggle } = useSourceFilters(uid);
  return (
    <>
      <SourceFilters events={events} hidden={hidden} onToggle={toggle} />
      <CalendarGrid month="2026-09-01" today={TODAY} events={applyFilters(events, hidden)} />
    </>
  );
}

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* not available */ }
});

describe('monthCells', () => {
  it('covers September 2026 with Monday-first weeks from 31 Aug to 4 Oct', () => {
    const weeks = monthCells('2026-09-15');
    expect(weeks[0][0]).toBe('2026-08-31');
    expect(weeks[weeks.length - 1][6]).toBe('2026-10-04');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
});

describe('CalendarGrid', () => {
  it('renders each event in its own day cell', () => {
    render(
      <CalendarGrid
        month="2026-09-01"
        today={TODAY}
        events={[ev({ kind: 'task', entityId: 't1', date: '2026-09-10', title: 'Check roof' }), ev({ kind: 'issue', entityId: 'i1', date: '2026-09-12', title: 'Leak' })]}
      />,
    );
    expect(within(screen.getByTestId('day-2026-09-10')).getByText('Check roof')).toBeInTheDocument();
    expect(within(screen.getByTestId('day-2026-09-12')).getByText('Leak')).toBeInTheDocument();
    expect(within(screen.getByTestId('day-2026-09-10')).queryByText('Leak')).not.toBeInTheDocument();
    // Today's number is marked for assistive tech as well as with the ring.
    expect(within(screen.getByTestId('day-2026-09-10')).getByRole('button', { name: /Open Thursday 10 September/ })).toHaveAttribute('aria-current', 'date');
  });

  it('shows three chips and a +N overflow that opens the day', () => {
    const onSelectDate = vi.fn();
    const events = ['a', 'b', 'c', 'd', 'e'].map((id) => ev({ kind: 'document', entityId: id, date: '2026-09-03', title: `Doc ${id}` }));
    render(<CalendarGrid month="2026-09-01" today={TODAY} events={events} onSelectDate={onSelectDate} />);
    const cell = screen.getByTestId('day-2026-09-03');
    expect(within(cell).getByText('Doc a')).toBeInTheDocument();
    expect(within(cell).getByText('Doc c')).toBeInTheDocument();
    expect(within(cell).queryByText('Doc d')).not.toBeInTheDocument();
    fireEvent.click(within(cell).getByRole('button', { name: /2 more/ }));
    expect(onSelectDate).toHaveBeenCalledWith('2026-09-03');
  });

  it('hides a kind when its filter chip is toggled off, and remembers the choice per user', () => {
    const events = [ev({ kind: 'task', entityId: 't1', date: '2026-09-10', title: 'Check roof' }), ev({ kind: 'issue', entityId: 'i1', date: '2026-09-10', title: 'Leak' })];
    render(<Harness events={events} />);
    expect(screen.getByText('Leak')).toBeInTheDocument();

    const filters = within(screen.getByRole('group', { name: 'Show on calendar' }));
    const issuesChip = filters.getByRole('button', { name: /^Issue\b/ });
    expect(issuesChip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(issuesChip);

    expect(issuesChip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Leak')).not.toBeInTheDocument();
    expect(screen.getByText('Check roof')).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(filtersStorageKey('me')) ?? '[]')).toEqual(['issue']);
    // The chip's accessible name is its label and count, nothing repeated ("Task 3 Task").
    expect(filters.getByRole('button', { name: 'Task 1' })).toBeInTheDocument();
    expect(filters.getByRole('button', { name: 'Issue 1' })).toBeInTheDocument();
  });

  it('re-reads the remembered filters when the user id changes (session resolves after mount)', () => {
    window.localStorage.setItem(filtersStorageKey('u2'), JSON.stringify(['task', 'ppm']));
    const { result, rerender } = renderHook(({ uid }: { uid: string | undefined }) => useSourceFilters(uid), { initialProps: { uid: undefined as string | undefined } });
    expect(result.current.hidden.size).toBe(0);

    rerender({ uid: 'u2' });
    expect([...result.current.hidden].sort()).toEqual(['ppm', 'task']);

    rerender({ uid: 'me' });
    expect(result.current.hidden.size).toBe(0);
  });

  it('calls onReschedule(taskId, date) when a task chip is dropped on another day', () => {
    const onReschedule = vi.fn();
    render(
      <CalendarGrid
        month="2026-09-01"
        today={TODAY}
        events={[ev({ kind: 'task', entityId: 't1', date: '2026-09-10', title: 'Check roof' })]}
        onReschedule={onReschedule}
      />,
    );
    const chip = screen.getByRole('button', { name: /Check roof/ });
    expect(chip).toHaveAttribute('draggable', 'true');
    const setData = vi.fn();
    fireEvent.dragStart(chip, { dataTransfer: { setData, effectAllowed: 'none', getData: () => '' } });
    expect(setData).toHaveBeenCalledWith('text/plain', 't1');

    const target = screen.getByTestId('day-2026-09-15');
    fireEvent.dragOver(target, { dataTransfer: { dropEffect: 'none', getData: () => 't1' } });
    fireEvent.drop(target, { dataTransfer: { getData: () => 't1' } });
    expect(onReschedule).toHaveBeenCalledWith('t1', '2026-09-15');
  });

  it('ignores a drop back onto the same day', () => {
    const onReschedule = vi.fn();
    render(<CalendarGrid month="2026-09-01" today={TODAY} events={[ev({ kind: 'task', entityId: 't1', date: '2026-09-10' })]} onReschedule={onReschedule} />);
    fireEvent.drop(screen.getByTestId('day-2026-09-10'), { dataTransfer: { getData: () => 't1' } });
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it('is read-only without onReschedule: chips are not draggable and drops do nothing', () => {
    render(<CalendarGrid month="2026-09-01" today={TODAY} events={[ev({ kind: 'task', entityId: 't1', date: '2026-09-10', title: 'Check roof' })]} />);
    expect(screen.getByRole('button', { name: /Check roof/ })).not.toHaveAttribute('draggable');
    expect(screen.queryByText(/press M/)).not.toBeInTheDocument();
  });

  it('offers a keyboard path: M on a focused task chip opens a date input that calls onReschedule', () => {
    const onReschedule = vi.fn();
    render(
      <CalendarGrid
        month="2026-09-01"
        today={TODAY}
        events={[ev({ kind: 'task', entityId: 't1', date: '2026-09-10', title: 'Check roof' }), ev({ kind: 'issue', entityId: 'i1', date: '2026-09-10', title: 'Leak' })]}
        onReschedule={onReschedule}
      />,
    );
    // Only tasks move: M on an issue does nothing.
    fireEvent.keyDown(screen.getByRole('button', { name: /Leak/ }), { key: 'm' });
    expect(screen.queryByLabelText(/Move Leak to/)).not.toBeInTheDocument();

    const chip = screen.getByRole('button', { name: /Check roof/ });
    chip.focus();
    fireEvent.keyDown(chip, { key: 'm' });
    const input = screen.getByLabelText('Move Check roof to') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.className).toMatch(/min-h-11/);

    fireEvent.change(input, { target: { value: '2026-09-18' } });
    expect(onReschedule).toHaveBeenCalledWith('t1', '2026-09-18');
    expect(screen.queryByLabelText('Move Check roof to')).not.toBeInTheDocument();
  });

  it('closes the date input on Escape without moving anything', () => {
    const onReschedule = vi.fn();
    render(<CalendarGrid month="2026-09-01" today={TODAY} events={[ev({ kind: 'task', entityId: 't1', date: '2026-09-10', title: 'Check roof' })]} onReschedule={onReschedule} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /Check roof/ }), { key: 'M' });
    const input = screen.getByLabelText('Move Check roof to');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('Move Check roof to')).not.toBeInTheDocument();
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it('strikes through done events and marks overdue ones', () => {
    render(
      <CalendarGrid
        month="2026-09-01"
        today={TODAY}
        events={[ev({ kind: 'task', entityId: 't1', date: '2026-09-02', title: 'Old', status: 'overdue' }), ev({ kind: 'task', entityId: 't2', date: '2026-09-02', title: 'Finished', status: 'done' })]}
      />,
    );
    expect(screen.getByText('Old').className).toMatch(/text-destructive/);
    expect(screen.getByText('Finished').className).toMatch(/line-through/);
  });
});

describe('CalendarWeek', () => {
  it('stacks seven Monday-first day sections with 44 px rows and reports taps', () => {
    const onSelectEvent = vi.fn();
    const event = ev({ kind: 'signoff', entityId: 's1', date: '2026-09-11', title: 'Fire check' });
    render(<CalendarWeek week="2026-09-10" today={TODAY} events={[event]} onSelectEvent={onSelectEvent} />);
    expect(weekDays('2026-09-10')).toEqual(['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']);
    expect(screen.getAllByRole('region')).toHaveLength(7);
    const friday = screen.getByTestId('week-day-2026-09-11');
    const row = within(friday).getByRole('button', { name: /Fire check/ });
    expect(row.className).toMatch(/min-h-11/);
    fireEvent.click(row);
    expect(onSelectEvent).toHaveBeenCalledWith(event);
    expect(within(screen.getByTestId('week-day-2026-09-07')).getByText('Nothing due.')).toBeInTheDocument();
  });

  it('is read-only without onReschedule: no Move buttons, no hint, M does nothing', () => {
    render(<CalendarWeek week="2026-09-10" today={TODAY} events={[ev({ kind: 'task', entityId: 't1', date: '2026-09-10', title: 'Check roof' })]} />);
    expect(screen.queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/press M/)).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: /Check roof/ }), { key: 'm' });
    expect(screen.queryByLabelText(/Move Check roof to/)).not.toBeInTheDocument();
  });

  it('gives each open task row a 44 px Move button that opens a 44 px date input calling onReschedule', () => {
    const onReschedule = vi.fn();
    render(
      <CalendarWeek
        week="2026-09-10"
        today={TODAY}
        events={[
          ev({ kind: 'task', entityId: 't1', date: '2026-09-10', title: 'Check roof' }),
          ev({ kind: 'task', entityId: 't2', date: '2026-09-10', title: 'Finished', status: 'done' }),
          ev({ kind: 'issue', entityId: 'i1', date: '2026-09-11', title: 'Leak' }),
        ]}
        onReschedule={onReschedule}
      />,
    );
    // Only open tasks move: the done task and the issue get no button.
    const moveButtons = screen.getAllByRole('button', { name: /^Move / });
    expect(moveButtons.map((b) => b.getAttribute('aria-label'))).toEqual(['Move Check roof']);
    expect(moveButtons[0].className).toMatch(/min-h-11/);
    expect(moveButtons[0].className).toMatch(/min-w-11/);
    expect(moveButtons[0]).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(moveButtons[0]);
    expect(moveButtons[0]).toHaveAttribute('aria-expanded', 'true');
    const input = screen.getByLabelText('Move Check roof to') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.className).toMatch(/min-h-11/);
    expect(input.value).toBe('2026-09-10');

    // Picking the same day is a no-op; picking another day moves the task and closes the input.
    fireEvent.change(input, { target: { value: '2026-09-10' } });
    expect(onReschedule).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '2026-09-18' } });
    expect(onReschedule).toHaveBeenCalledWith('t1', '2026-09-18');
    expect(screen.queryByLabelText('Move Check roof to')).not.toBeInTheDocument();
  });

  it('toggles the date input closed from the Move button and on Escape without moving anything', () => {
    const onReschedule = vi.fn();
    render(<CalendarWeek week="2026-09-10" today={TODAY} events={[ev({ kind: 'task', entityId: 't1', date: '2026-09-10', title: 'Check roof' })]} onReschedule={onReschedule} />);
    const move = screen.getByRole('button', { name: 'Move Check roof' });
    fireEvent.click(move);
    expect(screen.getByLabelText('Move Check roof to')).toBeInTheDocument();
    fireEvent.click(move);
    expect(screen.queryByLabelText('Move Check roof to')).not.toBeInTheDocument();

    fireEvent.click(move);
    fireEvent.keyDown(screen.getByLabelText('Move Check roof to'), { key: 'Escape' });
    expect(screen.queryByLabelText('Move Check roof to')).not.toBeInTheDocument();
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it('offers the same keyboard path as the grid: M on a focused task row opens the date input', () => {
    const onReschedule = vi.fn();
    render(
      <CalendarWeek
        week="2026-09-10"
        today={TODAY}
        events={[ev({ kind: 'task', entityId: 't1', date: '2026-09-10', title: 'Check roof' }), ev({ kind: 'issue', entityId: 'i1', date: '2026-09-10', title: 'Leak' })]}
        onReschedule={onReschedule}
      />,
    );
    expect(screen.getByText(/press M/)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: /Leak/ }), { key: 'm' });
    expect(screen.queryByLabelText(/Move Leak to/)).not.toBeInTheDocument();

    const row = screen.getByRole('button', { name: /^Task: Check roof/ });
    row.focus();
    fireEvent.keyDown(row, { key: 'M' });
    const input = screen.getByLabelText('Move Check roof to');
    fireEvent.change(input, { target: { value: '2026-09-14' } });
    expect(onReschedule).toHaveBeenCalledWith('t1', '2026-09-14');
  });
});
