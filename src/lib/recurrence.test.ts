import { describe, it, expect } from 'vitest';
import fixture from '../../docs/fixtures/recurrence-occurrences.json';
import {
  occurrences,
  isValidRule,
  legacyFrequency,
  describeRule,
  ruleFromFrequency,
  nextOccurrences,
  type RecurrenceRule,
} from './recurrence';
import { ALL_FREQUENCIES } from './taskSchedule';

type Row = { rule: RecurrenceRule; from: string; to: string; expected: string[] };
const rows = fixture as Row[];

describe('occurrences — pinned to docs/fixtures/recurrence-occurrences.json', () => {
  it('has the eleven fixture rows', () => {
    expect(rows).toHaveLength(11);
  });

  for (const row of rows) {
    const name = `${JSON.stringify(row.rule)} ${row.from}..${row.to}`;
    it(name, () => {
      expect(occurrences(row.rule, row.from, row.to)).toEqual(row.expected);
    });
  }

  it('month: anchors on the first occurrence on or after from, then steps every N months', () => {
    // 2026-09-01 < from, so the anchor is 2026-10-01; then +6 months from there.
    expect(occurrences({ every: 6, unit: 'month', monthDay: 1 }, '2026-09-10', '2027-12-31')).toEqual([
      '2026-10-01', '2027-04-01', '2027-10-01',
    ]);
  });

  it('year: anchors on the first occurrence on or after from, then steps every N years', () => {
    // 2026-01-01 < from, so the anchor is 2027-01-01; then +2 years from there.
    expect(occurrences({ every: 2, unit: 'year', month: 1, monthDay: 1 }, '2026-09-10', '2029-12-31')).toEqual([
      '2027-01-01', '2029-01-01',
    ]);
  });

  it('month: clamps monthDay per occurrence month after anchoring', () => {
    expect(occurrences({ every: 2, unit: 'month', monthDay: 31 }, '2026-01-15', '2026-06-30')).toEqual([
      '2026-01-31', '2026-03-31', '2026-05-31',
    ]);
  });

  it('returns nothing when to < from', () => {
    expect(occurrences({ every: 1, unit: 'day' }, '2026-09-10', '2026-09-09')).toEqual([]);
  });

  it('ignores lead (visibility, not due date)', () => {
    expect(occurrences({ every: 1, unit: 'day', lead: 5 }, '2026-09-10', '2026-09-12')).toEqual([
      '2026-09-10', '2026-09-11', '2026-09-12',
    ]);
  });

  it('caps at 400 dates', () => {
    expect(occurrences({ every: 1, unit: 'day' }, '2020-01-01', '2030-01-01')).toHaveLength(400);
  });

  it('month: defaults monthDay to 1', () => {
    expect(occurrences({ every: 1, unit: 'month' }, '2026-09-01', '2026-10-31')).toEqual(['2026-09-01', '2026-10-01']);
  });

  it('year: clamps 29 Feb to the month length and honours "last"', () => {
    expect(occurrences({ every: 1, unit: 'year', month: 2, monthDay: 31 }, '2027-01-01', '2028-12-31')).toEqual([
      '2027-02-28', '2028-02-29',
    ]);
    expect(occurrences({ every: 1, unit: 'year', month: 2, monthDay: 'last' }, '2027-01-01', '2028-12-31')).toEqual([
      '2027-02-28', '2028-02-29',
    ]);
  });

  it('week: Sunday (7) belongs to the Monday-start week that contains it', () => {
    // 2026-09-13 is a Sunday in the week starting Monday 2026-09-07.
    expect(occurrences({ every: 1, unit: 'week', weekdays: [7] }, '2026-09-13', '2026-09-20')).toEqual([
      '2026-09-13', '2026-09-20',
    ]);
  });
});

