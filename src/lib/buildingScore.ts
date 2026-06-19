/**
 * Per-building operational score: task completion over a rolling window.
 * completed ÷ (completed + pending + overdue) × 100, rounded; null when there are
 * no tasks (honest empty-state, never NaN). Display-only; the building's tasks live
 * in task_instances. Paired with the real OHS compliance % (compliance_scores).
 */
export interface TaskCounts {
  completed: number;
  pending: number;
  overdue: number;
}

export function taskCompletionPct(c: TaskCounts): number | null {
  const total = c.completed + c.pending + c.overdue;
  return total > 0 ? Math.round((c.completed / total) * 100) : null;
}
