import { describe, it, expect } from 'vitest';
import { cocBadgeVariant, formatFileSize } from './insight-linker-format';

describe('cocBadgeVariant', () => {
  it('maps pass to success-ish, fail to destructive, else neutral', () => {
    expect(cocBadgeVariant('Pass')).toBe('default');
    expect(cocBadgeVariant('fail')).toBe('destructive');
    expect(cocBadgeVariant('Pending')).toBe('secondary');
    expect(cocBadgeVariant(null)).toBe('outline');
    expect(cocBadgeVariant('')).toBe('outline');
  });
});

describe('formatFileSize', () => {
  it('formats bytes, KB, MB and tolerates null', () => {
    expect(formatFileSize(null)).toBe('');
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(900)).toBe('900 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(5_242_880)).toBe('5.0 MB');
  });
});
