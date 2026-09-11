import { describe, it, expect } from 'vitest';
import { formatRand, parseCost } from './money';

describe('parseCost', () => {
  it('treats a blank field as "store nothing" (null)', () => {
    expect(parseCost('')).toBeNull();
    expect(parseCost('   ')).toBeNull();
  });

  it('accepts plain, space-grouped, comma-decimal and R-prefixed amounts', () => {
    expect(parseCost('1234.50')).toBe(1234.5);
    expect(parseCost('1 234,50')).toBe(1234.5);
    expect(parseCost('R 1 234,50')).toBe(1234.5);
    expect(parseCost('r1234')).toBe(1234);
    expect(parseCost('0')).toBe(0);
    expect(parseCost(' 15 ')).toBe(15);
  });

  it('rejects (undefined, not null) letters, negatives and non-finite input', () => {
    expect(parseCost('abc')).toBeUndefined();
    expect(parseCost('-5')).toBeUndefined();
    expect(parseCost('R -5')).toBeUndefined();
    expect(parseCost('Infinity')).toBeUndefined();
    expect(parseCost('1,234,50')).toBeUndefined();
  });
});

describe('formatRand', () => {
  it('formats en-ZA style with space-grouped thousands and comma cents only when present', () => {
    expect(formatRand(12345)).toBe('R 12 345');
    expect(formatRand(12345.6)).toBe('R 12 345,60');
    expect(formatRand(1234567.5)).toBe('R 1 234 567,50');
    expect(formatRand(999.999)).toBe('R 1 000');
    expect(formatRand(0)).toBe('R 0');
    expect(formatRand(-250)).toBe('-R 250');
  });

  it('shows R 0 for null and undefined', () => {
    expect(formatRand(null)).toBe('R 0');
    expect(formatRand(undefined)).toBe('R 0');
  });
});
