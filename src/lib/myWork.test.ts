import { describe, it, expect } from 'vitest';
import { bucketTasks, greetingFor } from './myWork';

const t = (id: string, due_date: string) => ({ id, task_name: id, due_date, building_id: 'b', building_name: 'B', requires_photo: false, requires_signature: false, task_description: null, status: 'pending' as const });

describe('bucketTasks', () => {
  it('splits overdue / today / upcoming (next 7 days) and drops the rest', () => {
    const r = bucketTasks([t('a', '2026-09-09'), t('b', '2026-09-10'), t('c', '2026-09-15'), t('d', '2026-09-18')], '2026-09-10');
    expect(r.overdue.map((x) => x.id)).toEqual(['a']);
    expect(r.today.map((x) => x.id)).toEqual(['b']);
    expect(r.upcoming.map((x) => x.id)).toEqual(['c']);
  });
  it('sorts each bucket by due date', () => {
    const r = bucketTasks([t('a', '2026-09-08'), t('b', '2026-09-07')], '2026-09-10');
    expect(r.overdue.map((x) => x.id)).toEqual(['b', 'a']);
  });
  it('includes the today+7 boundary in upcoming and excludes today+8', () => {
    const r = bucketTasks([t('in', '2026-09-17'), t('out', '2026-09-18')], '2026-09-10');
    expect(r.upcoming.map((x) => x.id)).toEqual(['in']);
    expect(r.overdue).toEqual([]);
    expect(r.today).toEqual([]);
  });
});

describe('greetingFor', () => {
  it('uses the hour and first name', () => {
    expect(greetingFor('Thabo Mokoena', 8)).toBe('Good morning, Thabo');
    expect(greetingFor(null, 14)).toBe('Good afternoon');
    expect(greetingFor('Ann', 20)).toBe('Good evening, Ann');
  });
  it('uses afternoon at hour 12 and evening at hour 18', () => {
    expect(greetingFor('Ann', 12)).toBe('Good afternoon, Ann');
    expect(greetingFor('Ann', 18)).toBe('Good evening, Ann');
  });
});
