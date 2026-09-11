import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { mockViewport } from '@/test/mobile';

const enqueueAndRun = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/offline/enqueueAndRun', () => ({ enqueueAndRun }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isAdminOrManager: true }) }));
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import ReportIssueDialog from './ReportIssueDialog';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const renderDialog = () => {
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  render(
    <ReportIssueDialog
      open
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
      taskId="t1"
      taskName="Check fire extinguishers"
      buildingId="b1"
      buildingName="North Tower"
    />,
  );
  return { onOpenChange, onSuccess };
};

const submit = async () => {
  fireEvent.change(screen.getByLabelText(/issue title/i), { target: { value: ' Extinguisher missing ' } });
  fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Bracket on level 2 is empty.' } });
  fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
  await waitFor(() => expect(enqueueAndRun).toHaveBeenCalledTimes(1));
};

describe('ReportIssueDialog', () => {
  beforeEach(() => {
    enqueueAndRun.mockReset().mockResolvedValue({ status: 'synced', result: {} });
    toast.mockClear(); toast.success.mockClear(); toast.error.mockClear(); toast.info.mockClear();
  });
  afterEach(() => mockViewport(1024));

  it('opens as a bottom sheet on a phone with its title and primary button', async () => {
    mockViewport(375);
    renderDialog();
    expect(await screen.findByRole('heading', { name: /report issue/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /report issue/i })).toBeInTheDocument();
    expect(document.querySelector('[data-vaul-drawer]')).not.toBeNull();
  });

  it('queues an issue_create op tied to the task, with a client-generated issue id', async () => {
    const { onOpenChange, onSuccess } = renderDialog();
    await submit();
    const [uid, payload, photos] = enqueueAndRun.mock.calls[0];
    expect(uid).toBe('u1');
    expect(payload).toMatchObject({
      kind: 'issue_create',
      row: {
        title: 'Extinguisher missing', description: 'Bracket on level 2 is empty.', priority: 'medium', status: 'open',
        building_id: 'b1', task_instance_id: 't1', reported_by: 'u1', assigned_to: null, deadline: null, corrective_action: null,
      },
      markTaskIssueLogged: 't1',
    });
    expect(payload.issueId).toMatch(UUID);
    expect(photos).toEqual([]);
    expect(toast.success).toHaveBeenCalledWith('Issue reported successfully');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalled();
  });

  it('closes with the queued guardrail toast when the write is held on the device', async () => {
    enqueueAndRun.mockResolvedValueOnce({ status: 'queued' });
    const { onOpenChange, onSuccess } = renderDialog();
    await submit();
    expect(toast).toHaveBeenCalledWith("Issue saved on this device — it will be reported when you're back online");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalled();
  });

  it('stays open and shows the server message when the write is rejected', async () => {
    enqueueAndRun.mockResolvedValueOnce({ status: 'failed', error: 'new row violates row-level security policy' });
    const { onOpenChange, onSuccess } = renderDialog();
    await submit();
    expect(toast.error).toHaveBeenCalledWith('new row violates row-level security policy');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
