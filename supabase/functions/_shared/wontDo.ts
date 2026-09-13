/**
 * The "Can't do" reason vocabulary (S6b, spec §5.1). Pure and import-free: bundled into the
 * daily-digest edge function (its coverage lines print the label) and re-exported to the web app
 * through src/lib/wontDo.ts, so the list is written once. The complete_task RPC mirrors it
 * (2026-09-16_01_wont_do.sql, the check inside the function): change both together.
 *
 * Stored form (`task_completions.reason`): `<code>` for the four fixed codes, `other: <text>` for
 * free text — one column, human readable, filterable by prefix.
 */
export const WONT_DO_CODES = ['area_locked', 'load_shedding', 'contractor_absent', 'no_materials', 'other'] as const;
export type WontDoCode = (typeof WONT_DO_CODES)[number];

/** What a completion row says happened. Mirrors task_completions_outcome_check. */
export type TaskOutcome = 'completed' | 'wont_do';

export const WONT_DO_LABELS: Record<WontDoCode, string> = {
  area_locked: 'Area locked',
  load_shedding: 'Load shedding',
  contractor_absent: 'Contractor absent',
  no_materials: 'No materials',
  other: 'Other',
};

export const OTHER_PREFIX = 'other: ';

export function isWontDoCode(v: unknown): v is WontDoCode {
  return typeof v === 'string' && (WONT_DO_CODES as readonly string[]).includes(v);
}

/** The value to store; null when `other` carries no text (the dialog refuses to submit that). */
export function formatReason(code: WontDoCode, otherText = ''): string | null {
  if (code !== 'other') return code;
  const text = otherText.trim();
  return text ? `${OTHER_PREFIX}${text}` : null;
}

/** The stored value back into code + free text. Unknown input parses as `other` with the raw text; never throws. */
export function parseReason(reason: string | null | undefined): { code: WontDoCode | null; text: string } {
  const r = (reason ?? '').trim();
  if (!r) return { code: null, text: '' };
  if (r === 'other') return { code: 'other', text: '' };
  if (isWontDoCode(r)) return { code: r, text: '' };
  if (r.startsWith(OTHER_PREFIX)) return { code: 'other', text: r.slice(OTHER_PREFIX.length).trim() };
  return { code: 'other', text: r };
}

/** Human text for a stored reason: the label, or the free text itself for `other`. Empty when there is none. */
export function reasonLabel(reason: string | null | undefined): string {
  const { code, text } = parseReason(reason);
  if (!code) return '';
  return code === 'other' ? text || WONT_DO_LABELS.other : WONT_DO_LABELS[code];
}
