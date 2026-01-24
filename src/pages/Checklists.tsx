import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ClipboardCheck,
  Search,
  Building2,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Camera,
  Loader2,
  RefreshCw,
  User,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, startOfDay, startOfWeek, startOfMonth, startOfQuarter, startOfYear, addDays, addWeeks, addMonths, addQuarters, addYears } from 'date-fns';
import ReportIssueDialog from '@/components/checklists/ReportIssueDialog';
import CompleteTaskDialog from '@/components/checklists/CompleteTaskDialog';

type TaskFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
type TaskStatus = 'pending' | 'completed' | 'overdue' | 'issue_logged';

interface TaskInstance {
  id: string;
  task_name: string;
  task_description: string | null;
  frequency: TaskFrequency;
  status: TaskStatus;
  due_date: string;
  requires_photo: boolean;
  requires_signature: boolean;
  responsible_role: string;
  building_id: string;
  building_name?: string;
}

interface Building {
  id: string;
  name: string;
}

interface TemplateItem {
  id: string;
  task_name: string;
  task_description: string | null;
  responsible_party: string;
  requires_photo: boolean;
  requires_signature: boolean;
  template: {
    frequency: TaskFrequency;
  };
}

const frequencyLabels: Record<TaskFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annual',
};

const statusColors: Record<TaskStatus, string> = {
  pending: 'bg-warning text-warning-foreground',
  completed: 'bg-success text-success-foreground',
  overdue: 'bg-destructive text-destructive-foreground',
  issue_logged: 'bg-destructive/80 text-destructive-foreground',
};

function getDueDateForFrequency(frequency: TaskFrequency): string {
  const now = new Date();
  switch (frequency) {
    case 'daily':
      return format(startOfDay(now), 'yyyy-MM-dd');
    case 'weekly':
      return format(addDays(startOfWeek(now, { weekStartsOn: 1 }), 6), 'yyyy-MM-dd');
    case 'monthly':
      return format(addMonths(startOfMonth(now), 1), 'yyyy-MM-dd');
    case 'quarterly':
      return format(addQuarters(startOfQuarter(now), 1), 'yyyy-MM-dd');
    case 'annually':
      return format(addYears(startOfYear(now), 1), 'yyyy-MM-dd');
    default:
      return format(now, 'yyyy-MM-dd');
  }
}

