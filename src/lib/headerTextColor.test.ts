import { describe, it, expect } from 'vitest';
import { headerTextColor } from './headerTextColor';

describe('headerTextColor', () => {
  // The brand colour is whatever an admin typed, so fixed white text is unreadable on a pale one.
  it('picks the colour with the better contrast against the brand colour', () => {
    expect(headerTextColor('#2563eb')).toBe('#ffffff');
    expect(headerTextColor('#000000')).toBe('#ffffff');
    expect(headerTextColor('#7f1d1d')).toBe('#ffffff');
    expect(headerTextColor('#ffffff')).toBe('#000000');
    expect(headerTextColor('#ffff00')).toBe('#000000');
    expect(headerTextColor('#f5f5dc')).toBe('#000000');
  });
});
