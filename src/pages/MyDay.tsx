/**
 * The landing page for site roles: what is mine today, each row actionable in place.
 *
 * Mobile-first single column — a caretaker opens this on a phone between buildings, so every
 * row carries its own action (complete the task, open the issue, go sign) rather than sending
 * the reader off to find the right list page. Order is deliberate: what is late, then what is
 * due, then the things other people are waiting on me for, and only then the week ahead.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  AlertTriangle,
  ChevronDown,
  ClipboardCheck,
  CheckCircle2,
  FileText,
  Loader2,
  PenLine,
  Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useMyWork, type MyIssue } from '@/hooks/useMyWork';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { failedTaskIds, queuedTaskIds } from '@/lib/offline/pendingOverlay';
import { greetingFor, type MyTask } from '@/lib/myWork';
import CompleteTaskDialog from '@/components/checklists/CompleteTaskDialog';
import { InstallCard } from '@/components/pwa/InstallCard';
import { PushPromptCard } from '@/components/pwa/PushPromptCard';
import { WeekStrip } from '@/components/myday/WeekStrip';
import IssueDetailDialog from '@/components/issues/IssueDetailDialog';
import { formatBuildingName } from '@/lib/buildingName';
import { formatPeriodLabel } from '@/lib/fortressReports';
import { track } from '@/lib/analytics';

const priorityColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-warning text-warning-foreground',
  high: 'bg-destructive/80 text-destructive-foreground',
  critical: 'bg-destructive text-destructive-foreground',
};

/**
 * A date-column value (YYYY-MM-DD) read against the operating day, not the browser's.
 * A past due date reads "Was due …": in a list mixing overdue and upcoming rows, a bare
 * "Due Mon 8 Sep" gives the reader no clue that the date has already gone.
 */
function dueLabel(dueDate: string, today: string): string {
  if (dueDate === today) return 'Due today';
  const parsed = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dueDate;
  const when = format(parsed, 'EEE d MMM');
  return dueDate < today ? `Was due ${when}` : `Due ${when}`;
}

function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return format(parsed, 'EEE d MMM');
}

