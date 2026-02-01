/**
 * Shared constants, color maps, and type definitions
 * Centralized to avoid duplication across components
 */

import type { Database } from '@/integrations/supabase/types';

// Type exports from database
export type AppRole = Database['public']['Enums']['app_role'];
export type TaskFrequency = Database['public']['Enums']['task_frequency'];
export type TaskStatus = Database['public']['Enums']['task_status'];
export type IssuePriority = Database['public']['Enums']['issue_priority'];
export type IssueStatus = Database['public']['Enums']['issue_status'];

// Frequency display labels
export const FREQUENCY_LABELS: Record<TaskFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annual',
};

// Frequency badge colors - using semantic design tokens
export const FREQUENCY_COLORS: Record<TaskFrequency, string> = {
  daily: 'bg-info/10 text-info border-info/20',
  weekly: 'bg-success/10 text-success border-success/20',
  monthly: 'bg-accent/10 text-accent border-accent/20',
  quarterly: 'bg-warning/10 text-warning border-warning/20',
  annually: 'bg-destructive/10 text-destructive border-destructive/20',
};

// Priority display labels
export const PRIORITY_LABELS: Record<IssuePriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

// Priority badge colors - using semantic design tokens
export const PRIORITY_COLORS: Record<IssuePriority, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-warning/10 text-warning border-warning/20',
  high: 'bg-destructive/20 text-destructive border-destructive/30',
  critical: 'bg-destructive text-destructive-foreground',
};

// Issue status display labels
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  escalated: 'Escalated',
  resolved: 'Resolved',
};

// Issue status badge colors - using semantic design tokens
export const ISSUE_STATUS_COLORS: Record<IssueStatus, string> = {
  open: 'bg-warning/10 text-warning border-warning/20',
  in_progress: 'bg-info/10 text-info border-info/20',
  escalated: 'bg-destructive/20 text-destructive border-destructive/30',
  resolved: 'bg-success/10 text-success border-success/20',
};

// Task status display labels
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  completed: 'Completed',
  overdue: 'Overdue',
  issue_logged: 'Issue Logged',
};

// Task status badge colors - using semantic design tokens
export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'bg-warning/10 text-warning border-warning/20',
  completed: 'bg-success/10 text-success border-success/20',
  overdue: 'bg-destructive/20 text-destructive border-destructive/30',
  issue_logged: 'bg-destructive/10 text-destructive border-destructive/20',
};

// Role display labels
export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  user: 'User',
  reviewer: 'Reviewer',
};

// Role badge colors
export const ROLE_COLORS: Record<AppRole, string> = {
  admin: 'bg-destructive/10 text-destructive border-destructive/20',
  manager: 'bg-primary/10 text-primary border-primary/20',
  user: 'bg-muted text-muted-foreground',
  reviewer: 'bg-accent/10 text-accent border-accent/20',
};

// Frequency options for dropdowns
export const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
] as const;

// Priority options for dropdowns
export const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
] as const;

// Issue status options for dropdowns
export const ISSUE_STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
] as const;

// Role options for dropdowns
export const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'user', label: 'User' },
  { value: 'reviewer', label: 'Reviewer' },
] as const;
