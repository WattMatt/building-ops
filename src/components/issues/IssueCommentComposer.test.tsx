import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const inserted = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
const notify = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => { inserted.rows.push(row); return { select: () => ({ single: () => Promise.resolve({ data: { id: 'a1' }, error: null }) }) }; },
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { full_name: 'Me' }, error: null }) }) }),
    }),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/hooks/useBuildingMembers', () => ({
  useBuildingMembers: () => ({ data: [{ id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' }], byId: new Map([['u1', { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' }]]) }),
  memberDisplayName: (m: { full_name: string | null }) => m.full_name ?? 'Unnamed user',
}));
vi.mock('@/lib/issuePhotos', () => ({ uploadIssuePhotos: async () => [] }));
vi.mock('@/lib/notify', () => ({ notify }));
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import { IssueCommentComposer } from './IssueCommentComposer';

describe('IssueCommentComposer', () => {
  beforeEach(() => {
    inserted.rows = [];
    notify.mockClear();
  });

  it('posts a comment with the chosen mention', async () => {
    const onPosted = vi.fn();
    render(<IssueCommentComposer issueId="i1" buildingId="b1" issueTitle="Leak" reporterId="r1" assigneeId={null} onPosted={onPosted} />);
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'ping @tha', selectionStart: 9 } });
    fireEvent.click(await screen.findByText('Thabo M'));
    fireEvent.click(screen.getByRole('button', { name: /post/i }));
    await waitFor(() => expect(onPosted).toHaveBeenCalled());
    // The composer trims before writing, so the space insertMention leaves after the name is gone.
    expect(inserted.rows[0]).toMatchObject({ issue_id: 'i1', activity_type: 'comment', comment: 'ping @Thabo M', mentions: ['u1'], user_id: 'me', author_name: 'Me' });
    // reporterId 'r1' is neither the author nor mentioned, so it gets an issue_comment notification;
    // the mentioned member 'u1' gets an issue_mention notification instead.
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'issue_comment', recipients: ['r1'] }));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'issue_mention', recipients: ['u1'] }));
  });

  it('disables Post while empty', () => {
    render(<IssueCommentComposer issueId="i1" buildingId="b1" issueTitle="Leak" reporterId="r1" assigneeId={null} onPosted={() => {}} />);
    expect(screen.getByRole('button', { name: /post/i })).toBeDisabled();
  });

  it('drops a mention that was picked but then edited out of the text', async () => {
    const onPosted = vi.fn();
    render(<IssueCommentComposer issueId="i1" buildingId="b1" issueTitle="Leak" reporterId="r1" assigneeId={null} onPosted={onPosted} />);
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'ping @tha', selectionStart: 9 } });
    fireEvent.click(await screen.findByText('Thabo M'));
    // Now edit the text to remove the mention entirely.
    fireEvent.change(box, { target: { value: 'never mind', selectionStart: 10 } });
    fireEvent.click(screen.getByRole('button', { name: /post/i }));
    await waitFor(() => expect(onPosted).toHaveBeenCalled());
    expect(inserted.rows[0]).toMatchObject({ comment: 'never mind', mentions: [] });
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'issue_mention' }));
  });

  it('picks a mention via the keyboard (ArrowDown then Enter)', async () => {
    const onPosted = vi.fn();
    render(<IssueCommentComposer issueId="i1" buildingId="b1" issueTitle="Leak" reporterId="r1" assigneeId={null} onPosted={onPosted} />);
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '@tha', selectionStart: 4 } });
    await screen.findByText('Thabo M');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('@Thabo M ');
    fireEvent.click(screen.getByRole('button', { name: /post/i }));
    await waitFor(() => expect(onPosted).toHaveBeenCalled());
    expect(inserted.rows[0]).toMatchObject({ comment: '@Thabo M', mentions: ['u1'] });
  });
});
