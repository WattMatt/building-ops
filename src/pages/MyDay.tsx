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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useMyWork, type MyIssue } from '@/hooks/useMyWork';
import { greetingFor, type MyTask } from '@/lib/myWork';
import CompleteTaskDialog from '@/components/checklists/CompleteTaskDialog';
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

/** A date-column value (YYYY-MM-DD) read against the operating day, not the browser's. */
function dueLabel(dueDate: string, today: string): string {
  if (dueDate === today) return 'Due today';
  const parsed = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dueDate;
  return `Due ${format(parsed, 'EEE d MMM')}`;
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
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

/** Every row is the same shape: what it is, where it is, and one action, ≥ 40 px tall. */
function Row({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">{children}</div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

export default function MyDay() {
  const { isAdminOrManager } = useAuth();
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
    isEmpty,
    refetch,
  } = useMyWork();

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

  const taskRow = (task: MyTask) => (
    <Row
      key={task.id}
      action={
        <Button className="h-10 w-full sm:w-auto" onClick={() => setTaskToComplete(task)}>
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Complete
        </Button>
      }
    >
      <p className="font-medium text-sm">{task.task_name}</p>
      <p className="text-xs text-muted-foreground">
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
              {issues.map((issue) => (
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
                    {whenLabel(issue.deadline) ? ` · Due ${whenLabel(issue.deadline)}` : ''}
                  </p>
                </Row>
              ))}
            </Section>
          )}

          {signoffs.length > 0 && (
            <Section
              title="Sign-offs waiting"
              count={signoffs.length}
              icon={<PenLine className="h-4 w-4" />}
            >
              {signoffs.map((signoff) => (
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
                    {whenLabel(signoff.due_at) ? ` · Due ${whenLabel(signoff.due_at)}` : ''}
                  </p>
                </Row>
              ))}
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
                  <button
                    type="button"
                    className="flex min-h-[40px] w-full items-center justify-between gap-2 p-4 text-left"
                  >
                    <span className="flex items-center gap-2 text-base font-semibold">
                      <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                      {`Upcoming (${buckets.upcoming.length})`}
                    </span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
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
