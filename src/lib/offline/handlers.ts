/**
 * One handler per queued operation kind. Each runs a queued op against the backend exactly
 * the way the online dialog does today (same inserts, same RPC, same notifications), with the
 * client-generated row id so a second attempt after a half-failed first one is a no-op
 * (`complete_task` reports `already_completed`; the inserts collide on the primary key and the
 * replay engine treats 23505/409 as "already applied"). Throws on failure; replay.ts classifies.
 */
import { supabase } from '@/integrations/supabase/client';
import { uploadPhotos, photoPrefix } from '@/lib/photos';
import { postIssueComment } from '@/lib/issueActivity';
import { notify } from '@/lib/notify';
import type { QueuedOp } from './types';

/** Runs one op against the backend. Throws on failure; the caller classifies the error. */
export async function runOp(op: QueuedOp): Promise<unknown> {
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
      if (error) throw error;
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
      const { authorName } = await postIssueComment({
        id: p.activityId, issueId: p.issueId, userId: op.uid, userEmail: p.userEmail,
        comment: p.comment, photoUrls, mentions: p.mentions,
      });
      const others = p.notifyOthers.filter((id) => id !== op.uid && !p.mentions.includes(id));
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
      await postIssueComment({
        id: p.activityId, issueId: p.issueId, userId: op.uid, userEmail: p.userEmail, comment: p.note, photoUrls,
      });
      // The note is saved even if the status flip is refused — it is true either way.
      const { data, error } = await supabase.from('issues').update({ status: 'resolved' }).eq('id', p.issueId).select('id');
      if (error) throw error;
      if (!data?.length) {
        throw Object.assign(
          new Error('Your note was saved, but you do not have permission to resolve this issue.'),
          { code: 'RESOLVE_DENIED' },
        );
      }
      return { issueId: p.issueId };
    }
  }
}