describe('isValidRule — mirror of public.recurrence_is_valid', () => {
  const accept: unknown[] = [
    { every: 1, unit: 'day' },
    { every: 52, unit: 'day' },
    { every: 1, unit: 'week', weekdays: [1, 3, 5] },
    { every: 2, unit: 'week', weekdays: [7] },
    { every: 1, unit: 'month' },
    { every: 1, unit: 'month', monthDay: 31 },
    { every: 1, unit: 'month', monthDay: 'last' },
    { every: 1, unit: 'year', month: 12 },
    { every: 1, unit: 'year', month: 1, monthDay: 1 },
    { every: 1, unit: 'day', lead: 0 },
    { every: 1, unit: 'day', lead: 60 },
  ];
  const reject: unknown[] = [
    null,
    undefined,
    'daily',
    42,
    [],
    {},
    { every: 1 },
    { unit: 'day' },
    { every: 1, unit: 'fortnight' },
    { every: 0, unit: 'day' },
    { every: 53, unit: 'day' },
    { every: -1, unit: 'day' },
    { every: 1.5, unit: 'day' },
    { every: '1', unit: 'day' },
    { every: 1, unit: 'week' }, // weekdays required for week
    { every: 1, unit: 'week', weekdays: [] }, // ...and at least one of them, else nothing ever generates
    { every: 1, unit: 'week', weekdays: 1 },
    { every: 1, unit: 'week', weekdays: [0] },
    { every: 1, unit: 'week', weekdays: [8] },
    { every: 1, unit: 'week', weekdays: [1, 2.5] },
    { every: 1, unit: 'week', weekdays: ['1'] },
    { every: 1, unit: 'month', monthDay: 0 },
    { every: 1, unit: 'month', monthDay: 32 },
    { every: 1, unit: 'month', monthDay: 'first' },
    { every: 1, unit: 'month', monthDay: 1.5 },
    { every: 1, unit: 'year' }, // month required for year
    { every: 1, unit: 'year', month: 0 },
    { every: 1, unit: 'year', month: 13 },
    { every: 1, unit: 'year', month: '1' },
    { every: 1, unit: 'day', lead: -1 },
    { every: 1, unit: 'day', lead: 61 },
    { every: 1, unit: 'day', lead: 1.5 },
  ];

  for (const r of accept) it(`accepts ${JSON.stringify(r)}`, () => expect(isValidRule(r)).toBe(true));
  for (const r of reject) it(`rejects ${JSON.stringify(r)}`, () => expect(isValidRule(r)).toBe(false));
});

describe('legacyFrequency — mirror of public.legacy_frequency', () => {
  it.each<[RecurrenceRule, string]>([
    [{ every: 1, unit: 'day' }, 'daily'],
    [{ every: 3, unit: 'day' }, 'daily'],
    [{ every: 2, unit: 'week', weekdays: [1] }, 'weekly'],
    [{ every: 1, unit: 'month', monthDay: 1 }, 'monthly'],
    [{ every: 2, unit: 'month', monthDay: 1 }, 'monthly'],
    [{ every: 3, unit: 'month', monthDay: 15 }, 'quarterly'],
    [{ every: 6, unit: 'month', monthDay: 1 }, 'quarterly'],
    [{ every: 12, unit: 'month', monthDay: 1 }, 'monthly'],
    [{ every: 1, unit: 'year', month: 1, monthDay: 1 }, 'annually'],
    [{ every: 2, unit: 'year', month: 6 }, 'annually'],
  ])('%j -> %s', (rule, expected) => {
    expect(legacyFrequency(rule)).toBe(expected);
  });
});

