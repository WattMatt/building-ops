import { useState, useEffect } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  BarChart3,
  Download,
  Building2,
  AlertTriangle,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { useOrganization } from '@/hooks/useOrganization';
import { generateBuildingHsReport } from '@/lib/hsReportData';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { computeHsScores } from '@/lib/hsScore';
import { generatePortfolioSummaryPdf } from '@/lib/pdfGenerator';
import { PortfolioComplianceCard } from '@/components/reports/fortress/PortfolioComplianceCard';

interface ReportStats {
  buildingsCount: number;
  pendingIssues: number;
}

export default function Reports() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ReportStats>({
    buildingsCount: 0,
    pendingIssues: 0,
  });
  const { organization } = useOrganization();
  const [hsDialogOpen, setHsDialogOpen] = useState(false);
  const [hsBuildings, setHsBuildings] = useState<{ id: string; name: string }[]>([]);
  const [hsBuildingId, setHsBuildingId] = useState('');
  const [hsStart, setHsStart] = useState(format(subDays(new Date(), 90), 'yyyy-MM-dd'));
  const [hsEnd, setHsEnd] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [hsGenerating, setHsGenerating] = useState(false);
  const [portfolioGenerating, setPortfolioGenerating] = useState(false);

  useEffect(() => {
    fetchStats();
  }, []);

  const openHsDialog = async () => {
    setHsDialogOpen(true);
    const { data } = await supabase.from('buildings').select('id, name').order('name');
    setHsBuildings(data || []);
  };

  const handleGenerateHsReport = async () => {
    if (!hsBuildingId) { toast.error('Select a building'); return; }
    setHsGenerating(true);
    try {
      const building = hsBuildings.find((b) => b.id === hsBuildingId)!;
      await generateBuildingHsReport({
        buildingId: hsBuildingId,
        buildingName: building.name,
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
      });
      toast.success('H&S Compliance Report downloaded');
      setHsDialogOpen(false);
    } catch (error) {
      console.error('H&S report error:', error);
      toast.error('Failed to generate H&S report');
    } finally {
      setHsGenerating(false);
    }
  };

  const handleGeneratePortfolio = async () => {
    setPortfolioGenerating(true);
    try {
      const today = new Date();
      const windowStart = format(subDays(today, 30), 'yyyy-MM-dd');
      const todayStr = format(today, 'yyyy-MM-dd');
      const [{ data: buildings }, { data: tasks }, { data: documents }] = await Promise.all([
        supabase.from('buildings').select('id, name').order('name'),
        supabase
          .from('task_instances')
          .select('building_id, status, due_date, category')
          .not('category', 'is', null)
          .gte('due_date', windowStart)
          .lte('due_date', todayStr),
        supabase.from('building_documents').select('building_id, expiry_date'),
      ]);
      const rows = computeHsScores(buildings || [], tasks || [], documents || [], today);
      await generatePortfolioSummaryPdf({
        rows,
        generatedAt: todayStr,
        branding: {
          name: organization?.name || 'Building Ops',
          logoUrl: organization?.logo_url,
          primaryColor: organization?.primary_color || '#2563eb',
          address: organization?.address,
          phone: organization?.phone,
          email: organization?.email,
        },
      });
      toast.success('Portfolio summary downloaded');
    } catch (error) {
      console.error('Portfolio report error:', error);
      toast.error('Failed to generate portfolio summary');
    } finally {
      setPortfolioGenerating(false);
    }
  };

  const fetchStats = async () => {
    setLoading(true);
    try {
      // Fetch buildings count
      const { count: buildingsCount } = await supabase
        .from('buildings')
        .select('*', { count: 'exact', head: true });

      // Fetch open issues
      const { count: openIssuesCount } = await supabase
        .from('issues')
        .select('*', { count: 'exact', head: true })
        .neq('status', 'resolved');

      setStats({
        buildingsCount: buildingsCount || 0,
        pendingIssues: openIssuesCount || 0,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Compliance Reports</h1>
          <p className="text-muted-foreground">
            Generate and download compliance documentation
          </p>
        </div>
        <Button onClick={handleGeneratePortfolio} disabled={portfolioGenerating}>
          {portfolioGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BarChart3 className="w-4 h-4 mr-2" />}
          Portfolio Summary PDF
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Buildings Tracked</p>
                <p className="text-2xl font-bold">{stats.buildingsCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-warning/10 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pending Issues</p>
                <p className="text-2xl font-bold">{stats.pendingIssues}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Operational Compliance — Portfolio (Fortress) */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Operational Compliance — Portfolio</h2>
        <PortfolioComplianceCard />
      </div>

      {/* Available Reports */}
      <Card>
        <CardHeader>
          <CardTitle>Available Reports</CardTitle>
          <CardDescription>
            Select a report to generate or download
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium">H&S Compliance Report</h3>
                <p className="text-sm text-muted-foreground">
                  Survey-ready evidence pack: completed checks with photo evidence, outstanding items, certificate register status
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={openHsDialog}>
              <Download className="h-4 w-4 mr-2" />
              Generate PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* H&S Compliance Report Dialog */}
      <Dialog open={hsDialogOpen} onOpenChange={setHsDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>H&S Compliance Report</DialogTitle>
            <DialogDescription>
              Generates a branded PDF evidence pack for a building over a date range.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="hs-building">Building</Label>
              <Select value={hsBuildingId} onValueChange={setHsBuildingId}>
                <SelectTrigger id="hs-building">
                  <SelectValue placeholder="Select building" />
                </SelectTrigger>
                <SelectContent>
                  {hsBuildings.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{formatBuildingName(b.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="hs-start">From</Label>
                <Input id="hs-start" type="date" value={hsStart} onChange={(e) => setHsStart(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hs-end">To</Label>
                <Input id="hs-end" type="date" value={hsEnd} onChange={(e) => setHsEnd(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleGenerateHsReport} disabled={hsGenerating || !hsBuildingId}>
              {hsGenerating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generate PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
