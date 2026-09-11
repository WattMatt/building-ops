import { describe, it, expect } from 'vitest';
import {
  asPpmStatus, colHeader, derivedByService, doneMonthsFromGrid, fiscalWindow, gridHasData, legacyMonthsOf, mergePpmGrid,
  mergePpmGrids, occurrenceSummary, overridesOf, ppmCompletionFromGrid,
  type DerivedRow, type PpmGridRow,
} from './ppmGrid';

const WINDOW = fiscalWindow('2026-09-01');
const row = (period_month: string, status: string, extra: Partial<DerivedRow> = {}): DerivedRow =>
  ({ ppm_service_id: 'p1', period_month, status, ...extra });

describe('fiscalWindow', () => {
  it('starts in July of the same year for months from July on', () => {
    expect(fiscalWindow('2026-09-01')).toEqual([
      '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
      '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06',
    ]);
  });
  it('starts in July of the previous year for January to June', () => {
    expect(fiscalWindow('2026-03-01')[0]).toBe('2025-07');
    expect(fiscalWindow('2026-03-01')[11]).toBe('2026-06');
  });
  it('accepts a Date and defaults to today', () => {
    expect(fiscalWindow(new Date(2026, 6, 15))[0]).toBe('2026-07');
    expect(fiscalWindow()).toHaveLength(12);
  });
  it('turns over on 1 July: 30 June belongs to the previous fiscal year', () => {
    expect(fiscalWindow('2026-06-30')[0]).toBe('2025-07');
    expect(fiscalWindow('2026-06-30')[11]).toBe('2026-06');
    expect(fiscalWindow('2026-07-01')[0]).toBe('2026-07');
    expect(fiscalWindow('2026-07-01')[11]).toBe('2027-06');
  });
  it('an anchor that does not parse falls back to today instead of twelve NaN keys', () => {
    expect(fiscalWindow('not-a-date')).toEqual(fiscalWindow());
    expect(fiscalWindow(new Date('garbage'))).toEqual(fiscalWindow());
    expect(fiscalWindow('not-a-date').every((k) => /^\d{4}-\d{2}$/.test(k))).toBe(true);
  });
});

describe('colHeader', () => {
  it('splits a month key into a short month and a two-digit year', () => {
    expect(colHeader('2026-07')).toEqual({ mon: new Date(2026, 6, 1).toLocaleDateString('en-ZA', { month: 'short' }), yr: "'26" });
    expect(colHeader('2027-01').yr).toBe("'27");
  });
});

