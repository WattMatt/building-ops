import { describe, it, expect } from 'vitest';
import { taskCompletionPct } from './buildingScore';

describe('taskCompletionPct', () => {
  it('computes completed ÷ (completed+pending+overdue)', () => {
    expect(taskCompletionPct({ completed: 7, pending: 2, overdue: 1 })).toBe(70);
  });
  it('all complete → 100', () => {
    expect(taskCompletionPct({ completed: 5, pending: 0, overdue: 0 })).toBe(100);
  });
  it('none complete → 0', () => {
    expect(taskCompletionPct({ completed: 0, pending: 3, overdue: 1 })).toBe(0);
  });
  it('no tasks → null (honest empty-state)', () => {
    expect(taskCompletionPct({ completed: 0, pending: 0, overdue: 0 })).toBeNull();
  });
  it('rounds to nearest integer', () => {
    expect(taskCompletionPct({ completed: 1, pending: 2, overdue: 0 })).toBe(33);
  });
});
