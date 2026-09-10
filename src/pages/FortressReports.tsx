/**
 * Portfolio-wide list of OPS / CM / annual reports.
 *
 * Until now the only list of these lived inside a single building's Reports tab, so seeing
 * one month across the estate meant opening every building in turn — 35 trips to answer
 * "did June land?". This is the one screen that answers it.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDiscardDraft, useFortressReports, useSetBuildingReportTypes } from '@/hooks/useFortressReports';
import { REPORT_TYPE_LABELS, type ReportType } from '@/integrations/supabase/fortress-db';
import { REPORT_STATUS_VARIANT, formatPeriodLabel } from '@/lib/fortressReports';
import { formatBuildingName } from '@/lib/buildingName';
import { DEFAULT_REPORT_TYPES, buildCoverage, previousMonthPeriod } from '@/lib/reportCoverage';
import { CoverageGrid } from '@/components/reports/fortress/CoverageGrid';
import { DiscardDraftDialog } from '@/components/reports/fortress/DiscardDraftDialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const ALL = '__all__';

export default function FortressReports() {
  const navigate = useNavigate();
  const { isAdmin, isAdminOrManager } = useAuth();
  const { data: reports, isLoading, isError, error } = useFortressReports();
  const discard = useDiscardDraft();
  const setTypes = useSetBuildingReportTypes();
  /** The draft the coverage grid asked to discard; the dialog confirms before anything is sent. */
  const [discardId, setDiscardId] = useState<string | null>(null);

  const { data: buildings } = useQuery({
    queryKey: ['buildings-for-reports'],
    queryFn: async () => {
      // buildings.report_types is not yet in the generated types; regenerate after the migration ships.
      const { data, error: bErr } = await supabase.from('buildings').select('id, name, report_types' as 'id, name').order('name');
      if (bErr) throw bErr;
      return (data ?? []) as { id: string; name: string; report_types?: string[] | null }[];
    },
  });

  const buildingName = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of buildings ?? []) m.set(b.id, b.name);
    return m;
  }, [buildings]);

  const [period, setPeriod] = useState<string>(() => previousMonthPeriod());
  const [type, setType] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [q, setQ] = useState('');

  const periods = useMemo(
    () => [...new Set((reports ?? []).map((r) => r.report_period))].sort().reverse(),
    [reports],
  );
  // The default period is offered even when no report exists for it yet.
  const periodOptions = useMemo(() => [...new Set([previousMonthPeriod(), ...periods])].sort().reverse(), [periods]);
  const statuses = useMemo(
    () => [...new Set((reports ?? []).map((r) => r.status))].sort(),
    [reports],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (reports ?? [])
      .filter((r) => period === ALL || r.report_period === period)
      .filter((r) => type === ALL || r.report_type === type)
      .filter((r) => status === ALL || r.status === status)
      .filter((r) => {
        if (!needle) return true;
        const name = buildingName.get(r.building_id) ?? '';
        return name.toLowerCase().includes(needle) || (r.title ?? '').toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        if (a.report_period !== b.report_period) return a.report_period < b.report_period ? 1 : -1;
        const an = buildingName.get(a.building_id) ?? '';
        const bn = buildingName.get(b.building_id) ?? '';
        return an.localeCompare(bn) || a.report_type.localeCompare(b.report_type);
      });
  }, [reports, period, type, status, q, buildingName]);

  // Coverage for the selected period — the gap is as important as the list.
  const coverage = useMemo(() => {
    if (period === ALL || !buildings?.length) return null;
    return buildCoverage(
      buildings.map((b) => ({ id: b.id, name: b.name, report_types: b.report_types ?? DEFAULT_REPORT_TYPES })),
      (reports ?? []).map((r) => ({ id: r.id, building_id: r.building_id, report_type: r.report_type, report_period: r.report_period, status: r.status })),
      period,
    );
  }, [buildings, reports, period]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Building Reports</h1>
        <p className="text-sm text-muted-foreground">
          Every monthly OPS &amp; CM and annual inspection report, across the portfolio.
        </p>
        <Hint className="mt-1">Pick a period to see which buildings still owe a report.</Hint>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="min-w-44 flex-1">
            <Label htmlFor="rep-search" className="text-xs text-muted-foreground">Building</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="rep-search"
                className="pl-8"
                placeholder="Search buildings"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
          <div className="w-44">
            <Label className="text-xs text-muted-foreground">Period</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All periods</SelectItem>
                {periodOptions.map((p) => <SelectItem key={p} value={p}>{formatPeriodLabel(p)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-44">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                {Object.entries(REPORT_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v as string}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {statuses.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading reports…</p>
          ) : isError ? (
            // A failed query must not be dressed up as "no reports" — that reads as data loss.
            <div className="p-6 text-sm">
              <p className="font-medium text-destructive">Could not load reports.</p>
              <p className="mt-1 text-muted-foreground">{(error as Error)?.message ?? 'Please try again.'}</p>
            </div>
          ) : !rows.length ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <FileText className="h-8 w-8" />
              <p className="font-medium">No reports match these filters</p>
              <p className="text-sm">Try a different period or clear the search.</p>
            </div>
          ) : (
            <>
              <p className="border-b px-4 py-2 text-xs text-muted-foreground">
                {rows.length} report{rows.length === 1 ? '' : 's'}
                {period !== ALL && ` · ${new Set(rows.map((r) => r.building_id)).size} of ${buildings?.length ?? 0} buildings`}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Building</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/reports/fortress/${r.id}`)}
                    >
                      <TableCell className="font-medium">
                        {formatBuildingName(buildingName.get(r.building_id) ?? '—')}
                      </TableCell>
                      <TableCell>{REPORT_TYPE_LABELS[r.report_type as ReportType]}</TableCell>
                      <TableCell>{formatPeriodLabel(r.report_period)}</TableCell>
                      <TableCell>
                        <Badge variant={REPORT_STATUS_VARIANT[r.status] ?? 'outline'} className="capitalize">
                          {r.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {coverage && (
        <CoverageGrid
          period={period}
          rows={coverage.rows}
          summary={coverage.summary}
          canEditTypes={isAdminOrManager}
          canDiscard={isAdmin}
          discarding={discard.isPending}
          onOpenReport={(id) => navigate(`/reports/fortress/${id}`)}
          onOpenBuilding={(id) => navigate(`/buildings/${id}?tab=reports`)}
          onDiscardDraft={setDiscardId}
          onSetReportTypes={(buildingId, reportTypes) => setTypes.mutate({ buildingId, reportTypes })}
        />
      )}
      <DiscardDraftDialog open={discardId !== null} onOpenChange={(open) => { if (!open) setDiscardId(null); }}
        pending={discard.isPending} onConfirm={() => { if (discardId) discard.mutate(discardId); }} />
    </div>
  );
}
