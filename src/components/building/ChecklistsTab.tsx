import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Camera,
  Loader2,
  RefreshCw,
  User,
  Plus,
  ClipboardCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  format,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  addQuarters,
  addYears,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
  isPast,
} from 'date-fns';
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
  completion?: {
    completed_by: string;
    completed_at: string;
    completed_by_name?: string;
  };
}

interface ChecklistsTabProps {
  buildingId: string;
  buildingName?: string;
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

function getPeriodLabel(frequency: TaskFrequency): string {
  const now = new Date();
  switch (frequency) {
    case 'daily':
      return format(now, 'EEEE, MMMM d');
    case 'weekly':
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      const weekEnd = addDays(weekStart, 6);
      return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
    case 'monthly':
      return format(now, 'MMMM yyyy');
    case 'quarterly':
      const quarter = Math.ceil((now.getMonth() + 1) / 3);
      return `Q${quarter} ${format(now, 'yyyy')}`;
    case 'annually':
      return format(now, 'yyyy');
    default:
      return '';
  }
}

export default function ChecklistsTab({ buildingId, buildingName }: ChecklistsTabProps) {
  const { user, isAdminOrManager } = useAuth();
  const [tasks, setTasks] = useState<TaskInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedFrequency, setSelectedFrequency] = useState<TaskFrequency>('daily');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());

  // Dialog states
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskInstance | null>(null);

  useEffect(() => {
    fetchTasks();
  }, [buildingId]);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      // Fetch tasks with their completions
      const { data: tasksData, error: tasksError } = await supabase
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
          building_id
        `)
        .eq('building_id', buildingId)
        .order('due_date');

      if (tasksError) throw tasksError;

      // Fetch completions for these tasks
      const taskIds = (tasksData || []).map(t => t.id);
      const { data: completionsData, error: completionsError } = await supabase
        .from('task_completions')
        .select(`
          task_instance_id,
          completed_by,
          completed_at
        `)
        .in('task_instance_id', taskIds);

      if (completionsError) throw completionsError;

      // Fetch profile names for completions
      const userIds = [...new Set((completionsData || []).map(c => c.completed_by))];
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds);

      const profileMap = new Map((profilesData || []).map(p => [p.id, p.full_name || p.email]));

      // Map completions to tasks
      const completionMap = new Map(
        (completionsData || []).map(c => [
          c.task_instance_id,
          {
            completed_by: c.completed_by,
            completed_at: c.completed_at,
            completed_by_name: profileMap.get(c.completed_by) || 'Unknown',
          },
        ])
      );

      const formattedTasks: TaskInstance[] = (tasksData || []).map(task => ({
        ...task,
        frequency: task.frequency as TaskFrequency,
        status: task.status as TaskStatus,
        completion: completionMap.get(task.id),
      }));

      setTasks(formattedTasks);
    } catch (error) {
      console.error('Error fetching tasks:', error);
      toast.error('Failed to load checklists');
    } finally {
      setLoading(false);
    }
  };

  const generateTasksForFrequency = async (frequency: TaskFrequency) => {
    try {
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
      if (!templateItems || templateItems.length === 0) return 0;

      const dueDate = getDueDateForFrequency(frequency);

      const { data: existingTasks } = await supabase
        .from('task_instances')
        .select('template_item_id')
        .eq('building_id', buildingId)
        .eq('due_date', dueDate)
        .eq('frequency', frequency);

      const existingItemIds = new Set((existingTasks || []).map(t => t.template_item_id));

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
    setGenerating(true);
    try {
      const count = await generateTasksForFrequency(selectedFrequency);
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

  const handleGenerateAllFrequencies = async () => {
    setGenerating(true);
    let totalGenerated = 0;

    try {
      for (const freq of ['daily', 'weekly', 'monthly', 'quarterly', 'annually'] as TaskFrequency[]) {
        const count = await generateTasksForFrequency(freq);
        totalGenerated += count || 0;
      }

      if (totalGenerated > 0) {
        toast.success(`Generated ${totalGenerated} new tasks`);
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

  // Filter tasks by frequency
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => task.frequency === selectedFrequency);
  }, [tasks, selectedFrequency]);

  // Group tasks by date for calendar view
  const tasksByDate = useMemo(() => {
    const byDate: Record<string, TaskInstance[]> = {};
    filteredTasks.forEach(task => {
      const dateKey = task.due_date;
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push(task);
    });
    return byDate;
  }, [filteredTasks]);

  // Calendar days
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = addMonths(monthStart, 1);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(addDays(monthEnd, -1), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentMonth]);

  // Tasks for selected date
  const selectedDateTasks = useMemo(() => {
    if (!selectedDate) return [];
    const dateKey = format(selectedDate, 'yyyy-MM-dd');
    return tasksByDate[dateKey] || [];
  }, [selectedDate, tasksByDate]);

  // Calculate progress
  const pendingTasks = filteredTasks.filter(t => t.status === 'pending');
  const completedTasksList = filteredTasks.filter(t => t.status === 'completed');
  const issueTasks = filteredTasks.filter(t => t.status === 'issue_logged');
  const progressPercentage = filteredTasks.length > 0
    ? Math.round((completedTasksList.length / filteredTasks.length) * 100)
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Building Checklists</h2>
          <p className="text-sm text-muted-foreground">
            Track and complete maintenance tasks for this building
          </p>
        </div>
        {isAdminOrManager && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateAllFrequencies}
            disabled={generating}
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Generate All Tasks
          </Button>
        )}
      </div>

      {/* Frequency Tabs */}
      <Tabs value={selectedFrequency} onValueChange={v => setSelectedFrequency(v as TaskFrequency)}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="quarterly">Quarterly</TabsTrigger>
          <TabsTrigger value="annually">Annual</TabsTrigger>
        </TabsList>

        <TabsContent value={selectedFrequency} className="mt-6 space-y-6">
          {/* Period Label & Progress */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">{getPeriodLabel(selectedFrequency)}</span>
            </div>
            {isAdminOrManager && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleGenerateTasks}
                disabled={generating}
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Generate {frequencyLabels[selectedFrequency]}
              </Button>
            )}
          </div>

          {/* Progress Card */}
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
                  <span className="text-2xl font-bold text-primary">{progressPercentage}%</span>
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

          {/* Calendar + Task List Layout */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Mini Calendar */}
            <Card className="lg:col-span-1">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">Calendar</CardTitle>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm font-medium min-w-[100px] text-center">
                    {format(currentMonth, 'MMM yyyy')}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Weekday headers */}
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                    <div key={i} className="text-center text-xs font-medium text-muted-foreground py-1">
                      {day}
                    </div>
                  ))}
                </div>

                {/* Calendar grid */}
                <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map(day => {
                    const dateKey = format(day, 'yyyy-MM-dd');
                    const dayTasks = tasksByDate[dateKey] || [];
                    const hasCompleted = dayTasks.some(t => t.status === 'completed');
                    const hasPending = dayTasks.some(t => t.status === 'pending');
                    const hasIssue = dayTasks.some(t => t.status === 'issue_logged');
                    const isSelected = selectedDate && isSameDay(day, selectedDate);
                    const isCurrentMonth = isSameMonth(day, currentMonth);

                    return (
                      <button
                        key={day.toISOString()}
                        onClick={() => setSelectedDate(day)}
                        className={`
                          relative h-8 w-full rounded text-sm transition-colors
                          ${!isCurrentMonth ? 'text-muted-foreground/40' : ''}
                          ${isToday(day) ? 'bg-primary text-primary-foreground font-bold' : ''}
                          ${isSelected && !isToday(day) ? 'ring-2 ring-primary' : ''}
                          ${dayTasks.length > 0 && !isToday(day) ? 'hover:bg-accent' : ''}
                        `}
                      >
                        {format(day, 'd')}
                        {dayTasks.length > 0 && (
                          <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                            {hasCompleted && <div className="w-1 h-1 rounded-full bg-success" />}
                            {hasPending && <div className="w-1 h-1 rounded-full bg-warning" />}
                            {hasIssue && <div className="w-1 h-1 rounded-full bg-destructive" />}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Tasks List */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {selectedDate ? format(selectedDate, 'EEEE, MMMM d') : 'All Tasks'}
                  {selectedDateTasks.length > 0 && (
                    <Badge variant="secondary">{selectedDateTasks.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedDate ? (
                  <TasksList
                    tasks={selectedDateTasks}
                    onComplete={handleCompleteTask}
                    onReportIssue={handleReportIssue}
                    emptyMessage={`No ${frequencyLabels[selectedFrequency].toLowerCase()} tasks for this date`}
                  />
                ) : (
                  <TasksList
                    tasks={filteredTasks}
                    onComplete={handleCompleteTask}
                    onReportIssue={handleReportIssue}
                    emptyMessage={`No ${frequencyLabels[selectedFrequency].toLowerCase()} tasks scheduled`}
                  />
                )}
              </CardContent>
            </Card>
          </div>

          {/* All Tasks Summary (collapsible sections) */}
          {selectedDate === null && (
            <>
              {issueTasks.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-base font-medium flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    Issues Logged ({issueTasks.length})
                  </h3>
                  <TasksList
                    tasks={issueTasks}
                    onComplete={handleCompleteTask}
                    onReportIssue={handleReportIssue}
                    variant="issue"
                  />
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      {selectedTask && (
        <>
          <ReportIssueDialog
            open={issueDialogOpen}
            onOpenChange={setIssueDialogOpen}
            taskId={selectedTask.id}
            taskName={selectedTask.task_name}
            buildingId={selectedTask.building_id}
            buildingName={buildingName || 'Unknown'}
            onSuccess={fetchTasks}
          />
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
        </>
      )}
    </div>
  );
}

// Sub-component for task lists
interface TasksListProps {
  tasks: TaskInstance[];
  onComplete: (task: TaskInstance) => void;
  onReportIssue: (task: TaskInstance) => void;
  emptyMessage?: string;
  variant?: 'default' | 'issue';
}

function TasksList({ tasks, onComplete, onReportIssue, emptyMessage, variant = 'default' }: TasksListProps) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <ClipboardCheck className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">{emptyMessage || 'No tasks'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[400px] overflow-y-auto">
      {tasks.map(task => (
        <div
          key={task.id}
          className={`p-3 rounded-lg border ${
            variant === 'issue'
              ? 'border-destructive/50 bg-destructive/5'
              : task.status === 'completed'
              ? 'bg-muted/30'
              : ''
          }`}
        >
          <div className="flex items-start gap-3">
            {task.status === 'completed' ? (
              <CheckCircle2 className="h-5 w-5 text-success mt-0.5 shrink-0" />
            ) : task.status === 'issue_logged' ? (
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
            ) : (
              <Clock className="h-5 w-5 text-warning mt-0.5 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p
                    className={`font-medium text-sm ${
                      task.status === 'completed' ? 'line-through text-muted-foreground' : ''
                    }`}
                  >
                    {task.task_name}
                  </p>
                  {task.task_description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{task.task_description}</p>
                  )}
                </div>
                <Badge
                  variant={task.status === 'completed' ? 'secondary' : 'outline'}
                  className={`shrink-0 ${task.status === 'completed' ? statusColors.completed : ''}`}
                >
                  {task.status === 'completed'
                    ? 'Done'
                    : task.status === 'issue_logged'
                    ? 'Issue'
                    : 'Pending'}
                </Badge>
              </div>

              {/* Completed by info */}
              {task.completion && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {task.completion.completed_by_name} •{' '}
                  {format(new Date(task.completion.completed_at), 'MMM d, h:mm a')}
                </p>
              )}

              {/* Actions for pending tasks */}
              {task.status === 'pending' && (
                <div className="flex items-center gap-2 mt-2">
                  <Button size="sm" className="h-7 text-xs" onClick={() => onComplete(task)}>
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Complete
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onReportIssue(task)}
                  >
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Issue
                  </Button>
                  {task.requires_photo && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Camera className="h-3 w-3" />
                      Photo
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
