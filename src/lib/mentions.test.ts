import { describe, it, expect } from 'vitest';
import { mentionQueryAt, insertMention } from './mentions';

describe('mentionQueryAt', () => {
  it('returns the partial name typed after an @ at the caret', () => {
    expect(mentionQueryAt('hello @tha', 10)).toEqual({ start: 6, query: 'tha' });
  });
  it('returns null when the caret is not inside an @-word', () => {
    expect(mentionQueryAt('hello there', 11)).toBeNull();
    expect(mentionQueryAt('a@b', 3)).toBeNull(); // no whitespace/start before @
  });
});

describe('insertMention', () => {
  it('replaces the @query with @Name and a trailing space', () => {
    expect(insertMention('hello @tha', { start: 6, query: 'tha' }, 'Thabo M')).toEqual({ text: 'hello @Thabo M ', caret: 15 });
  });
});
