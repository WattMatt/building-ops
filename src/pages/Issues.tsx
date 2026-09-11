import { useEffect, useRef, useState } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { useAuth } from '@/contexts/AuthContext';
import { useIssues } from '@/hooks/useIssues';
import { useNow } from '@/hooks/useNow';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { queuedIssues, type QueuedIssueRow } from '@/lib/offline/pendingOverlay';
import { subscribeQueue } from '@/lib/offline/queue';
import type { MyTask } from '@/lib/myWork';
import { queryClient } from '@/lib/queryClient';
import IssueDetailDialog from '@/components/issues/IssueDetailDialog';
import { SlaChip } from '@/components/issues/SlaChip';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle,
  Plus,
  Search,
  Building2,
  Clock,
  Calendar,
  CloudOff,
  Loader2,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { csvInstant, csvText, type CsvColumn } from '@/lib/exportCsv';
import { formatSlaInstant, slaState } from '@/lib/slaState';
import type { Issue } from '@/hooks/useIssues';
import { isTenantIssue } from '@/lib/issueSource';
import type { IssuePriority, IssueStatus } from '@/lib/constants';

const priorityColors: Record<IssuePriority, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-warning text-warning-foreground',
  high: 'bg-destructive/80 text-destructive-foreground',
  critical: 'bg-destructive text-destructive-foreground',
};

const statusColors: Record<IssueStatus, string> = {
  open: 'bg-warning text-warning-foreground',
  in_progress: 'bg-info text-info-foreground',
  escalated: 'bg-destructive text-destructive-foreground',
  resolved: 'bg-success text-success-foreground',
};

const statusLabels: Record<IssueStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  escalated: 'Escalated',
  resolved: 'Resolved',
};

/**
 * The issue register as a spreadsheet: what is on screen after the filters, with the SLA clock
 * spelled out (target, due, state) so an export can answer "which of these breached?" without
 * the reader re-deriving it. `slaState` is the same function the chips use.
 *
 * No assignee column: the list spans buildings and returns ids only, and resolving them would
 * mean one `building_members` RPC per building on this page. A uuid in a landlord's
 * spreadsheet answers nothing, so the column is out rather than raw.
 */
export const ISSUE_CSV_COLUMNS: CsvColumn<Issue>[] = [
  { key: 'title', header: 'Title' },
  { key: 'building_name', header: 'Building', format: csvText },
  { key: 'priority', header: 'Priority' },
  { key: 'status', header: 'Status', format: (v) => statusLabels[v as IssueStatus] ?? String(v) },
  { key: 'category', header: 'Category', format: csvText },
  { key: 'created_at', header: 'Reported', format: csvInstant },
  { key: 'deadline', header: 'Deadline', format: csvText },
  { key: 'resolved_at', header: 'Resolved at', format: csvInstant },
  { key: 'sla_target_hours', header: 'SLA target (hours)', format: csvText },
  { header: 'SLA due', format: (_v, row) => { const d = slaState(row).due; return d ? formatSlaInstant(d) : ''; } },
  { header: 'SLA state', format: (_v, row) => slaState(row).label },
  { key: 'sla_breached_at', header: 'SLA breached at', format: csvInstant },
  { key: 'first_response_at', header: 'First response', format: csvInstant },
  { key: 'corrective_action', header: 'Corrective action', format: csvText },
];

