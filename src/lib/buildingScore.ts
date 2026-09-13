/**
 * Per-building operational score: task completion over a rolling window.
 * completed ÷ (completed + pending + overdue) × 100, rounded; null when there are
 * no tasks (honest empty-state, never NaN). Display-only; the building's tasks live
 * in task_instances. Paired with the real OHS compliance % (compliance_scores).
 *
 * Two statuses are outside the score on purpose, and are named here rather than dropped by
 * omission: `issue_logged` (the answer was a problem, not a completion — it was never counted,
 * and nothing changes for it) and, since S6b, `wont_do` (closed with a reason: neither done nor
 * outstanding). The nightly snapshot (snapshot_building_metrics) draws the same line, so the
 * snapshot path and this live fallback agree.
 */
export interface TaskCounts {
  completed: number;
  pending: number;
  overdue: number;
}

export const UNSCORED_STATUSES: readonly string[] = ['issue_logged', 'wont_do'];

/** Bucket raw `task_instances.status` values into the three that score; everything else is ignored. */
export function countForScore(statuses: readonly (string | null | undefined)[]): TaskCounts {
  const c: TaskCounts = { completed: 0, pending: 0, overdue: 0 };
  for (const s of statuses) {
    if (s === 'completed') c.completed++;
    else if (s === 'pending') c.pending++;
    else if (s === 'overdue') c.overdue++;
    // UNSCORED_STATUSES (and any value the check constraint does not know) fall through.
  }
  return c;
}

export function taskCompletionPct(c: TaskCounts): number | null {
  const total = c.completed + c.pending + c.overdue;
  return total > 0 ? Math.round((c.completed / total) * 100) : null;
}
