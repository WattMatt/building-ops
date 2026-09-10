import type { IssuePriority } from '@/lib/constants';

/** A photo held in the queue until it can be uploaded. Files survive structured clone, so the File itself is stored. */
export interface QueuedPhoto { file: File }

export interface TaskCompletePayload {
  kind: 'task_complete';
  completionId: string;           // client id → complete_task.p_completion_id (idempotent replay)
  taskInstanceId: string;
  taskName: string;               // for the queue sheet only
  notes: string | null;
  signatureConfirmed: boolean;
}
export interface IssueCreatePayload {
  kind: 'issue_create';
  issueId: string;                // client id → issues.id
  row: {
    title: string; description: string; priority: IssuePriority; status: 'open';
    building_id: string; deadline: string | null; corrective_action: string | null;
    reported_by: string; assigned_to: string | null; task_instance_id: string | null;
  };
  /** ReportIssueDialog flips the task to issue_logged after the insert. */
  markTaskIssueLogged: string | null;
}
export interface IssueCommentPayload {
  kind: 'issue_comment';
  activityId: string;             // client id → issue_activity.id
  issueId: string;
  issueTitle: string;
  buildingId: string;
  comment: string;
  mentions: string[];
  /** For the two notify calls the composer makes today. */
  notifyOthers: string[];
  userEmail: string | null;
}
export interface IssueResolvePayload {
  kind: 'issue_resolve';
  activityId: string;
  issueId: string;
  note: string;
  userEmail: string | null;
}
export type OpPayload = TaskCompletePayload | IssueCreatePayload | IssueCommentPayload | IssueResolvePayload;
export type OpKind = OpPayload['kind'];

export interface QueuedOp {
  id: string;
  uid: string;
  createdAt: number;
  attempts: number;
  status: 'pending' | 'failed';
  lastError: string | null;
  payload: OpPayload;
  photos: QueuedPhoto[];
}

/** What `enqueueAndRun` tells the caller happened to THEIR op right now. */
export type RunOutcome =
  | { status: 'synced'; result: unknown }
  | { status: 'queued' }             // offline or network failure: it will replay later
  /** `code` is the handler's machine-readable reason (e.g. RESOLVE_DENIED) so a dialog can tell terminal from retryable. */
  | { status: 'failed'; error: string; code?: string };
