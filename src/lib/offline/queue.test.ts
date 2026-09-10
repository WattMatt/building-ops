import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { entries } from 'idb-keyval';
import { enqueue, listOps, updateOp, removeOp, clearQueue, subscribeQueue, queueStoreName } from './queue';
import { File as NodeFile } from 'node:buffer';

// `entries` is the read the per-user seed goes through; wrap it so one test can make it fail.
// The wrapper passes through by default, so every other test still hits fake-indexeddb.
vi.mock('idb-keyval', async (importOriginal) => {
  const actual = await importOriginal<typeof import('idb-keyval')>();
  return { ...actual, entries: vi.fn(actual.entries) };
});

const payload = { kind: 'task_complete', completionId: 'c1', taskInstanceId: 't1', taskName: 'Check', notes: null, signatureConfirmed: false } as const;

describe('offline queue store', () => {
  beforeEach(async () => { await clearQueue('u1'); await clearQueue('u2'); await clearQueue('u3'); await clearQueue('u4'); await clearQueue('u5'); });
  afterEach(() => { vi.restoreAllMocks(); });

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

  it('gives same-millisecond ops strictly increasing createdAt so they list in enqueue order', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const a = await enqueue('u3', payload, []);
    const b = await enqueue('u3', { ...payload, completionId: 'c2', taskInstanceId: 't2' }, []);
    const c = await enqueue('u3', { ...payload, completionId: 'c3', taskInstanceId: 't3' }, []);
    const ops = await listOps('u3');
    expect(ops.map((o) => o.id)).toEqual([a.id, b.id, c.id]);
    expect(ops.map((o) => o.createdAt)).toEqual([1000, 1001, 1002]);
  });

  it('retries the seed after a transient store failure instead of caching the rejection', async () => {
    // One failed IndexedDB read during the first seed must not poison every later enqueue for
    // that user until reload.
    vi.mocked(entries).mockRejectedValueOnce(new Error('transient idb failure'));
    await expect(enqueue('u5', payload, [])).rejects.toThrow('transient idb failure');
    const op = await enqueue('u5', payload, []);
    expect((await listOps('u5')).map((o) => o.id)).toEqual([op.id]);
  });

  it('keeps createdAt increasing across a reload by seeding from the store', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const first = await enqueue('u4', payload, []);
    expect(first.createdAt).toBe(1000);
    // A fresh module instance (as after a page reload) has no in-memory high-water mark; it must
    // recover it from what is already persisted rather than hand out 1000 again.
    vi.resetModules();
    const fresh = await import('./queue');
    const second = await fresh.enqueue('u4', { ...payload, completionId: 'c2', taskInstanceId: 't2' }, []);
    expect(second.createdAt).toBe(1001);
    const ops = await fresh.listOps('u4');
    expect(ops.map((o) => o.id)).toEqual([first.id, second.id]);
  });
});
