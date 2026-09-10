/**
 * One handler per queued operation kind. Each runs a queued op against the backend exactly
 * the way the online dialog does today (same inserts, same RPC, same notifications), with the
 * client-generated row id so a second attempt after a half-failed first one is a no-op
 * (`complete_task` reports `already_completed`; the inserts collide on the primary key).
 *
 * Single-write ops (`task_complete`, `issue_comment`) let a 23505 propagate: replay.ts treats it
 * as "already applied". Two-write ops (`issue_create` + task flip, `issue_resolve` = comment +
 * status flip) must NOT: the network may have died between write 1 and write 2, so a duplicate
 * on write 1 only proves write 1 landed. They swallow the 23505 and always run write 2, which is
 * an idempotent update. Throws on anything else; replay.ts classifies.
 *
 * `issue_resolve` may carry a third write (the contractor rating). It runs only after the status
 * flip succeeded. A rejection of the rating itself (RLS, a constraint) is best effort: the issue
 * is resolved by then, so the op completes and the result says the rating failed. A transport
 * failure is NOT swallowed — the rating never reached the server, and completing the op would
 * lose it for good — so it propagates and replay.ts re-queues the whole op. On that replay write
 * 1 collides (23505, swallowed), write 2 is an idempotent update, and write 3 either lands or, if
 * the lost response had in fact been a success, collides on the unique `issue_id` → 'duplicate'.
 */
import { supabase } from '@/integrations/supabase/client';
import { uploadPhotos, photoPrefix } from '@/lib/photos';
import { postIssueComment } from '@/lib/issueActivity';
import { notify } from '@/lib/notify';
import { isNetworkError } from './network';
import type { IssueResolvePayload, QueuedOp } from './types';

const isDuplicate = (e: unknown) => (e as { code?: string } | null)?.code === '23505';

/** Outcome of the optional rating write that follows an issue_resolve status flip. */
export type RatingWriteOutcome = 'saved' | 'duplicate' | 'failed';

/** What a synced `issue_resolve` op hands back; `rating` is present only when the payload carried one. */
export interface IssueResolveResult {
  issueId: string;
  rating?: RatingWriteOutcome;
}

/**
 * Write 3 of issue_resolve. Returns the outcome for every rejection the server itself made;
 * rethrows only when the request never got an answer (transport), so the caller can re-queue.
 */
async function insertContractorRating(
  uid: string,
  issueId: string,
  rating: NonNullable<IssueResolvePayload['rating']>,
): Promise<RatingWriteOutcome> {
  try {
    const { error } = await supabase
      .from('contractor_ratings')
      .insert({
        contractor_id: rating.contractorId,
        issue_id: issueId,
        rating: rating.rating,
        comment: rating.comment,
        rated_by: uid,
      });
    if (!error) return 'saved';
    if (isDuplicate(error)) return 'duplicate';
    // supabase-js wraps a dead connection into a plain error object rather than throwing it.
    if (isNetworkError(error)) throw error;
    if (import.meta.env.DEV) console.warn('contractor_ratings insert failed after resolve:', error);
    return 'failed';
  } catch (e) {
    if (isNetworkError(e)) throw e;
    if (import.meta.env.DEV) console.warn('contractor_ratings insert threw after resolve:', e);
    return 'failed';
  }
}

