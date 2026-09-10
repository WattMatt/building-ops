import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const posted = vi.hoisted(() => ({ inputs: [] as Record<string, unknown>[] }));
const notify = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/issueActivity', () => ({
  postIssueComment: async (input: Record<string, unknown>) => { posted.inputs.push(input); return { id: 'a1', authorName: 'Me' }; },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/hooks/useBuildingMembers', () => ({
  useBuildingMembers: () => ({ data: [{ id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' }], byId: new Map([['u1', { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' }]]) }),
  memberDisplayName: (m: { full_name: string | null }) => m.full_name ?? 'Unnamed user',
}));
vi.mock('@/lib/photos', () => ({ uploadPhotos: vi.fn().mockResolvedValue([]), photoPrefix: (u: string) => `photos/${u}` }));
vi.mock('@/lib/notify', () => ({ notify }));
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import { IssueCommentComposer } from './IssueCommentComposer';

describe('IssueCommentComposer', () => {
  beforeEach(() => {
    posted.inputs = [];
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
    expect(posted.inputs[0]).toMatchObject({ issueId: 'i1', comment: 'ping @Thabo M', mentions: ['u1'], userId: 'me' });
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
    expect(posted.inputs[0]).toMatchObject({ issueId: 'i1', comment: 'never mind', mentions: [], userId: 'me' });
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
    expect(posted.inputs[0]).toMatchObject({ issueId: 'i1', comment: '@Thabo M', mentions: ['u1'], userId: 'me' });
  });

  it('closes the picker on Escape and does not reopen it on the matching keyup', async () => {
    const onPosted = vi.fn();
    render(<IssueCommentComposer issueId="i1" buildingId="b1" issueTitle="Leak" reporterId="r1" assigneeId={null} onPosted={onPosted} />);
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'ping @tha', selectionStart: 9 } });
    await screen.findByRole('listbox');
    fireEvent.keyDown(box, { key: 'Escape' });
    fireEvent.keyUp(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
