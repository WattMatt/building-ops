/** Caret-aware helpers for the @mention picker in the issue comment composer. */
export interface MentionRange { start: number; query: string }

/** If the caret sits inside an "@word" that starts at the beginning or after whitespace, return it. */
export function mentionQueryAt(text: string, caret: number): MentionRange | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

export function insertMention(text: string, range: MentionRange, name: string): { text: string; caret: number } {
  const head = text.slice(0, range.start);
  const tail = text.slice(range.start + 1 + range.query.length);
  const inserted = `${head}@${name} `;
  return { text: inserted + tail, caret: inserted.length };
}
