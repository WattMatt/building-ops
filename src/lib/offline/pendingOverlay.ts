/**
 * Pure selectors that project the offline write queue onto the read lists.
 *
 * The read cache (My Day, Issues) only knows what the server last said. While a write is
 * waiting to sync, the pages overlay it from the queue so the caretaker sees "I did that" —
 * a task marked Queued instead of offering Complete again, an issue in the list before the
 * server has it. Nothing here touches the queue store; it is a view over `ops`.
 */
import type { IssuePriority } from '@/lib/constants';
import type { QueuedOp } from './types';

export type BuildingNames = Map<string, string> | Record<string, string>;

/** An issue that exists only in the queue so far. Shaped like a list row plus the queue flags. */
export interface QueuedIssueRow {
  id: string;
  title: string;
  description: string;
  priority: IssuePriority;
  status: 'open';
  building_id: string;
  building_name: string;
  created_at: string;
  deadline: string | null;
  queued: true;
  /** The backend rejected it; the queue sheet is where the user retries or discards. */
  failed: boolean;
}

/** Task instance ids with a pending or failed completion in the queue. */
export function queuedTaskIds(ops: readonly QueuedOp[]): Set<string> {
  const ids = new Set<string>();
  for (const op of ops) {
    if (op.payload.kind === 'task_complete') ids.add(op.payload.taskInstanceId);
  }
  return ids;
}

/** Task instance ids whose queued completion the backend rejected. */
export function failedTaskIds(ops: readonly QueuedOp[]): Set<string> {
  const ids = new Set<string>();
  for (const op of ops) {
    if (op.payload.kind === 'task_complete' && op.status === 'failed') ids.add(op.payload.taskInstanceId);
  }
  return ids;
}

function lookupName(names: BuildingNames, id: string): string | undefined {
  return names instanceof Map ? names.get(id) : names[id];
}

/** Queued issue_create ops as list rows, oldest first (the queue's own order). */
export function queuedIssues(ops: readonly QueuedOp[], buildingNames: BuildingNames): QueuedIssueRow[] {
  const rows: QueuedIssueRow[] = [];
  for (const op of ops) {
    if (op.payload.kind !== 'issue_create') continue;
    const { row } = op.payload;
    rows.push({
      id: op.payload.issueId,
      title: row.title,
      description: row.description,
      priority: row.priority,
      status: 'open',
      building_id: row.building_id,
      building_name: lookupName(buildingNames, row.building_id) ?? '',
      created_at: new Date(op.createdAt).toISOString(),
      deadline: row.deadline,
      queued: true,
      failed: op.status === 'failed',
    });
  }
  return rows;
}
