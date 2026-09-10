/**
 * Client-side seam for in-app notifications. R1a records the intent; R1b replaces the body
 * with `supabase.functions.invoke('notify')` so the row lands in the recipient's inbox and
 * email fans out according to their preferences. Fire-and-forget: a failure to notify must
 * never fail the action that caused it.
 *
 * Bulk task assignment sends one notification keyed on the first task id; the `url`
 * deep-links to the building's checklist tab, not to a single task.
 */
export type NotificationKind =
  | 'task_assigned' | 'issue_assigned' | 'issue_comment' | 'issue_mention'
  | 'report_submitted' | 'report_returned' | 'report_approved'
  | 'form_submitted' | 'form_reviewed' | 'signoff_requested' | 'signoff_complete' | 'signoff_overdue'
  | 'document_expiring' | 'asset_service_due';

export type NotificationEntityType = 'task' | 'issue' | 'report' | 'form_submission' | 'signoff_request' | 'document' | 'asset';

export interface NotifyInput {
  kind: NotificationKind;
  entityType: NotificationEntityType;
  entityId: string;
  buildingId: string;
  /** Profile ids. The sender drops the actor and anyone without access to the building. */
  recipients: string[];
  title: string;
  body?: string;
  /** In-app path the inbox row deep-links to. */
  url: string;
}

export async function notify(input: NotifyInput): Promise<void> {
  if (!input.recipients.length) return;
  if (import.meta.env.DEV) console.info('[notify] (not wired yet)', input.kind, input.recipients.length, 'recipient(s)');
}