export default function Checklists() {
  const { user, isAdminOrManager } = useAuth();
  const [tasks, setTasks] = useState<TaskInstance[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBuilding, setSelectedBuilding] = useState<string>('all');
  const [selectedFrequency, setSelectedFrequency] = useState<TaskFrequency>('daily');

  // Dialog states
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskInstance | null>(null);

  useEffect(() => {
    fetchBuildings();
    fetchTasks();
  }, []);

  const fetchBuildings = async () => {
    try {
      const { data, error } = await supabase
        .from('buildings')
        .select('id, name')
        .order('name');

      if (error) throw error;
      setBuildings(data || []);
    } catch (error) {
      console.error('Error fetching buildings:', error);
    }
  };

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('task_instances')
        .select(`
          id,
          task_name,
          task_description,
          frequency,
          status,
          due_date,
          requires_photo,
          requires_signature,
          responsible_role,
          building_id,
          buildings (name)
        `)
        .order('due_date');

      if (error) throw error;
      
      const formattedTasks = (data || []).map(task => ({
        ...task,
        building_name: (task.buildings as any)?.name || 'Unknown',
      }));
      
      setTasks(formattedTasks);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateTasksForBuilding = async (buildingId: string, frequency: TaskFrequency) => {
    try {
      // Fetch template items for this frequency
      const { data: templateItems, error: templateError } = await supabase
        .from('template_items')
        .select(`
          id,
          task_name,
          task_description,
          responsible_party,
          requires_photo,
          requires_signature,
          checklist_templates!inner (frequency)
        `)
        .eq('checklist_templates.frequency', frequency);

      if (templateError) throw templateError;
      if (!templateItems || templateItems.length === 0) return;

      const dueDate = getDueDateForFrequency(frequency);

      // Check for existing tasks to avoid duplicates
      const { data: existingTasks } = await supabase
        .from('task_instances')
        .select('template_item_id')
        .eq('building_id', buildingId)
        .eq('due_date', dueDate)
        .eq('frequency', frequency);

      const existingItemIds = new Set((existingTasks || []).map(t => t.template_item_id));

      // Create new task instances
      const newTasks = templateItems
        .filter(item => !existingItemIds.has(item.id))
        .map(item => ({
          building_id: buildingId,
          template_item_id: item.id,
          task_name: item.task_name,
          task_description: item.task_description,
          frequency: frequency,
          responsible_role: 'user' as const,
          status: 'pending' as const,
          due_date: dueDate,
          requires_photo: item.requires_photo,
          requires_signature: item.requires_signature,
        }));

      if (newTasks.length > 0) {
        const { error: insertError } = await supabase
          .from('task_instances')
          .insert(newTasks);

        if (insertError) throw insertError;
      }

      return newTasks.length;
    } catch (error) {
      console.error('Error generating tasks:', error);
      throw error;
    }
  };

  const handleGenerateTasks = async () => {
    if (selectedBuilding === 'all') {
      toast.error('Please select a specific building');
      return;
    }

    setGenerating(true);
    try {
      const count = await generateTasksForBuilding(selectedBuilding, selectedFrequency);
      if (count && count > 0) {
        toast.success(`Generated ${count} new ${frequencyLabels[selectedFrequency].toLowerCase()} tasks`);
        fetchTasks();
      } else {
        toast.info('All tasks already exist for this period');
      }
    } catch (error) {
      toast.error('Failed to generate tasks');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateAllTasks = async () => {
    if (buildings.length === 0) {
      toast.error('No buildings available');
      return;
    }

    setGenerating(true);
    let totalGenerated = 0;

    try {
      for (const building of buildings) {
        for (const freq of ['daily', 'weekly', 'monthly', 'quarterly', 'annually'] as TaskFrequency[]) {
          const count = await generateTasksForBuilding(building.id, freq);
          totalGenerated += count || 0;
        }
      }

      if (totalGenerated > 0) {
        toast.success(`Generated ${totalGenerated} new tasks across all buildings`);
        fetchTasks();
      } else {
        toast.info('All tasks already exist for current periods');
      }
    } catch (error) {
      toast.error('Failed to generate tasks');
    } finally {
      setGenerating(false);
    }
  };

  const handleCompleteTask = (task: TaskInstance) => {
    setSelectedTask(task);
    setCompleteDialogOpen(true);
  };

  const handleReportIssue = (task: TaskInstance) => {
    setSelectedTask(task);
    setIssueDialogOpen(true);
  };

  const filteredTasks = tasks.filter((task) => {
    const matchesSearch = task.task_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFrequency = task.frequency === selectedFrequency;
    const matchesBuilding = selectedBuilding === 'all' || task.building_id === selectedBuilding;
    return matchesSearch && matchesFrequency && matchesBuilding;
  });

  const pendingTasks = filteredTasks.filter((t) => t.status === 'pending');
  const completedTasksList = filteredTasks.filter((t) => t.status === 'completed');
  const issueTasks = filteredTasks.filter((t) => t.status === 'issue_logged');

  const progressPercentage = filteredTasks.length > 0
    ? Math.round((completedTasksList.length / filteredTasks.length) * 100)
    : 0;

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
          <h1 className="text-2xl font-bold">Checklists</h1>
          <p className="text-muted-foreground">
            Complete your maintenance tasks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            {format(new Date(), 'EEEE, MMMM d, yyyy')}
          </div>
          {isAdminOrManager && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleGenerateAllTasks}
              disabled={generating}
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Generate All
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={selectedBuilding} onValueChange={setSelectedBuilding}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <Building2 className="h-4 w-4 mr-2" />
            <SelectValue placeholder="All Buildings" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Buildings</SelectItem>
            {buildings.map((building) => (
              <SelectItem key={building.id} value={building.id}>
                {building.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdminOrManager && selectedBuilding !== 'all' && (
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={handleGenerateTasks}
            disabled={generating}
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Generate {frequencyLabels[selectedFrequency]}
          </Button>
        )}
      </div>

      {/* Frequency Tabs */}
      <Tabs value={selectedFrequency} onValueChange={(v) => setSelectedFrequency(v as TaskFrequency)}>
        <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="quarterly">Quarterly</TabsTrigger>
          <TabsTrigger value="annually">Annual</TabsTrigger>
        </TabsList>

        <TabsContent value={selectedFrequency} className="mt-6 space-y-6">
          {/* Progress Summary */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {frequencyLabels[selectedFrequency]} Progress
                  </p>
                  <p className="text-2xl font-bold">
                    {completedTasksList.length} / {filteredTasks.length} tasks
                  </p>
                </div>
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-2xl font-bold text-primary">
                    {progressPercentage}%
                  </span>
                </div>
              </div>
              <Progress value={progressPercentage} className="h-2" />
              <div className="flex gap-4 mt-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-warning" />
                  <span>Pending: {pendingTasks.length}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-success" />
                  <span>Completed: {completedTasksList.length}</span>
                </div>
                {issueTasks.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-destructive" />
                    <span>Issues: {issueTasks.length}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Issue Tasks */}
          {issueTasks.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Issues Logged ({issueTasks.length})
              </h2>
              <div className="space-y-3">
                {issueTasks.map((task) => (
                  <Card key={task.id} className="border-destructive/50 bg-destructive/5">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium">{task.task_name}</h3>
                          {task.task_description && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {task.task_description}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <Building2 className="h-3 w-3" />
                            {task.building_name}
                          </div>
                        </div>
                        <Badge variant="destructive">Issue Logged</Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Pending Tasks */}
          {pendingTasks.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Clock className="h-5 w-5 text-warning" />
                Pending Tasks ({pendingTasks.length})
              </h2>
              <div className="space-y-3">
                {pendingTasks.map((task) => (
                  <Card key={task.id} className="hover:shadow-sm transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h3 className="font-medium">{task.task_name}</h3>
                              {task.task_description && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  {task.task_description}
                                </p>
                              )}
                              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Building2 className="h-3 w-3" />
                                  {task.building_name}
                                </span>
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  Due: {format(new Date(task.due_date), 'MMM d')}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {task.requires_photo && (
                                <Badge variant="outline" className="gap-1">
                                  <Camera className="h-3 w-3" />
                                  Photo
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-3">
                            <Button
                              size="sm"
                              onClick={() => handleCompleteTask(task)}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-2" />
                              Complete
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleReportIssue(task)}
                            >
                              <AlertTriangle className="h-4 w-4 mr-2" />
                              Report Issue
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Completed Tasks */}
          {completedTasksList.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" />
                Completed ({completedTasksList.length})
              </h2>
              <div className="space-y-3">
                {completedTasksList.map((task) => (
                  <Card key={task.id} className="bg-muted/30">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <CheckCircle2 className="h-5 w-5 text-success mt-0.5" />
                        <div className="flex-1">
                          <h3 className="font-medium line-through text-muted-foreground">
                            {task.task_name}
                          </h3>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <Building2 className="h-3 w-3" />
                            {task.building_name}
                          </div>
                        </div>
                        <Badge variant="secondary" className={statusColors.completed}>
                          Done
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {filteredTasks.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <ClipboardCheck className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No tasks found</h3>
                <p className="text-muted-foreground text-center mb-4">
                  No {frequencyLabels[selectedFrequency].toLowerCase()} tasks scheduled
                  {selectedBuilding !== 'all' ? ' for this building' : ''}.
                </p>
                {isAdminOrManager && selectedBuilding !== 'all' && (
                  <Button onClick={handleGenerateTasks} disabled={generating}>
                    {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                    Generate Tasks
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Issue Dialog */}
      {selectedTask && (
        <ReportIssueDialog
          open={issueDialogOpen}
          onOpenChange={setIssueDialogOpen}
          taskId={selectedTask.id}
          taskName={selectedTask.task_name}
          buildingId={selectedTask.building_id}
          buildingName={selectedTask.building_name || 'Unknown'}
          onSuccess={fetchTasks}
        />
      )}

      {/* Complete Task Dialog */}
      {selectedTask && (
        <CompleteTaskDialog
          open={completeDialogOpen}
          onOpenChange={setCompleteDialogOpen}
          taskId={selectedTask.id}
          taskName={selectedTask.task_name}
          taskDescription={selectedTask.task_description}
          requiresPhoto={selectedTask.requires_photo}
          requiresSignature={selectedTask.requires_signature}
          onSuccess={fetchTasks}
        />
      )}
    </div>
  );
}
