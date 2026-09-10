import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enqueue, listOps, updateOp, removeOp, clearQueue, subscribeQueue, queueStoreName } from './queue';
import { File as NodeFile } from 'node:buffer';

const payload = { kind: 'task_complete', completionId: 'c1', taskInstanceId: 't1', taskName: 'Check', notes: null, signatureConfirmed: false } as const;

describe('offline queue store', () => {
  beforeEach(async () => { await clearQueue('u1'); await clearQueue('u2'); });

  it('enqueues, lists oldest-first, and isolates users', async () => {
    const a = await enqueue('u1', payload, []);
    const b = await enqueue('u1', { ...payload, completionId: 'c2', taskInstanceId: 't2' }, []);
    await enqueue('u2', payload, []);
    const ops = await listOps('u1');
    expect(ops.map((o) => o.id)).toEqual([a.id, b.id]);
    expect(ops[0]).toMatchObject({ uid: 'u1', status: 'pending', attempts: 0, lastError: null });
    expect((await listOps('u2')).length).toBe(1);
  });

  it('keeps photo files', async () => {
    // fake-indexeddb clones with Node's structuredClone, which flattens jsdom's pure-JS File to {}.
    // Node's own File is a host object (like a browser File) and survives the clone, so it stands
    // in here; the contract under test is the store's round-trip, not jsdom's File implementation.
    const file = new NodeFile(['x'], 'a.jpg', { type: 'image/jpeg' }) as unknown as File;
    const op = await enqueue('u1', payload, [{ file }]);
    const [stored] = await listOps('u1');
    expect(stored.id).toBe(op.id);
    expect(stored.photos[0].file.name).toBe('a.jpg');
    expect(await stored.photos[0].file.text()).toBe('x');
  });

  it('updates, removes and clears, notifying subscribers each time', async () => {
    const seen = vi.fn();
    const unsub = subscribeQueue(seen);
    const op = await enqueue('u1', payload, []);
    await updateOp('u1', op.id, { status: 'failed', lastError: 'boom', attempts: 1 });
    expect((await listOps('u1'))[0]).toMatchObject({ status: 'failed', lastError: 'boom', attempts: 1 });
    await removeOp('u1', op.id);
    expect(await listOps('u1')).toEqual([]);
    await enqueue('u1', payload, []);
    await clearQueue('u1');
    expect(await listOps('u1')).toEqual([]);
    expect(seen.mock.calls.length).toBeGreaterThanOrEqual(5);
    unsub();
  });

  it('names the store per user', () => {
    expect(queueStoreName('u1')).toBe('bo-queue-u1');
  });
});
