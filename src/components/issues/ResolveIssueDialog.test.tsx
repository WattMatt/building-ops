import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { mockViewport } from '@/test/mobile';

const enqueueAndRun = vi.hoisted(() => vi.fn());
const removeOp = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/offline/enqueueAndRun', () => ({ enqueueAndRun }));
vi.mock('@/lib/offline/queue', () => ({ removeOp }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'me@example.com' } }) }));
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import { ResolveIssueDialog } from './ResolveIssueDialog';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const renderDialog = (props: Partial<React.ComponentProps<typeof ResolveIssueDialog>> = {}) => {
  const onOpenChange = vi.fn();
  const onResolved = vi.fn();
  render(<ResolveIssueDialog issueId="i1" open onOpenChange={onOpenChange} onResolved={onResolved} {...props} />);
  return { onOpenChange, onResolved };
};

const noteBox = () => screen.getByRole('textbox', { name: /what was done/i });

const submit = async (note = '  Replaced the breaker.  ') => {
  fireEvent.change(noteBox(), { target: { value: note } });
  fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
  await waitFor(() => expect(enqueueAndRun).toHaveBeenCalledTimes(1));
};

describe('ResolveIssueDialog', () => {
  beforeEach(() => {
    enqueueAndRun.mockReset().mockResolvedValue({ status: 'synced', result: {}, opId: 'op-1' });
    removeOp.mockReset().mockResolvedValue(undefined);
    toast.mockClear(); toast.success.mockClear(); toast.error.mockClear(); toast.info.mockClear();
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
    fireEvent.change(noteBox(), { target: { value: '   ' } });
    expect(button).toBeDisabled();
    fireEvent.change(noteBox(), { target: { value: 'Replaced the breaker.' } });
    expect(button).toBeEnabled();
  });

  it('queues an issue_resolve op with the trimmed note and a client-generated activity id', async () => {
    const { onOpenChange, onResolved } = renderDialog();
    await submit();
    const [uid, payload, photos] = enqueueAndRun.mock.calls[0];
    expect(uid).toBe('me');
    expect(payload).toMatchObject({ kind: 'issue_resolve', issueId: 'i1', note: 'Replaced the breaker.', userEmail: 'me@example.com' });
    expect(payload.activityId).toMatch(UUID);
    expect(photos).toEqual([]);
    expect(toast.success).toHaveBeenCalledWith('Issue resolved');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it('closes with the queued guardrail toast when the write is held on the device', async () => {
    enqueueAndRun.mockResolvedValueOnce({ status: 'queued', opId: 'op-1' });
    const { onOpenChange, onResolved } = renderDialog();
    await submit();
    expect(toast).toHaveBeenCalledWith("Saved on this device — it will resolve when you're back online");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it('stays open and keeps the op queued when the write is rejected for a retryable reason', async () => {
    enqueueAndRun.mockResolvedValueOnce({ status: 'failed', error: 'Issue not found', opId: 'op-1' });
    const { onOpenChange, onResolved } = renderDialog();
    await submit();
    expect(toast.error).toHaveBeenCalledWith('Issue not found');
    expect(removeOp).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onResolved).not.toHaveBeenCalled();
  });

  describe('contractor rating', () => {
    const stars = () => screen.getAllByRole('button', { name: /^\d stars? — / });

    it('is absent when the issue has no contractor, and the payload carries no rating', async () => {
      renderDialog();
      expect(screen.queryByText(/how did the contractor do/i)).toBeNull();
      await submit();
      expect(enqueueAndRun.mock.calls[0][1]).not.toHaveProperty('rating');
    });

    it('shows five 44px toggle stars that are real buttons (keyboard operable) with aria-pressed', () => {
      renderDialog({ contractorId: 'con1' });
      expect(screen.getByText(/how did the contractor do/i)).toBeInTheDocument();
      const buttons = stars();
      expect(buttons).toHaveLength(5);
      for (const b of buttons) {
        expect(b.tagName).toBe('BUTTON');
        expect(b).toHaveAttribute('type', 'button');
        expect(b).toHaveAttribute('aria-pressed', 'false');
        expect(b.className).toMatch(/\bh-11\b/);
        expect(b.className).toMatch(/\bw-11\b/);
      }
      buttons[3].focus();
      expect(document.activeElement).toBe(buttons[3]);
      fireEvent.click(buttons[3]);
      expect(buttons[3]).toHaveAttribute('aria-pressed', 'true');
      expect(buttons[2]).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Very good')).toBeInTheDocument();
      // Tapping the lit star again clears the rating.
      fireEvent.click(buttons[3]);
      expect(buttons[3]).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Not rated')).toBeInTheDocument();
    });

    it('lands the chosen star and trimmed comment in the issue_resolve payload', async () => {
      renderDialog({ contractorId: 'con1' });
      fireEvent.click(stars()[3]);
      fireEvent.change(screen.getByLabelText(/comment about the contractor/i), { target: { value: '  Tidy work.  ' } });
      await submit();
      expect(enqueueAndRun.mock.calls[0][1]).toMatchObject({
        kind: 'issue_resolve', issueId: 'i1', rating: { contractorId: 'con1', rating: 4, comment: 'Tidy work.' },
      });
    });

    it('sends no rating when no star was chosen', async () => {
      renderDialog({ contractorId: 'con1' });
      await submit();
      expect(enqueueAndRun.mock.calls[0][1]).not.toHaveProperty('rating');
    });

    it('sends a null comment when a star was chosen but the comment box is empty', async () => {
      renderDialog({ contractorId: 'con1' });
      fireEvent.click(stars()[0]);
      await submit();
      expect(enqueueAndRun.mock.calls[0][1].rating).toEqual({ contractorId: 'con1', rating: 1, comment: null });
    });

    it('clears the stars and comment when the contractor changes', () => {
      const { rerender } = render(<ResolveIssueDialog issueId="i1" open onOpenChange={() => {}} onResolved={() => {}} contractorId="con1" />);
      fireEvent.click(stars()[2]);
      fireEvent.change(screen.getByLabelText(/comment about the contractor/i), { target: { value: 'Fine' } });
      expect(screen.getByText('Good')).toBeInTheDocument();

      rerender(<ResolveIssueDialog issueId="i1" open onOpenChange={() => {}} onResolved={() => {}} contractorId="con2" />);
      expect(screen.getByText('Not rated')).toBeInTheDocument();
      for (const b of stars()) expect(b).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByLabelText(/comment about the contractor/i)).toHaveValue('');
    });

    it('clears the stars and comment when the dialog is closed and reopened', () => {
      const { rerender } = render(<ResolveIssueDialog issueId="i1" open onOpenChange={() => {}} onResolved={() => {}} contractorId="con1" />);
      fireEvent.click(stars()[4]);
      fireEvent.change(screen.getByLabelText(/comment about the contractor/i), { target: { value: 'Great' } });
      expect(screen.getByText('Excellent')).toBeInTheDocument();

      rerender(<ResolveIssueDialog issueId="i1" open={false} onOpenChange={() => {}} onResolved={() => {}} contractorId="con1" />);
      rerender(<ResolveIssueDialog issueId="i1" open onOpenChange={() => {}} onResolved={() => {}} contractorId="con1" />);
      expect(screen.getByText('Not rated')).toBeInTheDocument();
      expect(screen.getByLabelText(/comment about the contractor/i)).toHaveValue('');
    });

    it('says the earlier rating was kept when the handler reports a duplicate, and still closes as resolved', async () => {
      enqueueAndRun.mockResolvedValueOnce({ status: 'synced', result: { issueId: 'i1', rating: 'duplicate' }, opId: 'op-1' });
      const { onOpenChange, onResolved } = renderDialog({ contractorId: 'con1' });
      fireEvent.click(stars()[1]);
      await submit();
      expect(toast.success).toHaveBeenCalledWith('Issue resolved');
      expect(toast.info).toHaveBeenCalledWith('This contractor was already rated on this issue. The earlier rating was kept.');
      expect(toast.error).not.toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onResolved).toHaveBeenCalledTimes(1);
    });

    it('still closes as resolved, but says so, when the handler could not save the rating', async () => {
      enqueueAndRun.mockResolvedValueOnce({ status: 'synced', result: { issueId: 'i1', rating: 'failed' }, opId: 'op-1' });
      const { onOpenChange, onResolved } = renderDialog({ contractorId: 'con1' });
      fireEvent.click(stars()[4]);
      await submit();
      expect(toast.success).toHaveBeenCalledWith('Issue resolved');
      expect(toast.error).toHaveBeenCalledWith('The issue is resolved, but the contractor rating could not be saved.');
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onResolved).toHaveBeenCalledTimes(1);
    });
  });

  it('treats a refused status flip as terminal: the note is saved, so it discards the op, closes and refreshes', async () => {
    const denied = 'Your note was saved, but you do not have permission to resolve this issue.';
    enqueueAndRun.mockResolvedValueOnce({ status: 'failed', error: denied, code: 'RESOLVE_DENIED', opId: 'op-7' });
    const { onOpenChange, onResolved } = renderDialog();
    await submit();
    await waitFor(() => expect(removeOp).toHaveBeenCalledWith('me', 'op-7'));
    expect(toast.error).toHaveBeenCalledWith(denied);
    expect(toast.success).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });
});
