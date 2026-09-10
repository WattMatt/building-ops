/**
 * SLA clock for an issue (R4a §5.4). Pure: the DB stamps sla_target_hours (org default per priority),
 * first_response_at and sla_breached_at; this only derives what to show. Time zone does not matter here —
 * every value is an instant — except the wording, which is relative ("Due in 3h"), and `formatSlaInstant`,
 * which is the one place an SLA instant becomes wall-clock text (always SAST).
 */
export interface SlaIssueFields {
  created_at: string;
  status: string;
  sla_target_hours?: number | string | null;
  sla_breached_at?: string | null;
  first_response_at?: string | null;
  resolved_at?: string | null;
}

export type SlaKind = 'none' | 'ok' | 'due_soon' | 'breached' | 'met' | 'missed';

export interface SlaState {
  kind: SlaKind;
  due: Date | null;
  /**
   * Signed milliseconds from `now` until `due` — positive while the clock is running, zero at the
   * deadline, negative once past. It means the same thing in every kind: for `met` and `missed` it
   * is still `due - now` (not the resolution margin, which lives in the label). Null without a target.
   */
  remainingMs: number | null;
  breached: boolean;
  /** Plain chip text: "Due in 3h", "Breached 2d ago", "Met", "Missed by 4h", "No SLA". */
  label: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Minutes under an hour, hours under two days, else whole days. The value is rounded (or floored)
 * in its own unit first and only then promoted, so 59m30s reads "1h" and 47h50m reads "2d" when
 * rounding — but "59m" and "47h" when flooring. `floor` never over-promises time left ("Due in");
 * `round` is the honest reading of elapsed time ("Breached … ago", "Missed by").
 */
export function formatDuration(ms: number, mode: 'round' | 'floor' = 'round'): string {
  const fn = mode === 'floor' ? Math.floor : Math.round;
  const abs = Math.abs(ms);
  const minutes = fn(abs / MINUTE);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = fn(abs / HOUR);
  if (hours < 48) return `${hours}h`;
  return `${fn(abs / DAY)}d`;
}

/** Instant → wall-clock text in SAST, e.g. "13 Sept 2026, 02:00". Used by the chip title and the detail line. */
export function formatSlaInstant(date: Date): string {
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' }).format(date);
}

/**
 * "Due soon" once less than 20% of the target (or under 4 hours) remains — capped at half the target,
 * so a short clock (critical: 4 h) is not amber from the moment it starts.
 */
export const DUE_SOON_FRACTION = 0.2;
export const DUE_SOON_MIN_MS = 4 * HOUR;
export const DUE_SOON_MAX_FRACTION = 0.5;

export function dueSoonThresholdMs(targetMs: number): number {
  return Math.min(targetMs * DUE_SOON_MAX_FRACTION, Math.max(DUE_SOON_MIN_MS, targetMs * DUE_SOON_FRACTION));
}

export function slaState(issue: SlaIssueFields, now: Date = new Date()): SlaState {
  const hours = issue.sla_target_hours == null || issue.sla_target_hours === '' ? NaN : Number(issue.sla_target_hours);
  const created = new Date(issue.created_at).getTime();
  if (!Number.isFinite(hours) || hours <= 0 || Number.isNaN(created)) {
    return { kind: 'none', due: null, remainingMs: null, breached: false, label: 'No SLA' };
  }
  const targetMs = hours * HOUR;
  const due = new Date(created + targetMs);
  const remainingMs = due.getTime() - now.getTime();
  const breachedAt = issue.sla_breached_at ? new Date(issue.sla_breached_at) : null;

  if (issue.status === 'resolved') {
    const resolvedAt = issue.resolved_at ? new Date(issue.resolved_at).getTime() : null;
    const missed = !!breachedAt || (resolvedAt !== null && resolvedAt > due.getTime());
    if (!missed) return { kind: 'met', due, remainingMs, breached: false, label: 'Met' };
    // "Missed by" needs the resolution instant; a sweep stamp alone only says it was missed.
    const by = resolvedAt !== null ? resolvedAt - due.getTime() : 0;
    return { kind: 'missed', due, remainingMs, breached: true, label: by > 0 ? `Missed by ${formatDuration(by)}` : 'Missed' };
  }

  if (breachedAt || remainingMs <= 0) {
    return { kind: 'breached', due, remainingMs, breached: true, label: `Breached ${formatDuration(-remainingMs)} ago` };
  }
  const soon = remainingMs <= dueSoonThresholdMs(targetMs);
  return { kind: soon ? 'due_soon' : 'ok', due, remainingMs, breached: false, label: `Due in ${formatDuration(remainingMs, 'floor')}` };
}
