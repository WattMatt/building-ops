import { useAuth } from '@/contexts/AuthContext';
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
} from 'lucide-react';
import { Link } from 'react-router-dom';

// Mock data for the dashboard - will be replaced with real data
const stats = {
  buildings: 8,
  pendingTasks: 24,
  completedToday: 18,
  openIssues: 5,
  complianceRate: 87,
};

const upcomingTasks = [
  { id: 1, name: 'Restroom Consumables Restock', building: 'Menlyn Mall', due: 'Today', priority: 'daily' },
  { id: 2, name: 'HVAC Filters Inspection', building: 'Hatfield Square', due: 'Today', priority: 'weekly' },
  { id: 3, name: 'Fire Extinguisher Check', building: 'Brooklyn Mall', due: 'Tomorrow', priority: 'daily' },
  { id: 4, name: 'Emergency Exit Inspection', building: 'Centurion Mall', due: 'Tomorrow', priority: 'weekly' },
];

const recentIssues = [
  { id: 1, title: 'HVAC not cooling properly', building: 'Menlyn Mall', priority: 'high', status: 'open' },
  { id: 2, title: 'Elevator maintenance overdue', building: 'Brooklyn Mall', priority: 'critical', status: 'escalated' },
  { id: 3, title: 'Parking lot lighting issue', building: 'Hatfield Square', priority: 'medium', status: 'in_progress' },
];

const priorityColors = {
  daily: 'bg-info text-info-foreground',
  weekly: 'bg-accent text-accent-foreground',
  monthly: 'bg-warning text-warning-foreground',
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-warning text-warning-foreground',
  high: 'bg-destructive/80 text-destructive-foreground',
  critical: 'bg-destructive text-destructive-foreground',
};

const statusColors = {
  open: 'bg-warning text-warning-foreground',
  in_progress: 'bg-info text-info-foreground',
  escalated: 'bg-destructive text-destructive-foreground',
  resolved: 'bg-success text-success-foreground',
};

export default function Dashboard() {
  const { user, role, isAdminOrManager } = useAuth();

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
            <div className="flex items-center gap-2 text-success">
              <TrendingUp className="h-4 w-4" />
              <span className="text-sm font-medium">+5% this week</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="text-4xl font-bold">{stats.complianceRate}%</div>
            <Progress value={stats.complianceRate} className="flex-1 h-3" />
          </div>
        </CardContent>
      </Card>

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
            <div className="space-y-4">
              {upcomingTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div className="flex items-start gap-3">
                    <ClipboardCheck className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">{task.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {task.building}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={priorityColors[task.priority as keyof typeof priorityColors]}
                    >
                      {task.priority}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{task.due}</span>
                  </div>
                </div>
              ))}
            </div>
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
                        {issue.building}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={priorityColors[issue.priority as keyof typeof priorityColors]}
                    >
                      {issue.priority}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className={statusColors[issue.status as keyof typeof statusColors]}
                    >
                      {issue.status.replace('_', ' ')}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
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
