/**
 * SLA clock for an issue (R4a §5.4). Pure: the DB stamps sla_target_hours (org default per priority),
 * first_response_at and sla_breached_at; this only derives what to show. Time zone does not matter here —
 * every value is an instant — except the wording, which is relative ("Due in 3h").
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
  /** Milliseconds until `due` (negative once past); null when there is no target. */
  remainingMs: number | null;
  breached: boolean;
  /** Plain chip text: "Due in 3h", "Breached 2d ago", "Met", "Missed by 4h", "No SLA". */
  label: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** '45m' under an hour, '3h' under two days, else whole days ('2d' for 2.6 days — never over-promise). */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < HOUR) return `${Math.max(1, Math.round(abs / 60_000))}m`;
  if (abs < 2 * DAY) return `${Math.round(abs / HOUR)}h`;
  return `${Math.floor(abs / DAY)}d`;
}

/** "Due soon" once less than 20% of the target (or under 4 hours) remains. */
export const DUE_SOON_FRACTION = 0.2;
export const DUE_SOON_MIN_MS = 4 * HOUR;

export function slaState(issue: SlaIssueFields, now: Date = new Date()): SlaState {
  const hours = issue.sla_target_hours == null || issue.sla_target_hours === '' ? NaN : Number(issue.sla_target_hours);
  const created = new Date(issue.created_at).getTime();
  if (!Number.isFinite(hours) || hours <= 0 || Number.isNaN(created)) {
    return { kind: 'none', due: null, remainingMs: null, breached: false, label: 'No SLA' };
  }
  const due = new Date(created + hours * HOUR);
  const breachedAt = issue.sla_breached_at ? new Date(issue.sla_breached_at) : null;

  if (issue.status === 'resolved') {
    const resolvedAt = issue.resolved_at ? new Date(issue.resolved_at).getTime() : null;
    const missed = !!breachedAt || (resolvedAt !== null && resolvedAt > due.getTime());
    if (!missed) return { kind: 'met', due, remainingMs: 0, breached: false, label: 'Met' };
    const by = resolvedAt !== null ? resolvedAt - due.getTime() : (breachedAt ? breachedAt.getTime() - due.getTime() : 0);
    return { kind: 'missed', due, remainingMs: 0, breached: true, label: by > 0 ? `Missed by ${formatDuration(by)}` : 'Missed' };
  }

  const remainingMs = due.getTime() - now.getTime();
  if (breachedAt || remainingMs < 0) {
    return { kind: 'breached', due, remainingMs, breached: true, label: `Breached ${formatDuration(-remainingMs)} ago` };
  }
  const soon = remainingMs <= Math.max(DUE_SOON_MIN_MS, hours * HOUR * DUE_SOON_FRACTION);
  return { kind: soon ? 'due_soon' : 'ok', due, remainingMs, breached: false, label: `Due in ${formatDuration(remainingMs)}` };
}
