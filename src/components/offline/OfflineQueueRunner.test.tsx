import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, act } from '@testing-library/react';

const replayAll = vi.hoisted(() => vi.fn());
const countOps = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }));

vi.mock('@/lib/offline/replay', () => ({ replayAll }));
vi.mock('@/lib/offline/queue', () => ({ countOps }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('sonner', () => ({ toast }));

import { queryClient } from '@/lib/queryClient';
import { OfflineQueueRunner } from './OfflineQueueRunner';

/** Let the debounce fire and the replay → invalidate → recount chain settle. */
async function runDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

describe('OfflineQueueRunner', () => {
  let invalidate: MockInstance<typeof queryClient.invalidateQueries>;
  beforeEach(() => {
    vi.useFakeTimers();
    auth.user = { id: 'u1' };
    replayAll.mockReset().mockResolvedValue({ blocked: false });
    countOps.mockReset().mockResolvedValue(0);
    toast.success.mockClear();
    invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
  });
  afterEach(() => {
    invalidate.mockRestore();
    vi.useRealTimers();
  });

  it('replays after the debounce and refetches My Day and the building overview', async () => {
    render(<OfflineQueueRunner />);
    expect(replayAll).not.toHaveBeenCalled();
    await runDebounce();
    expect(replayAll).toHaveBeenCalledWith('u1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['my-work'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['building-overview'] });
  });

  it('says "All synced" once a non-empty queue drains to zero', async () => {
    countOps.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    render(<OfflineQueueRunner />);
    await runDebounce();
    expect(toast.success).toHaveBeenCalledWith('All synced', { duration: 2000 });
  });

  it('stays quiet when there was nothing to sync', async () => {
    countOps.mockResolvedValue(0);
    render(<OfflineQueueRunner />);
    await runDebounce();
    expect(replayAll).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('stays quiet when the run could not drain the queue', async () => {
    countOps.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    render(<OfflineQueueRunner />);
    await runDebounce();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('does nothing without a signed-in user', async () => {
    auth.user = null;
    render(<OfflineQueueRunner />);
    await runDebounce();
    expect(replayAll).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
