import { describe, it, expect } from 'vitest';
import { captionText, captionLayout } from './photoCaption';

describe('photoCaption', () => {
  it('formats the capture time in the operating timezone', () => {
    expect(captionText(new Date('2026-09-10T08:05:00Z'), null)).toBe('10 Sep 2026, 10:05');
  });
  it('appends a 4-decimal geotag when present', () => {
    expect(captionText(new Date('2026-09-10T08:05:00Z'), { lat: -26.20412, lng: 28.04734 })).toBe('10 Sep 2026, 10:05 · -26.2041, 28.0473');
  });
  it('scales the strip with the shorter side and keeps minimums', () => {
    expect(captionLayout(1920, 1080)).toEqual({ fontPx: 24, padPx: 12, stripPx: 48 });
    expect(captionLayout(320, 240)).toEqual({ fontPx: 12, padPx: 6, stripPx: 24 });
  });
});
