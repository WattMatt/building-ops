import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  profile: { full_name: 'Me' } as { full_name: string | null } | null,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        state.rows.push(row);
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'a1' }, error: null }) }) };
      },
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.profile, error: null }) }) }),
    }),
  },
}));

import { postIssueComment } from './issueActivity';

describe('postIssueComment', () => {
  beforeEach(() => {
    state.rows = [];
    state.profile = { full_name: 'Me' };
  });

  it('inserts one comment row with the denormalised author name', async () => {
    const result = await postIssueComment({
      issueId: 'i1',
      userId: 'me',
      userEmail: 'me@example.com',
      comment: 'ping @Thabo M',
      photoUrls: ['p1'],
      mentions: ['u1'],
    });

    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({
      issue_id: 'i1',
      activity_type: 'comment',
      comment: 'ping @Thabo M',
      photo_urls: ['p1'],
      mentions: ['u1'],
      user_id: 'me',
      author_name: 'Me',
    });
    expect(result).toEqual({ id: 'a1', authorName: 'Me' });
  });

  it('defaults photo_urls and mentions to empty arrays', async () => {
    await postIssueComment({ issueId: 'i1', userId: 'me', comment: 'plain' });
    expect(state.rows[0]).toMatchObject({ photo_urls: [], mentions: [] });
  });

  it('falls back to the email when the profile has no full name', async () => {
    state.profile = { full_name: null };
    const { authorName } = await postIssueComment({
      issueId: 'i1',
      userId: 'me',
      userEmail: 'me@example.com',
      comment: 'hi',
    });
    expect(authorName).toBe('me@example.com');
    expect(state.rows[0]).toMatchObject({ author_name: 'me@example.com' });
  });

  it('falls back to Someone when there is no name and no email', async () => {
    state.profile = null;
    const { authorName } = await postIssueComment({ issueId: 'i1', userId: 'me', comment: 'hi' });
    expect(authorName).toBe('Someone');
  });
});
