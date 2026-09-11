/**
 * Offline read cache. Queries opt in with `meta: { persist: true }`; everything else stays
 * network-only. The store is keyed per user and cleared on sign-out, which is what keeps one
 * phone shared between two caretakers from showing the previous user's day.
 */
import { get, set, del } from 'idb-keyval';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query } from '@tanstack/react-query';
import type { Persister } from '@tanstack/react-query-persist-client';

/** Anything persisted longer ago than this is discarded on restore rather than shown. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Spread into any query that opts in: cached rows render offline, and survive a reload for a day. */
export const PERSIST_DEFAULTS = {
  meta: { persist: true },
  networkMode: 'offlineFirst' as const,
  gcTime: 24 * 60 * 60 * 1000,
};

export const cacheKeyFor = (uid: string) => `bo-cache-${uid}`;

/** Only opted-in queries that actually hold data are worth writing to disk. */
export function shouldPersistQuery(q: Query): boolean {
  return q.meta?.persist === true && q.state.status === 'success';
}

/**
 * A persister that can be switched off for good. The async-storage persister throttles
 * writes and keeps the LAST dehydrated snapshot around to write once the interval elapses,
 * and merely unsubscribing from the query cache does not cancel that pending write. So
 * "stop persisting" has to mean the store can no longer be written to — `dispose()` turns
 * every later `setItem` into a no-op, including one already scheduled inside the throttle.
 */
export type DisposablePersister = Persister & { dispose: () => void };

export function createPersisterFor(uid: string, opts: { throttleTime?: number } = {}): DisposablePersister {
  let disposed = false;
  const persister = createAsyncStoragePersister({
    key: cacheKeyFor(uid),
    storage: {
      getItem: async (k) => (await get<string>(k)) ?? null,
      setItem: async (k, v) => { if (!disposed) await set(k, v); },
      removeItem: async (k) => { await del(k); },
    },
    throttleTime: opts.throttleTime ?? 1000,
  });
  return { ...persister, dispose: () => { disposed = true; } };
}

export async function clearPersistedCache(uid: string | undefined | null): Promise<void> {
  if (!uid) return;
  try { await del(cacheKeyFor(uid)); } catch { /* storage unavailable: nothing was persisted either */ }
}

/**
 * Registry for the one live persist subscription, so code outside the provider (AuthContext's
 * `signOut`) can halt persistence BEFORE it empties the in-memory cache.
 *
 * Why the order matters: `queryClient.clear()` emits one synchronous `removed` event per
 * query, and the persister's throttle runs the first save immediately — so with the
 * subscription still live, "the cache minus one query" is dehydrated and written to disk right
 * after the caller issued its delete. The put wins and the outgoing user's rows sit on disk
 * until the trailing empty save lands. Stopping first means `clear()` produces no write at all.
 */
let persistStop: (() => void) | null = null;

/** Called by the provider with the stop function for its current subscription (or null once it has ended). */
export function registerPersistStop(fn: (() => void) | null): void {
  persistStop = fn;
}

/** Halts the live subscription (if any) and disposes its persister. Safe to call when nothing is registered. */
export function stopPersisting(): void {
  const stop = persistStop;
  persistStop = null;
  stop?.();
}
