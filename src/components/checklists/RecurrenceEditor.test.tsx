import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import type { RecurrenceRule } from '@/lib/recurrence';

// jsdom lacks the Pointer Events capture API Radix's Select opens with; polyfill so the
// unit picker is drivable here (same shim as AssigneePicker.test.tsx).
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

// A Thursday, so "weekly on Monday" previews start the following week.
vi.mock('@/lib/myWork', () => ({ todayInOperatingTz: () => '2026-09-10' }));

import RecurrenceEditor, { recurrenceProblem, formatIsoDay } from './RecurrenceEditor';

const onChange = vi.fn();

/** The editor is controlled; this harness plays the parent so chips and inputs round-trip. */
function Harness({ initial }: { initial: RecurrenceRule }) {
  const [rule, setRule] = useState(initial);
  return (
    <RecurrenceEditor
      value={rule}
      onChange={(next, valid) => {
        onChange(next, valid);
        setRule(next);
      }}
    />
  );
}

const weeklyMonday: RecurrenceRule = { every: 1, unit: 'week', weekdays: [1] };

describe('RecurrenceEditor', () => {
  it('renders the caption and the next six due dates as dd MMM yyyy', () => {
    render(<Harness initial={weeklyMonday} />);
    expect(screen.getByText('Weekly on Mon')).toBeInTheDocument();
    expect(screen.getByTestId('recurrence-preview')).toHaveTextContent(
      'Next: 14 Sep 2026, 21 Sep 2026, 28 Sep 2026, 05 Oct 2026, 12 Oct 2026, 19 Oct 2026',
    );
  });

  it('requires at least one weekday for a weekly rule and reports the invalid state', () => {
    onChange.mockClear();
    render(<Harness initial={weeklyMonday} />);
    fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
    expect(onChange).toHaveBeenLastCalledWith({ every: 1, unit: 'week', weekdays: [] }, false);
    expect(screen.getByRole('alert')).toHaveTextContent('Pick at least one weekday');
    expect(screen.queryByTestId('recurrence-preview')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    expect(onChange).toHaveBeenLastCalledWith({ every: 1, unit: 'week', weekdays: [3] }, true);
    expect(screen.getByText('Weekly on Wed')).toBeInTheDocument();
  });

  it('keeps weekdays sorted and emits valid=true when a second day is added', () => {
    onChange.mockClear();
    render(<Harness initial={{ every: 1, unit: 'week', weekdays: [3] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
    expect(onChange).toHaveBeenLastCalledWith({ every: 1, unit: 'week', weekdays: [1, 3] }, true);
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('changes the interval and the lead, flagging out-of-range values', () => {
    onChange.mockClear();
    render(<Harness initial={weeklyMonday} />);
    fireEvent.change(screen.getByLabelText('Every'), { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith({ every: 2, unit: 'week', weekdays: [1] }, true);
    expect(screen.getByText('Every 2 weeks on Mon')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Days before'), { target: { value: '7' } });
    expect(onChange).toHaveBeenLastCalledWith({ every: 2, unit: 'week', weekdays: [1], lead: 7 }, true);

    fireEvent.change(screen.getByLabelText('Every'), { target: { value: '99' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ every: 99 }), false);
    expect(screen.getByRole('alert')).toHaveTextContent('Repeat every 1 to 52 units');
  });

  it('switching to months drops the weekdays and seeds day 1', () => {
    onChange.mockClear();
    render(<Harness initial={{ every: 1, unit: 'week', weekdays: [1, 5] }} />);
    const trigger = screen.getByRole('combobox', { name: 'Unit' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    const option = screen.getByRole('option', { name: 'month' });
    fireEvent.pointerUp(option);
    fireEvent.click(option);
    expect(onChange).toHaveBeenLastCalledWith({ every: 1, unit: 'month', monthDay: 1 }, true);
    expect(screen.getByText('Monthly on the 1st')).toBeInTheDocument();
    expect(screen.getByTestId('recurrence-preview')).toHaveTextContent('Next: 01 Oct 2026, 01 Nov 2026');
    expect(screen.queryByRole('group', { name: 'Weekdays' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Day of month' })).toBeInTheDocument();
  });

  it('exposes the year pickers for a yearly rule', () => {
    render(<Harness initial={{ every: 1, unit: 'year', month: 3, monthDay: 'last' }} />);
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveTextContent('March');
    expect(screen.getByRole('combobox', { name: 'Day of month' })).toHaveTextContent('Last day');
    expect(screen.getByText('Yearly on the last day of Mar')).toBeInTheDocument();
  });
});

describe('recurrenceProblem', () => {
  it('layers the weekday requirement over isValidRule', () => {
    expect(recurrenceProblem({ every: 1, unit: 'week', weekdays: [] })).toBe('Pick at least one weekday');
    expect(recurrenceProblem({ every: 1, unit: 'week', weekdays: [7] })).toBeNull();
    expect(recurrenceProblem({ every: 0, unit: 'day' })).toBe('Repeat every 1 to 52 units');
    expect(recurrenceProblem({ every: 1, unit: 'day', lead: 61 })).toBe('Show between 0 and 60 days before');
    expect(recurrenceProblem({ every: 1, unit: 'year' })).toBe('This schedule is not valid');
  });
});

describe('formatIsoDay', () => {
  it('never lets the local zone shift the calendar day', () => {
    expect(formatIsoDay('2026-01-01')).toBe('01 Jan 2026');
    expect(formatIsoDay('2026-12-31')).toBe('31 Dec 2026');
  });
});
