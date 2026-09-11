/**
 * Recurrence rules for checklist templates, mirrored from the SQL in
 * supabase/schema/2026-09-13_01_r3_schedule.sql (`recurrence_is_valid`, `legacy_frequency`,
 * `recurrence_occurrences`). docs/fixtures/recurrence-occurrences.json pins both
 * implementations; change one, change the fixture, and the other fails.
 *
 * Date-only UTC arithmetic, like taskSchedule.ts — no local time zones anywhere.
 */
import type { TaskFrequency } from '@/lib/constants';

export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year';

export type RecurrenceRule = {
  every: number;
  unit: RecurrenceUnit;
  /** ISO weekdays, 1 = Mon … 7 = Sun. Required for `week`. */
  weekdays?: number[];
  /** 1–31 (clamped to the month length) or 'last'. Defaults to 1 for `month` and `year`. */
  monthDay?: number | 'last';
  /** 1–12. Required for `year`. */
  month?: number;
  /** Days before the due date the task becomes visible; NOT applied by `occurrences`. */
  lead?: number;
};

const MAX_OCCURRENCES = 400;
const UNITS: readonly RecurrenceUnit[] = ['day', 'week', 'month', 'year'];

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fromIso = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
/** Days in month `m` (1–12) of year `y`. */
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
/** Resolve a monthDay inside (y, m): clamp to the month length, 'last' = last day. */
const resolveMonthDay = (y: number, m: number, md: number | 'last'): Date =>
  ymd(y, m, md === 'last' ? daysInMonth(y, m) : Math.min(md, daysInMonth(y, m)));

/** All due dates of `rule` between `fromIso` and `toIso` inclusive, at most 400. */
export function occurrences(rule: RecurrenceRule, fromIsoDate: string, toIsoDate: string): string[] {
  const from = fromIso(fromIsoDate);
  const to = fromIso(toIsoDate);
  const out: string[] = [];
  if (to < from) return out;
  const every = rule.every;
  const push = (d: Date) => { if (d >= from && d <= to) out.push(toIso(d)); };
  const full = () => out.length >= MAX_OCCURRENCES;

  switch (rule.unit) {
    case 'day': {
      for (let d = from; d <= to && !full(); d = addDays(d, every)) out.push(toIso(d));
      break;
    }
    case 'week': {
      const weekdays = [...(rule.weekdays ?? [])].sort((a, b) => a - b);
      // Monday-start week containing `from`.
      let wk = addDays(from, -((from.getUTCDay() + 6) % 7));
      while (wk <= to && !full()) {
        for (const wd of weekdays) { if (full()) break; push(addDays(wk, wd - 1)); }
        wk = addDays(wk, 7 * every);
      }
      break;
    }
    case 'month': {
      // Anchor: scanning month by month from `from`'s month, the first candidate whose
      // clamped monthDay is >= `from`; then every N months from that anchor.
      const md = rule.monthDay ?? 1;
      let y = from.getUTCFullYear();
      let m = from.getUTCMonth() + 1;
      const step = (n: number) => { m += n; while (m > 12) { m -= 12; y += 1; } };
      while (ymd(y, m, 1) <= to && !full()) {
        const occ = resolveMonthDay(y, m, md);
        if (occ < from) { step(1); continue; } // not anchored yet: next month
        push(occ);
        step(every);
      }
      break;
    }
    case 'year': {
      // Anchor: scanning year by year from `from`'s year, the first candidate whose
      // month + clamped monthDay is >= `from`; then every N years from that anchor.
      const md = rule.monthDay ?? 1;
      const m = rule.month ?? 1;
      let y = from.getUTCFullYear();
      while (ymd(y, m, 1) <= to && !full()) {
        const occ = resolveMonthDay(y, m, md);
        if (occ < from) { y += 1; continue; } // not anchored yet: next year
        push(occ);
        y += every;
      }
      break;
    }
  }
  return out;
}

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Mirror of public.recurrence_is_valid (for a non-null rule). */
export function isValidRule(rule: unknown): rule is RecurrenceRule {
  if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) return false;
  const r = rule as Record<string, unknown>;
  if (!UNITS.includes(r.unit as RecurrenceUnit)) return false;
  if (!isInt(r.every, 1, 52)) return false;
  if (r.weekdays !== undefined) {
    if (!Array.isArray(r.weekdays) || !r.weekdays.every((d) => isInt(d, 1, 7))) return false;
  }
  if (r.monthDay !== undefined && r.monthDay !== 'last' && !isInt(r.monthDay, 1, 31)) return false;
  if (r.month !== undefined && !isInt(r.month, 1, 12)) return false;
  if (r.lead !== undefined && !isInt(r.lead, 0, 60)) return false;
  if (r.unit === 'week' && (!Array.isArray(r.weekdays) || r.weekdays.length === 0)) return false;
  if (r.unit === 'year' && r.month === undefined) return false;
  return true;
}

/** Mirror of public.legacy_frequency: the five-bucket value iOS and the reports keep reading. */
export function legacyFrequency(rule: RecurrenceRule): TaskFrequency {
  switch (rule.unit) {
    case 'day': return 'daily';
    case 'week': return 'weekly';
    case 'month': return rule.every === 3 || rule.every === 6 ? 'quarterly' : 'monthly';
    default: return 'annually';
  }
}

/** The rule a legacy template edits as, chosen so legacyFrequency() round-trips. */
export function ruleFromFrequency(freq: TaskFrequency): RecurrenceRule {
  switch (freq) {
    case 'daily': return { every: 1, unit: 'day' };
    case 'weekly': return { every: 1, unit: 'week', weekdays: [1] };
    case 'monthly': return { every: 1, unit: 'month', monthDay: 1 };
    case 'quarterly': return { every: 3, unit: 'month', monthDay: 1 };
    case 'annually': return { every: 1, unit: 'year', month: 1, monthDay: 1 };
  }
}

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ordinal = (n: number) => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
};

/** Human label: "Every day", "Every 2 weeks on Mon, Wed", "Monthly on the 1st", "Yearly on 1 Jan". */
export function describeRule(rule: RecurrenceRule): string {
  const n = rule.every;
  switch (rule.unit) {
    case 'day':
      return n === 1 ? 'Every day' : `Every ${n} days`;
    case 'week': {
      const days = [...(rule.weekdays ?? [])].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d - 1]).join(', ');
      return `${n === 1 ? 'Weekly' : `Every ${n} weeks`} on ${days}`;
    }
    case 'month': {
      const md = rule.monthDay ?? 1;
      const day = md === 'last' ? 'the last day' : `the ${ordinal(md)}`;
      return `${n === 1 ? 'Monthly' : `Every ${n} months`} on ${day}`;
    }
    case 'year': {
      const md = rule.monthDay ?? 1;
      const month = MONTH_NAMES[(rule.month ?? 1) - 1];
      const day = md === 'last' ? `the last day of ${month}` : `${md} ${month}`;
      return `${n === 1 ? 'Yearly' : `Every ${n} years`} on ${day}`;
    }
  }
}

/** The first `n` due dates on or after `fromIso`, scanning at most 3 years ahead. */
export function nextOccurrences(rule: RecurrenceRule, n: number, fromIsoDate: string): string[] {
  if (n <= 0) return [];
  const from = fromIso(fromIsoDate);
  const to = ymd(from.getUTCFullYear() + 3, from.getUTCMonth() + 1, from.getUTCDate());
  return occurrences(rule, fromIsoDate, toIso(to)).slice(0, n);
}
