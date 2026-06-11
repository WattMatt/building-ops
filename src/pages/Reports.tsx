import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BarChart3,
  Download,
  FileText,
  Calendar,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { useOrganization } from '@/hooks/useOrganization';
import { generateHsCompliancePdf } from '@/lib/pdfGenerator';
import type { HsTask, HsDocument } from '@/lib/hsComplianceReport';
import { resolveStorageUrl } from '@/integrations/supabase/storage';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface ReportStats {
  complianceRate: number;
  buildingsCount: number;
  pendingIssues: number;
}

const reportTypes = [
  {
    id: 1,
    name: 'Monthly Compliance Summary',
    description: 'Overview of task completion rates and compliance scores',
    type: 'summary',
  },
  {
    id: 2,
    name: 'Issue Resolution Report',
    description: 'Details of all issues, their status, and resolution times',
    type: 'issues',
  },
  {
    id: 3,
    name: 'Building Performance Report',
    description: 'Comparative analysis of compliance across buildings',
    type: 'performance',
  },
  {
    id: 4,
    name: 'Audit Compliance Pack',
    description: 'Complete documentation package for regulatory audits',
    type: 'audit',
  },
];

const MAX_EMBEDDED_PHOTOS = 30;

export default function Reports() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ReportStats>({
    complianceRate: 0,
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

      // H&S tasks = instances carrying a compliance category (set by the DB trigger)
      const { data: taskRows, error: tasksError } = await supabase
        .from('task_instances')
        .select('id, task_name, category, status, due_date, completed_at, completed_by, completion_notes, photo_urls, signature_url')
        .eq('building_id', hsBuildingId)
        .gte('due_date', hsStart)
        .lte('due_date', hsEnd)
        .not('category', 'is', null)
        .order('due_date');
      if (tasksError) throw tasksError;

      const completerIds = [...new Set((taskRows || []).map((t) => t.completed_by).filter(Boolean))] as string[];
      const names = new Map<string, string>();
      if (completerIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', completerIds);
        (profiles || []).forEach((p) => names.set(p.id, p.full_name ?? 'Unknown'));
      }

      const tasks: HsTask[] = (taskRows || []).map((t) => ({
        id: t.id,
        task_name: t.task_name,
        category: t.category,
        status: t.status,
        due_date: t.due_date,
        completed_at: t.completed_at,
        completed_by_name: t.completed_by ? (names.get(t.completed_by) ?? 'Unknown') : null,
        completion_notes: t.completion_notes,
        photo_urls: Array.isArray(t.photo_urls) ? (t.photo_urls as string[]) : [],
        signature_confirmed: Boolean(t.signature_url),
      }));

      const { data: docRows, error: docsError } = await supabase
        .from('building_documents')
        .select('id, name, document_type, expiry_date, issuing_authority, reference_number')
        .eq('building_id', hsBuildingId)
        .order('document_type');
      if (docsError) throw docsError;
      const documents: HsDocument[] = (docRows || []).map((d) => ({ ...d, document_type: d.document_type ?? 'other' }));

      // embed up to MAX_EMBEDDED_PHOTOS thumbnails (1 per completed task, newest first)
      const photoDataUrls: Record<string, string[]> = {};
      let embedded = 0;
      const completedWithPhotos = tasks
        .filter((t) => t.status === 'completed' && t.photo_urls.length > 0)
        .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
      for (const t of completedWithPhotos) {
        if (embedded >= MAX_EMBEDDED_PHOTOS) break;
        try {
          const signed = await resolveStorageUrl(t.photo_urls[0]);
          if (!signed) continue;
          const blob = await (await fetch(signed)).blob();
          const dataUrl: string = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          photoDataUrls[t.id] = [dataUrl];
          embedded += 1;
        } catch {
          // photo unavailable — report shows "N photo(s) on file" without thumbnail
        }
      }

      await generateHsCompliancePdf({
        buildingName: building.name,
        rangeStart: hsStart,
        rangeEnd: hsEnd,
        tasks,
        documents,
        photoDataUrls,
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

  const fetchStats = async () => {
    setLoading(true);
    try {
      // Fetch buildings count
      const { count: buildingsCount } = await supabase
        .from('buildings')
        .select('*', { count: 'exact', head: true });

      // Fetch pending and completed tasks for compliance rate
      const today = format(new Date(), 'yyyy-MM-dd');
      const { count: pendingCount } = await supabase
        .from('task_instances')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      const { count: completedCount } = await supabase
        .from('task_instances')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'completed');

      // Fetch open issues
      const { count: openIssuesCount } = await supabase
        .from('issues')
        .select('*', { count: 'exact', head: true })
        .neq('status', 'resolved');

      // Calculate compliance rate
      const totalTasks = (pendingCount || 0) + (completedCount || 0);
      const complianceRate = totalTasks > 0 
        ? Math.round(((completedCount || 0) / totalTasks) * 100) 
        : 0;

      setStats({
        complianceRate,
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
        <Button>
          <BarChart3 className="w-4 h-4 mr-2" />
          Generate New Report
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Overall Compliance</p>
                <p className="text-2xl font-bold">{stats.complianceRate}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
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
          {reportTypes.map((report) => (
            <div
              key={report.id}
              className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">{report.name}</h3>
                  <p className="text-sm text-muted-foreground">{report.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  PDF
                </Button>
                <Button variant="outline" size="sm">
                  CSV
                </Button>
              </div>
            </div>
          ))}
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
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
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
