/**
 * Dashboard widget for admins/managers: what is waiting on them right now — building
 * reports that are submitted or reviewed (both states still await approval — see
 * FortressReportEditor, which offers Approve from either one), and sign-off requests
 * that have gone overdue. Two independent TanStack queries, each rendered from its own
 * state (skeleton / inline error with retry / rows) so a slow or broken source never
 * blocks or hides the other's data.
 */
import { Link } from 'react-router-dom';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import { AlertTriangle, ClipboardCheck, FileText } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { fdb } from '@/integrations/supabase/fortress-db';
import { formatBuildingName } from '@/lib/buildingName';
import { formatPeriodLabel } from '@/lib/fortressReports';

const REPORT_STATUSES_TO_APPROVE = ['submitted', 'reviewed'] as const;
type ReportStatusToApprove = (typeof REPORT_STATUSES_TO_APPROVE)[number];

interface SubmittedReportRow {
  id: string;
  title: string | null;
  status: ReportStatusToApprove;
  report_period: string;
  updated_at: string;
  building_name: string;
}

interface OverdueSignoffRow {
  id: string;
  due_at: string;
  form_name: string;
  building_id: string | null;
  building_name: string | null;
}

interface WaitingResult<T> {
  count: number;
  rows: T[];
}

const ROW_LINK_FOCUS_CLASSES = 'focus-visible:ring-2 focus-visible:ring-ring rounded-lg';

async function fetchSubmittedReports(): Promise<WaitingResult<SubmittedReportRow>> {
  const [{ count, error: countError }, { data, error }] = await Promise.all([
    fdb.from('reports').select('id', { count: 'exact', head: true }).in('status', REPORT_STATUSES_TO_APPROVE),
    fdb
      .from('reports')
      .select('id, title, status, report_period, updated_at, buildings(name)')
      .in('status', REPORT_STATUSES_TO_APPROVE)
      .order('updated_at', { ascending: false })
      .limit(5),
  ]);
  if (countError) throw new Error(countError.message);
  if (error) throw new Error(error.message);

  return {
    count: count ?? 0,
    rows: (data ?? []).map((r: any) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      report_period: r.report_period,
      updated_at: r.updated_at,
      building_name: r.buildings?.name ?? 'Building',
    })),
  };
}

async function fetchOverdueSignoffs(): Promise<WaitingResult<OverdueSignoffRow>> {
  const nowIso = new Date().toISOString();

  const [{ count, error: countError }, { data: reqs, error }] = await Promise.all([
    supabase
      .from('form_signoff_requests')
      .select('id', { count: 'exact', head: true })
      .eq('active', true)
      .eq('status', 'pending')
      .lt('due_at', nowIso),
    supabase
      .from('form_signoff_requests')
      .select('id, submission_id, due_at')
      .eq('active', true)
      .eq('status', 'pending')
      .lt('due_at', nowIso)
      .order('due_at', { ascending: true })
      .limit(5),
  ]);
  if (countError) throw new Error(countError.message);
  if (error) throw new Error(error.message);

  const rows = reqs ?? [];

  // Hydrated the same way useMySignoffs does: form_signoff_requests carries no form/building
  // info of its own, so resolve submission_id -> form_submissions -> buildings in two batched
  // lookups rather than per-row round trips.
  const subIds = [...new Set(rows.map((r) => r.submission_id))];
  const subs = subIds.length
    ? ((await supabase.from('form_submissions').select('id, form_name, building_id').in('id', subIds)).data ?? [])
    : [];
  const subMap = new Map(subs.map((s) => [s.id, s]));

  const bIds = [...new Set(subs.map((s) => s.building_id).filter(Boolean))] as string[];
  const blds = bIds.length ? ((await supabase.from('buildings').select('id, name').in('id', bIds)).data ?? []) : [];
  const bMap = new Map(blds.map((b) => [b.id, b.name]));

  return {
    count: count ?? 0,
    rows: rows.map((r) => {
      const s = subMap.get(r.submission_id);
      return {
        id: r.id,
        // `.lt('due_at', nowIso)` excludes NULL due_at rows (NULL comparisons are UNKNOWN in SQL), so every matched row has one.
        due_at: r.due_at!,
        form_name: s?.form_name ?? 'Form',
        building_id: s?.building_id ?? null,
        building_name: s?.building_id ? (bMap.get(s.building_id) ?? null) : null,
      };
    }),
  };
}

