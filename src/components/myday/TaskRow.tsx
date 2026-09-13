/**
 * One assigned task as a row: what it is, where it is (optional), when it is due, and one action.
 *
 * Shared by My Day and the building page's "My work here" card (spec: pilot-field §4.2) so the
 * two can never drift on the 56 px tap target, the Complete button or the queued chip. `Row` is
 * the shape of every My Day row (issues, sign-offs, returned reports too) and is exported so
 * My Day keeps one row primitive rather than a copy.
 */
import type { ReactNode } from 'react';
import { format } from 'date-fns';
import { CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatBuildingName } from '@/lib/buildingName';
import type { MyTask } from '@/lib/myWork';

/** Whether a completion for this task is already waiting in the offline queue, and how it stands. */
export type QueuedState = 'none' | 'queued' | 'failed';

/** The two pendingOverlay sets projected onto one row; `failed` wins because it needs the reader. */
export function queuedStateFor(taskId: string, queued: ReadonlySet<string>, failed: ReadonlySet<string>): QueuedState {
  if (failed.has(taskId)) return 'failed';
  if (queued.has(taskId)) return 'queued';
  return 'none';
}

/**
 * A date-column value (YYYY-MM-DD) read against the operating day, not the browser's.
 * A past due date reads "Was due …": in a list mixing overdue and upcoming rows, a bare
 * "Due Mon 8 Sep" gives the reader no clue that the date has already gone.
 */
export function dueLabel(dueDate: string, today: string): string {
  if (dueDate === today) return 'Due today';
  const parsed = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dueDate;
  const when = format(parsed, 'EEE d MMM');
  return dueDate < today ? `Was due ${when}` : `Due ${when}`;
}

/**
 * Every row is the same shape: what it is, where it is, and one action. Spec §5.3: a 56 px
 * tap target on phones (min-h-14), relaxing to 40 px once the row lays out horizontally.
 */
export function Row({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex min-h-14 flex-col gap-3 rounded-lg bg-muted/50 p-3 sm:min-h-10 sm:flex-row sm:items-center sm:justify-between">
      {/* break-words here rather than on each title: long task names and issue titles
          arrive unhyphenated from the field and would otherwise widen the row on a phone. */}
      <div className="min-w-0 flex-1 break-words">{children}</div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

// Guardrail chips, not <Hint>s: the state of a queued write must survive hints being off.
function QueuedChip({ state }: { state: Exclude<QueuedState, 'none'> }) {
  return state === 'failed' ? (
    <Badge variant="destructive" className="h-10 w-full justify-center sm:w-auto sm:h-auto">
      Needs attention
    </Badge>
  ) : (
    <Badge variant="secondary" className="h-10 w-full justify-center sm:w-auto sm:h-auto">
      Queued
    </Badge>
  );
}

export interface TaskRowProps {
  task: MyTask;
  /** Today as YYYY-MM-DD in the operating timezone (from useMyWork), so the due line agrees with the buckets. */
  today: string;
  queued: QueuedState;
  onComplete: (task: MyTask) => void;
  /** True on My Day, where rows span buildings; false on a page that already is the building. */
  showBuilding: boolean;
}

export function TaskRow({ task, today, queued, onComplete, showBuilding }: TaskRowProps) {
  return (
    <Row
      action={
        queued !== 'none' ? (
          <QueuedChip state={queued} />
        ) : (
          <Button className="h-10 w-full sm:w-auto" onClick={() => onComplete(task)}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Complete
          </Button>
        )
      }
    >
      <p className="font-medium text-sm">{task.task_name}</p>
      <p className="text-sm text-muted-foreground">
        {showBuilding && <>{formatBuildingName(task.building_name)} · </>}
        {dueLabel(task.due_date, today)}
      </p>
    </Row>
  );
}
