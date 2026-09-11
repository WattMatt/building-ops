import { useState, useEffect, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, AlertCircle, FileText, Wrench, ArrowRight, CheckCircle, ClipboardList, ListChecks } from 'lucide-react';
import { format, differenceInDays, isPast, isSameDay, subDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { todayInOperatingTz } from '@/lib/myWork';
import MonthCostsCard from './MonthCostsCard';

interface OverviewWidgetsProps {
  buildingId: string;
  onTabChange?: (tab: string) => void;
}

interface ExpiringDocument {
  id: string;
  name: string;
  document_type: string;
  expiry_date: string;
}

interface OverdueAsset {
  id: string;
  name: string;
  category: string;
  next_service_date: string;
}

interface FormSubmission {
  id: string;
  form_name: string;
  status: string;
  created_at: string;
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  compliance_certificate: 'Compliance Certificate',
  fire_certificate: 'Fire Certificate',
  electrical_coc: 'Electrical COC',
  occupancy_certificate: 'Occupancy Certificate',
  insurance: 'Insurance Policy',
  floor_plan: 'Floor Plan',
  building_plan: 'Building Plan',
  municipal_rates: 'Municipal Rates',
  water_certificate: 'Water Certificate',
  gas_certificate: 'Gas Certificate',
  lift_certificate: 'Lift Certificate',
  other: 'Other',
};

const ASSET_CATEGORY_LABELS: Record<string, string> = {
  hvac: 'HVAC',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  fire_safety: 'Fire Safety',
  elevator: 'Elevator',
  generator: 'Generator',
  security: 'Security',
  other: 'Other',
};

/* ---------------------------------------------------------------------------
 * Compact "what needs me now" widgets. Spec §5.3: on a phone the overview reads
 * score (chips in the page header), today's tasks, open issues, contacts, then the
 * rest — so these two render first and the DOM order is the phone order.
 * ------------------------------------------------------------------------- */

interface TaskCounts {
  /** Open tasks (pending/overdue) due on or before today. */
  due: number;
  /** The subset of `due` whose due_date is before today — same rule as My Day's bucketTasks. */
  overdue: number;
}

interface IssueCounts {
  /** Issues not yet resolved. */
  open: number;
  /** The subset of `open` with priority high or critical. */
  urgent: number;
}

const OPEN_TASK_STATUSES = ['pending', 'overdue'];
const URGENT_ISSUE_PRIORITIES = ['high', 'critical'];

async function fetchTaskCounts(buildingId: string): Promise<TaskCounts> {
  const today = todayInOperatingTz();
  const [{ count: due, error: dueError }, { count: overdue, error: overdueError }] = await Promise.all([
    supabase
      .from('task_instances')
      .select('id', { count: 'exact', head: true })
      .eq('building_id', buildingId)
      .in('status', OPEN_TASK_STATUSES)
      .lte('due_date', today),
    supabase
      .from('task_instances')
      .select('id', { count: 'exact', head: true })
      .eq('building_id', buildingId)
      .in('status', OPEN_TASK_STATUSES)
      .lt('due_date', today),
  ]);
  if (dueError) throw new Error(dueError.message);
  if (overdueError) throw new Error(overdueError.message);
  return { due: due ?? 0, overdue: overdue ?? 0 };
}

async function fetchIssueCounts(buildingId: string): Promise<IssueCounts> {
  const [{ count: open, error: openError }, { count: urgent, error: urgentError }] = await Promise.all([
    supabase
      .from('issues')
      .select('id', { count: 'exact', head: true })
      .eq('building_id', buildingId)
      .neq('status', 'resolved'),
    supabase
      .from('issues')
      .select('id', { count: 'exact', head: true })
      .eq('building_id', buildingId)
      .neq('status', 'resolved')
      .in('priority', URGENT_ISSUE_PRIORITIES),
  ]);
  if (openError) throw new Error(openError.message);
  if (urgentError) throw new Error(urgentError.message);
  return { open: open ?? 0, urgent: urgent ?? 0 };
}

interface CompactWidgetProps {
  icon: ReactNode;
  title: string;
  /** Whole card is the tap target (>= 44px), keyboard operable via Enter / Space. */
  onActivate: () => void;
  isLoading: boolean;
  isError: boolean;
  /** Draws the destructive border, mirroring the alert widgets below. */
  attention: boolean;
  children: ReactNode;
}

function CompactWidget({ icon, title, onActivate, isLoading, isError, attention, children }: CompactWidgetProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-busy={isLoading}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
      className={cn(
        'min-h-11 cursor-pointer select-none transition-colors hover:bg-muted/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        attention && 'border-destructive',
      )}
    >
      <CardHeader className="p-4 pb-1">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-1">
        {isLoading ? (
          <div className="h-6 w-24 animate-pulse rounded bg-muted" aria-hidden="true" />
        ) : isError ? (
          // Guardrail, not a hint: a failed count must never read as "nothing due".
          <p className="text-sm text-destructive">Couldn't load</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function TodayTasksWidget({ buildingId, onTabChange }: OverviewWidgetsProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['building-overview', 'tasks', buildingId],
    queryFn: () => fetchTaskCounts(buildingId),
    staleTime: 60_000,
  });
  const due = data?.due ?? 0;
  const overdue = data?.overdue ?? 0;

  return (
    <CompactWidget
      icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}
      title="Today's tasks"
      onActivate={() => onTabChange?.('checklists')}
      isLoading={isPending}
      isError={isError}
      attention={overdue > 0}
    >
      {due === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing due today</p>
      ) : (
        <p className="text-lg font-semibold leading-tight">
          {due} due
          {overdue > 0 && <span className="text-destructive"> · {overdue} overdue</span>}
        </p>
      )}
    </CompactWidget>
  );
}

