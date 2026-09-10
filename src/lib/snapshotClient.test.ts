import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@/lib/myWork', () => ({ todayInOperatingTz: () => '2026-09-10' }));

import { daysAgo, fetchAll, formatAsOf, snapshotQueryDefaults, snapshotRowsOrEmpty, type PgResult, type RowBuilder } from './snapshotClient';

/** A builder whose only real method is `range`; every other method returns itself. */
function fakeBuilder<Row>(pages: (from: number, to: number) => PgResult<Row>, log: [number, number][]): () => RowBuilder<Row> {
  return () => {
    const b = {
      range: (from: number, to: number) => { log.push([from, to]); return Promise.resolve(pages(from, to)) as unknown as RowBuilder<Row>; },
    } as unknown as RowBuilder<Row>;
    for (const m of ['eq', 'in', 'gte', 'lte', 'order', 'limit'] as const) (b as unknown as Record<string, () => unknown>)[m] = () => b;
    return b;
  };
}

describe('fetchAll', () => {
  it('keeps paging while pages come back full and stops on the first short page', async () => {
    const log: [number, number][] = [];
    const rowsFrom = (from: number, to: number, cap: number) => Array.from({ length: Math.max(0, Math.min(to, cap - 1) - from + 1) }, (_, i) => ({ i: from + i }));
    // 1 003 rows in total: a full 1 000-row first page (the server cap) then a 3-row tail.
    const res = await fetchAll(fakeBuilder((f, t) => ({ data: rowsFrom(f, t, 1003), error: null }), log));
    expect(log).toEqual([[0, 999], [1000, 1999]]);
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(1003);
    expect(res.data[1002]).toEqual({ i: 1002 });
  });

  it('a short first page is one request', async () => {
    const log: [number, number][] = [];
    const res = await fetchAll(fakeBuilder(() => ({ data: [{ i: 0 }, { i: 1 }], error: null }), log));
    expect(log).toEqual([[0, 999]]);
    expect(res.data).toHaveLength(2);
  });

  it('honours a custom page size', async () => {
    const log: [number, number][] = [];
    await fetchAll(fakeBuilder((f) => ({ data: f === 0 ? [{ i: 0 }, { i: 1 }] : [], error: null }), log), 2);
    expect(log).toEqual([[0, 1], [2, 3]]);
  });

  it('returns the error (and the rows read so far) instead of throwing', async () => {
    const log: [number, number][] = [];
    const res = await fetchAll(fakeBuilder(() => ({ data: null, error: { message: 'relation does not exist', code: '42P01' } }), log));
    expect(res.error?.code).toBe('42P01');
    expect(res.data).toEqual([]);
    expect(log).toHaveLength(1);
  });
});

describe('snapshotRowsOrEmpty', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  beforeEach(() => warn.mockClear());
  afterEach(() => warn.mockClear());

  it('returns the rows on success', () => {
    expect(snapshotRowsOrEmpty({ data: [{ a: 1 }], error: null }, 'x')).toEqual([{ a: 1 }]);
    expect(snapshotRowsOrEmpty({ data: null, error: null }, 'x')).toEqual([]);
  });

  it('returns [] on a read error and says where, so the caller takes its live path', () => {
    expect(snapshotRowsOrEmpty({ data: null, error: { message: 'permission denied' } }, 'useBuildingScore')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[useBuildingScore]'), 'permission denied');
  });
});

describe('snapshotQueryDefaults', () => {
  it('retries once, never when the table is missing', () => {
    const { retry } = snapshotQueryDefaults;
    expect(retry(0, { message: 'boom' })).toBe(true);
    expect(retry(1, { message: 'boom' })).toBe(false);
    expect(retry(0, { message: 'missing', code: 'PGRST205' })).toBe(false);
    expect(retry(0, { message: 'missing', code: '42P01' })).toBe(false);
    expect(retry(0, undefined)).toBe(true);
    expect(snapshotQueryDefaults.staleTime).toBe(10 * 60_000);
  });
});

describe('daysAgo / formatAsOf', () => {
  it('daysAgo counts back from today in the operating timezone, across a month boundary', () => {
    expect(daysAgo(0)).toBe('2026-09-10');
    expect(daysAgo(3)).toBe('2026-09-07');
    expect(daysAgo(29)).toBe('2026-08-12');
    expect(daysAgo(10, '2026-03-05')).toBe('2026-02-23');
  });

  it('formatAsOf prints the SAST day, month and time (en-ZA order)', () => {
    // 03:02 UTC is 05:02 in Johannesburg.
    expect(formatAsOf('2026-09-10T03:02:00Z')).toBe('10 Sept, 05:02');
  });
});