export default function Issues() {
  const { isAdminOrManager, user } = useAuth();
  const { issues, stats, loading, error, refetch } = useIssues();
  // One ticking clock for every SLA chip on the page (a minute is the chips' finest unit).
  const now = useNow();
  // The live list is not react-query backed, so a background replay (OfflineQueueRunner) would
  // otherwise leave a just-synced issue as a stale queued row: every queue mutation refetches.
  // Not while offline, though: the fetch would only fail (and flash the spinner over the queued
  // rows); the queue itself is the whole picture until the connection is back.
  useEffect(() => subscribeQueue(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    void refetch();
  }), [refetch]);
  // Issues reported while offline sit in the queue until they sync; the server does not have
  // them yet, so they are overlaid at the top of the list. Names come from the live list first,
  // then from the persisted My Day tasks cache (the building the caretaker was working in when
  // the issue was reported is usually there); a building in neither shows blank.
  const { ops: queuedOps } = useOfflineQueue();
  const buildingNames = new Map<string, string>();
  for (const issue of issues) {
    if (issue.building_name && !buildingNames.has(issue.building_id)) {
      buildingNames.set(issue.building_id, issue.building_name);
    }
  }
  const cachedTasks = user ? queryClient.getQueryData<MyTask[]>(['my-work', 'tasks', user.id]) : undefined;
  for (const task of cachedTasks ?? []) {
    if (task.building_name && !buildingNames.has(task.building_id)) {
      buildingNames.set(task.building_id, task.building_name);
    }
  }
  const pendingIssues = queuedIssues(queuedOps, buildingNames);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<IssueStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<IssuePriority | 'all'>('all');
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  // Derive from the live list so the dialog reflects edits after refetch.
  const selectedIssue = issues.find((i) => i.id === selectedIssueId) ?? null;

  // Deep link: /issues?open=<id> opens that issue once the list has loaded.
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get('open');
  const missingToastedFor = useRef<string | null>(null);
  const dropOpenParam = () => setSearchParams((prev) => { prev.delete('open'); return prev; }, { replace: true });

  useEffect(() => {
    if (!openId || loading) return;
    if (issues.some((i) => i.id === openId)) {
      setSelectedIssueId(openId);
      return;
    }
    // Not in the list: either it does not exist or RLS hides it — same answer either way.
    if (missingToastedFor.current !== openId) {
      missingToastedFor.current = openId;
      toast.error('That issue is not available to you.');
    }
    setSearchParams((prev) => { prev.delete('open'); return prev; }, { replace: true });
  }, [openId, loading, issues, setSearchParams]);

  const matchesFilters = (issue: {
    title: string;
    description: string;
    status: IssueStatus;
    priority: IssuePriority;
    reference?: string | null;
    reporter?: { name: string } | null;
  }) => {
    const matchesSearch =
      issue.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      issue.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      // A tenant quotes their reference number, and the team searches for the person who called.
      (issue.reference ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (issue.reporter?.name ?? '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || issue.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || issue.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  };

  // Queued rows take part in the same filters, and always sit above the live rows.
  const filteredQueued = pendingIssues.filter(matchesFilters);
  const filteredIssues = issues.filter(matchesFilters);
  const nothingToShow = filteredQueued.length === 0 && filteredIssues.length === 0;

  // No detail dialog for a queued issue: it has no server row to load activity for. The
  // queue sheet (where it can be retried or discarded) is the tap target once it lands.
  const onQueuedRowClick = (row: QueuedIssueRow) => {
    toast(row.failed ? 'This issue could not sync yet' : 'This issue is waiting to sync');
  };

  // Guardrail: the error card must never hide a queued issue. A caretaker who reports an issue
  // offline lands here with the fetch failing; on its own the card replaces the page, but with
  // queued rows it sits above them and the rows still render. Same for the spinner.
  const errorCard = error ? (
    <Card className="border-destructive/50">
      <CardContent className="flex flex-col items-center justify-center py-12">
        <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Failed to load issues</h3>
        <p className="text-muted-foreground text-center mb-4 max-w-md">
          {error.message || 'An unexpected error occurred while fetching issues.'}
        </p>
        <Button onClick={() => refetch()} variant="outline">
          Try Again
        </Button>
      </CardContent>
    </Card>
  ) : null;

  if (pendingIssues.length === 0) {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (error) {
      return (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Issues</h1>
            <p className="text-muted-foreground">Track and resolve maintenance issues</p>
          </div>
          {errorCard}
        </div>
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Issues</h1>
          <p className="text-muted-foreground">
            Track and resolve maintenance issues
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Server rows only: a queued issue has no server row, so it carries no SLA clock. */}
          <ExportCsvButton rows={filteredIssues} columns={ISSUE_CSV_COLUMNS} filename="issues" />
          <Button asChild>
            <Link to="/issues/new">
              <Plus className="w-4 h-4 mr-2" />
              Report Issue
            </Link>
          </Button>
        </div>
      </div>

      {loading && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading issues…
        </p>
      )}
      {errorCard}

      {/* Stats: server counts, so not shown while the server list could not be loaded. */}
      {!error && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Open</p>
                  <p className="text-2xl font-bold">{stats.open}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-warning/10 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-warning" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">In Progress</p>
                  <p className="text-2xl font-bold">{stats.inProgress}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-info/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-info" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Escalated</p>
                  <p className="text-2xl font-bold">{stats.escalated}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Resolved</p>
                  <p className="text-2xl font-bold">{stats.resolved}</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-success/10 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-success" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search issues..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as IssueStatus | 'all')}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="escalated">Escalated</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as IssuePriority | 'all')}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Issues List */}
      {nothingToShow ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No issues found</h3>
            <p className="text-muted-foreground text-center">
              {searchQuery || statusFilter !== 'all' || priorityFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'No issues have been reported yet'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredQueued.map((row) => (
            <Card
              key={row.id}
              data-testid="queued-issue"
              className="border-dashed cursor-pointer"
              onClick={() => onQueuedRowClick(row)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-muted">
                      <CloudOff className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">{row.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {row.description}
                      </p>
                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        {row.building_name && (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {formatBuildingName(row.building_name)}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(row.created_at), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge variant="secondary" className={priorityColors[row.priority]}>
                      {row.priority}
                    </Badge>
                    {/* Guardrail chip, plain text: the sync state must always be visible. */}
                    <Badge variant={row.failed ? 'destructive' : 'outline'}>
                      {row.failed ? 'Needs attention' : 'Queued'}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {filteredIssues.map((issue) => (
            <Card
              key={issue.id}
              className="hover:shadow-sm transition-shadow cursor-pointer"
              onClick={() => setSelectedIssueId(issue.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        issue.priority === 'critical' || issue.priority === 'high'
                          ? 'bg-destructive/10'
                          : 'bg-warning/10'
                      }`}
                    >
                      <AlertTriangle
                        className={`h-5 w-5 ${
                          issue.priority === 'critical' || issue.priority === 'high'
                            ? 'text-destructive'
                            : 'text-warning'
                        }`}
                      />
                    </div>
                    <div>
                      <h3 className="font-medium">{issue.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {issue.description}
                      </p>
                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {formatBuildingName(issue.building_name)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(issue.created_at), 'MMM d, yyyy')}
                        </span>
                        {issue.deadline && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Due: {format(new Date(issue.deadline), 'MMM d')}
                          </span>
                        )}
                        {isTenantIssue(issue) && (
                          <Badge variant="outline" className="border-info text-info" data-testid="tenant-chip">
                            Tenant{issue.reference ? ` · ${issue.reference}` : ''}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge variant="secondary" className={priorityColors[issue.priority]}>
                      {issue.priority}
                    </Badge>
                    <Badge variant="secondary" className={statusColors[issue.status]}>
                      {statusLabels[issue.status]}
                    </Badge>
                    <SlaChip issue={issue} now={now} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedIssue && (
        <IssueDetailDialog
          issue={selectedIssue}
          open={!!selectedIssue}
          onOpenChange={(o) => { if (!o) { setSelectedIssueId(null); if (openId) dropOpenParam(); } }}
          canManage={isAdminOrManager}
          onUpdated={refetch}
        />
      )}
    </div>
  );
}
