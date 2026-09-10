/**
 * Client-side seam for in-app notifications. Calls the `notify` edge function so the row
 * lands in the recipient's inbox and email fans out according to their preferences.
 * Fire-and-forget: a failure to notify must never fail the action that caused it.
 *
 * Bulk task assignment sends one notification keyed on the first task id; the `url`
 * deep-links to the building's checklist tab, not to a single task.
 */
import { supabase } from '@/integrations/supabase/client';

/**
 * Mirrors NOTIFICATION_KINDS in supabase/functions/_shared/notifyRules.ts (that module is
 * Deno-land, not in the app bundle). `task_due_today` is raised by the daily digest only;
 * `issue_sla_breached` by the SQL sweep `mark_sla_breaches()` only; the client never sends
 * either and `notify` would reject them.
 */
export type NotificationKind =
  | 'task_assigned' | 'issue_assigned' | 'issue_comment' | 'issue_mention'
  | 'report_submitted' | 'report_returned' | 'report_approved'
  | 'form_submitted' | 'form_reviewed' | 'signoff_requested' | 'signoff_complete' | 'signoff_overdue'
  | 'document_expiring' | 'asset_service_due' | 'task_due_today' | 'issue_sla_breached';

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

/**
 * Kinds the edge function fans out to every admin and manager, so the caller sends no
 * recipients. Mirrors ORG_WIDE_KINDS in supabase/functions/_shared/notifyRules.ts — declared
 * again rather than imported, because that module is Deno-land and is not in the app bundle.
 *
 * `form_submitted` and `signoff_overdue` are org-wide too but never travel through this seam:
 * their own edge functions raise them, and `notify` rejects them outright.
 */
const ORG_WIDE = new Set<NotificationKind>(['report_submitted']);

/** Fire-and-forget: a failure to notify must never fail the action that caused it. */
export async function notify(input: NotifyInput): Promise<void> {
  if (!input.recipients.length && !ORG_WIDE.has(input.kind)) return;
  try {
    const { error } = await supabase.functions.invoke('notify', { body: input });
    if (error && import.meta.env.DEV) console.warn('[notify] failed:', error.message ?? error);
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[notify] failed:', e);
  }
}
