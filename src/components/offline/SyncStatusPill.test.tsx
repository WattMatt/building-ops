import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { QueuedOp } from '@/lib/offline/types';
import { SyncStatusPill } from './SyncStatusPill';

const queue = vi.hoisted(() => ({
  ops: [] as QueuedOp[],
  pending: 0,
  failed: 0,
  retry: vi.fn(),
  discard: vi.fn(),
  retryAll: vi.fn(),
}));
const status = vi.hoisted(() => ({ online: true }));
const track = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useOfflineQueue', () => ({ useOfflineQueue: () => queue }));
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => status.online }));
vi.mock('@/lib/analytics', () => ({ track }));

let seq = 0;
const op = (over: Partial<QueuedOp> = {}): QueuedOp => ({
  id: `op-${++seq}`,
  uid: 'u1',
  createdAt: Date.now() - 60_000,
  attempts: 0,
  status: 'pending',
  lastError: null,
  payload: {
    kind: 'task_complete',
    completionId: 'c1',
    taskInstanceId: 't1',
    taskName: 'Check fire doors',
    notes: null,
    signatureConfirmed: false,
  },
  photos: [],
  ...over,
});

function setQueue(ops: QueuedOp[]) {
  queue.ops = ops;
  queue.pending = ops.filter((o) => o.status === 'pending').length;
  queue.failed = ops.length - queue.pending;
}

beforeEach(() => {
  vi.clearAllMocks();
  status.online = true;
  setQueue([]);
  queue.retry.mockResolvedValue({ status: 'synced', result: null });
  queue.discard.mockResolvedValue(undefined);
});

describe('SyncStatusPill', () => {
  it('renders nothing when the queue is empty', () => {
    const { container } = render(<SyncStatusPill />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the queued count while offline', () => {
    status.online = false;
    setQueue([op(), op()]);
    render(<SyncStatusPill />);
    expect(screen.getByRole('button', { name: /Offline · 2 queued/ })).toBeInTheDocument();
  });

  it('shows Syncing while online with pending ops', () => {
    setQueue([op()]);
    render(<SyncStatusPill />);
    expect(screen.getByRole('button', { name: /Syncing…/ })).toBeInTheDocument();
  });

  it('shows the failed count when ops need attention', () => {
    setQueue([op(), op({ status: 'failed', lastError: 'Not allowed' })]);
    render(<SyncStatusPill />);
    expect(screen.getByRole('button', { name: /1 need attention/ })).toBeInTheDocument();
  });

  it('opens the queue sheet, tracks it, and lists ops oldest-first with titles and photo counts', async () => {
    setQueue([
      op({
        createdAt: Date.now() - 10_000,
        payload: {
          kind: 'issue_create',
          issueId: 'i1',
          row: {
            title: 'Leaking tap', description: '', priority: 'medium', status: 'open',
            building_id: 'b1', deadline: null, corrective_action: null,
            reported_by: 'u1', assigned_to: null, task_instance_id: null,
          },
          markTaskIssueLogged: null,
        },
        photos: [{ file: new File(['x'], 'a.jpg') }, { file: new File(['y'], 'b.jpg') }],
      }),
      op({ createdAt: Date.now() - 120_000 }),
    ]);
    render(<SyncStatusPill />);
    fireEvent.click(screen.getByRole('button', { name: /Syncing…/ }));

    expect(track).toHaveBeenCalledWith('offline_queue_opened', { pending: 2, failed: 0 });
    const dialog = await screen.findByRole('dialog');
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Complete task');
    expect(rows[0]).toHaveTextContent('Check fire doors');
    expect(rows[1]).toHaveTextContent('New issue');
    expect(rows[1]).toHaveTextContent('Leaking tap');
    expect(rows[1]).toHaveTextContent('2 photos');
    expect(within(dialog).getByText('Signing out discards changes that have not synced.')).toBeInTheDocument();
  });

  it('shows the error for a failed op and wires Retry / Discard', async () => {
    const failed = op({ id: 'bad', status: 'failed', lastError: 'Task already closed' });
    setQueue([failed]);
    render(<SyncStatusPill />);
    fireEvent.click(screen.getByRole('button', { name: /1 need attention/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Task already closed')).toBeInTheDocument();
    expect(within(dialog).getByText('Failed')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(queue.retry).toHaveBeenCalledWith('bad');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(queue.discard).toHaveBeenCalledWith('bad');
  });

  it('does not offer Retry / Discard for pending ops', async () => {
    setQueue([op()]);
    render(<SyncStatusPill />);
    fireEvent.click(screen.getByRole('button', { name: /Syncing…/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Discard' })).toBeNull();
  });
});
