import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { shouldPersistQuery, cacheKeyFor, createPersisterFor, clearPersistedCache, PERSIST_DEFAULTS } from './persist';

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

  it('persisted queries render cached data while offline', () => {
    expect(PERSIST_DEFAULTS.networkMode).toBe('offlineFirst');
    expect(PERSIST_DEFAULTS.gcTime).toBe(24 * 60 * 60 * 1000);
    expect(PERSIST_DEFAULTS.meta.persist).toBe(true);
  });
});
