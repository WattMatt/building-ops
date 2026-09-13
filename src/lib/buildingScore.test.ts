import { describe, it, expect } from 'vitest';
import { UNSCORED_STATUSES, countForScore, taskCompletionPct } from './buildingScore';

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

describe('countForScore', () => {
  it('counts completed, pending and overdue and nothing else', () => {
    expect(countForScore(['completed', 'completed', 'pending', 'overdue', 'issue_logged', 'wont_do', null, 'anything'])).toEqual({
      completed: 2, pending: 1, overdue: 1,
    });
  });
  it('names exactly the two statuses that are outside the score: issue_logged (as before) and wont_do (S6b)', () => {
    expect([...UNSCORED_STATUSES].sort()).toEqual(['issue_logged', 'wont_do']);
    // A building whose only tasks are can't-dos has no score, not a 0 % one.
    expect(taskCompletionPct(countForScore(['wont_do', 'wont_do', 'issue_logged']))).toBeNull();
    // A can't-do beside one completion is 100 %, not 50 %.
    expect(taskCompletionPct(countForScore(['completed', 'wont_do']))).toBe(100);
  });
});
