import { describe, it, expect } from 'vitest';
import { OTHER_PREFIX, WONT_DO_CODES, WONT_DO_LABELS, formatReason, isWontDoCode, parseReason, reasonLabel } from './wontDo';

describe('wontDo vocabulary', () => {
  it('has the five codes the RPC check mirrors, each with a label', () => {
    expect(WONT_DO_CODES).toEqual(['area_locked', 'load_shedding', 'contractor_absent', 'no_materials', 'other']);
    for (const code of WONT_DO_CODES) expect(WONT_DO_LABELS[code]).toMatch(/\S/);
    expect(isWontDoCode('load_shedding')).toBe(true);
    expect(isWontDoCode('bogus')).toBe(false);
    expect(isWontDoCode(null)).toBe(false);
  });

  it('formatReason stores a fixed code as itself and "other" as other: <text>, trimmed', () => {
    expect(formatReason('area_locked')).toBe('area_locked');
    expect(formatReason('area_locked', 'ignored')).toBe('area_locked');
    expect(formatReason('other', '  gate welded shut ')).toBe(`${OTHER_PREFIX}gate welded shut`);
  });

  it('formatReason refuses "other" without text (null, so a dialog cannot submit it)', () => {
    expect(formatReason('other')).toBeNull();
    expect(formatReason('other', '   ')).toBeNull();
  });

  it('parseReason inverts formatReason and never throws on odd input', () => {
    expect(parseReason('load_shedding')).toEqual({ code: 'load_shedding', text: '' });
    expect(parseReason('other: gate welded shut')).toEqual({ code: 'other', text: 'gate welded shut' });
    expect(parseReason('other')).toEqual({ code: 'other', text: '' });
    expect(parseReason('something unexpected')).toEqual({ code: 'other', text: 'something unexpected' });
    expect(parseReason(null)).toEqual({ code: null, text: '' });
    expect(parseReason('')).toEqual({ code: null, text: '' });
  });

  it('round-trips an "other" text that itself contains ": " (only the first prefix is the separator)', () => {
    const stored = formatReason('other', 'note: gate: x');
    expect(stored).toBe(`${OTHER_PREFIX}note: gate: x`);
    expect(parseReason(stored)).toEqual({ code: 'other', text: 'note: gate: x' });
    expect(reasonLabel(stored)).toBe('note: gate: x');
  });

  it('reasonLabel prints the label for a code and the text itself for "other"', () => {
    expect(reasonLabel('load_shedding')).toBe('Load shedding');
    expect(reasonLabel('other: gate welded shut')).toBe('gate welded shut');
    expect(reasonLabel('other')).toBe('Other');
    expect(reasonLabel(null)).toBe('');
  });
});
