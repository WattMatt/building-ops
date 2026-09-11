/**
 * "This week" strip for My Day: seven day columns starting today, each a link into the
 * calendar's week view for that day.
 *
 * No query of its own. The counts come from what My Day already fetched — the task buckets
 * (`bucketTasks` keeps only tasks up to seven days out, so its window is exactly this strip's),
 * the user's issues (by `deadline`) and their sign-offs (by `due_at`). Only the total per day
 * is drawn; the breakdown by kind lives in the link's accessible name, so a screen reader hears
 * "Wed 16 Sep: 3 tasks, 1 issue" and a sighted reader on a phone gets one legible number.
 */
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import type { MyTask } from '@/lib/myWork';
import type { MyIssue } from '@/hooks/useMyWork';
import type { MySignoff } from '@/hooks/useMySignoffs';
import { OPERATING_TZ } from '@/lib/myWork';

export interface DayCounts {
  /** YYYY-MM-DD, operating-timezone calendar day. */
  date: string;
  tasks: number;
  issues: number;
  signoffs: number;
}

export interface WeekStripProps {
  /** YYYY-MM-DD in the operating timezone (`useMyWork().today`). */
  today: string;
  tasks: MyTask[];
  issues: MyIssue[];
  signoffs: MySignoff[];
  /** Where a day column goes. Defaults to the calendar's week view on that date. */
  onDayHref?: (date: string) => string;
}

const DAYS = 7;

/** Sign-offs are timestamps; the day they count under is the operating-timezone date, not the browser's. */
const operatingDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: OPERATING_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function signoffDate(dueAt: string | null): string | null {
  if (!dueAt) return null;
  const parsed = new Date(dueAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return operatingDate.format(parsed);
}

/** Per-day totals for the seven days from `today`. Pure, so the test can pin the arithmetic. */
export function weekCounts(
  today: string,
  tasks: MyTask[],
  issues: MyIssue[],
  signoffs: MySignoff[],
): DayCounts[] {
  const byDate = new Map<string, DayCounts>();
  for (let i = 0; i < DAYS; i += 1) {
    const date = addDays(today, i);
    byDate.set(date, { date, tasks: 0, issues: 0, signoffs: 0 });
  }
  for (const task of tasks) {
    const day = byDate.get(task.due_date);
    if (day) day.tasks += 1;
  }
  for (const issue of issues) {
    const day = issue.deadline ? byDate.get(issue.deadline) : undefined;
    if (day) day.issues += 1;
  }
  for (const signoff of signoffs) {
    const iso = signoffDate(signoff.due_at);
    const day = iso ? byDate.get(iso) : undefined;
    if (day) day.signoffs += 1;
  }
  return [...byDate.values()];
}

export function defaultDayHref(date: string): string {
  return `/calendar?date=${date}&view=week`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Wed 16 Sep: 3 tasks, 1 issue" — or "nothing due" so an empty column still says what it is. */
export function dayLabel(day: DayCounts): string {
  const when = format(new Date(`${day.date}T00:00:00`), 'EEE d MMM');
  const parts = [
    day.tasks > 0 && plural(day.tasks, 'task', 'tasks'),
    day.issues > 0 && plural(day.issues, 'issue', 'issues'),
    day.signoffs > 0 && plural(day.signoffs, 'sign-off', 'sign-offs'),
  ].filter((p): p is string => Boolean(p));
  return `${when}: ${parts.length ? parts.join(', ') : 'nothing due'}`;
}

export function WeekStrip({ today, tasks, issues, signoffs, onDayHref = defaultDayHref }: WeekStripProps) {
  const days = weekCounts(today, tasks, issues, signoffs);

  return (
    <section aria-label="This week" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">This week</h2>
        {/* Coaching only: what tapping a day does. The columns and counts stay with hints off. */}
        <Hint icon={false}>Tap a day to open it in the calendar.</Hint>
      </div>
      <ol className="grid grid-cols-7 gap-1" data-testid="week-strip">
        {days.map((day) => {
          const total = day.tasks + day.issues + day.signoffs;
          const isToday = day.date === today;
          const date = new Date(`${day.date}T00:00:00`);
          return (
            <li key={day.date} className="min-w-0">
              <Link
                to={onDayHref(day.date)}
                aria-label={dayLabel(day)}
                aria-current={isToday ? 'date' : undefined}
                className={cn(
                  'flex min-h-[44px] flex-col items-center justify-center rounded-lg border px-1 py-2 text-center transition-colors hover:bg-muted',
                  isToday ? 'border-primary bg-primary/10' : 'border-transparent bg-muted/50',
                  total === 0 && !isToday && 'text-muted-foreground',
                )}
              >
                <span className="text-[11px] uppercase leading-none">{format(date, 'EEE')}</span>
                <span className={cn('text-base font-semibold leading-tight', isToday && 'text-primary')}>
                  {format(date, 'd')}
                </span>
                <span
                  className={cn(
                    'text-xs leading-none tabular-nums',
                    total === 0 ? 'text-muted-foreground/60' : 'font-medium',
                  )}
                >
                  {total === 0 ? '–' : total}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default WeekStrip;
