import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** replay is mocked; the queue underneath is the real one on fake-indexeddb. */
vi.mock('./replay', () => ({
  replayAll: vi.fn(),
  runOne: vi.fn(),
}));

import { replayAll, runOne } from './replay';
import { listOps, clearQueue } from './queue';
import { enqueueAndRun } from './enqueueAndRun';
import type { TaskCompletePayload } from './types';

const UID = 'u1';
const payload: TaskCompletePayload = {
  kind: 'task_complete', completionId: 'c1', taskInstanceId: 't1', taskName: 'Check extinguishers', notes: null, signatureConfirmed: true,
};

describe('enqueueAndRun', () => {
  let onLine: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    await clearQueue(UID);
    vi.mocked(replayAll).mockReset().mockResolvedValue({ blocked: false });
    vi.mocked(runOne).mockReset().mockResolvedValue({ status: 'synced', result: { ok: true } });
    onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });
  afterEach(() => { onLine.mockRestore(); });

  it('offline: persists the op and reports queued without touching replay', async () => {
    onLine.mockReturnValue(false);
    expect(await enqueueAndRun(UID, payload, [])).toEqual({ status: 'queued' });
    expect(replayAll).not.toHaveBeenCalled();
    expect(runOne).not.toHaveBeenCalled();
    const [stored] = await listOps(UID);
    expect(stored).toMatchObject({ uid: UID, status: 'pending', attempts: 0, payload });
  });

  it('online: replays everything older first (stopping at its own op), then runs its op and returns that outcome', async () => {
    const outcome = await enqueueAndRun(UID, payload, []);
    const [stored] = await listOps(UID);
    expect(replayAll).toHaveBeenCalledTimes(1);
    expect(replayAll).toHaveBeenCalledWith(UID, { stopAt: stored.id });
    expect(runOne).toHaveBeenCalledTimes(1);
    expect(runOne).toHaveBeenCalledWith(expect.objectContaining({ id: stored.id, uid: UID, payload }));
    expect(vi.mocked(replayAll).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(runOne).mock.invocationCallOrder[0]);
    expect(outcome).toEqual({ status: 'synced', result: { ok: true } });

    // The caller sees its own op's outcome, whatever it is.
    vi.mocked(runOne).mockResolvedValueOnce({ status: 'failed', error: 'permission denied' });
    expect(await enqueueAndRun(UID, payload, [])).toEqual({ status: 'failed', error: 'permission denied' });
  });

  it('online but older ops cannot reach the server: the new op waits behind them (queued, not run)', async () => {
    vi.mocked(replayAll).mockResolvedValue({ blocked: true });
    expect(await enqueueAndRun(UID, payload, [])).toEqual({ status: 'queued' });
    expect(replayAll).toHaveBeenCalledTimes(1);
    expect(runOne).not.toHaveBeenCalled();
    const [stored] = await listOps(UID);
    expect(stored).toMatchObject({ status: 'pending', attempts: 0, payload });
  });
});
