/**
 * "My work here": the tasks assigned to me in this building — the overview a field user opens
 * the building page for (spec: pilot-field §4.2).
 *
 * Same task query as My Day (`useMyTasks`, which `useMyWork` composes; filtered here to one
 * building) so the two pages can never disagree about what is mine, and the same row, Complete
 * action and queued chip (`TaskRow`) so completing from here behaves exactly as completing from
 * My Day. Only the tasks query is read: issues, sign-offs and returned reports are My Day's,
 * not this card's, so their loading and failure states do not reach it and an Overview visit
 * costs one request, not five. The building name is left off the rows because the page is the
 * building. Mobile-first: one column, nothing side by side.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardCheck, ListChecks, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { useMyTasks } from '@/hooks/useMyTasks';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { failedTaskIds, queuedTaskIds } from '@/lib/offline/pendingOverlay';
import type { MyTask } from '@/lib/myWork';
import { TaskRow, queuedStateFor } from '@/components/myday/TaskRow';
import CompleteTaskDialog from '@/components/checklists/CompleteTaskDialog';
import { track } from '@/lib/analytics';

interface MyWorkHereProps {
  buildingId: string;
}

/** One bucket inside the card: a heading with its count, optional coaching line, then rows. */
function Group({
  title,
  count,
  icon,
  tone = 'default',
  description,
  children,
}: {
  title: string;
  count: number;
  icon: ReactNode;
  tone?: 'default' | 'destructive';
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className={cn('flex items-center gap-2 text-sm font-semibold', tone === 'destructive' && 'text-destructive')}>
        <span className={cn('shrink-0', tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground')}>{icon}</span>
        {`${title} (${count})`}
      </h3>
      {/* Coaching copy through <Hint>; the heading, count and rows are state cues and stay. */}
      {description && <Hint>{description}</Hint>}
      {children}
    </section>
  );
}

export default function MyWorkHere({ buildingId }: MyWorkHereProps) {
  const { today, buckets, isLoading, isError, error, refetch } = useMyTasks();

  // Completions waiting in the offline queue: the server still lists those tasks as due, so
  // the row must say "already done, waiting to sync" rather than offer Complete a second time.
  const { ops: queuedOps } = useOfflineQueue();
  const queuedTasks = queuedTaskIds(queuedOps);
  const failedTasks = failedTaskIds(queuedOps);

  const [taskToComplete, setTaskToComplete] = useState<MyTask | null>(null);

  const here = useMemo(
    () => ({
      overdue: buckets.overdue.filter((t) => t.building_id === buildingId),
      today: buckets.today.filter((t) => t.building_id === buildingId),
      upcoming: buckets.upcoming.filter((t) => t.building_id === buildingId),
    }),
    [buckets, buildingId],
  );
  // Decided here, not from useMyWork().isEmpty: My Day can be busy while this building is clear,
  // and this card never reads the issue, sign-off or returned-report sources at all.
  const isEmpty = here.overdue.length + here.today.length + here.upcoming.length === 0;

  const taskRow = (task: MyTask) => (
    <TaskRow
      key={task.id}
      task={task}
      today={today}
      queued={queuedStateFor(task.id, queuedTasks, failedTasks)}
      onComplete={setTaskToComplete}
      showBuilding={false}
    />
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          My work here
        </CardTitle>
        <Hint>Tasks assigned to you in this building. Everything else that is yours is on My Day.</Hint>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading your work here" />
          </div>
        )}

        {/* A failed load must not read as "nothing here" — that is the one wrong answer. */}
        {!isLoading && isError && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
                Your work here could not be loaded
              </p>
              <Button variant="outline" size="sm" className="h-10" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Tasks may still be assigned to you. Try again, or open the Tasks tab.
            </p>
            {/* The actual failure, so a report to support says more than "it didn't work".
                Not a <Hint>: this is an error detail, and must survive hints being off. */}
            {error?.message && <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>}
          </div>
        )}

        {!isLoading && !isError && isEmpty && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-success" aria-hidden="true" />
            <p className="font-medium">Nothing assigned to you here</p>
            <p className="text-sm text-muted-foreground">
              No overdue, due-today or upcoming tasks in this building are yours.
            </p>
          </div>
        )}

        {!isLoading && !isError && !isEmpty && (
          <>
            {here.overdue.length > 0 && (
              <Group
                title="Overdue"
                count={here.overdue.length}
                tone="destructive"
                icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
                description="Past their due date — clear these first."
              >
                {here.overdue.map(taskRow)}
              </Group>
            )}
            {here.today.length > 0 && (
              <Group title="Today" count={here.today.length} icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />}>
                {here.today.map(taskRow)}
              </Group>
            )}
            {here.upcoming.length > 0 && (
              <Group title="Next 7 days" count={here.upcoming.length} icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />}>
                {here.upcoming.map(taskRow)}
              </Group>
            )}
          </>
        )}
      </CardContent>

      {taskToComplete && (
        <CompleteTaskDialog
          open
          onOpenChange={(open) => {
            if (!open) setTaskToComplete(null);
          }}
          taskId={taskToComplete.id}
          taskName={taskToComplete.task_name}
          taskDescription={taskToComplete.task_description}
          requiresPhoto={taskToComplete.requires_photo}
          requiresSignature={taskToComplete.requires_signature}
          onSuccess={() => {
            track('task_completed', { taskId: taskToComplete.id, surface: 'my_work_here' });
            setTaskToComplete(null);
            refetch();
          }}
        />
      )}
    </Card>
  );
}
