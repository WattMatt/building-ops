import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const enqueueAndRun = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/offline/enqueueAndRun', () => ({ enqueueAndRun }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/hooks/useBuildingMembers', () => ({
  useBuildingMembers: () => ({ data: [{ id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' }], byId: new Map([['u1', { id: 'u1', full_name: 'Thabo M', avatar_url: null, role: 'user' }]]) }),
  memberDisplayName: (m: { full_name: string | null }) => m.full_name ?? 'Unnamed user',
}));
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import { IssueCommentComposer } from './IssueCommentComposer';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('IssueCommentComposer', () => {
  beforeEach(() => {
    enqueueAndRun.mockReset().mockResolvedValue({ status: 'synced', result: {} });
    toast.mockClear(); toast.success.mockClear(); toast.error.mockClear();
  });

  it('queues an issue_comment op with the chosen mention and the people to notify', async () => {
    const onPosted = vi.fn();
    render(<IssueCommentComposer issueId="i1" buildingId="b1" issueTitle="Leak" reporterId="r1" assigneeId={null} onPosted={onPosted} />);
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'ping @tha', selectionStart: 9 } });
    fireEvent.click(await screen.findByText('Thabo M'));
    fireEvent.click(screen.getByRole('button', { name: /post/i }));
    await waitFor(() => expect(onPosted).toHaveBeenCalled());
    const [uid, payload, photos] = enqueueAndRun.mock.calls[0];
    expect(uid).toBe('me');
    // The composer trims before writing, so the space insertMention leaves after the name is gone.
    // The handler is the one that drops the author and the mentioned from notifyOthers, so the
    // reporter goes through as-is and the mention travels separately.
    expect(payload).toMatchObject({
      kind: 'issue_comment', issueId: 'i1', buildingId: 'b1', issueTitle: 'Leak',
      comment: 'ping @Thabo M', mentions: ['u1'], notifyOthers: ['r1'], userEmail: null,
    });
    expect(payload.activityId).toMatch(UUID);
    expect(photos).toEqual([]);
    expect(box.value).toBe('');
    expect(toast.success).not.toHaveBeenCalled();
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
    expect(enqueueAndRun.mock.calls[0][1]).toMatchObject({ issueId: 'i1', comment: 'never mind', mentions: [] });
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
    expect(enqueueAndRun.mock.calls[0][1]).toMatchObject({ issueId: 'i1', comment: '@Thabo M', mentions: ['u1'] });
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

  it('clears the box with the queued guardrail toast when the comment is held on the device', async () => {
    enqueueAndRun.mockResolvedValueOnce({ status: 'queued' });
    const onPosted = vi.fn();
    render(<IssueCommentComposer issueId="i1" buildingId="b1" issueTitle="Leak" reporterId="r1" assigneeId={null} onPosted={onPosted} />);
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Still leaking', selectionStart: 13 } });
    fireEvent.click(screen.getByRole('button', { name: /post/i }));
    await waitFor(() => expect(onPosted).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith("Comment saved on this device — it will post when you're back online");
    expect(box.value).toBe('');
  });

  it('keeps the text and shows the error when the comment is rejected', async () => {
    enqueueAndRun.mockResolvedValueOnce({ status: 'failed', error: 'The comment was not saved.' });
    const onPosted = vi.fn();
    render(<IssueCommentComposer issueId="i1" buildingId="b1" issueTitle="Leak" reporterId="r1" assigneeId={null} onPosted={onPosted} />);
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Still leaking', selectionStart: 13 } });
    fireEvent.click(screen.getByRole('button', { name: /post/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The comment was not saved.'));
    expect(onPosted).not.toHaveBeenCalled();
    expect(box.value).toBe('Still leaking');
  });
});
