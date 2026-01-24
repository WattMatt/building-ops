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
} from 'lucide-react';
import { format } from 'date-fns';

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

export default function Reports() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ReportStats>({
    complianceRate: 0,
    buildingsCount: 0,
    pendingIssues: 0,
  });

  useEffect(() => {
    fetchStats();
  }, []);

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
    </div>
  );
}
