/**
 * Offline read cache. Queries opt in with `meta: { persist: true }`; everything else stays
 * network-only. The store is keyed per user and cleared on sign-out, which is what keeps one
 * phone shared between two caretakers from showing the previous user's day.
 */
import { get, set, del } from 'idb-keyval';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query } from '@tanstack/react-query';

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

export function createPersisterFor(uid: string, opts: { throttleTime?: number } = {}) {
  return createAsyncStoragePersister({
    key: cacheKeyFor(uid),
    storage: {
      getItem: async (k) => (await get<string>(k)) ?? null,
      setItem: async (k, v) => { await set(k, v); },
      removeItem: async (k) => { await del(k); },
    },
    throttleTime: opts.throttleTime ?? 1000,
  });
}

export async function clearPersistedCache(uid: string | undefined | null): Promise<void> {
  if (!uid) return;
  try { await del(cacheKeyFor(uid)); } catch { /* storage unavailable: nothing was persisted either */ }
}
