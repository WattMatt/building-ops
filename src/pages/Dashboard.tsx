import { useState } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { useUserProfile } from '@/hooks/useUserProfile';
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
  UserCircle,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import GlobalAlertsWidget from '@/components/dashboard/GlobalAlertsWidget';
import HsComplianceWidget from '@/components/dashboard/HsComplianceWidget';
import PendingSubmissionsWidget from '@/components/dashboard/PendingSubmissionsWidget';
import BuildingAlertsWidget from '@/components/dashboard/BuildingAlertsWidget';

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
  const { role, isAdminOrManager } = useAuth();
  const { stats, upcomingTasks, recentIssues, loading } = useDashboardStats();
  const { profile, loading: profileLoading } = useUserProfile();
  const [profileNudgeDismissed, setProfileNudgeDismissed] = useState(
    () => localStorage.getItem('profileNudgeDismissed') === 'true'
  );

  const dismissProfileNudge = () => {
    localStorage.setItem('profileNudgeDismissed', 'true');
    setProfileNudgeDismissed(true);
  };

  const showProfileNudge =
    !profileLoading &&
    !profileNudgeDismissed &&
    profile !== null &&
    !profile.full_name?.trim();

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
      {/* Profile completion nudge (non-blocking, dismissible) */}
      {showProfileNudge && (
        <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <UserCircle className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-sm">Complete your profile</p>
            <p className="text-sm text-muted-foreground">
              Add your name and an avatar so teammates can recognise you.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/profile">Update profile</Link>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={dismissProfileNudge}
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

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

      {/* H&S compliance score per building */}
      {isAdminOrManager && <HsComplianceWidget />}

      {/* Global Alerts for Admins/Managers */}
      {isAdminOrManager && <GlobalAlertsWidget />}

      {/* Building Health Widget */}
      {isAdminOrManager && <BuildingAlertsWidget />}

      {/* Pending Form Submissions for Managers */}
      {isAdminOrManager && <PendingSubmissionsWidget />}

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
                          {formatBuildingName(task.building_name)}
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
                          {formatBuildingName(issue.building_name)}
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
