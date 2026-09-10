/**
 * The next 30 days of a building's open tasks, one column, grouped by ISO week (Mon–Sun).
 * Anything already past due sits in an "Overdue" group on top: it is the most urgent thing on
 * the board, and hiding it behind a date window would be the one place a caretaker forgets it.
 *
 * Date math is on ISO strings in UTC (as myWork.ts does) so week boundaries never drift with
 * the device timezone; `due_date` is a date column, `today` is YYYY-MM-DD in the operating tz.
 */
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CheckCircle2, ClipboardCheck, User, Camera, PenLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { todayInOperatingTz } from '@/lib/myWork';
import { memberDisplayName, type BuildingMember } from '@/hooks/useBuildingMembers';
import { AssigneePicker } from '@/components/people/AssigneePicker';
import type { TaskInstance } from '@/components/building/TasksList';

export const HORIZON_DAYS = 30;

export interface UpcomingWeek {
  /** Monday of the week (YYYY-MM-DD), or 'overdue'. Stable for React keys. */
  key: string;
  label: string;
  tasks: TaskInstance[];
}

function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDaysIso(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `iso`. */
export function mondayOf(iso: string): string {
  const d = parseIso(iso);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return addDaysIso(iso, -sinceMonday);
}

/** A Date carrying the ISO day as LOCAL components, so date-fns formats the intended calendar day. */
function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "This week", "Next week", or a range like "15–21 Sep" / "28 Sep–4 Oct". */
export function weekLabel(monday: string, today: string): string {
  const thisMonday = mondayOf(today);
  if (monday === thisMonday) return 'This week';
  if (monday === addDaysIso(thisMonday, 7)) return 'Next week';
  const sunday = addDaysIso(monday, 6);
  const a = localDate(monday);
  const b = localDate(sunday);
  return a.getMonth() === b.getMonth()
    ? `${format(a, 'd')}–${format(b, 'd MMM')}`
    : `${format(a, 'd MMM')}–${format(b, 'd MMM')}`;
}

/** Open tasks (pending/overdue) due within the horizon, grouped by week; past-due first. */
export function groupUpcoming(tasks: TaskInstance[], today: string, horizonDays = HORIZON_DAYS): UpcomingWeek[] {
  const end = addDaysIso(today, horizonDays);
  const open = tasks
    .filter((t) => (t.status === 'pending' || t.status === 'overdue') && t.due_date <= end)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.task_name.localeCompare(b.task_name));

  const overdue = open.filter((t) => t.due_date < today);
  const byWeek = new Map<string, TaskInstance[]>();
  for (const t of open) {
    if (t.due_date < today) continue;
    const key = mondayOf(t.due_date);
    const bucket = byWeek.get(key);
    if (bucket) bucket.push(t);
    else byWeek.set(key, [t]);
  }

  const weeks: UpcomingWeek[] = [];
  if (overdue.length) weeks.push({ key: 'overdue', label: 'Overdue', tasks: overdue });
  for (const [key, list] of [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    weeks.push({ key, label: weekLabel(key, today), tasks: list });
  }
  return weeks;
}

function dueLabel(due: string, today: string): string {
  if (due === today) return 'Today';
  if (due === addDaysIso(today, 1)) return 'Tomorrow';
  return format(localDate(due), 'EEE d MMM');
}

export interface UpcomingTasksProps {
  tasks: TaskInstance[];
  onComplete: (task: TaskInstance) => void;
  onAssign?: (task: TaskInstance, userId: string | null) => void;
  /** Whether the viewer may change this task's assignee; defaults to never. */
  canAssign?: (task: TaskInstance) => boolean;
  members: Map<string, BuildingMember>;
  /** YYYY-MM-DD in the operating timezone. Injected by tests; defaults to today. */
  today?: string;
}

export function UpcomingTasks({ tasks, onComplete, onAssign, canAssign, members, today = todayInOperatingTz() }: UpcomingTasksProps) {
  const weeks = groupUpcoming(tasks, today);

  if (weeks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <ClipboardCheck className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Nothing due in the next {HORIZON_DAYS} days.</p>
      </div>
    );
  }

  const nameOf = (id: string | null) => (id && members.get(id) ? memberDisplayName(members.get(id)!) : null);

  return (
    <div className="space-y-5" data-testid="upcoming-tasks">
      {weeks.map((week) => (
        <section key={week.key} aria-labelledby={`upcoming-${week.key}`}>
          <h3
            id={`upcoming-${week.key}`}
            className={cn('mb-2 flex items-center gap-2 text-sm font-semibold', week.key === 'overdue' && 'text-destructive')}
          >
            {week.label}
            <span className="text-muted-foreground font-normal">· {week.tasks.length}</span>
          </h3>
          <ul className="space-y-2">
            {week.tasks.map((task) => {
              const overdue = task.due_date < today;
              const assignee = task.assigned_to ? nameOf(task.assigned_to) ?? 'Assigned' : 'Unassigned';
              const chip = (
                <Badge variant="outline" className="gap-1 font-normal">
                  <User className="h-3 w-3" aria-hidden="true" />
                  {assignee}
                </Badge>
              );
              return (
                <li
                  key={task.id}
                  className={cn('flex items-center gap-3 rounded-lg border p-3', overdue && 'border-destructive/50 bg-destructive/5')}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-medium">{task.task_name}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className={cn(overdue && 'font-medium text-destructive')}>{dueLabel(task.due_date, today)}</span>
                      {canAssign?.(task) && onAssign ? (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              aria-label={`Change assignee for ${task.task_name}`}
                              className="inline-flex min-h-11 items-center rounded hover:bg-muted"
                            >
                              {chip}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64">
                            <AssigneePicker buildingId={task.building_id} value={task.assigned_to} onChange={(id) => onAssign(task, id)} />
                          </PopoverContent>
                        </Popover>
                      ) : chip}
                      {task.requires_photo && <Camera className="h-3 w-3" aria-label="Photo required" />}
                      {task.requires_signature && <PenLine className="h-3 w-3" aria-label="Signature required" />}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="min-h-11 min-w-11 shrink-0 px-3"
                    onClick={() => onComplete(task)}
                    aria-label={`Complete ${task.task_name}`}
                  >
                    <CheckCircle2 className="h-4 w-4 sm:mr-1" aria-hidden="true" />
                    <span className="hidden sm:inline">Complete</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default UpcomingTasks;