/** Runs one op against the backend. Throws on failure; the caller classifies the error. */
export async function runOp(op: QueuedOp): Promise<unknown> {
  // A replay that started under one user must not finish under another: on an implicit user
  // switch the old user's queue is being cleared, and any op still in flight would otherwise go
  // out with the new user's JWT. Checked before the photo upload so nothing lands under the wrong
  // user. Not a network error, so replay.ts marks the op failed rather than retrying it.
  const sessionUid = (await supabase.auth.getSession()).data.session?.user.id;
  if (sessionUid !== op.uid) {
    throw Object.assign(new Error('Signed-in user changed while syncing'), { code: 'USER_MISMATCH' });
  }
  // Fresh paths every attempt: overwriting an existing object needs the admin-only update policy.
  const photoUrls = op.photos.length
    ? await uploadPhotos(op.photos.map((p) => ({ file: p.file, preview: '' })), { prefix: photoPrefix(op.uid) })
    : [];
  const p = op.payload;
  switch (p.kind) {
    case 'task_complete': {
      const { data, error } = await supabase.rpc('complete_task', {
        p_completion_id: p.completionId,
        p_task_instance_id: p.taskInstanceId,
        p_notes: p.notes ?? undefined,
        p_signature_confirmed: p.signatureConfirmed,
        p_photo_urls: photoUrls,
      });
      if (error) throw error;
      return data?.[0] ?? { completion_id: p.completionId, already_completed: false };
    }
    case 'issue_create': {
      const { error } = await supabase
        .from('issues')
        .insert({ id: p.issueId, ...p.row, photo_urls: photoUrls.length ? photoUrls : null });
      // A duplicate means an earlier attempt inserted the issue; the task flip below may still be owed.
      if (error && !isDuplicate(error)) throw error;
      if (p.markTaskIssueLogged) {
        const { error: e2 } = await supabase
          .from('task_instances')
          .update({ status: 'issue_logged' })
          .eq('id', p.markTaskIssueLogged);
        if (e2) throw e2;
      }
      return { issueId: p.issueId };
    }
    case 'issue_comment': {
      // Single write: a 23505 here propagates and replay.ts drops the op as already applied. The
      // two notifies below are then skipped — acceptable, they were sent (or not) by the attempt
      // that landed, and a comment must never notify twice.
      const { authorName } = await postIssueComment({
        id: p.activityId, issueId: p.issueId, userId: op.uid, userEmail: p.userEmail,
        comment: p.comment, photoUrls, mentions: p.mentions,
      });
      // Same shaping as the online composer: dedupe, drop empties, then the actor and the mentioned.
      const others = [...new Set(p.notifyOthers.filter(Boolean))].filter((id) => id !== op.uid && !p.mentions.includes(id));
      if (others.length) {
        void notify({
          kind: 'issue_comment', entityType: 'issue', entityId: p.issueId, buildingId: p.buildingId, recipients: others,
          title: `${authorName} commented on: ${p.issueTitle}`, body: p.comment.slice(0, 200), url: `/issues?open=${p.issueId}`,
        });
      }
      const mentioned = p.mentions.filter((id) => id !== op.uid);
      if (mentioned.length) {
        void notify({
          kind: 'issue_mention', entityType: 'issue', entityId: p.issueId, buildingId: p.buildingId, recipients: mentioned,
          title: `${authorName} mentioned you on: ${p.issueTitle}`, body: p.comment.slice(0, 200), url: `/issues?open=${p.issueId}`,
        });
      }
      return { activityId: p.activityId, authorName };
    }
    case 'issue_resolve': {
      try {
        await postIssueComment({
          id: p.activityId, issueId: p.issueId, userId: op.uid, userEmail: p.userEmail, comment: p.note, photoUrls,
        });
      } catch (e) {
        // The note already landed on an earlier attempt; the status flip below may still be owed.
        if (!isDuplicate(e)) throw e;
      }
      // The note is saved even if the status flip is refused — it is true either way.
      const { data, error } = await supabase.from('issues').update({ status: 'resolved' }).eq('id', p.issueId).select('id');
      if (error) throw error;
      if (!data?.length) {
        throw Object.assign(
          new Error('Your note was saved, but you do not have permission to resolve this issue.'),
          { code: 'RESOLVE_DENIED' },
        );
      }
      const result: IssueResolveResult = { issueId: p.issueId };
      if (!p.rating) return result;
      // Write 3. The issue IS resolved by now, so a rejection of the rating (RLS, a constraint)
      // must not fail the op: it is logged and reported in the result for the dialog to mention.
      // A transport failure is different — the rating may never have arrived — so it throws and
      // replay.ts re-queues the op; the retry re-runs all three writes (1 and 2 are idempotent)
      // and, if the lost answer had been a success, write 3 hits the unique `issue_id` → 'duplicate'.
      result.rating = await insertContractorRating(op.uid, p.issueId, p.rating);
      return result;
    }
  }
}
