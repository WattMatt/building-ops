/**
 * Rand amount helpers shared by the cost inputs (NewIssue, IssueDetailDialog) and the
 * cost displays (MonthCostsCard). One parse and one format so the rules never drift.
 */

/**
 * Parse a typed amount.
 *
 * - '' (or whitespace) → `null`: the field was left blank, store nothing.
 * - a non-negative amount → `number`; accepts "1234.50", "1 234,50" and an "R" prefix
 *   ("R 1 234,50"), so what a user would write on paper parses.
 * - anything else (letters, negatives, NaN) → `undefined`: rejected, show an error.
 *
 * The three-way result is deliberate: callers must tell "clear it" from "that's not a number".
 */
export function parseCost(input: string): number | null | undefined {
  const t = input.trim().replace(/^R\s*/i, '');
  if (!t) return null;
  const n = Number(t.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** 'R 12 345' — en-ZA style: space-grouped thousands, comma decimals, and no decimals unless cents exist. */
export function formatRand(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  const negative = n < 0;
  const cents = Math.round(Math.abs(n) * 100);
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const text = frac === 0 ? grouped : `${grouped},${String(frac).padStart(2, '0')}`;
  return `${negative ? '-' : ''}R ${text}`;
}
