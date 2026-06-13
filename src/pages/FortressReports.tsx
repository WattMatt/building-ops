/** Fortress reports list — author monthly OPS/CM and annual inspection reports. */
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileText } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useFortressReports } from '@/hooks/useFortressReports';
import { useBuildings } from '@/hooks/useBuildings';
import { usePortfolioCompliance } from '@/hooks/usePortfolioCompliance';
import { NewReportDialog } from '@/components/reports/fortress/NewReportDialog';
import { REPORT_STATUS_VARIANT, formatPeriodLabel, formatPct } from '@/lib/fortressReports';
import { classify, THRESHOLDS, STATUS_CLASS } from '@/lib/fortressKpis';
import { REPORT_TYPE_LABELS } from '@/integrations/supabase/fortress-db';
import { cn } from '@/lib/utils';

export default function FortressReports() {
  const navigate = useNavigate();
  const { isAdminOrManager } = useAuth();
  const { data: reports, isLoading } = useFortressReports();
  const { buildings } = useBuildings();
  const { data: portfolio } = usePortfolioCompliance();

  const buildingName = (id: string) => buildings.find((b) => b.id === id)?.name ?? '—';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Operational Reports</h1>
          <p className="text-sm text-muted-foreground">Monthly OPS &amp; CM and annual inspection reports.</p>
        </div>
        {isAdminOrManager && <NewReportDialog />}
      </div>

      {!!portfolio?.length && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Portfolio OHS Compliance</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {portfolio.map((p) => {
                const c = STATUS_CLASS[classify(p.pct, THRESHOLDS.compliance)];
                return (
                  <button
                    key={p.buildingId}
                    onClick={() => navigate(`/reports/fortress/building/${p.buildingId}`)}
                    className={cn('rounded-md border p-3 text-left ring-1 transition-colors hover:bg-muted/50', c.ring)}
                  >
                    <p className="truncate text-sm font-medium">{buildingName(p.buildingId)}</p>
                    <p className={cn('text-lg font-semibold tabular-nums', c.text)}>{formatPct(p.pct)}</p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading reports…</p>
          ) : !reports?.length ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
              <FileText className="h-8 w-8" />
              <p className="font-medium">No reports yet</p>
              <p className="text-sm">{isAdminOrManager ? 'Create your first report to get started.' : 'No reports have been created for your buildings.'}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Report</TableHead>
                  <TableHead>Building</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/reports/fortress/${r.id}`)}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell>
                      <button
                        className="text-primary underline-offset-2 hover:underline"
                        onClick={(e) => { e.stopPropagation(); navigate(`/reports/fortress/building/${r.building_id}`); }}
                      >
                        {buildingName(r.building_id)}
                      </button>
                    </TableCell>
                    <TableCell>{REPORT_TYPE_LABELS[r.report_type]}</TableCell>
                    <TableCell>{formatPeriodLabel(r.report_period)}</TableCell>
                    <TableCell><Badge variant={REPORT_STATUS_VARIANT[r.status] ?? 'outline'} className="capitalize">{r.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