describe('mergePpmGrid', () => {
  it('fills every month of the window, blank where nothing is known', () => {
    const grid = mergePpmGrid(WINDOW, [], {});
    expect(Object.keys(grid)).toEqual(WINDOW);
    expect(grid['2026-07']).toEqual({ status: null, source: 'none', derivedStatus: null });
  });

  it('takes the derived status when there is no override', () => {
    const grid = mergePpmGrid(WINDOW, [row('2026-08', 'done', { done_on: '2026-08-12' }), row('2026-09', 'due')], {});
    expect(grid['2026-08']).toMatchObject({ status: 'done', source: 'derived', doneOn: '2026-08-12', derivedStatus: 'done' });
    expect(grid['2026-09']).toMatchObject({ status: 'due', source: 'derived', doneOn: null });
  });

  it('an override wins over derived and keeps the derived status and note beside it', () => {
    const grid = mergePpmGrid(WINDOW, [row('2026-08', 'missed')], {
      '2026-08': { status: 'na', note: 'Lift decommissioned', by: 'u1', at: '2026-09-01T00:00:00Z' },
    });
    expect(grid['2026-08']).toMatchObject({ status: 'na', source: 'override', note: 'Lift decommissioned', derivedStatus: 'missed' });
  });

  it('an override applies even to a month with no occurrence', () => {
    const grid = mergePpmGrid(WINDOW, [], { '2026-10': { status: 'done', note: 'Done ad hoc' } });
    expect(grid['2026-10']).toMatchObject({ status: 'done', source: 'override', derivedStatus: null });
  });

  it('a month with several occurrences reads as a compliance grid: missed > done > due', () => {
    // one completed, one missed → the month is Missed, and the completion date is not shown against it
    const grid = mergePpmGrid(WINDOW, [row('2026-08', 'due'), row('2026-08', 'missed'), row('2026-08', 'done', { done_on: '2026-08-20' })], {});
    expect(grid['2026-08']).toMatchObject({ status: 'missed', doneOn: null, occurrences: { done: 1, missed: 1, due: 1, total: 3 } });
    expect(mergePpmGrid(WINDOW, [row('2026-08', 'due'), row('2026-08', 'missed')], {})['2026-08'].status).toBe('missed');
    // done beats due, and keeps the first completion date
    expect(mergePpmGrid(WINDOW, [row('2026-08', 'due'), row('2026-08', 'done', { done_on: '2026-08-20' })], {})['2026-08'])
      .toMatchObject({ status: 'done', doneOn: '2026-08-20', occurrences: { done: 1, missed: 0, due: 1, total: 2 } });
    expect(mergePpmGrid(WINDOW, [row('2026-08', 'done'), row('2026-08', 'done', { done_on: '2026-08-21' })], {})['2026-08'].doneOn).toBe('2026-08-21');
  });

  it('a single occurrence carries no counts; the summary reads them out when there are several', () => {
    const single = mergePpmGrid(WINDOW, [row('2026-08', 'done', { done_on: '2026-08-20' })], {})['2026-08'];
    expect(single.occurrences).toBeUndefined();
    expect(occurrenceSummary(single)).toBeNull();
    const several = mergePpmGrid(WINDOW, [row('2026-08', 'done'), row('2026-08', 'missed')], {})['2026-08'];
    expect(occurrenceSummary(several)).toBe('2 occurrences: 1 done, 1 missed');
    // the counts survive an override so the title can still explain what execution held
    const overridden = mergePpmGrid(WINDOW, [row('2026-08', 'done'), row('2026-08', 'missed')], { '2026-08': { status: 'na', note: 'n' } })['2026-08'];
    expect(overridden).toMatchObject({ status: 'na', source: 'override', derivedStatus: 'missed' });
    expect(occurrenceSummary(overridden)).toBe('2 occurrences: 1 done, 1 missed');
  });

  it('ignores derived rows outside the window and statuses it does not know', () => {
    const grid = mergePpmGrid(WINDOW, [row('2025-01', 'done'), row('2026-08', 'weird')], {});
    expect(grid['2026-08'].source).toBe('none');
    expect(Object.keys(grid)).not.toContain('2025-01');
  });

  it('an override with a status the grid does not know is treated as absent (derived shows through)', () => {
    const overrides = { '2026-08': { status: 'cancelled', note: 'typo from an import' }, '2026-09': { status: 'done', note: 'ok' } } as unknown as Record<string, { status: 'done'; note: string }>;
    const grid = mergePpmGrid(WINDOW, [row('2026-08', 'due')], overrides);
    expect(grid['2026-08']).toMatchObject({ status: 'due', source: 'derived' });
    expect(grid['2026-09']).toMatchObject({ status: 'done', source: 'override' });
    // and with nothing underneath, the cell is simply blank rather than a crash
    expect(mergePpmGrid(WINDOW, [], overrides)['2026-08']).toEqual({ status: null, source: 'none', derivedStatus: null });
  });

  it('a legacy months cell with a status the grid does not know is treated as absent', () => {
    const legacy = { '2026-07': { status: 'yes' }, '2026-08': { status: 'done' } } as unknown as Record<string, { status: 'done' }>;
    const grid = mergePpmGrid(WINDOW, [], {}, legacy);
    expect(grid['2026-07']).toEqual({ status: null, source: 'none', derivedStatus: null });
    expect(grid['2026-08']).toMatchObject({ status: 'done', source: 'legacy' });
  });

  it('falls back to a legacy months cell only when neither override nor derived exists', () => {
    const legacy = { '2026-07': { status: 'done' as const, date: '2026-07-03' }, '2026-08': { status: 'due' as const } };
    const grid = mergePpmGrid(WINDOW, [row('2026-08', 'done')], {}, legacy);
    expect(grid['2026-07']).toMatchObject({ status: 'done', source: 'legacy' });
    expect(grid['2026-08']).toMatchObject({ status: 'done', source: 'derived' });
  });
});

describe('derivedByService', () => {
  it('groups view rows by plan line', () => {
    const m = derivedByService([row('2026-08', 'done'), row('2026-09', 'due', { ppm_service_id: 'p2' }), row('2026-09', 'due')]);
    expect(m.get('p1')?.map((r) => r.period_month)).toEqual(['2026-08', '2026-09']);
    expect(m.get('p2')).toHaveLength(1);
  });
});

describe('ppmCompletionFromGrid (K11)', () => {
  it('counts a row as serviced when any cell is done, whatever layer produced it', () => {
    const rows = [
      mergePpmGrid(WINDOW, [row('2026-08', 'done')], {}),                                      // derived done
      mergePpmGrid(WINDOW, [row('2026-08', 'missed')], { '2026-08': { status: 'done', note: 'n' } }), // override done
      mergePpmGrid(WINDOW, [], {}, { '2026-07': { status: 'done' } }),                          // legacy done
      mergePpmGrid(WINDOW, [row('2026-08', 'due'), row('2026-09', 'missed')], {}),               // not done
      mergePpmGrid(WINDOW, [row('2026-08', 'done')], { '2026-08': { status: 'na', note: 'n' } }), // override hides the done
    ];
    expect(ppmCompletionFromGrid(rows)).toEqual({ doneCount: 3, total: 5, pct: 60 });
  });
  it('is null for no rows', () => {
    expect(ppmCompletionFromGrid([]).pct).toBeNull();
  });
});

