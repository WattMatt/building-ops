import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { mockViewport } from '@/test/mobile';

const state = vi.hoisted(() => ({
  calls: [] as string[],
  commentInputs: [] as Record<string, unknown>[],
  updateRows: [{ id: 'i1' }] as { id: string }[],
}));

vi.mock('@/lib/issueActivity', () => ({
  postIssueComment: vi.fn(async (input: Record<string, unknown>) => {
    state.calls.push('postIssueComment');
    state.commentInputs.push(input);
    return { id: 'a1', authorName: 'Me' };
  }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => {
            state.calls.push('issues.update');
            return Promise.resolve({ data: state.updateRows, error: null });
          },
        }),
      }),
    }),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'me@example.com' } }) }));
vi.mock('@/lib/photos', () => ({ uploadPhotos: vi.fn().mockResolvedValue([]), photoPrefix: (u: string) => `photos/${u}` }));
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import { ResolveIssueDialog } from './ResolveIssueDialog';

const renderDialog = (props: Partial<React.ComponentProps<typeof ResolveIssueDialog>> = {}) => {
  const onOpenChange = vi.fn();
  const onResolved = vi.fn();
  render(<ResolveIssueDialog issueId="i1" open onOpenChange={onOpenChange} onResolved={onResolved} {...props} />);
  return { onOpenChange, onResolved };
};

describe('ResolveIssueDialog', () => {
  beforeEach(() => {
    state.calls = [];
    state.commentInputs = [];
    state.updateRows = [{ id: 'i1' }];
  });
  afterEach(() => mockViewport(1024));

  it('opens as a bottom sheet on a phone with the Resolve button present', async () => {
    mockViewport(375);
    renderDialog();
    expect(await screen.findByRole('button', { name: /resolve/i })).toBeInTheDocument();
    expect(document.querySelector('[data-vaul-drawer]')).not.toBeNull();
  });

  it('keeps Resolve disabled while the note is only whitespace', () => {
    renderDialog();
    const button = screen.getByRole('button', { name: /resolve/i });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Replaced the breaker.' } });
    expect(button).toBeEnabled();
  });

  it('saves the note before flipping the status', async () => {
    const { onResolved } = renderDialog();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Replaced the breaker.  ' } });
    fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(state.calls).toEqual(['postIssueComment', 'issues.update']);
    expect(state.commentInputs[0]).toMatchObject({ issueId: 'i1', userId: 'me', comment: 'Replaced the breaker.' });
  });

  it('closes and refreshes without throwing when the status update is denied', async () => {
    state.updateRows = [];
    const { onOpenChange, onResolved } = renderDialog();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Replaced the breaker.' } });
    fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // The note still landed, so the comment insert must have run.
    expect(state.calls).toEqual(['postIssueComment', 'issues.update']);
  });
});
