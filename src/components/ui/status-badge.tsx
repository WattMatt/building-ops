/**
 * Reusable status/label badge component
 * Uses centralized constants for consistent styling
 */

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  FREQUENCY_COLORS,
  FREQUENCY_LABELS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  ISSUE_STATUS_COLORS,
  ISSUE_STATUS_LABELS,
  TASK_STATUS_COLORS,
  TASK_STATUS_LABELS,
  ROLE_COLORS,
  ROLE_LABELS,
  type TaskFrequency,
  type IssuePriority,
  type IssueStatus,
  type TaskStatus,
  type AppRole,
} from '@/lib/constants';

interface StatusBadgeProps {
  className?: string;
}

interface FrequencyBadgeProps extends StatusBadgeProps {
  frequency: TaskFrequency;
}

export function FrequencyBadge({ frequency, className }: FrequencyBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(FREQUENCY_COLORS[frequency], 'border', className)}
    >
      {FREQUENCY_LABELS[frequency]}
    </Badge>
  );
}

interface PriorityBadgeProps extends StatusBadgeProps {
  priority: IssuePriority;
}

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(PRIORITY_COLORS[priority], 'border', className)}
    >
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}

interface IssueStatusBadgeProps extends StatusBadgeProps {
  status: IssueStatus;
}

export function IssueStatusBadge({ status, className }: IssueStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(ISSUE_STATUS_COLORS[status], 'border', className)}
    >
      {ISSUE_STATUS_LABELS[status]}
    </Badge>
  );
}

interface TaskStatusBadgeProps extends StatusBadgeProps {
  status: TaskStatus;
}

export function TaskStatusBadge({ status, className }: TaskStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(TASK_STATUS_COLORS[status], 'border', className)}
    >
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

interface RoleBadgeProps extends StatusBadgeProps {
  role: AppRole;
}

export function RoleBadge({ role, className }: RoleBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(ROLE_COLORS[role], 'border', className)}
    >
      {ROLE_LABELS[role]}
    </Badge>
  );
}
