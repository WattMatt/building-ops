/**
 * Pure helpers for the dashboard's seven-day activity feed: per-type wording (reusing the
 * phrasing from IssueDetailDialog's activityText) and day-grouping in Africa/Johannesburg
 * local time.
 */
import { format } from 'date-fns';
import { ISSUE_STATUS_LABELS, type IssueStatus } from '@/lib/constants';
import { OPERATING_TZ } from '@/lib/myWork';

export interface FeedRow {
  id: string;
  issue_id: string;
  activity_type: string;
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
  author_name: string | null;
  created_at: string;
  issue_title: string;
  building_name: string | null;
}

const COMMENT_PREVIEW_LENGTH = 80;

export function describeActivity(row: FeedRow): string {
  switch (row.activity_type) {
    case 'created':
      return 'created this issue';
    case 'status_change': {
      const oldLabel = ISSUE_STATUS_LABELS[row.old_value as IssueStatus] ?? row.old_value;
      const newLabel = ISSUE_STATUS_LABELS[row.new_value as IssueStatus] ?? row.new_value;
      return `changed status ${oldLabel} → ${newLabel}`;
    }
    // No assignee-name join here (profiles are not readable across users under RLS), so this
    // names the action, not the person — unlike IssueDetailDialog's activityText.
    case 'assignment':
      return row.new_value ? 'assigned this issue' : 'removed the assignee';
    case 'contractor_assignment':
      return `assigned contractor ${row.new_value ?? ''}`.trim();
    case 'comment': {
      const text = row.comment ?? '';
      if (!text) return 'commented';
      const preview =
        text.length > COMMENT_PREVIEW_LENGTH ? `${text.slice(0, COMMENT_PREVIEW_LENGTH)}…` : text;
      return `commented: ${preview}`;
    }
    default:
      return row.activity_type;
  }
}

export interface DayGroup {
  day: string;
  items: FeedRow[];
}

const JOHANNESBURG_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: OPERATING_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The row's created_at as a YYYY-MM-DD calendar day in Africa/Johannesburg local time. */
function localDay(iso: string): string {
  return JOHANNESBURG_DAY_FORMATTER.format(new Date(iso));
}

/** `day` is a YYYY-MM-DD calendar date; South Africa has no DST, so plain UTC arithmetic is safe. */
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A timezone-naive Date for a YYYY-MM-DD day, used only to derive the weekday/day/month label. */
function formatDayLabel(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return format(new Date(year, month - 1, date), 'EEE d MMM');
}

/**
 * Groups rows by their local calendar day (Africa/Johannesburg), newest day first, labelling
 * today and yesterday specially. `rows` is expected newest-first (as queried); item order within
 * each day group is preserved rather than re-sorted.
 */
export function groupByDay(rows: FeedRow[], today: string): DayGroup[] {
  const yesterday = addDays(today, -1);
  const order: string[] = [];
  const byDay = new Map<string, FeedRow[]>();

  for (const row of rows) {
    const day = localDay(row.created_at);
    if (!byDay.has(day)) {
      byDay.set(day, []);
      order.push(day);
    }
    byDay.get(day)!.push(row);
  }

  const days = [...order].sort((a, b) => b.localeCompare(a));

  return days.map((day) => ({
    day: day === today ? 'Today' : day === yesterday ? 'Yesterday' : formatDayLabel(day),
    items: byDay.get(day)!,
  }));
}
