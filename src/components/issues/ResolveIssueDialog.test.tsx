import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { mockViewport } from '@/test/mobile';

const enqueueAndRun = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/offline/enqueueAndRun', () => ({ enqueueAndRun }));
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

const submit = async (note = '  Replaced the breaker.  ') => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: note } });
  fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
  await waitFor(() => expect(enqueueAndRun).toHaveBeenCalledTimes(1));
};

describe('ResolveIssueDialog', () => {
  beforeEach(() => {
    enqueueAndRun.mockReset().mockResolvedValue({ status: 'synced', result: {} });
    toast.mockClear(); toast.success.mockClear(); toast.error.mockClear();
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
    enqueueAndRun.mockResolvedValueOnce({ status: 'queued' });
    const { onOpenChange, onResolved } = renderDialog();
    await submit();
    expect(toast).toHaveBeenCalledWith("Saved on this device — it will resolve when you're back online");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it('stays open and shows the message when the status flip is refused', async () => {
    const denied = 'Your note was saved, but you do not have permission to resolve this issue.';
    enqueueAndRun.mockResolvedValueOnce({ status: 'failed', error: denied });
    const { onOpenChange, onResolved } = renderDialog();
    await submit();
    expect(toast.error).toHaveBeenCalledWith(denied);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onResolved).not.toHaveBeenCalled();
  });
});
