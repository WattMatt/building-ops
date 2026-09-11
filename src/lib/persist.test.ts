import { describe, it, expect, vi } from 'vitest';
import { get } from 'idb-keyval';
import { QueryClient } from '@tanstack/react-query';
import {
  shouldPersistQuery,
  cacheKeyFor,
  createPersisterFor,
  clearPersistedCache,
  registerPersistStop,
  stopPersisting,
  PERSIST_DEFAULTS,
} from './persist';

describe('persist', () => {
  it('only dehydrates queries that opted in with meta.persist and have data', () => {
    const qc = new QueryClient();
    qc.setQueryData(['a'], 1);
    const a = qc.getQueryCache().find({ queryKey: ['a'] })!;
    expect(shouldPersistQuery(a)).toBe(false);
    a.setOptions({ ...a.options, meta: { persist: true } });
    expect(shouldPersistQuery(a)).toBe(true);
  });

  it('does not persist an opted-in query that has no data yet', () => {
    const qc = new QueryClient();
    qc.getQueryCache().build(qc, { queryKey: ['b'], meta: { persist: true } });
    const b = qc.getQueryCache().find({ queryKey: ['b'] })!;
    expect(b.state.status).toBe('pending');
    expect(shouldPersistQuery(b)).toBe(false);
  });

  it('keys the store per user', () => {
    expect(cacheKeyFor('u1')).toBe('bo-cache-u1');
    expect(cacheKeyFor('u2')).not.toBe(cacheKeyFor('u1'));
  });

  it('persister round-trips and clear removes it', async () => {
    const p = createPersisterFor('u1');
    await p.persistClient({ buster: 'u1', timestamp: Date.now(), clientState: { mutations: [], queries: [] } });
    expect(await p.restoreClient()).toBeTruthy();
    await clearPersistedCache('u1');
    expect(await p.restoreClient()).toBeUndefined();
  });

  it('clearing one user leaves another user\'s store alone', async () => {
    const p1 = createPersisterFor('u1', { throttleTime: 0 });
    const p2 = createPersisterFor('u2', { throttleTime: 0 });
    await p1.persistClient({ buster: 'u1', timestamp: Date.now(), clientState: { mutations: [], queries: [] } });
    await p2.persistClient({ buster: 'u2', timestamp: Date.now(), clientState: { mutations: [], queries: [] } });
    await clearPersistedCache('u1');
    expect(await p1.restoreClient()).toBeUndefined();
    expect((await p2.restoreClient())?.buster).toBe('u2');
    await clearPersistedCache('u2');
  });

  it('clearing with no user is a no-op', async () => {
    await expect(clearPersistedCache(null)).resolves.toBeUndefined();
    await expect(clearPersistedCache(undefined)).resolves.toBeUndefined();
  });

  it('a disposed persister never writes again, even for a save the throttle already queued', async () => {
    // Throttle interval of 50 ms: the first save runs immediately, the second is held and
    // written once the interval elapses — the trailing write that unsubscribing alone
    // cannot cancel.
    const p = createPersisterFor('u3', { throttleTime: 50 });
    const snapshot = (buster: string) => ({ buster, timestamp: Date.now(), clientState: { mutations: [], queries: [] } });
    await p.persistClient(snapshot('first'));
    void p.persistClient(snapshot('trailing')); // queued behind the interval
    p.dispose();
    await clearPersistedCache('u3');
    await new Promise((r) => setTimeout(r, 120));
    expect(await get(cacheKeyFor('u3'))).toBeUndefined();
  });

  it('stopPersisting runs the registered stop once and is a no-op when nothing is registered', () => {
    expect(() => stopPersisting()).not.toThrow();
    const stop = vi.fn();
    registerPersistStop(stop);
    stopPersisting();
    stopPersisting();
    expect(stop).toHaveBeenCalledTimes(1);
    registerPersistStop(null);
  });

  it('persisted queries render cached data while offline', () => {
    expect(PERSIST_DEFAULTS.networkMode).toBe('offlineFirst');
    expect(PERSIST_DEFAULTS.gcTime).toBe(24 * 60 * 60 * 1000);
    expect(PERSIST_DEFAULTS.meta.persist).toBe(true);
  });
});
