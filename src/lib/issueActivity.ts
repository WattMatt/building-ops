import { supabase } from '@/integrations/supabase/client';

interface PostIssueCommentInput {
  /** Client-generated row id so an offline replay of the same comment is idempotent. */
  id?: string;
  issueId: string;
  userId: string;
  userEmail?: string | null;
  comment: string;
  photoUrls?: string[];
  mentions?: string[];
}

/**
 * Post a comment on an issue. One insert into issue_activity with the author's name
 * denormalised from their own profile (other users cannot read profiles, so the name must
 * travel with the row). Returns the new row id and the author name used.
 */
export async function postIssueComment(
  input: PostIssueCommentInput,
): Promise<{ id: string; authorName: string }> {
  const { id, issueId, userId, userEmail, comment, photoUrls, mentions } = input;

  const { data: me } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  const authorName = (me as { full_name?: string | null } | null)?.full_name?.trim() || userEmail || 'Someone';

  const { data, error } = await supabase
    .from('issue_activity')
    .insert({
      ...(id ? { id } : {}),
      issue_id: issueId,
      activity_type: 'comment',
      comment,
      photo_urls: photoUrls ?? [],
      mentions: mentions ?? [],
      user_id: userId,
      author_name: authorName,
    })
    .select('id')
    .single();

  if (error) throw error;
  if (!data) throw new Error('The comment was not saved.');

  return { id: (data as { id: string }).id, authorName };
}
