import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const inserted = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
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
vi.mock('@/lib/notify', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import { IssueCommentComposer } from './IssueCommentComposer';

describe('IssueCommentComposer', () => {
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
  });

  it('disables Post while empty', () => {
    render(<IssueCommentComposer issueId="i1" buildingId="b1" issueTitle="Leak" reporterId="r1" assigneeId={null} onPosted={() => {}} />);
    expect(screen.getByRole('button', { name: /post/i })).toBeDisabled();
  });
});
