import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Plus,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { useBuildingMembers, memberDisplayName } from '@/hooks/useBuildingMembers';
import { AssigneePicker } from '@/components/people/AssigneePicker';
import { notify } from '@/lib/notify';
import {
  format,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  endOfWeek,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  addDays,
  addMonths,
  subMonths,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  isWithinInterval,
  isAfter,
} from 'date-fns';
import { Hint } from '@/components/ui/hint';
import ReportIssueDialog from '@/components/checklists/ReportIssueDialog';
import CompleteTaskDialog from '@/components/checklists/CompleteTaskDialog';
import { TasksList, type TaskInstance, type TaskFrequency, type TaskStatus } from '@/components/building/TasksList';
import { ALL_FREQUENCIES } from '@/lib/taskSchedule';

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

// Get the current period range for a frequency
function getCurrentPeriodRange(frequency: TaskFrequency): { start: Date; end: Date } {
  const now = new Date();
  switch (frequency) {
    case 'daily':
      return { start: startOfDay(now), end: startOfDay(now) };
    case 'weekly':
      return { 
        start: startOfWeek(now, { weekStartsOn: 1 }), 
        end: addDays(startOfWeek(now, { weekStartsOn: 1 }), 6) 
      };
    case 'monthly':
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'quarterly':
      return { start: startOfQuarter(now), end: endOfQuarter(now) };
    case 'annually':
      return { start: startOfYear(now), end: endOfYear(now) };
    default:
      return { start: now, end: now };
  }
}

