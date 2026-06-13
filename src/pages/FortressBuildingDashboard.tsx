/** Building operations hub: that building's Reports (author + lifecycle) plus its
 *  OHS Compliance and KPI dashboards. Reports are scoped to this building. */
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { useBuilding } from '@/hooks/useBuildings';
import { useBuildingKpis } from '@/hooks/useBuildingKpis';
import { useFortressReports } from '@/hooks/useFortressReports';
import { KpiCard } from '@/components/reports/fortress/KpiCard';
import { OhsComplianceTab } from '@/components/reports/fortress/OhsComplianceTab';
import { NewReportDialog } from '@/components/reports/fortress/NewReportDialog';
import { REPORT_STATUS_VARIANT, formatPeriodLabel } from '@/lib/fortressReports';
import { REPORT_TYPE_LABELS } from '@/integrations/supabase/fortress-db';

export default function FortressBuildingDashboard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdminOrManager } = useAuth();
  const { building } = useBuilding(id);
  const { data: kpiData, isLoading: kpiLoading } = useBuildingKpis(id);
  const { data: reports, isLoading: reportsLoading } = useFortressReports(id);

  const hasApproved = !!kpiData?.ops || !!kpiData?.cm;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => navigate('/reports/fortress')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> All buildings
        </Button>
        <h1 className="text-2xl font-semibold">{building?.name ?? 'Building'} — Operations</h1>
        <p className="text-sm text-muted-foreground">Reports, OHS compliance and KPIs for this building.</p>
      </div>

      <Tabs defaultValue="reports">
        <TabsList>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="ohs">OHS Compliance</TabsTrigger>
          <TabsTrigger value="kpis">KPIs</TabsTrigger>
        </TabsList>

        {/* Reports — scoped to this building */}
        <TabsContent value="reports" className="mt-4 space-y-4">
          {isAdminOrManager && (
            <div className="flex justify-end">
              <NewReportDialog buildingId={id} buildingName={building?.name} />
            </div>
          )}
          <Card>
            <CardContent className="p-0">
              {reportsLoading ? (
                <p className="p-6 text-sm text-muted-foreground">Loading reports…</p>
              ) : !reports?.length ? (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
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
        </TabsContent>

        {/* OHS Compliance */}
        <TabsContent value="ohs" className="mt-4">
          {kpiLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !hasApproved ? (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No approved reports yet for this building.</CardContent></Card>
          ) : (
            <OhsComplianceTab
              buildingId={id!}
              kpis={kpiData?.kpis ?? []}
              sectionScores={kpiData?.sectionScores ?? []}
              actions={kpiData?.actions ?? []}
              trend={kpiData?.trend ?? []}
            />
          )}
        </TabsContent>

        {/* KPIs */}
        <TabsContent value="kpis" className="mt-4">
          {kpiLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !hasApproved ? (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No approved reports yet for this building.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {(kpiData?.kpis ?? []).map((k) => <KpiCard key={k.id} kpi={k} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