describe('describeRule', () => {
  it.each<[RecurrenceRule, string]>([
    [{ every: 1, unit: 'day' }, 'Every day'],
    [{ every: 2, unit: 'day' }, 'Every 2 days'],
    [{ every: 1, unit: 'week', weekdays: [1] }, 'Weekly on Mon'],
    [{ every: 2, unit: 'week', weekdays: [1, 3] }, 'Every 2 weeks on Mon, Wed'],
    [{ every: 1, unit: 'week', weekdays: [5, 1, 7] }, 'Weekly on Mon, Fri, Sun'],
    [{ every: 1, unit: 'month', monthDay: 1 }, 'Monthly on the 1st'],
    [{ every: 1, unit: 'month' }, 'Monthly on the 1st'],
    [{ every: 1, unit: 'month', monthDay: 2 }, 'Monthly on the 2nd'],
    [{ every: 1, unit: 'month', monthDay: 3 }, 'Monthly on the 3rd'],
    [{ every: 1, unit: 'month', monthDay: 11 }, 'Monthly on the 11th'],
    [{ every: 1, unit: 'month', monthDay: 12 }, 'Monthly on the 12th'],
    [{ every: 1, unit: 'month', monthDay: 13 }, 'Monthly on the 13th'],
    [{ every: 1, unit: 'month', monthDay: 21 }, 'Monthly on the 21st'],
    [{ every: 1, unit: 'month', monthDay: 22 }, 'Monthly on the 22nd'],
    [{ every: 1, unit: 'month', monthDay: 23 }, 'Monthly on the 23rd'],
    [{ every: 1, unit: 'month', monthDay: 31 }, 'Monthly on the 31st'],
    [{ every: 3, unit: 'month', monthDay: 15 }, 'Every 3 months on the 15th'],
    [{ every: 6, unit: 'month', monthDay: 'last' }, 'Every 6 months on the last day'],
    [{ every: 1, unit: 'month', monthDay: 'last' }, 'Monthly on the last day'],
    [{ every: 1, unit: 'year', month: 1, monthDay: 1 }, 'Yearly on 1 Jan'],
    [{ every: 1, unit: 'year', month: 12 }, 'Yearly on 1 Dec'],
    [{ every: 2, unit: 'year', month: 6, monthDay: 30 }, 'Every 2 years on 30 Jun'],
    [{ every: 1, unit: 'year', month: 2, monthDay: 'last' }, 'Yearly on the last day of Feb'],
  ])('%j -> %s', (rule, expected) => {
    expect(describeRule(rule)).toBe(expected);
  });
});

describe('ruleFromFrequency', () => {
  it.each<[string, RecurrenceRule]>([
    ['daily', { every: 1, unit: 'day' }],
    ['weekly', { every: 1, unit: 'week', weekdays: [1] }],
    ['monthly', { every: 1, unit: 'month', monthDay: 1 }],
    ['quarterly', { every: 3, unit: 'month', monthDay: 1 }],
    ['annually', { every: 1, unit: 'year', month: 1, monthDay: 1 }],
  ])('%s -> %j', (freq, expected) => {
    expect(ruleFromFrequency(freq as (typeof ALL_FREQUENCIES)[number])).toEqual(expected);
  });

  it('round-trips through legacyFrequency for every legacy bucket', () => {
    for (const f of ALL_FREQUENCIES) {
      const rule = ruleFromFrequency(f);
      expect(isValidRule(rule)).toBe(true);
      expect(legacyFrequency(rule)).toBe(f);
    }
  });
});

describe('nextOccurrences', () => {
  it('returns exactly n dates on or after from, in order', () => {
    const out = nextOccurrences({ every: 1, unit: 'week', weekdays: [1, 3, 5] }, 5, '2026-09-10');
    expect(out).toEqual(['2026-09-11', '2026-09-14', '2026-09-16', '2026-09-18', '2026-09-21']);
  });

  it('includes from itself when it matches', () => {
    expect(nextOccurrences({ every: 1, unit: 'day' }, 3, '2026-09-10')).toEqual([
      '2026-09-10', '2026-09-11', '2026-09-12',
    ]);
  });

  it('returns exactly n for a sparse rule when 3 years hold enough', () => {
    expect(nextOccurrences({ every: 1, unit: 'year', month: 1, monthDay: 1 }, 3, '2026-09-10')).toEqual([
      '2027-01-01', '2028-01-01', '2029-01-01',
    ]);
  });

  it('returns fewer than n when 3 years do not hold enough', () => {
    // Anchor 2027-01-01 (2026-01-01 < from), then every 2 years; 2031 is past the 3-year scan.
    expect(nextOccurrences({ every: 2, unit: 'year', month: 1, monthDay: 1 }, 5, '2026-09-10')).toEqual([
      '2027-01-01', '2029-01-01',
    ]);
  });

  it('returns [] for n <= 0', () => {
    expect(nextOccurrences({ every: 1, unit: 'day' }, 0, '2026-09-10')).toEqual([]);
  });
});
