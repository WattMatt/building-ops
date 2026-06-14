import { describe, it, expect } from 'vitest';
import { computeHsScores, scoreBand, summarizePortfolio, type HsScoreTask, type HsScoreDocument } from './hsScore';

const T = (over: Partial<HsScoreTask>): HsScoreTask => ({
  building_id: 'b1', status: 'pending', due_date: '2026-06-01', category: 'fire_safety', ...over,
});
const D = (over: Partial<HsScoreDocument>): HsScoreDocument => ({
  building_id: 'b1', expiry_date: null, ...over,
});

describe('computeHsScores', () => {
  const today = new Date('2026-06-11');
  it('scores completion percentage per building', () => {
    const rows = computeHsScores(
      [
        { id: 'b1', name: 'Alpha' },
        { id: 'b2', name: 'Beta' },
      ],
      [
        T({ building_id: 'b1', status: 'completed' }),
        T({ building_id: 'b1', status: 'completed' }),
        T({ building_id: 'b1', status: 'pending' }),
        T({ building_id: 'b2', status: 'completed' }),
      ],
      [], today
    );
    expect(rows.find((r) => r.building_id === 'b1')!.score).toBe(67);
    expect(rows.find((r) => r.building_id === 'b2')!.score).toBe(100);
  });
  it('buildings with no H&S tasks get a null score', () => {
    const rows = computeHsScores([{ id: 'b9', name: 'Empty' }], [], [], today);
    expect(rows[0].score).toBeNull();
    expect(rows[0].total).toBe(0);
  });
  it('flags buildings with an expired certificate', () => {
    const rows = computeHsScores(
      [{ id: 'b1', name: 'Alpha' }],
      [T({ status: 'completed' })],
      [D({ expiry_date: '2026-06-01' }), D({ expiry_date: '2027-01-01' })],
      today
    );
    expect(rows[0].hasExpiredCert).toBe(true);
  });
  it('does not flag current or no-expiry certificates', () => {
    const rows = computeHsScores(
      [{ id: 'b1', name: 'Alpha' }],
      [],
      [D({ expiry_date: '2027-01-01' }), D({ expiry_date: null })],
      today
    );
    expect(rows[0].hasExpiredCert).toBe(false);
  });
  it('sorts worst score first, null scores last', () => {
    const rows = computeHsScores(
      [
        { id: 'b1', name: 'Good' },
        { id: 'b2', name: 'Bad' },
        { id: 'b3', name: 'Empty' },
      ],
      [
        T({ building_id: 'b1', status: 'completed' }),
        T({ building_id: 'b2', status: 'pending' }),
      ],
      [], today
    );
    expect(rows.map((r) => r.name)).toEqual(['Bad', 'Good', 'Empty']);
  });
});

describe('scoreBand', () => {
  it('bands at 90 and 70', () => {
    expect(scoreBand(95)).toBe('good');
    expect(scoreBand(90)).toBe('good');
    expect(scoreBand(89)).toBe('warning');
    expect(scoreBand(70)).toBe('warning');
    expect(scoreBand(69)).toBe('critical');
    expect(scoreBand(null)).toBe('none');
  });
});

describe('summarizePortfolio', () => {
  const rows = [
    { building_id: 'a', name: 'A', total: 10, completed: 10, score: 100, hasExpiredCert: false },
    { building_id: 'b', name: 'B', total: 10, completed: 8, score: 80, hasExpiredCert: true },
    { building_id: 'c', name: 'C', total: 10, completed: 5, score: 50, hasExpiredCert: false },
    { building_id: 'd', name: 'D', total: 0, completed: 0, score: null, hasExpiredCert: false },
  ];
  it('counts bands, averages only scored buildings, and counts expired certs', () => {
    const s = summarizePortfolio(rows);
    expect(s.total).toBe(4);
    expect(s.good).toBe(1);
    expect(s.warning).toBe(1);
    expect(s.critical).toBe(1);
    expect(s.none).toBe(1);
    expect(s.avgScore).toBe(77);
    expect(s.expiredCerts).toBe(1);
  });
  it('returns null average when no building has a score', () => {
    const s = summarizePortfolio([{ building_id: 'd', name: 'D', total: 0, completed: 0, score: null, hasExpiredCert: false }]);
    expect(s.avgScore).toBeNull();
    expect(s.none).toBe(1);
  });
});
