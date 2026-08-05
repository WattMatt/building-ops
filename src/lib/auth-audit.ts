import { supabase } from '@/integrations/supabase/client';

// auth-audit — thin client-side helper for auth-event rows in audit_logs (C7).
//
// Modeled on the onboarding-standard kit's auth-audit.ts, adapted to this
// repo: there is no log-auth-event edge function here, and audit_logs RLS
// already permits self-attributed inserts (WITH CHECK user_id = auth.uid() OR
// user_id IS NULL), so events are written directly to the table.
//
// Fire-and-forget by design — auth UX must never block on a failed audit
// write. Failed writes are queued in localStorage and replayed on the next
// successful call OR on next module load. Queue capped at 50; entries older
// than 7 days are dropped on drain (a replayed row must still satisfy
// user_id = auth.uid(), so events for a different signed-in user cannot be
// replayed and would pin the queue forever without the age cap).

const QUEUE_KEY = 'gmi_auth_audit_retry_queue';
const MAX_QUEUE = 50;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type AuthAuditAction = 'auth.login' | 'auth.logout' | 'user_role_change';

interface AuditRow {
  action: AuthAuditAction;
  entity_type: string;
  entity_id: string | null;
  user_id: string | null;
}

interface QueuedEvent extends AuditRow {
  queued_at: number;
}

function readQueue(): QueuedEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedEvent[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedEvent[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  } catch {
    /* quota / privacy mode — drop */
  }
}

async function sendOne(row: AuditRow): Promise<boolean> {
  try {
    const { error } = await supabase.from('audit_logs').insert(row);
    return !error;
  } catch {
    return false;
  }
}

async function drainQueue(): Promise<void> {
  const queue = readQueue().filter((item) => Date.now() - item.queued_at < MAX_AGE_MS);
  if (queue.length === 0) {
    writeQueue(queue);
    return;
  }
  const remaining: QueuedEvent[] = [];
  for (const item of queue) {
    const { queued_at, ...row } = item;
    const ok = await sendOne(row);
    if (!ok) remaining.push(item);
  }
  writeQueue(remaining);
}

// Drain on module load (idempotent). Failures stay queued for next time.
if (typeof window !== 'undefined') {
  void drainQueue().catch(() => {});
}

/**
 * Records an auth event in audit_logs, attributed to the current user.
 * `entityId` is the affected user (defaults to the actor — e.g. login/logout);
 * for role changes pass the TARGET user's id.
 *
 * Never throws and never blocks on failure; awaiting it merely waits for the
 * write attempt, which matters for 'auth.logout' (the session is about to be
 * revoked, so the row must be written before signOut).
 */
export async function recordAuthEvent(
  action: AuthAuditAction,
  opts: { entityId?: string } = {},
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const row: AuditRow = {
      action,
      entity_type: 'user',
      entity_id: opts.entityId ?? user?.id ?? null,
      user_id: user?.id ?? null,
    };
    const ok = await sendOne(row);
    if (ok) {
      // Opportunistically retry anything that piled up while we were down.
      void drainQueue().catch(() => {});
      return;
    }
    if (import.meta.env.DEV) {
      console.warn('[auth-audit] failed to record event; queued for retry', action);
    }
    const queue = readQueue();
    queue.push({ ...row, queued_at: Date.now() });
    writeQueue(queue);
  } catch {
    /* never let audit failures surface into auth UX */
  }
}
