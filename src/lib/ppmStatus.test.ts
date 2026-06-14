import { describe, it, expect } from 'vitest';
import { doneMonths, hasDoneCell, ppmCompletion, type PpmServiceLike } from './ppmStatus';

const svc = (months: PpmServiceLike['months']): PpmServiceLike => ({ months });

describe('doneMonths', () => {
  it('returns only the months whose status is exactly "done", sorted', () => {
    const s = svc({
      '2025-09': { status: 'due' },
      '2025-08': { status: 'done', date: '2025-08-12' },
      '2025-11': { status: 'done' },
      '2025-10': { status: 'missed' },
    });
    expect(doneMonths(s)).toEqual(['2025-08', '2025-11']);
  });
  it('returns an empty array for blank / null months', () => {
    expect(doneMonths(svc({}))).toEqual([]);
    expect(doneMonths({ months: null })).toEqual([]);
    expect(doneMonths({})).toEqual([]);
  });
});

describe('hasDoneCell', () => {
  it('is true when any cell is done', () => {
    expect(hasDoneCell(svc({ '2025-08': { status: 'done' } }))).toBe(true);
  });
  it('is false when no cell is done (blank, na, due, missed do not count)', () => {
    expect(hasDoneCell(svc({}))).toBe(false);
    expect(hasDoneCell(svc({ '2025-08': { status: 'na' } }))).toBe(false);
    expect(hasDoneCell(svc({ '2025-08': { status: 'due' }, '2025-09': { status: 'missed' } }))).toBe(false);
  });
});

describe('ppmCompletion (K11)', () => {
  it('counts a service with a done cell; blank/na/due/missed do not count as done', () => {
    const services: PpmServiceLike[] = [
      svc({ '2025-08': { status: 'done' } }),       // counts
      svc({ '2025-08': { status: 'na' } }),         // no
      svc({ '2025-08': { status: 'due' } }),        // no
      svc({ '2025-08': { status: 'missed' } }),     // no
      svc({}),                                      // no
    ];
    const r = ppmCompletion(services);
    expect(r.doneCount).toBe(1);
    expect(r.total).toBe(5);
    expect(r.pct).toBe(20);
  });

  it('rounds the percentage', () => {
    // 7 of 25 done → 28%, matching AbaQulusi's seeded report
    const services = Array.from({ length: 25 }, (_, i) =>
      svc(i < 7 ? { '2025-08': { status: 'done' } } : {}),
    );
    const r = ppmCompletion(services);
    expect(r.doneCount).toBe(7);
    expect(r.total).toBe(25);
    expect(r.pct).toBe(28);
  });

  it('returns null pct for no services (honest empty-state)', () => {
    const r = ppmCompletion([]);
    expect(r.total).toBe(0);
    expect(r.doneCount).toBe(0);
    expect(r.pct).toBeNull();
  });
});
