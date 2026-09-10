import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const enqueueAndRun = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/offline/enqueueAndRun', () => ({ enqueueAndRun }));
vi.mock('sonner', () => ({ toast }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
const auth = vi.hoisted(() => ({ value: { user: { id: 'u1' }, isAdminOrManager: false } as { user: { id: string }; isAdminOrManager: boolean } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.value }));
vi.mock('@/hooks/useBuildings', () => ({
  useBuildings: () => ({ buildings: [{ id: 'b1', name: 'North Tower' }], loading: false }),
}));
vi.mock('@/components/ui/photo-capture', () => ({ PhotoCapture: () => null }));

import NewIssue from './NewIssue';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const submit = async () => {
  fireEvent.change(screen.getByLabelText(/issue title/i), { target: { value: ' Lift out of service ' } });
  fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Lift 2 stuck on ground floor.' } });
  fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
  await waitFor(() => expect(enqueueAndRun).toHaveBeenCalledTimes(1));
};

describe('NewIssue', () => {
  beforeEach(() => {
    enqueueAndRun.mockReset().mockResolvedValue({ status: 'synced', result: {} });
    navigate.mockClear();
    auth.value = { user: { id: 'u1' }, isAdminOrManager: false };
    toast.mockClear(); toast.success.mockClear(); toast.error.mockClear();
  });

  it('queues an issue_create op with a client-generated issue id and goes to the list', async () => {
    render(<MemoryRouter><NewIssue /></MemoryRouter>);
    await submit();
    const [uid, payload, photos] = enqueueAndRun.mock.calls[0];
    expect(uid).toBe('u1');
    expect(payload).toMatchObject({
      kind: 'issue_create',
      row: {
        title: 'Lift out of service', description: 'Lift 2 stuck on ground floor.', priority: 'medium', status: 'open',
        building_id: 'b1', deadline: null, corrective_action: null, reported_by: 'u1', assigned_to: null, task_instance_id: null,
      },
      markTaskIssueLogged: null,
    });
    expect(payload.issueId).toMatch(UUID);
    expect(photos).toEqual([]);
    expect(toast.success).toHaveBeenCalledWith('Issue reported successfully');
    expect(navigate).toHaveBeenCalledWith('/issues');
  });

  describe('estimated cost', () => {
    it('is not offered to a plain user and is omitted from the row', async () => {
      render(<MemoryRouter><NewIssue /></MemoryRouter>);
      expect(screen.queryByLabelText(/estimated cost/i)).toBeNull();
      await submit();
      const [, payload] = enqueueAndRun.mock.calls[0];
      expect('estimated_cost' in payload.row).toBe(false);
    });

    it('is written as estimated_cost for a manager, and null when left blank', async () => {
      auth.value = { user: { id: 'u1' }, isAdminOrManager: true };
      const { unmount } = render(<MemoryRouter><NewIssue /></MemoryRouter>);
      fireEvent.change(screen.getByLabelText(/estimated cost/i), { target: { value: '1500.50' } });
      await submit();
      expect(enqueueAndRun.mock.calls[0][1].row.estimated_cost).toBe(1500.5);
      unmount();

      enqueueAndRun.mockReset().mockResolvedValue({ status: 'synced', result: {} });
      render(<MemoryRouter><NewIssue /></MemoryRouter>);
      await submit();
      expect(enqueueAndRun.mock.calls[0][1].row).toHaveProperty('estimated_cost', null);
    });

    it('rejects a negative estimate before anything is queued', async () => {
      auth.value = { user: { id: 'u1' }, isAdminOrManager: true };
      render(<MemoryRouter><NewIssue /></MemoryRouter>);
      fireEvent.change(screen.getByLabelText(/issue title/i), { target: { value: 'Broken door' } });
      fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'Hinge snapped.' } });
      const cost = screen.getByLabelText(/estimated cost/i) as HTMLInputElement;
      fireEvent.change(cost, { target: { value: '-5' } });
      fireEvent.click(screen.getByRole('button', { name: /report issue/i }));
      // min={0} makes the browser refuse the submit (jsdom runs the same constraint validation);
      // parseCost in handleSubmit is the backstop for anything that slips past it.
      expect(cost.validity.rangeUnderflow).toBe(true);
      await new Promise((r) => setTimeout(r, 0));
      expect(enqueueAndRun).not.toHaveBeenCalled();
    });
  });

  it('still goes to the list when the issue is queued, and stays put when it is rejected', async () => {
    enqueueAndRun.mockResolvedValueOnce({ status: 'queued' });
    const { unmount } = render(<MemoryRouter><NewIssue /></MemoryRouter>);
    await submit();
    expect(toast).toHaveBeenCalledWith("Issue saved on this device — it will be reported when you're back online");
    expect(navigate).toHaveBeenCalledWith('/issues');
    unmount();

    enqueueAndRun.mockReset().mockResolvedValueOnce({ status: 'failed', error: 'new row violates row-level security policy' });
    navigate.mockClear();
    render(<MemoryRouter><NewIssue /></MemoryRouter>);
    await submit();
    expect(toast.error).toHaveBeenCalledWith('new row violates row-level security policy');
    expect(navigate).not.toHaveBeenCalled();
  });
});
