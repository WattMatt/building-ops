import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Building2,
  ClipboardCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingUp,
  Calendar,
  ArrowRight,
  Plus,
  Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import GlobalAlertsWidget from '@/components/dashboard/GlobalAlertsWidget';

interface DashboardStats {
  buildings: number;
  pendingTasks: number;
  completedToday: number;
  openIssues: number;
  complianceRate: number;
}

interface UpcomingTask {
  id: string;
  task_name: string;
  building_name: string;
  due_date: string;
  frequency: string;
}

interface RecentIssue {
  id: string;
  title: string;
  building_name: string;
  priority: string;
  status: string;
}

const priorityColors: Record<string, string> = {
  daily: 'bg-info text-info-foreground',
  weekly: 'bg-accent text-accent-foreground',
  monthly: 'bg-warning text-warning-foreground',
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-warning text-warning-foreground',
  high: 'bg-destructive/80 text-destructive-foreground',
  critical: 'bg-destructive text-destructive-foreground',
};

const statusColors: Record<string, string> = {
  open: 'bg-warning text-warning-foreground',
  in_progress: 'bg-info text-info-foreground',
  escalated: 'bg-destructive text-destructive-foreground',
  resolved: 'bg-success text-success-foreground',
};

export default function Dashboard() {
  const { user, role, isAdminOrManager } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    buildings: 0,
    pendingTasks: 0,
    completedToday: 0,
    openIssues: 0,
    complianceRate: 0,
  });
  const [upcomingTasks, setUpcomingTasks] = useState<UpcomingTask[]>([]);
  const [recentIssues, setRecentIssues] = useState<RecentIssue[]>([]);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      // Fetch buildings count
      const { count: buildingsCount } = await supabase
        .from('buildings')
        .select('*', { count: 'exact', head: true });

      // Fetch pending tasks (due today or overdue)
      const today = format(new Date(), 'yyyy-MM-dd');
      const { count: pendingCount } = await supabase
        .from('task_instances')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lte('due_date', today);

      // Fetch completed today
      const { count: completedCount } = await supabase
        .from('task_instances')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'completed')
        .eq('due_date', today);

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
        buildings: buildingsCount || 0,
        pendingTasks: pendingCount || 0,
        completedToday: completedCount || 0,
        openIssues: openIssuesCount || 0,
        complianceRate,
      });

      // Fetch upcoming tasks with building names
      const { data: tasksData } = await supabase
        .from('task_instances')
        .select(`
          id,
          task_name,
          due_date,
          frequency,
          building_id,
          buildings (name)
        `)
        .eq('status', 'pending')
        .order('due_date')
        .limit(4);

      if (tasksData) {
        setUpcomingTasks(tasksData.map(task => ({
          id: task.id,
          task_name: task.task_name,
          building_name: (task.buildings as any)?.name || 'Unknown',
          due_date: task.due_date,
          frequency: task.frequency,
        })));
      }

      // Fetch recent issues with building names
      const { data: issuesData } = await supabase
        .from('issues')
        .select(`
          id,
          title,
          priority,
          status,
          building_id,
          buildings (name)
        `)
        .neq('status', 'resolved')
        .order('created_at', { ascending: false })
        .limit(3);

      if (issuesData) {
        setRecentIssues(issuesData.map(issue => ({
          id: issue.id,
          title: issue.title,
          building_name: (issue.buildings as any)?.name || 'Unknown',
          priority: issue.priority,
          status: issue.status,
        })));
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDueDate = (dateStr: string) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const tomorrow = format(new Date(Date.now() + 86400000), 'yyyy-MM-dd');
    if (dateStr === today) return 'Today';
    if (dateStr === tomorrow) return 'Tomorrow';
    return format(new Date(dateStr), 'MMM d');
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
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back! Here's your compliance overview.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/checklists">
              <ClipboardCheck className="w-4 h-4 mr-2" />
              View Checklists
            </Link>
          </Button>
          {isAdminOrManager && (
            <Button asChild>
              <Link to="/buildings/new">
                <Plus className="w-4 h-4 mr-2" />
                Add Building
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Buildings</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.buildings}</div>
            <p className="text-xs text-muted-foreground">
              In your portfolio
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pending Tasks</CardTitle>
            <Clock className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingTasks}</div>
            <p className="text-xs text-muted-foreground">
              Due today
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Completed Today</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.completedToday}</div>
            <p className="text-xs text-muted-foreground">
              Tasks finished
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Open Issues</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.openIssues}</div>
            <p className="text-xs text-muted-foreground">
              Require attention
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Compliance Score */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Overall Compliance Score</CardTitle>
              <CardDescription>Based on task completion across all buildings</CardDescription>
            </div>
            {stats.complianceRate > 0 && (
              <div className="flex items-center gap-2 text-success">
                <TrendingUp className="h-4 w-4" />
                <span className="text-sm font-medium">Today's progress</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="text-4xl font-bold">{stats.complianceRate}%</div>
            <Progress value={stats.complianceRate} className="flex-1 h-3" />
          </div>
        </CardContent>
      </Card>

      {/* Global Alerts for Admins/Managers */}
      {isAdminOrManager && <GlobalAlertsWidget />}

      {/* Two Column Layout */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upcoming Tasks */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Upcoming Tasks</CardTitle>
              <CardDescription>Tasks requiring attention</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/checklists">
                View all
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {upcomingTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle2 className="h-10 w-10 text-success mb-2" />
                <p className="text-sm text-muted-foreground">All caught up! No pending tasks.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {upcomingTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <div className="flex items-start gap-3">
                      <ClipboardCheck className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">{task.task_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {task.building_name}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="secondary"
                        className={priorityColors[task.frequency] || 'bg-muted'}
                      >
                        {task.frequency}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDueDate(task.due_date)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Issues */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Issues</CardTitle>
              <CardDescription>Escalations requiring action</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/issues">
                View all
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recentIssues.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle2 className="h-10 w-10 text-success mb-2" />
                <p className="text-sm text-muted-foreground">No open issues. Great job!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {recentIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">{issue.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {issue.building_name}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="secondary"
                        className={priorityColors[issue.priority] || 'bg-muted'}
                      >
                        {issue.priority}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className={statusColors[issue.status] || 'bg-muted'}
                      >
                        {issue.status.replace('_', ' ')}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions for Field Staff */}
      {role === 'user' && (
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Complete your daily tasks</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Button variant="outline" className="h-24 flex-col gap-2" asChild>
                <Link to="/checklists?frequency=daily">
                  <Calendar className="h-6 w-6" />
                  <span>Daily Checklist</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-24 flex-col gap-2" asChild>
                <Link to="/checklists?frequency=weekly">
                  <ClipboardCheck className="h-6 w-6" />
                  <span>Weekly Checklist</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-24 flex-col gap-2" asChild>
                <Link to="/issues/new">
                  <AlertTriangle className="h-6 w-6" />
                  <span>Report Issue</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-24 flex-col gap-2" asChild>
                <Link to="/buildings">
                  <Building2 className="h-6 w-6" />
                  <span>My Buildings</span>
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
