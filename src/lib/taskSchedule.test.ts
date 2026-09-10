import { describe, it, expect } from 'vitest';
import fixture from '../../docs/fixtures/frequency-due-dates.json';
import { scheduledDueDate } from './taskSchedule';

describe('scheduledDueDate mirrors public.scheduled_due_date', () => {
  for (const row of fixture) {
    it(`${row.frequency} on ${row.today} -> ${row.expected}`, () => {
      expect(scheduledDueDate(row.frequency as never, row.today)).toBe(row.expected);
    });
  }
  it('unknown frequency falls back to today', () => {
    expect(scheduledDueDate('never' as never, '2026-09-10')).toBe('2026-09-10');
  });
});