describe('jsonb narrowing helpers', () => {
  it('asPpmStatus admits only the four statuses', () => {
    expect(asPpmStatus('done')).toBe('done');
    expect(asPpmStatus('na')).toBe('na');
    expect(asPpmStatus('weird')).toBeNull();
    expect(asPpmStatus(null)).toBeNull();
    expect(asPpmStatus(3)).toBeNull();
  });
  it('overridesOf / legacyMonthsOf give {} for anything but a plain object', () => {
    expect(overridesOf(null)).toEqual({});
    expect(overridesOf([])).toEqual({});
    expect(overridesOf('oops')).toEqual({});
    expect(overridesOf({ '2026-08': { status: 'na', note: 'n' } })).toEqual({ '2026-08': { status: 'na', note: 'n' } });
    expect(legacyMonthsOf(undefined)).toEqual({});
    expect(legacyMonthsOf({ '2026-07': { status: 'done' } })).toEqual({ '2026-07': { status: 'done' } });
  });
});

describe('gridHasData', () => {
  it('is true when any cell came from a layer', () => {
    expect(gridHasData(mergePpmGrid(WINDOW, [], {}))).toBe(false);
    expect(gridHasData(mergePpmGrid(WINDOW, [row('2026-08', 'due')], {}))).toBe(true);
  });
});

describe('mergePpmGrids (one grid per report row)', () => {
  const rows: PpmGridRow[] = [
    { id: 'r1', plan_service_id: 'p1', overrides: {}, months: {} },
    { id: 'r2', plan_service_id: 'p2', overrides: { '2026-08': { status: 'na' as const, note: 'replaced' } }, months: { '2026-07': { status: 'due' as const } } },
    { id: 'r3', plan_service_id: null, overrides: null, months: { '2026-07': { status: 'done' as const }, '2025-03': { status: 'done' as const } } },
    { id: 'r4', plan_service_id: null, months: 'oops' },
  ];
  const derived: DerivedRow[] = [
    row('2026-08', 'done', { done_on: '2026-08-12' }),
    row('2026-08', 'missed', { ppm_service_id: 'p2' }),
    row('2026-09', 'due', { ppm_service_id: 'p2' }),
  ];

  it('merges each plan-backed row with its own plan line: override > derived > legacy', () => {
    const grids = mergePpmGrids(rows, derived, WINDOW);
    expect(grids.get('r1')!['2026-08']).toMatchObject({ status: 'done', source: 'derived', doneOn: '2026-08-12' });
    expect(grids.get('r1')!['2026-09']).toMatchObject({ status: null, source: 'none' });
    expect(grids.get('r2')!['2026-08']).toMatchObject({ status: 'na', source: 'override', derivedStatus: 'missed' });
    expect(grids.get('r2')!['2026-09']).toMatchObject({ status: 'due', source: 'derived' });
    expect(grids.get('r2')!['2026-07']).toMatchObject({ status: 'due', source: 'legacy' });
  });

  it('a legacy row gets its months as legacy cells, widened past the window so nothing captured is lost', () => {
    const grids = mergePpmGrids(rows, derived, WINDOW);
    const r3 = grids.get('r3')!;
    expect(r3['2026-07']).toMatchObject({ status: 'done', source: 'legacy' });
    expect(r3['2025-03']).toMatchObject({ status: 'done', source: 'legacy' });
    expect(Object.keys(r3)).toHaveLength(13);
    // and a legacy row never borrows derived rows or overrides
    expect(Object.values(r3).every((c) => c.source !== 'derived' && c.source !== 'override')).toBe(true);
  });

  it('tolerates malformed months jsonb', () => {
    const r4 = mergePpmGrids(rows, derived, WINDOW).get('r4')!;
    expect(Object.keys(r4)).toEqual(WINDOW);
    expect(gridHasData(r4)).toBe(false);
  });

  it('a plan-backed row with empty months but a derived done cell counts as serviced (K11)', () => {
    const grids = mergePpmGrids(rows, derived, WINDOW);
    const { doneCount, total } = ppmCompletionFromGrid([grids.get('r1')!, grids.get('r2')!, grids.get('r3')!]);
    expect({ doneCount, total }).toEqual({ doneCount: 2, total: 3 }); // r1 derived done, r3 legacy done
  });

  it('doneMonthsFromGrid lists the done months, sorted, whatever layer filled them', () => {
    const grids = mergePpmGrids(rows, derived, WINDOW);
    expect(doneMonthsFromGrid(grids.get('r1')!)).toEqual(['2026-08']);
    expect(doneMonthsFromGrid(grids.get('r2')!)).toEqual([]);
    expect(doneMonthsFromGrid(grids.get('r3')!)).toEqual(['2025-03', '2026-07']);
  });
});