export default function ChecklistsTab({ buildingId, buildingName }: ChecklistsTabProps) {
  const { user, isAdminOrManager } = useAuth();
  const { byId: members } = useBuildingMembers(buildingId);
  const [tasks, setTasks] = useState<TaskInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedFrequency, setSelectedFrequency] = useState<TaskFrequency>('daily');
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // Dialog states
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskInstance | null>(null);

  const nameOf = (id: string | null) => (id && members.get(id) ? memberDisplayName(members.get(id)!) : null);

  const assignTasks = async (taskIds: string[], assigned_to: string | null) => {
    if (!taskIds.length) return;
    const { data, error } = await supabase.from('task_instances').update({ assigned_to }).in('id', taskIds).select('id');
    if (error) { toast.error(`Could not assign: ${error.message}`); return; }
    if ((data?.length ?? 0) < taskIds.length) toast.error(`Only ${data?.length ?? 0} of ${taskIds.length} tasks could be assigned.`);
    else toast.success(assigned_to ? `Assigned ${taskIds.length} task${taskIds.length === 1 ? '' : 's'} to ${nameOf(assigned_to) ?? 'user'}` : 'Unassigned');
    if (assigned_to && assigned_to !== user?.id && data?.length) {
      void notify({ kind: 'task_assigned', entityType: 'task', entityId: data[0].id, buildingId, recipients: [assigned_to], title: `${data.length} task${data.length === 1 ? '' : 's'} assigned to you at ${buildingName ?? 'a building'}`, url: `/buildings/${buildingId}?tab=checklists` });
    }
    const landed = new Set((data ?? []).map((r) => r.id));
    setTasks((prev) => prev.map((t) => (landed.has(t.id) ? { ...t, assigned_to } : t)));
  };

  const canAssignTask = (task: TaskInstance) => isAdminOrManager || task.assigned_to === user?.id;
  const onAssignTask = (task: TaskInstance, userId: string | null) => assignTasks([task.id], userId);

  useEffect(() => {
    fetchTasks();
  }, [buildingId]);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      // Fetch tasks with their completions
      // `assigned_to` is not in the generated types until the migration ships; narrow at the boundary.
      const { data: tasksRaw, error: tasksError } = await supabase
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
          category,
          assigned_to
        `)
        .eq('building_id', buildingId)
        .order('due_date');

      if (tasksError) throw tasksError;

      const tasksData = tasksRaw as unknown as Array<Omit<TaskInstance, 'completion'>> | null;

      // Fetch completions for these tasks
      const taskIds = (tasksData || []).map(t => t.id);
      const { data: completionsData, error: completionsError } = await supabase
        .from('task_completions')
        .select(`
          task_instance_id,
          completed_by,
          completed_at:created_at
        `)
        .in('task_instance_id', taskIds);

      if (completionsError) throw completionsError;

      // Map completions to tasks. The completer's name is resolved at render time from the
      // building's member list (`nameOf`) — other users' `profiles` rows are not readable here.
      const completionMap = new Map(
        (completionsData || []).map(c => [
          c.task_instance_id,
          {
            completed_by: c.completed_by,
            completed_at: c.completed_at,
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

  const generate = async (frequency?: TaskFrequency) => {
    // An omitted p_frequency is dropped from the JSON body, so the function sees its `default null`.
    const { data, error } = await supabase.rpc('generate_scheduled_tasks', { p_building: buildingId, p_frequency: frequency });
    if (error) throw new Error(error.message);
    return data ?? 0;
  };

  const handleGenerateTasks = async () => {
    setGenerating(true);
    try {
      const count = await generate(selectedFrequency);
      if (count > 0) { toast.success(`Generated ${count} new ${frequencyLabels[selectedFrequency].toLowerCase()} tasks`); fetchTasks(); }
      else toast.info('All tasks already exist for this period');
    } catch (error) {
      if (import.meta.env.DEV) console.error('generate tasks:', error);
      toast.error('Failed to generate tasks');
    } finally { setGenerating(false); }
  };

  const handleGenerateAllFrequencies = async () => {
    setGenerating(true);
    try {
      const count = await generate();
      if (count > 0) { toast.success(`Generated ${count} new tasks`); fetchTasks(); }
      else toast.info('All tasks already exist for current periods');
    } catch (error) {
      if (import.meta.env.DEV) console.error('generate tasks:', error);
      toast.error('Failed to generate tasks');
    } finally { setGenerating(false); }
  };

  const handleCompleteTask = (task: TaskInstance) => {
    setSelectedTask(task);
    setCompleteDialogOpen(true);
  };

  const handleReportIssue = (task: TaskInstance) => {
    setSelectedTask(task);
    setIssueDialogOpen(true);
  };

  // Filter tasks by frequency - show ALL tasks for this frequency
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

  // Get current period range for highlighting
  const currentPeriodRange = useMemo(() => {
    return getCurrentPeriodRange(selectedFrequency);
  }, [selectedFrequency]);

  // Calendar days
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = addMonths(monthStart, 1);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(addDays(monthEnd, -1), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentMonth]);

  // Check if a day is in the current period
  const isDayInCurrentPeriod = (day: Date): boolean => {
    return isWithinInterval(day, { start: currentPeriodRange.start, end: currentPeriodRange.end });
  };

  // Check if a day is in a future period (for next occurrences)
  const isDayInFuturePeriod = (day: Date): boolean => {
    return isAfter(day, currentPeriodRange.end);
  };

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
          {isAdminOrManager && (
            <Hint>Tasks are generated automatically every night; use these buttons to run it now.</Hint>
          )}
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
          {ALL_FREQUENCIES.map(freq => {
            const count = tasks.filter(t => t.frequency === freq).length;
            return (
              <TabsTrigger key={freq} value={freq} className="relative">
                {frequencyLabels[freq]}
                {count > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 min-w-[20px] text-xs">
                    {count}
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value={selectedFrequency} className="mt-6 space-y-6">
          {/* Period Label & Progress */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">{getPeriodLabel(selectedFrequency)}</span>
              <Badge variant="outline" className="text-xs">Current Period</Badge>
            </div>
            <div className="flex items-center gap-2">
              {isAdminOrManager && pendingTasks.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm"><UserPlus className="mr-2 h-4 w-4" />Assign all pending</Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 space-y-2">
                    <p className="text-sm">Assign the {pendingTasks.length} pending {frequencyLabels[selectedFrequency].toLowerCase()} tasks to:</p>
                    <AssigneePicker buildingId={buildingId} value={null} onChange={(id) => id && assignTasks(pendingTasks.map((t) => t.id), id)} allowUnassigned={false} placeholder="Choose a person" />
                  </PopoverContent>
                </Popover>
              )}
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
                {/* Legend */}
                <div className="flex items-center gap-3 mb-3 text-xs">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-primary/20 border border-primary" />
                    <span>Current</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-muted" />
                    <span>Future</span>
                  </div>
                </div>

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
                    const isCurrentMonth = isSameMonth(day, currentMonth);
                    const inCurrentPeriod = isDayInCurrentPeriod(day);
                    const inFuturePeriod = isDayInFuturePeriod(day);

                    return (
                      <div
                        key={day.toISOString()}
                        className={`
                          relative h-8 w-full rounded text-sm flex items-center justify-center transition-colors
                          ${!isCurrentMonth ? 'text-muted-foreground/40' : ''}
                          ${isToday(day) ? 'bg-primary text-primary-foreground font-bold' : ''}
                          ${inCurrentPeriod && !isToday(day) ? 'bg-primary/20 border border-primary/40' : ''}
                          ${inFuturePeriod && dayTasks.length > 0 ? 'bg-muted' : ''}
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
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Tasks List - Show ALL tasks for this frequency */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {frequencyLabels[selectedFrequency]} Tasks
                  <Badge variant="secondary">{filteredTasks.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TasksList
                  tasks={filteredTasks}
                  onComplete={handleCompleteTask}
                  onReportIssue={handleReportIssue}
                  emptyMessage={`No ${frequencyLabels[selectedFrequency].toLowerCase()} tasks scheduled. Click "Generate ${frequencyLabels[selectedFrequency]}" to create tasks.`}
                  showDueDate
                  buildingId={buildingId}
                  nameOf={nameOf}
                  canAssign={canAssignTask}
                  onAssign={onAssignTask}
                />
              </CardContent>
            </Card>
          </div>

          {/* Issues Summary */}
          {issueTasks.length > 0 && (
            <Card className="border-destructive/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Issues Logged ({issueTasks.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TasksList
                  tasks={issueTasks}
                  onComplete={handleCompleteTask}
                  onReportIssue={handleReportIssue}
                  variant="issue"
                  showDueDate
                  buildingId={buildingId}
                  nameOf={nameOf}
                  canAssign={canAssignTask}
                  onAssign={onAssignTask}
                />
              </CardContent>
            </Card>
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
