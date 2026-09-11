import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { mockViewport } from '@/test/mobile';

const enqueueAndRun = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/offline/enqueueAndRun', () => ({ enqueueAndRun }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isAdminOrManager: true }) }));
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import CompleteTaskDialog from './CompleteTaskDialog';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const renderDialog = () => {
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  render(
    <CompleteTaskDialog
      open
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
      taskId="t1"
      taskName="Check fire extinguishers"
      requiresPhoto={false}
      requiresSignature={false}
    />,
  );
  return { onOpenChange, onSuccess };
};

const submit = async () => {
  fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: '  All present  ' } });
  fireEvent.click(screen.getByRole('button', { name: /complete task/i }));
  await waitFor(() => expect(enqueueAndRun).toHaveBeenCalledTimes(1));
};

describe('CompleteTaskDialog', () => {
  beforeEach(() => {
    enqueueAndRun.mockReset().mockResolvedValue({ status: 'synced', result: {} });
    toast.mockClear(); toast.success.mockClear(); toast.error.mockClear(); toast.info.mockClear();
  });
  afterEach(() => mockViewport(1024));

  it('opens as a bottom sheet on a phone with its title and primary button', async () => {
    mockViewport(375);
    renderDialog();
    expect(await screen.findByRole('heading', { name: /complete task/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /complete task/i })).toBeInTheDocument();
    expect(document.querySelector('[data-vaul-drawer]')).not.toBeNull();
  });

  it('completes through the queue with a client-generated completion id', async () => {
    const { onOpenChange, onSuccess } = renderDialog();
    await submit();
    const [uid, payload, photos] = enqueueAndRun.mock.calls[0];
    expect(uid).toBe('u1');
    expect(payload).toMatchObject({
      kind: 'task_complete', taskInstanceId: 't1', taskName: 'Check fire extinguishers', notes: 'All present', signatureConfirmed: false,
    });
    expect(payload.completionId).toMatch(UUID);
    expect(photos).toEqual([]);
    expect(toast.success).toHaveBeenCalledWith('Task completed successfully');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalled();
  });

  it('says so when the server reports the task was already completed', async () => {
    enqueueAndRun.mockResolvedValueOnce({ status: 'synced', result: { completion_id: 'c1', already_completed: true } });
    const { onSuccess } = renderDialog();
    await submit();
    expect(toast.info).toHaveBeenCalledWith('This task was already completed by someone else — your notes were not saved.');
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
  });

  it('closes with the queued guardrail toast when the write is held on the device', async () => {
    enqueueAndRun.mockResolvedValueOnce({ status: 'queued' });
    const { onOpenChange, onSuccess } = renderDialog();
    await submit();
    expect(toast).toHaveBeenCalledWith("Task saved on this device — it will complete when you're back online");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalled();
  });

  it('stays open and shows the server message when the write is rejected', async () => {
    enqueueAndRun.mockResolvedValueOnce({ status: 'failed', error: 'Task status was not updated — your role does not permit it.' });
    const { onOpenChange, onSuccess } = renderDialog();
    await submit();
    expect(toast.error).toHaveBeenCalledWith('Task status was not updated — your role does not permit it.');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
