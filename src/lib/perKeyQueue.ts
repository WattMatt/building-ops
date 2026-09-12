/**
 * Serialises async work per key. A call for key K starts only after every earlier call for K has
 * settled — success or failure — while different keys run side by side. The inspection and
 * compliance section hooks both chain their per-item upserts through this, so two rapid saves to
 * one item reach the server in call order instead of racing (the second used to land first and
 * the first then overwrote it with older values).
 *
 * Failure of one job never blocks the next for that key; it rejects only its own caller.
 */
export interface PerKeyQueue {
  /** Runs `work` after everything queued earlier under `key`; resolves/rejects as `work` does. */
  run(key: string, work: () => Promise<void>): Promise<void>;
  /** Keys with work still in flight (diagnostics and tests). */
  readonly size: number;
}

export function createPerKeyQueue(): PerKeyQueue {
  const inflight = new Map<string, Promise<void>>();
  return {
    async run(key, work) {
      const prev = inflight.get(key) ?? Promise.resolve();
      // `work` on both arms: an earlier failure for this key must not stall the queue.
      const job = prev.then(work, work);
      inflight.set(key, job);
      try {
        await job;
      } finally {
        // Only the LAST job for the key clears the slot; an earlier one settling must not drop a
        // later one that is still chained behind it.
        if (inflight.get(key) === job) inflight.delete(key);
      }
    },
    get size() {
      return inflight.size;
    },
  };
}