function Section({
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
    <Card className={cn(tone === 'destructive' && 'border-destructive/50 bg-destructive/5')}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className={cn('shrink-0', tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground')}>
            {icon}
          </span>
          {`${title} (${count})`}
        </CardTitle>
        {/* Coaching copy — why this section is first / what it wants from you. It goes
            through <Hint> so experienced users can switch it off; the counts, dates and
            error states around it are state cues and always stay visible. */}
        {description && <Hint>{description}</Hint>}
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

/**
 * Every row is the same shape: what it is, where it is, and one action. Spec §5.3: a 56 px
 * tap target on phones (min-h-14), relaxing to 40 px once the row lays out horizontally.
 */
function Row({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex min-h-14 flex-col gap-3 rounded-lg bg-muted/50 p-3 sm:min-h-10 sm:flex-row sm:items-center sm:justify-between">
      {/* break-words here rather than on each title: long task names and issue titles
          arrive unhyphenated from the field and would otherwise widen the row on a phone. */}
      <div className="min-w-0 flex-1 break-words">{children}</div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

export default function MyDay() {
  const { isAdminOrManager, user } = useAuth();
  const { profile } = useUserProfile();
  const {
    today,
    buckets,
    issues,
    signoffs,
    returnedReports,
    unread,
    isLoading,
    isError,
    error,
    isEmpty,
    refetch,
  } = useMyWork();

  // Completions waiting in the offline queue. The server still lists those tasks as due, so
  // the row must say "already done, waiting to sync" rather than offer Complete a second time.
  const { ops: queuedOps } = useOfflineQueue();
  const queuedTasks = queuedTaskIds(queuedOps);
  const failedTasks = failedTaskIds(queuedOps);

  const [taskToComplete, setTaskToComplete] = useState<MyTask | null>(null);
  const [issueToOpen, setIssueToOpen] = useState<MyIssue | null>(null);

  // One view event per page load, once the counts are real — firing while the queries are
  // still in flight would report an empty day for everybody.
  const viewTracked = useRef(false);
  useEffect(() => {
    if (isLoading || isError || viewTracked.current) return;
    viewTracked.current = true;
    track('my_day_viewed', {
      overdue: buckets.overdue.length,
      today: buckets.today.length,
      issues: issues.length,
    });
  }, [isLoading, isError, buckets.overdue.length, buckets.today.length, issues.length]);

  const greeting = greetingFor(profile?.full_name, new Date().getHours());

  // Guardrail chips, not <Hint>s: the state of a queued write must survive hints being off.
  const queuedChip = (taskId: string) =>
    failedTasks.has(taskId) ? (
      <Badge variant="destructive" className="h-10 w-full justify-center sm:w-auto sm:h-auto">
        Needs attention
      </Badge>
    ) : (
      <Badge variant="secondary" className="h-10 w-full justify-center sm:w-auto sm:h-auto">
        Queued
      </Badge>
    );

  const taskRow = (task: MyTask) => (
    <Row
      key={task.id}
      action={
        queuedTasks.has(task.id) ? (
          queuedChip(task.id)
        ) : (
          <Button className="h-10 w-full sm:w-auto" onClick={() => setTaskToComplete(task)}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Complete
          </Button>
        )
      }
    >
      <p className="font-medium text-sm">{task.task_name}</p>
      <p className="text-sm text-muted-foreground">
        {formatBuildingName(task.building_name)} · {dueLabel(task.due_date, today)}
      </p>
    </Row>
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Sun className="h-6 w-6 text-warning" />
          {greeting}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground">{format(new Date(), 'EEEE d MMMM yyyy')}</p>
          {unread > 0 && (
            <Link to="/inbox" className="inline-flex">
              <Badge variant="secondary" className="cursor-pointer">
                {unread} unread
              </Badge>
            </Link>
          )}
        </div>
      </div>

      <InstallCard />
      <PushPromptCard userId={user?.id} />

      {/* The week at a glance, built from the same data as the sections below — so it appears
          only once that data is real. While loading or after a failure there is nothing honest
          to draw: seven empty columns would read as a free week. */}
      {!isLoading && !isError && (
        <WeekStrip
          today={today}
          tasks={[...buckets.overdue, ...buckets.today, ...buckets.upcoming]}
          issues={issues}
          signoffs={signoffs}
        />
      )}

      {isLoading && (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading your day" />
        </div>
      )}

      {/* A failed load must not read as an empty day — that is the one wrong answer here. */}
      {!isLoading && isError && (
        <Card className="border-destructive/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Your day could not be loaded
            </CardTitle>
            <Button variant="outline" size="sm" className="h-10" onClick={() => refetch()}>
              Try again
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Work may still be assigned to you. Try again, or open Checklists and Issues directly.
            </p>
            {/* The actual failure, so a report to support says more than "it didn't work".
                Not a <Hint>: this is an error detail, and must survive hints being off. */}
            {error?.message && (
              <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
            )}
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && isEmpty && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-success" />
            <div>
              <p className="font-medium">Nothing waiting on you</p>
              <p className="text-sm text-muted-foreground">
                No tasks, issues, sign-offs or returned reports are assigned to you right now.
              </p>
            </div>
            <Button asChild variant="outline" className="h-10">
              <Link to="/buildings">Browse buildings</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && !isEmpty && (
        <>
          {buckets.overdue.length > 0 && (
            <Section
              title="Overdue"
              count={buckets.overdue.length}
              tone="destructive"
              icon={<AlertTriangle className="h-4 w-4" />}
              description="Past their due date — clear these first."
            >
              {buckets.overdue.map(taskRow)}
            </Section>
          )}

          {buckets.today.length > 0 && (
            <Section
              title="Due today"
              count={buckets.today.length}
              icon={<ClipboardCheck className="h-4 w-4" />}
            >
              {buckets.today.map(taskRow)}
            </Section>
          )}

          {issues.length > 0 && (
            <Section
              title="Issues assigned to me"
              count={issues.length}
              icon={<AlertTriangle className="h-4 w-4" />}
            >
              {issues.map((issue) => {
                const due = whenLabel(issue.deadline);
                return (
                  <Row
                    key={issue.id}
                    action={
                      <Button
                        variant="outline"
                        className="h-10 w-full sm:w-auto"
                        onClick={() => setIssueToOpen(issue)}
                      >
                        Open
                      </Button>
                    }
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-sm">{issue.title}</p>
                      <Badge variant="secondary" className={priorityColors[issue.priority] ?? 'bg-muted'}>
                        {issue.priority}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatBuildingName(issue.building_name)}
                      {due ? ` · Due ${due}` : ''}
                    </p>
                  </Row>
                );
              })}
            </Section>
          )}

          {signoffs.length > 0 && (
            <Section
              title="Sign-offs waiting"
              count={signoffs.length}
              icon={<PenLine className="h-4 w-4" />}
            >
              {signoffs.map((signoff) => {
                const due = whenLabel(signoff.due_at);
                return (
                  <Row
                    key={signoff.id}
                    action={
                      <Button asChild variant="outline" className="h-10 w-full sm:w-auto">
                        <Link to="/my-signoffs">Review &amp; sign</Link>
                      </Button>
                    }
                  >
                    <p className="font-medium text-sm">{signoff.form_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {signoff.building_name ? formatBuildingName(signoff.building_name) : 'No building'}
                      {due ? ` · Due ${due}` : ''}
                    </p>
                  </Row>
                );
              })}
            </Section>
          )}

          {returnedReports.length > 0 && (
            <Section
              title="Reports returned to me"
              count={returnedReports.length}
              icon={<FileText className="h-4 w-4" />}
              description="A reviewer sent these back with changes to make."
            >
              {returnedReports.map((report) => (
                <Row
                  key={report.id}
                  action={
                    <Button asChild variant="outline" className="h-10 w-full sm:w-auto">
                      <Link to={`/reports/fortress/${report.id}`}>Open report</Link>
                    </Button>
                  }
                >
                  <p className="font-medium text-sm">{report.title ?? 'Untitled report'}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatPeriodLabel(report.report_period)}
                  </p>
                  {report.review_notes && (
                    <p className="mt-1 text-xs italic text-muted-foreground">
                      “{report.review_notes}”
                    </p>
                  )}
                </Row>
              ))}
            </Section>
          )}

          {buckets.upcoming.length > 0 && (
            <Collapsible>
              <Card>
                <CollapsibleTrigger asChild>
                  {/* Radix puts data-state on the trigger itself, so `group` here is what
                      lets the chevron follow the open/closed state. */}
                  <button
                    type="button"
                    className="group flex min-h-[40px] w-full items-center justify-between gap-2 p-4 text-left"
                  >
                    <span className="flex items-center gap-2 text-base font-semibold">
                      <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                      {`Upcoming (${buckets.upcoming.length})`}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-2 pt-0">
                    {buckets.upcoming.map(taskRow)}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}
        </>
      )}

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
            track('task_completed', { taskId: taskToComplete.id });
            setTaskToComplete(null);
            refetch();
          }}
        />
      )}

      {issueToOpen && (
        <IssueDetailDialog
          issue={issueToOpen}
          open
          onOpenChange={(open) => {
            if (!open) setIssueToOpen(null);
          }}
          canManage={isAdminOrManager}
          onUpdated={() => refetch()}
        />
      )}
    </div>
  );
}
