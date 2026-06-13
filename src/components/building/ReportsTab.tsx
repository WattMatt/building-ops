/** Building → Reports tab: this building's OPS/CM/Annual reports (author + lifecycle)
 *  plus its OHS compliance and KPI dashboards. Lives inside BuildingDetails alongside
 *  Tenants/Assets/Documents — reports are per building, not a global list. */
import { useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { useFortressReports } from '@/hooks/useFortressReports';
import { useBuildingKpis } from '@/hooks/useBuildingKpis';
import { NewReportDialog } from '@/components/reports/fortress/NewReportDialog';
import { OhsComplianceTab } from '@/components/reports/fortress/OhsComplianceTab';
import { KpiCard } from '@/components/reports/fortress/KpiCard';
import { REPORT_STATUS_VARIANT, formatPeriodLabel } from '@/lib/fortressReports';
import { REPORT_TYPE_LABELS } from '@/integrations/supabase/fortress-db';

export default function ReportsTab({ buildingId, buildingName }: { buildingId: string; buildingName?: string }) {
  const navigate = useNavigate();
  const { isAdminOrManager } = useAuth();
  const { data: reports, isLoading } = useFortressReports(buildingId);
  const { data: kpiData } = useBuildingKpis(buildingId);
  const hasApproved = !!kpiData?.ops || !!kpiData?.cm;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Monthly OPS &amp; CM and annual inspection reports for this building.</p>
        {isAdminOrManager && <NewReportDialog buildingId={buildingId} buildingName={buildingName} />}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading reports…</p>
          ) : !reports?.length ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <FileText className="h-8 w-8" />
              <p className="font-medium">No reports yet</p>
              <p className="text-sm">{isAdminOrManager ? 'Create the first report for this building.' : 'No reports have been created for this building.'}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Report</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/reports/fortress/${r.id}`)}>
                    <TableCell className="font-medium">{r.title}</TableCell>
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

      {hasApproved && (
        <Tabs defaultValue="ohs">
          <TabsList>
            <TabsTrigger value="ohs">OHS Compliance</TabsTrigger>
            <TabsTrigger value="kpis">KPIs</TabsTrigger>
          </TabsList>
          <TabsContent value="ohs" className="mt-4">
            <OhsComplianceTab
              buildingId={buildingId}
              kpis={kpiData?.kpis ?? []}
              sectionScores={kpiData?.sectionScores ?? []}
              actions={kpiData?.actions ?? []}
              trend={kpiData?.trend ?? []}
            />
          </TabsContent>
          <TabsContent value="kpis" className="mt-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {(kpiData?.kpis ?? []).map((k) => <KpiCard key={k.id} kpi={k} />)}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