function OpenIssuesWidget({ buildingId }: OverviewWidgetsProps) {
  const navigate = useNavigate();
  const { data, isPending, isError } = useQuery({
    queryKey: ['building-overview', 'issues', buildingId],
    queryFn: () => fetchIssueCounts(buildingId),
    staleTime: 60_000,
  });
  const open = data?.open ?? 0;
  const urgent = data?.urgent ?? 0;

  return (
    <CompactWidget
      icon={<AlertCircle className="h-4 w-4" aria-hidden="true" />}
      title="Open issues"
      // Building Details has no issues tab and /issues does not read a ?building= param
      // yet, so the best we can do is land on the issues list.
      onActivate={() => navigate('/issues')}
      isLoading={isPending}
      isError={isError}
      attention={urgent > 0}
    >
      {open === 0 ? (
        <p className="text-sm text-muted-foreground">No open issues</p>
      ) : (
        <p className="text-lg font-semibold leading-tight">
          {open} open
          {urgent > 0 && <span className="text-destructive"> · {urgent} high priority</span>}
        </p>
      )}
    </CompactWidget>
  );
}

export default function OverviewWidgets({ buildingId, onTabChange }: OverviewWidgetsProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <TodayTasksWidget buildingId={buildingId} onTabChange={onTabChange} />
        <OpenIssuesWidget buildingId={buildingId} onTabChange={onTabChange} />
      </div>
      {/* Spec §8: the month-cost card sits right after the two "what needs me now" widgets. */}
      <MonthCostsCard buildingId={buildingId} />
      <AlertWidgets buildingId={buildingId} onTabChange={onTabChange} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Document / maintenance / form alert widgets (the "rest" in spec §5.3).
 * ------------------------------------------------------------------------- */

function AlertWidgets({ buildingId, onTabChange }: OverviewWidgetsProps) {
  const [expiringDocs, setExpiringDocs] = useState<ExpiringDocument[]>([]);
  const [expiredDocs, setExpiredDocs] = useState<ExpiringDocument[]>([]);
  const [overdueAssets, setOverdueAssets] = useState<OverdueAsset[]>([]);
  const [upcomingAssets, setUpcomingAssets] = useState<OverdueAsset[]>([]);
  const [recentSubmissions, setRecentSubmissions] = useState<FormSubmission[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [totalThisWeek, setTotalThisWeek] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [buildingId]);

  const fetchData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const in30Days = new Date(today);
      in30Days.setDate(in30Days.getDate() + 30);

      // Fetch documents with expiry dates
      const { data: docs, error: docsError } = await supabase
        .from('building_documents')
        .select('id, name, document_type, expiry_date')
        .eq('building_id', buildingId)
        .not('expiry_date', 'is', null)
        .lte('expiry_date', format(in30Days, 'yyyy-MM-dd'))
        .order('expiry_date');

      if (docsError) throw docsError;

      // Separate expired and expiring soon
      const expired: ExpiringDocument[] = [];
      const expiring: ExpiringDocument[] = [];
      
      (docs || []).forEach((doc) => {
        const expiryDate = new Date(doc.expiry_date);
        if (isPast(expiryDate) && !isSameDay(expiryDate, today)) {
          expired.push(doc);
        } else {
          expiring.push(doc);
        }
      });

      setExpiredDocs(expired);
      setExpiringDocs(expiring);

      // Fetch assets with service dates
      const { data: assets, error: assetsError } = await supabase
        .from('building_assets')
        .select('id, name, category, next_service_date')
        .eq('building_id', buildingId)
        .not('next_service_date', 'is', null)
        .lte('next_service_date', format(in30Days, 'yyyy-MM-dd'))
        .order('next_service_date');

      if (assetsError) throw assetsError;

      // Separate overdue and upcoming
      const overdue: OverdueAsset[] = [];
      const upcoming: OverdueAsset[] = [];
      
      (assets || []).forEach((asset) => {
        const serviceDate = new Date(asset.next_service_date);
        if (isPast(serviceDate) && !isSameDay(serviceDate, today)) {
          overdue.push(asset);
        } else {
          upcoming.push(asset);
        }
      });

      setOverdueAssets(overdue);
      setUpcomingAssets(upcoming);

      // Fetch form submissions for this building
      const sevenDaysAgo = subDays(today, 7);
      const { data: submissions, error: submissionsError } = await supabase
        .from('form_submissions')
        .select('id, form_name, status, created_at')
        .eq('building_id', buildingId)
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(5);

      if (submissionsError) throw submissionsError;

      setRecentSubmissions(submissions || []);
      setTotalThisWeek((submissions || []).length);
      setPendingCount((submissions || []).filter(s => s.status === 'submitted').length);

    } catch (error) {
      console.error('Error fetching overview data:', error);
      // Never fall through to the "all clear" empty states on a failed read.
      setLoadError(error instanceof Error ? error.message : 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const getExpiryBadge = (expiryDate: string) => {
    const today = new Date();
    const expiry = new Date(expiryDate);
    const days = differenceInDays(expiry, today);

    if (days < 0) {
      return (
        <Badge variant="destructive" className="text-xs">
          {Math.abs(days)}d overdue
        </Badge>
      );
    } else if (days === 0) {
      return (
        <Badge variant="destructive" className="text-xs">
          Today
        </Badge>
      );
    } else if (days <= 7) {
      return (
        <Badge variant="outline" className="text-xs border-destructive text-destructive">
          {days}d left
        </Badge>
      );
    } else {
      return (
        <Badge variant="outline" className="text-xs">
          {days}d left
        </Badge>
      );
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'submitted':
        return <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">Pending</Badge>;
      case 'reviewed':
        return <Badge variant="outline" className="text-xs border-blue-500 text-blue-600">Reviewed</Badge>;
      case 'approved':
        return <Badge variant="outline" className="text-xs border-green-500 text-green-600">Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive" className="text-xs">Rejected</Badge>;
      default:
        return <Badge variant="secondary" className="text-xs">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="pb-3">
              <div className="h-5 w-32 bg-muted rounded" />
            </CardHeader>
            <CardContent>
              <div className="h-20 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Failed to load overview alerts</h3>
          <p className="text-muted-foreground text-center mb-4 max-w-md">
            {loadError} Document, maintenance and form status for this building could not be
            checked — treat nothing here as confirmed.
          </p>
          <Button onClick={() => fetchData()} variant="outline">
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const totalDocAlerts = expiredDocs.length + expiringDocs.length;
  const totalAssetAlerts = overdueAssets.length + upcomingAssets.length;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {/* Documents Widget */}
      <Card className={expiredDocs.length > 0 ? 'border-destructive' : ''}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Document Expiry Alerts
              {totalDocAlerts > 0 && (
                <Badge variant={expiredDocs.length > 0 ? 'destructive' : 'secondary'}>
                  {totalDocAlerts}
                </Badge>
              )}
            </CardTitle>
            {totalDocAlerts > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onTabChange?.('documents')}>
                View All
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {totalDocAlerts === 0 ? (
            <div className="flex items-center gap-3 py-2">
              <CheckCircle className="h-8 w-8 text-primary" />
              <div>
                <p className="font-medium text-sm">All documents current</p>
                <p className="text-xs text-muted-foreground">No expiring documents in the next 30 days</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3 max-h-[200px] overflow-y-auto">
              {expiredDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-destructive/10 border border-destructive/20"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}
                    </p>
                  </div>
                  {getExpiryBadge(doc.expiry_date)}
                </div>
              ))}
              {expiringDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}
                    </p>
                  </div>
                  {getExpiryBadge(doc.expiry_date)}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Maintenance Widget */}
      <Card className={overdueAssets.length > 0 ? 'border-destructive' : ''}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Maintenance Alerts
              {totalAssetAlerts > 0 && (
                <Badge variant={overdueAssets.length > 0 ? 'destructive' : 'secondary'}>
                  {totalAssetAlerts}
                </Badge>
              )}
            </CardTitle>
            {totalAssetAlerts > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onTabChange?.('maintenance')}>
                View All
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {totalAssetAlerts === 0 ? (
            <div className="flex items-center gap-3 py-2">
              <CheckCircle className="h-8 w-8 text-primary" />
              <div>
                <p className="font-medium text-sm">All maintenance current</p>
                <p className="text-xs text-muted-foreground">No overdue or upcoming service in the next 30 days</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3 max-h-[200px] overflow-y-auto">
              {overdueAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-destructive/10 border border-destructive/20"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{asset.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ASSET_CATEGORY_LABELS[asset.category] || asset.category}
                    </p>
                  </div>
                  {getExpiryBadge(asset.next_service_date)}
                </div>
              ))}
              {upcomingAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{asset.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ASSET_CATEGORY_LABELS[asset.category] || asset.category}
                    </p>
                  </div>
                  {getExpiryBadge(asset.next_service_date)}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form Submissions Widget */}
      <Card className={pendingCount > 0 ? 'border-amber-500' : ''}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              Form Activity
              {pendingCount > 0 && (
                <Badge variant="outline" className="border-amber-500 text-amber-600">
                  {pendingCount} pending
                </Badge>
              )}
            </CardTitle>
            {recentSubmissions.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onTabChange?.('forms')}>
                View All
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {recentSubmissions.length === 0 ? (
            <div className="flex items-center gap-3 py-2">
              <ClipboardList className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">No recent submissions</p>
                <p className="text-xs text-muted-foreground">No forms submitted in the last 7 days</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">This week:</span>
                <span className="font-medium">{totalThisWeek} submission{totalThisWeek !== 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-2 max-h-[160px] overflow-y-auto">
                {recentSubmissions.map((submission) => (
                  <div
                    key={submission.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{submission.form_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(submission.created_at), 'MMM d, h:mm a')}
                      </p>
                    </div>
                    {getStatusBadge(submission.status)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
