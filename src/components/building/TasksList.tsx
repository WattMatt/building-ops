import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Camera,
  User,
  ClipboardCheck,
} from 'lucide-react';
import { format } from 'date-fns';
import { categoryMeta } from '@/lib/compliance';
import { AssigneePicker } from '@/components/people/AssigneePicker';

export type TaskFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
export type TaskStatus = 'pending' | 'completed' | 'overdue' | 'issue_logged';

export interface TaskInstance {
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
  category: string | null;
  assigned_to: string | null;
  completion?: {
    completed_by: string;
    completed_at: string;
    completed_by_name?: string;
  };
}

export const statusColors: Record<TaskStatus, string> = {
  pending: 'bg-warning text-warning-foreground',
  completed: 'bg-success text-success-foreground',
  overdue: 'bg-destructive text-destructive-foreground',
  issue_logged: 'bg-destructive/80 text-destructive-foreground',
};

export interface TasksListProps {
  tasks: TaskInstance[];
  onComplete: (task: TaskInstance) => void;
  onReportIssue: (task: TaskInstance) => void;
  emptyMessage?: string;
  variant?: 'default' | 'issue';
  showDueDate?: boolean;
  buildingId: string;
  nameOf: (id: string | null) => string | null;
  canAssign: (task: TaskInstance) => boolean;
  onAssign: (task: TaskInstance, userId: string | null) => void;
}

export function TasksList({ tasks, onComplete, onReportIssue, emptyMessage, variant = 'default', showDueDate = false, buildingId, nameOf, canAssign, onAssign }: TasksListProps) {
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
                  {categoryMeta(task.category) && (
                    <Badge variant="outline" className={`mt-1 ${categoryMeta(task.category)!.color}`}>
                      {categoryMeta(task.category)!.label}
                    </Badge>
                  )}
                  {showDueDate && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      Due: {format(new Date(task.due_date), 'MMM d, yyyy')}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <User className="h-3 w-3" />
                    {task.assigned_to ? (nameOf(task.assigned_to) ?? 'Assigned') : 'Unassigned'}
                    {canAssign(task) && task.status === 'pending' && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Change assignee for ${task.task_name}`}
                            className="rounded px-1.5 py-1 text-xs underline hover:bg-muted"
                          >
                            change
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64">
                          <AssigneePicker buildingId={buildingId} value={task.assigned_to} onChange={(id) => onAssign(task, id)} />
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
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
