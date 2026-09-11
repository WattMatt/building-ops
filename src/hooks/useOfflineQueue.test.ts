import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('@/lib/offline/replay', () => ({
  retryOp: vi.fn().mockResolvedValue({ status: 'synced', result: {} }),
  replayAll: vi.fn().mockResolvedValue(undefined),
}));

import { retryOp, replayAll } from '@/lib/offline/replay';
import { enqueue, listOps, updateOp, clearQueue } from '@/lib/offline/queue';
import { useOfflineQueue, OFFLINE_QUEUE_KEY } from './useOfflineQueue';
import type { TaskCompletePayload } from '@/lib/offline/types';

const UID = 'u1';
const payload = (completionId = 'c1'): TaskCompletePayload => ({
  kind: 'task_complete', completionId, taskInstanceId: 't1', taskName: 'Check extinguishers', notes: null, signatureConfirmed: false,
});

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearQueue(UID);
});
afterEach(() => {
  onlineManager.setOnline(true);
});

describe('useOfflineQueue', () => {
  it('starts empty and counts a queued op as pending', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOfflineQueue(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(client.getQueryState([OFFLINE_QUEUE_KEY, UID])?.status).toBe('success'));
    expect(result.current.ops).toEqual([]);
    expect(result.current.pending).toBe(0);
    expect(result.current.failed).toBe(0);

    await act(async () => { await enqueue(UID, payload(), []); });
    await waitFor(() => expect(result.current.pending).toBe(1));
    expect(result.current.ops).toHaveLength(1);
    expect(result.current.failed).toBe(0);
  });

  it('follows store mutations through the subscription: a failed op moves from pending to failed', async () => {
    const op = await enqueue(UID, payload(), []);
    const client = makeClient();
    const { result } = renderHook(() => useOfflineQueue(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.pending).toBe(1));

    await act(async () => { await updateOp(UID, op.id, { status: 'failed', lastError: 'permission denied' }); });
    await waitFor(() => expect(result.current.failed).toBe(1));
    expect(result.current.pending).toBe(0);
    expect(result.current.ops[0].lastError).toBe('permission denied');
  });

  it('discard removes the op from the store and the hook', async () => {
    const op = await enqueue(UID, payload(), []);
    const client = makeClient();
    const { result } = renderHook(() => useOfflineQueue(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.ops).toHaveLength(1));

    await act(async () => { await result.current.discard(op.id); });
    await waitFor(() => expect(result.current.ops).toHaveLength(0));
    expect(await listOps(UID)).toEqual([]);
  });

  it('retry hands the op to retryOp for this user', async () => {
    const op = await enqueue(UID, payload(), []);
    const client = makeClient();
    const { result } = renderHook(() => useOfflineQueue(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.ops).toHaveLength(1));

    let outcome: unknown;
    await act(async () => { outcome = await result.current.retry(op.id); });
    expect(retryOp).toHaveBeenCalledWith(UID, op.id);
    expect(outcome).toEqual({ status: 'synced', result: {} });
  });

  it('retryAll replays everything for this user including failed ops', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOfflineQueue(), { wrapper: wrapperFor(client) });
    await act(async () => { await result.current.retryAll(); });
    expect(replayAll).toHaveBeenCalledWith(UID, { retryFailed: true });
  });

  it('reads the queue while the browser is offline (networkMode always)', async () => {
    await enqueue(UID, payload(), []);
    onlineManager.setOnline(false);
    const client = makeClient();
    const { result } = renderHook(() => useOfflineQueue(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.pending).toBe(1));
    expect(client.getQueryState([OFFLINE_QUEUE_KEY, UID])?.fetchStatus).not.toBe('paused');
  });

  it('is not opted into the persisted read cache', async () => {
    const client = makeClient();
    renderHook(() => useOfflineQueue(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(client.getQueryState([OFFLINE_QUEUE_KEY, UID])?.status).toBe('success'));
    const q = client.getQueryCache().find({ queryKey: [OFFLINE_QUEUE_KEY, UID] });
    expect(q?.meta?.persist).toBeUndefined();
  });
});
