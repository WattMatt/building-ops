/**
 * Report distribution rules for the web app (R4b, spec §5.7). The scheduling arithmetic and copy live in
 * `supabase/functions/_shared/distribution.ts` so the `report-distribution` edge function and the Settings
 * card agree on "when does a schedule run"; this module re-exports it (the same seam as
 * `src/lib/calendar/events.ts`) and adds the display-only helpers the Settings UI needs.
 */
import type { Distribution, LastResult, Recipient, ReportSchedule } from '@/hooks/useReportSchedules';

export * from '../../supabase/functions/_shared/distribution';

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th", 11–13 → "th", 21 → "21st". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** "Sends on the 7th of the following month · reminder 3 days before" (or "· no reminder"). */
export function describeSchedule(s: { send_day: number; remind_days_before: number }): string {
  const reminder =
    s.remind_days_before === 0
      ? 'no reminder'
      : `reminder ${s.remind_days_before} day${s.remind_days_before === 1 ? '' : 's'} before`;
  return `Sends on the ${ordinal(s.send_day)} of the following month · ${reminder}`;
}

/** "7 Oct" for a `YYYY-MM-DD` date-only value (UTC arithmetic, no timezone shift). */
export function shortDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** What a chip shows for a recipient: the name, else the address, else "Colleague". */
export function recipientLabel(r: Recipient): string {
  return r.name?.trim() || r.email || 'Colleague';
}

export const STATUS_LABELS: Record<string, string> = {
  sent: 'Sent',
  would_send: 'Would send',
  skipped_no_artifact: 'Skipped: no PDF',
  skipped_not_approved: 'Skipped: not approved',
  failed: 'Failed',
  already_sent: 'Already sent',
  reminded: 'Reminded',
};

export type RunRow = LastResult['buildings'][number];
export interface ResultRow { key: string; building: string; status: string; recipients: string; when: string | null; error: string | null }

const isDistribution = (r: RunRow | Distribution): r is Distribution => 'sent_at' in r;

function whenLabel(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone });
}

/**
 * One row shape for a run's per-building result and a recorded `report_distributions` row.
 *
 * `recipientCount` is the schedule's configured recipient count. A row that never reached the sending
 * loop (every skip, and a failure before it) stores an empty `sent_to`, and the live run dialog labels
 * exactly those "0 of 2" — so history reads it the same way instead of a bare "0". The edge function's
 * own `recipientsLabel` is the rule being mirrored: no recipients configured at all is plain "0".
 */
export function toResultRows(
  rows: RunRow[] | Distribution[],
  buildingNames: Record<string, string>,
  timeZone: string,
  recipientCount = 0,
): ResultRow[] {
  return (rows as (RunRow | Distribution)[]).map((r, i) => {
    if (isDistribution(r)) {
      const ok = r.sent_to.filter((s) => s.ok).length;
      return {
        key: r.id,
        building: (r.building_id && buildingNames[r.building_id]) || r.building_id || 'Building removed',
        status: r.status,
        recipients: r.sent_to.length ? `${ok} of ${r.sent_to.length}` : recipientCount ? `0 of ${recipientCount}` : '0',
        when: whenLabel(r.sent_at, timeZone),
        error: r.error,
      };
    }
    return {
      key: `${r.buildingId}-${i}`,
      building: r.buildingName || r.buildingId,
      status: r.status,
      // Runs now report "1 of 2"; `String` keeps the bare number a pre-R4b `last_result` row stored.
      recipients: String(r.recipients),
      when: null,
      error: r.error ?? null,
    };
  });
}

/**
 * A dry run reports its own `would_send` key rather than borrowing `sent` and being re-worded here,
 * so one label per count is enough. (A dry run can only ever produce `would_send`: the run-now path
 * forces `action: 'send'` and the cron never sets `dryRun`.)
 */
const COUNT_LABELS: Record<string, string> = {
  sent: 'sent',
  would_send: 'would send',
  skipped_no_artifact: 'skipped: no PDF',
  skipped_not_approved: 'skipped: not approved',
  failed: 'failed',
  reminded: 'reminded',
  already_sent: 'already sent',
};

/** "31 would send · 4 skipped: no PDF" — zero counts left out; "Nothing to do" when every count is zero. */
export function countsLine(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${COUNT_LABELS[k] ?? k.replace(/_/g, ' ')}`);
  return parts.length ? parts.join(' · ') : 'Nothing to do';
}

/** "Ran 7 Oct: 31 sent · 4 skipped" or "Reminded 4 Oct: 12 buildings"; null when the schedule never ran. */
export function lastRunLabel(s: Pick<ReportSchedule, 'last_run_on' | 'last_result'>): string | null {
  if (!s.last_run_on) return null;
  const when = shortDate(s.last_run_on);
  const r = s.last_result;
  if (!r) return `Ran ${when}`;
  if (r.action === 'remind') return `Reminded ${when}: ${r.buildings.length} building${r.buildings.length === 1 ? '' : 's'}`;
  const sent = r.buildings.filter((b) => b.status === 'sent').length;
  const skipped = r.buildings.filter((b) => b.status.startsWith('skipped')).length;
  const failed = r.buildings.filter((b) => b.status === 'failed').length;
  return `Ran ${when}: ${sent} sent · ${skipped} skipped${failed ? ` · ${failed} failed` : ''}`;
}
