/**
 * Dashboard widget for admins/managers: what is waiting on them right now — building
 * reports submitted for review, and sign-off requests that have gone overdue. Two
 * independent TanStack queries so a slow or broken source doesn't block the other.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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

interface SubmittedReportRow {
  id: string;
  title: string | null;
  building_id: string;
  report_period: string;
  updated_at: string;
  building_name: string;
}

interface OverdueSignoffRow {
  id: string;
  due_at: string;
  form_name: string;
  building_name: string | null;
}

interface WaitingResult<T> {
  count: number;
  rows: T[];
}

async function fetchSubmittedReports(): Promise<WaitingResult<SubmittedReportRow>> {
  const [{ count, error: countError }, { data, error }] = await Promise.all([
    fdb.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    fdb
      .from('reports')
      .select('id, title, building_id, report_period, updated_at, buildings(name)')
      .eq('status', 'submitted')
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
      building_id: r.building_id,
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
        due_at: r.due_at ?? nowIso,
        form_name: s?.form_name ?? 'Form',
        building_name: s?.building_id ? (bMap.get(s.building_id) ?? null) : null,
      };
    }),
  };
}

export default function WaitingOnYouWidget() {
  const reportsQuery = useQuery({ queryKey: ['waiting', 'reports'], queryFn: fetchSubmittedReports });
  const signoffsQuery = useQuery({ queryKey: ['waiting', 'signoffs'], queryFn: fetchOverdueSignoffs });

  const isLoading = reportsQuery.isLoading || signoffsQuery.isLoading;
  const isError = reportsQuery.isError || signoffsQuery.isError;

  const retry = () => {
    void reportsQuery.refetch();
    void signoffsQuery.refetch();
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Waiting on You
          </CardTitle>
          <CardDescription>Reports submitted for review and overdue sign-offs</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Waiting on You
          </CardTitle>
          <CardDescription>Could not check what's waiting on you</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <p className="text-sm font-medium mb-1">Failed to load</p>
            <p className="text-xs text-muted-foreground max-w-sm mb-4">
              Reports and sign-offs may be waiting on you but are not visible right now.
            </p>
            <Button onClick={retry} variant="outline" size="sm">
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const reportsCount = reportsQuery.data?.count ?? 0;
  const signoffsCount = signoffsQuery.data?.count ?? 0;
  const reports = reportsQuery.data?.rows ?? [];
  const signoffs = signoffsQuery.data?.rows ?? [];

  if (reportsCount === 0 && signoffsCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Waiting on You
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-6">Nothing waiting on you</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <ClipboardCheck className="h-5 w-5" />
          Waiting on You
          {reportsCount > 0 && (
            <Badge variant="secondary" className="bg-warning/20 text-warning-foreground">
              {reportsCount} to review
            </Badge>
          )}
          {signoffsCount > 0 && <Badge variant="destructive">{signoffsCount} overdue</Badge>}
        </CardTitle>
        <CardDescription>Reports submitted for review and overdue sign-offs</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {reportsCount > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Reports to review</h4>
            <div className="space-y-2">
              {reports.map((r) => (
                <Link key={r.id} to={`/reports/fortress/${r.id}`} className="block">
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
                    <Badge variant="outline" className="text-xs whitespace-nowrap flex-shrink-0">
                      submitted {formatDistanceToNow(new Date(r.updated_at), { addSuffix: true })}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {signoffsCount > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Overdue sign-offs</h4>
            <div className="space-y-2">
              {signoffs.map((s) => (
                <Link key={s.id} to="/forms" className="block">
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
