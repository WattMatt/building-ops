/**
 * Per-building operational score: task completion over a rolling window.
 * completed ÷ (completed + pending + overdue) × 100, rounded; null when there are
 * no tasks (honest empty-state, never NaN). Display-only; the building's tasks live
 * in task_instances. Paired with the real OHS compliance % (compliance_scores).
 *
 * Two statuses are outside the score on purpose, and are named here rather than dropped by
 * omission: `issue_logged` (the answer was a problem, not a completion — it was never counted
 * here, and nothing changes for it) and, since S6b, `wont_do` (closed with a reason: neither done
 * nor outstanding). The nightly snapshot (snapshot_building_metrics) agrees on `wont_do` — it is
 * out of every task count there too — but differs on `issue_logged`: the snapshot keeps that row
 * in the denominator as not-done, while this live fallback drops it. That difference predates S6b
 * and is kept as-is per spec §5.3; only `wont_do` was added to both sides.
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
    // The exported list is the behaviour, not a parallel comment: an unscored status never buckets.
    if (s != null && UNSCORED_STATUSES.includes(s)) continue;
    if (s === 'completed') c.completed++;
    else if (s === 'pending') c.pending++;
    else if (s === 'overdue') c.overdue++;
    // Any value the check constraint does not know also falls through.
  }
  return c;
}

export function taskCompletionPct(c: TaskCounts): number | null {
  const total = c.completed + c.pending + c.overdue;
  return total > 0 ? Math.round((c.completed / total) * 100) : null;
}
