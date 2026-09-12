/**
 * perKeyQueue: same-key work runs strictly in call order, one at a time; different keys overlap;
 * a failure rejects only its own caller and never stalls the key.
 */
import { describe, it, expect, vi } from 'vitest';
import { createPerKeyQueue } from './perKeyQueue';

/** A job whose completion the test controls. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createPerKeyQueue', () => {
  it('a second job for the same key does not start until the first has resolved', async () => {
    const q = createPerKeyQueue();
    const first = deferred();
    const a = vi.fn(() => first.promise);
    const b = vi.fn(async () => {});
    const pa = q.run('k', a);
    const pb = q.run('k', b);
    await tick();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(q.size).toBe(1);
    first.resolve();
    await Promise.all([pa, pb]);
    expect(b).toHaveBeenCalledTimes(1);
    expect(q.size).toBe(0);
  });

  it('jobs for different keys overlap', async () => {
    const q = createPerKeyQueue();
    const first = deferred();
    const a = vi.fn(() => first.promise);
    const b = vi.fn(async () => {});
    const pa = q.run('k1', a);
    const pb = q.run('k2', b);
    await tick();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(q.size).toBe(1); // k2 already settled, k1 still in flight
    first.resolve();
    await Promise.all([pa, pb]);
    expect(q.size).toBe(0);
  });

  it('a failing job rejects its own caller only; the next job for that key still runs', async () => {
    const q = createPerKeyQueue();
    const b = vi.fn(async () => {});
    const pa = q.run('k', async () => { throw new Error('boom'); });
    const pb = q.run('k', b);
    await expect(pa).rejects.toThrow('boom');
    await expect(pb).resolves.toBeUndefined();
    expect(b).toHaveBeenCalledTimes(1);
    expect(q.size).toBe(0);
  });

  it('three rapid jobs land in call order', async () => {
    const q = createPerKeyQueue();
    const order: string[] = [];
    const gates = [deferred(), deferred(), deferred()];
    const jobs = gates.map((g, i) => q.run('k', () => { order.push(`start${i}`); return g.promise.then(() => { order.push(`end${i}`); }); }));
    await tick();
    expect(order).toEqual(['start0']);
    gates[1].resolve(); // resolving a later gate early changes nothing: job 1 has not started
    gates[0].resolve();
    await tick();
    expect(order).toEqual(['start0', 'end0', 'start1', 'end1', 'start2']);
    gates[2].resolve();
    await Promise.all(jobs);
    expect(order).toEqual(['start0', 'end0', 'start1', 'end1', 'start2', 'end2']);
  });
});
