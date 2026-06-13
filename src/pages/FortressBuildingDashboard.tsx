/** Building dashboard: KPI grid + the flagship OHS Compliance tab, for the latest
 *  approved reports. Linked from the reports list by clicking a building. */
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { useBuilding } from '@/hooks/useBuildings';
import { useBuildingKpis } from '@/hooks/useBuildingKpis';
import { KpiCard } from '@/components/reports/fortress/KpiCard';
import { OhsComplianceTab } from '@/components/reports/fortress/OhsComplianceTab';
import { formatPeriodLabel } from '@/lib/fortressReports';

export default function FortressBuildingDashboard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { building } = useBuilding(id);
  const { data, isLoading } = useBuildingKpis(id);

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => navigate('/reports/fortress')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Reports
        </Button>
        <h1 className="text-2xl font-semibold">{building?.name ?? 'Building'} — Operations</h1>
        {data?.ops && <p className="text-sm text-muted-foreground">Latest OPS: {formatPeriodLabel(data.ops.report_period)}</p>}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading KPIs…</p>
      ) : !data?.ops && !data?.cm ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          No approved reports yet for this building.
        </CardContent></Card>
      ) : (
        <Tabs defaultValue="ohs">
          <TabsList>
            <TabsTrigger value="ohs">OHS Compliance</TabsTrigger>
            <TabsTrigger value="kpis">All KPIs</TabsTrigger>
          </TabsList>

          <TabsContent value="ohs" className="mt-4">
            <OhsComplianceTab
              buildingId={id!}
              kpis={data?.kpis ?? []}
              sectionScores={data?.sectionScores ?? []}
              actions={data?.actions ?? []}
              trend={data?.trend ?? []}
            />
          </TabsContent>

          <TabsContent value="kpis" className="mt-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {(data?.kpis ?? []).map((k) => <KpiCard key={k.id} kpi={k} />)}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
