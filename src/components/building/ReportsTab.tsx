/** Building → Reports tab: this building's OPS/CM/Annual reports (author + lifecycle)
 *  plus its OHS compliance and KPI dashboards. Lives inside BuildingDetails alongside
 *  Tenants/Assets/Documents — reports are per building, not a global list. */
import { useNavigate } from 'react-router-dom';
import { formatBuildingName } from '@/lib/buildingName';
import { FileText, Download, Loader2 } from 'lucide-react';
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
import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { generateBuildingHsReport } from '@/lib/hsReportData';

export default function ReportsTab({ buildingId, buildingName }: { buildingId: string; buildingName?: string }) {
  const navigate = useNavigate();
  const { user, isAdminOrManager } = useAuth();
  const { data: reports, isLoading } = useFortressReports(buildingId);
  const { data: kpiData } = useBuildingKpis(buildingId);
  const hasApproved = !!kpiData?.ops || !!kpiData?.cm;
  const { organization } = useOrganization();
  const [hsOpen, setHsOpen] = useState(false);
  const [hsStart, setHsStart] = useState(format(subDays(new Date(), 90), 'yyyy-MM-dd'));
  const [hsEnd, setHsEnd] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [hsGenerating, setHsGenerating] = useState(false);

  const handleGenerateHs = async () => {
    setHsGenerating(true);
    try {
      const outcome = await generateBuildingHsReport({
        buildingId,
        buildingName: buildingName ?? 'Building',
        rangeStart: hsStart,
        rangeEnd: hsEnd,
        branding: {
          name: organization?.name || 'Building Ops',
          logoUrl: organization?.logo_url,
          primaryColor: organization?.primary_color || '#2563eb',
          address: organization?.address,
          phone: organization?.phone,
          email: organization?.email,
        },
        persist: organization?.id && user ? { orgId: organization.id, userId: user.id } : undefined,
      });
      // Download always succeeds by this point — report the persistence outcome too.
      if (outcome.persisted === 'saved') {
        toast.success('H&S Compliance Report downloaded and saved to Saved Reports');
      } else if (outcome.persisted === 'failed') {
        if (import.meta.env.DEV) console.error('H&S report persist failed:', outcome.error);
        toast.warning('H&S Compliance Report downloaded, but could not be saved to Saved Reports');
      } else {
        toast.success('H&S Compliance Report downloaded');
      }
      setHsOpen(false);
    } catch (error) {
      console.error('H&S report error:', error);
      toast.error('Failed to generate H&S report');
    } finally {
      setHsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Monthly OPS &amp; CM and annual inspection reports for this building.</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setHsOpen(true)}>
            <Download className="h-4 w-4 mr-2" />
            H&amp;S PDF
          </Button>
          {isAdminOrManager && <NewReportDialog buildingId={buildingId} buildingName={buildingName} />}
        </div>
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
        <Tabs defaultValue="kpis">
          <TabsList>
            <TabsTrigger value="kpis">KPIs</TabsTrigger>
            <TabsTrigger value="ohs">OHS Compliance</TabsTrigger>
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

      <Dialog open={hsOpen} onOpenChange={setHsOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>H&amp;S Compliance Report</DialogTitle>
            <DialogDescription>Branded PDF evidence pack for {formatBuildingName(buildingName) || 'this building'} over a date range.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tab-hs-start">From</Label>
              <Input id="tab-hs-start" type="date" value={hsStart} onChange={(e) => setHsStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tab-hs-end">To</Label>
              <Input id="tab-hs-end" type="date" value={hsEnd} onChange={(e) => setHsEnd(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHsOpen(false)}>Cancel</Button>
            <Button onClick={handleGenerateHs} disabled={hsGenerating}>
              {hsGenerating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generate PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