function ReportsSection({
  query,
  rows,
  count,
}: {
  query: UseQueryResult<WaitingResult<SubmittedReportRow>, Error>;
  rows: SubmittedReportRow[];
  count: number;
}) {
  if (query.isLoading) {
    return (
      <div>
        <h4 className="text-sm font-medium mb-2">Reports to approve</h4>
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div>
        <h4 className="text-sm font-medium mb-2">Reports to approve</h4>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
            <p className="text-xs text-muted-foreground truncate">Could not load reports waiting on you.</p>
          </div>
          <Button onClick={() => void query.refetch()} variant="outline" size="sm" disabled={query.isFetching}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (count === 0) return null;

  return (
    <div>
      <h4 className="text-sm font-medium mb-2">Reports to approve</h4>
      <div className="space-y-2">
        {rows.map((r) => (
          <Link key={r.id} to={`/reports/fortress/${r.id}`} className={`block ${ROW_LINK_FOCUS_CLASSES}`}>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
              <div className="flex items-start gap-3 min-w-0">
                <div className="h-9 w-9 rounded-lg bg-warning/10 flex items-center justify-center flex-shrink-0">
                  <FileText className="h-4 w-4 text-warning" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{r.title ?? 'Untitled report'}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {formatBuildingName(r.building_name)} • {formatPeriodLabel(r.report_period)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant="outline" className="text-xs whitespace-nowrap capitalize">
                  {r.status}
                </Badge>
                <Badge variant="outline" className="text-xs whitespace-nowrap">
                  {formatDistanceToNow(new Date(r.updated_at), { addSuffix: true })}
                </Badge>
              </div>
            </div>
          </Link>
        ))}
      </div>
      {count > rows.length && (
        <div className="mt-3 text-center">
          <Button variant="outline" size="sm" asChild>
            <Link to="/reports/fortress">View all {count} reports</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function SignoffsSection({
  query,
  rows,
  count,
}: {
  query: UseQueryResult<WaitingResult<OverdueSignoffRow>, Error>;
  rows: OverdueSignoffRow[];
  count: number;
}) {
  if (query.isLoading) {
    return (
      <div>
        <h4 className="text-sm font-medium mb-2">Overdue sign-offs</h4>
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div>
        <h4 className="text-sm font-medium mb-2">Overdue sign-offs</h4>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
            <p className="text-xs text-muted-foreground truncate">Could not load overdue sign-offs.</p>
          </div>
          <Button onClick={() => void query.refetch()} variant="outline" size="sm" disabled={query.isFetching}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (count === 0) return null;

  return (
    <div>
      <h4 className="text-sm font-medium mb-2">Overdue sign-offs</h4>
      <div className="space-y-2">
        {rows.map((s) => (
          <Link
            key={s.id}
            to={s.building_id ? `/buildings/${s.building_id}?tab=forms` : '/forms'}
            className={`block ${ROW_LINK_FOCUS_CLASSES}`}
          >
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
              <div className="flex items-start gap-3 min-w-0">
                <div className="h-9 w-9 rounded-lg bg-destructive/10 flex items-center justify-center flex-shrink-0">
                  <ClipboardCheck className="h-4 w-4 text-destructive" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{s.form_name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {s.building_name ? formatBuildingName(s.building_name) : 'No building'}
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="text-xs whitespace-nowrap flex-shrink-0 text-destructive">
                due {format(new Date(s.due_at), 'd MMM yyyy')}
              </Badge>
            </div>
          </Link>
        ))}
      </div>
      {count > rows.length && (
        <div className="mt-3 text-center">
          <Button variant="outline" size="sm" asChild>
            <Link to="/forms">View all {count} sign-offs</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

export default function WaitingOnYouWidget() {
  const reportsQuery = useQuery({ queryKey: ['waiting', 'reports'], queryFn: fetchSubmittedReports });
  const signoffsQuery = useQuery({ queryKey: ['waiting', 'signoffs'], queryFn: fetchOverdueSignoffs });

  const reportsCount = reportsQuery.data?.count ?? 0;
  const signoffsCount = signoffsQuery.data?.count ?? 0;
  const reports = reportsQuery.data?.rows ?? [];
  const signoffs = signoffsQuery.data?.rows ?? [];

  const bothEmpty =
    reportsQuery.isSuccess && signoffsQuery.isSuccess && reportsCount === 0 && signoffsCount === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <ClipboardCheck className="h-5 w-5" />
          Waiting on You
          {reportsQuery.isSuccess && reportsCount > 0 && (
            <Badge variant="secondary" className="bg-warning/20 text-warning-foreground">
              {reportsCount} to approve
            </Badge>
          )}
          {signoffsQuery.isSuccess && signoffsCount > 0 && <Badge variant="destructive">{signoffsCount} overdue</Badge>}
        </CardTitle>
        <CardDescription>Reports awaiting your approval and overdue sign-offs</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {bothEmpty ? (
          <p className="text-sm text-muted-foreground text-center py-6">Nothing waiting on you</p>
        ) : (
          <>
            <ReportsSection query={reportsQuery} rows={reports} count={reportsCount} />
            <SignoffsSection query={signoffsQuery} rows={signoffs} count={signoffsCount} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
