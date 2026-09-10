import { describe, it, expect } from 'vitest';
import { mentionQueryAt, insertMention, mentionPresent } from './mentions';

describe('mentionQueryAt', () => {
  it('returns the partial name typed after an @ at the caret', () => {
    expect(mentionQueryAt('hello @tha', 10)).toEqual({ start: 6, query: 'tha' });
  });
  it('returns null when the caret is not inside an @-word', () => {
    expect(mentionQueryAt('hello there', 11)).toBeNull();
    expect(mentionQueryAt('a@b', 3)).toBeNull(); // no whitespace/start before @
  });
  it('returns the @-word at the start of the text', () => {
    expect(mentionQueryAt('@th', 3)).toEqual({ start: 0, query: 'th' });
  });
});

describe('mentionPresent', () => {
  it('does not match a name that is a prefix of a longer mentioned name', () => {
    expect(mentionPresent('hi @Anna', 'Ann')).toBe(false);
  });
  it('matches an exact mention', () => {
    expect(mentionPresent('hi @Ann', 'Ann')).toBe(true);
  });
  it('matches a mention followed by more text', () => {
    expect(mentionPresent('hi @Ann there', 'Ann')).toBe(true);
  });
  it('matches a mention at the start of the text', () => {
    expect(mentionPresent('@Ann', 'Ann')).toBe(true);
  });
});

describe('insertMention', () => {
  it('replaces the @query with @Name and a trailing space', () => {
    expect(insertMention('hello @tha', { start: 6, query: 'tha' }, 'Thabo M')).toEqual({ text: 'hello @Thabo M ', caret: 15 });
  });
});
