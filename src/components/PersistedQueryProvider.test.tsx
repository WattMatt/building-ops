import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clear as clearIdb, get } from 'idb-keyval';
import { queryClient } from '@/lib/queryClient';
import { cacheKeyFor, clearPersistedCache, createPersisterFor, stopPersisting, PERSIST_DEFAULTS } from '@/lib/persist';
import { clearQueue, enqueue, listOps } from '@/lib/offline/queue';
import { clearDraftStore, readIssueDraft, saveIssueDraft } from '@/lib/offline/drafts';
import { PersistedQueryProvider } from './PersistedQueryProvider';

// The provider owns the only per-user IndexedDB persister in the app, so these tests run it
// against the real module `queryClient`, the real persist-client core and fake-indexeddb.
// The single seam is the Supabase auth client: `getSession` resolves whatever session the
// test has staged, and `onAuthStateChange` hands the callback back so a test can fire a
// cross-tab SIGNED_IN / SIGNED_OUT the way Supabase would — without going through
// AuthContext.signOut and its own clears.

type FakeSession = { user: { id: string } } | null;
type AuthCallback = (event: string, session: FakeSession) => void;

const auth = vi.hoisted(() => ({
  session: { user: { id: 'A' } } as FakeSession,
  callback: null as AuthCallback | null,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: auth.session } }),
      onAuthStateChange: (cb: AuthCallback) => {
        auth.callback = cb;
        return { data: { subscription: { unsubscribe: () => { auth.callback = null; } } } };
      },
    },
  },
}));

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const keyFor = (uid: string) => ['my-work', 'tasks', uid] as const;

interface PersistedClientShape {
  clientState: { queries: { queryKey: unknown }[] };
}

async function persistedKeys(uid: string): Promise<string[] | undefined> {
  const raw = await get<string>(cacheKeyFor(uid));
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as PersistedClientShape;
  return parsed.clientState.queries.map((q) => JSON.stringify(q.queryKey));
}

const fastPersister: typeof createPersisterFor = (uid) => createPersisterFor(uid, { throttleTime: 0 });

function Probe({ uid, extra }: { uid: string; extra?: boolean }) {
  const q = useQuery({ queryKey: keyFor(uid), queryFn: async () => [1], ...PERSIST_DEFAULTS });
  const issues = useQuery({
    queryKey: ['my-work', 'issues', uid],
    queryFn: async () => [2],
    enabled: extra === true,
    ...PERSIST_DEFAULTS,
  });
  return (
    <div>
      <span data-testid="status">{q.status}:{uid}</span>
      <span data-testid="issues">{issues.status}</span>
    </div>
  );
}

let setProbeUid: (uid: string) => void = () => {};

function Harness({ persister = fastPersister, extra }: { persister?: typeof createPersisterFor; extra?: boolean }) {
  const [uid, setUid] = useState('A');
  setProbeUid = setUid;
  return (
    <PersistedQueryProvider persisterFactory={persister}>
      <Probe uid={uid} extra={extra} />
    </PersistedQueryProvider>
  );
}

describe('PersistedQueryProvider', () => {
  beforeEach(async () => {
    auth.session = { user: { id: 'A' } };
    auth.callback = null;
    stopPersisting();
    queryClient.clear();
    await clearIdb();
  });

  afterEach(async () => {
    stopPersisting();
    queryClient.clear();
    await clearIdb();
    // The write queue and the draft store live in their own per-user stores, which clearIdb()
    // (default store) misses.
    await clearQueue('A');
    await clearQueue('B');
    await clearDraftStore('A');
    await clearDraftStore('B');
  });

  it('a direct user switch (no signOut) drops A from memory and disk before B persists anything', async () => {
    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('success:A'));
    await waitFor(async () => {
      expect(await persistedKeys('A')).toContain(JSON.stringify(keyFor('A')));
    });
    expect(auth.callback).toBeTruthy();

    // Supabase fires this in another tab's sign-in; AuthContext's listener updates the uid
    // its hooks key on in the same tick, which the probe's uid switch stands in for.
    act(() => {
      auth.callback!('SIGNED_IN', { user: { id: 'B' } });
      setProbeUid('B');
    });

    await waitFor(() => expect(queryClient.getQueryCache().find({ queryKey: keyFor('A') })).toBeUndefined());
    await waitFor(async () => expect(await get(cacheKeyFor('A'))).toBeUndefined());

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('success:B'));
    await waitFor(async () => {
      const keys = await persistedKeys('B');
      expect(keys).toContain(JSON.stringify(keyFor('B')));
      expect(keys).not.toContain(JSON.stringify(keyFor('A')));
    });
  });

  it('an implicit user switch also drops the outgoing user\'s offline write queue and issue draft', async () => {
    // A's unsynced writes must not survive on a shared device to replay under B's session, and
    // A's half-written issue must not be offered to B.
    await enqueue('A', { kind: 'task_complete', completionId: 'c1', taskInstanceId: 't1', taskName: 'Check', notes: null, signatureConfirmed: false }, []);
    await saveIssueDraft('A', { title: 'Lift', description: '', buildingId: 'b1', priority: 'medium', photos: [], savedAt: 1 });
    expect(await listOps('A')).toHaveLength(1);
    expect(await readIssueDraft('A')).not.toBeNull();

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('success:A'));
    expect(await listOps('A')).toHaveLength(1); // mounting as A keeps A's queue
    expect(await readIssueDraft('A')).not.toBeNull(); // and A's draft

    act(() => {
      auth.callback!('SIGNED_IN', { user: { id: 'B' } });
      setProbeUid('B');
    });

    await waitFor(async () => expect(await listOps('A')).toEqual([]));
    await waitFor(async () => expect(await readIssueDraft('A')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('success:B'));
  });

  it('an other-tab sign-out (uid -> null) clears memory and disk for the outgoing user', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('success:A'));
    await waitFor(async () => expect(await persistedKeys('A')).toBeDefined());

    act(() => { auth.callback!('SIGNED_OUT', null); });

    await waitFor(() => expect(queryClient.getQueryCache().find({ queryKey: keyFor('A') })).toBeUndefined());
    await waitFor(async () => expect(await get(cacheKeyFor('A'))).toBeUndefined());
  });

  it('stopPersisting() before clear() leaves no write behind, even with the 1 s throttle live', async () => {
    // Real throttle: two persisted queries so the first `removed` event from clear() would
    // dehydrate a non-empty snapshot if the subscription were still live.
    render(<Harness persister={createPersisterFor} extra />);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('success:A'));
    await waitFor(() => expect(screen.getByTestId('issues').textContent).toBe('success'));
    await waitFor(async () => {
      const keys = await persistedKeys('A');
      expect(keys).toContain(JSON.stringify(keyFor('A')));
      expect(keys).toContain(JSON.stringify(['my-work', 'issues', 'A']));
    }, { timeout: 4000 });

    // The signOut() sequence, in order.
    stopPersisting();
    queryClient.clear();
    await clearPersistedCache('A');

    await new Promise((r) => setTimeout(r, 1500));
    expect(await get(cacheKeyFor('A'))).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  }, 15000);

  it('holds queries back on the very first render after sign-in until the restore settles', async () => {
    // Seed a persisted store for A, then mount with no session and sign A in through the
    // auth callback: the probe must render the persisted rows, not fetch first.
    const seeded = createPersisterFor('A', { throttleTime: 0 });
    await seeded.persistClient({
      buster: 'A',
      timestamp: Date.now(),
      clientState: {
        mutations: [],
        queries: [{
          queryKey: keyFor('A'),
          queryHash: JSON.stringify(keyFor('A')),
          state: {
            data: ['from-disk'], dataUpdateCount: 1, dataUpdatedAt: Date.now(), error: null,
            errorUpdateCount: 0, errorUpdatedAt: 0, fetchFailureCount: 0, fetchFailureReason: null,
            fetchMeta: null, isInvalidated: false, status: 'success', fetchStatus: 'idle',
          },
        }],
      },
    });
    auth.session = null;

    const fetches: string[] = [];
    function LateProbe() {
      const q = useQuery({
        queryKey: keyFor('A'),
        queryFn: async () => { fetches.push('net'); return ['from-net']; },
        staleTime: Infinity,
        ...PERSIST_DEFAULTS,
      });
      return <span data-testid="late">{JSON.stringify(q.data ?? null)}</span>;
    }
    // Data queries live behind ProtectedRoute, so they mount on the same render that first
    // sees the new session — the render a state-driven `isRestoring` would get wrong.
    let showProbe: (on: boolean) => void = () => {};
    function Gate() {
      const [on, setOn] = useState(false);
      showProbe = setOn;
      return on ? <LateProbe /> : null;
    }
    render(<PersistedQueryProvider persisterFactory={fastPersister}><Gate /></PersistedQueryProvider>);
    await waitFor(() => expect(auth.callback).toBeTruthy());

    act(() => {
      auth.callback!('SIGNED_IN', { user: { id: 'A' } });
      showProbe(true);
    });

    await waitFor(() => expect(screen.getByTestId('late').textContent).toBe(JSON.stringify(['from-disk'])));
    expect(fetches).toHaveLength(0);
  });

  it('keeps a restored query alive with no consumer past the default 5-minute gcTime', async () => {
    // An offline launch restores every persisted query at once; the page that owns one may
    // not be visited for a while. Restored queries are built from the persisted state alone
    // (the consumer's PERSIST_DEFAULTS.gcTime is not on disk), so without `hydrateOptions`
    // they would get the 5-minute default and be collected before the user got there.
    const seeded = createPersisterFor('A', { throttleTime: 0 });
    await seeded.persistClient({
      buster: 'A',
      timestamp: Date.now(),
      clientState: {
        mutations: [],
        queries: [{
          queryKey: keyFor('A'),
          queryHash: JSON.stringify(keyFor('A')),
          state: {
            data: ['from-disk'], dataUpdateCount: 1, dataUpdatedAt: Date.now(), error: null,
            errorUpdateCount: 0, errorUpdatedAt: 0, fetchFailureCount: 0, fetchFailureReason: null,
            fetchMeta: null, isInvalidated: false, status: 'success', fetchStatus: 'idle',
          },
        }],
      },
    });

    // Only the timer pair the gc uses is faked: fake-indexeddb schedules on setImmediate and
    // React's scheduler on MessageChannel/setImmediate, which must keep running for the
    // restore to settle at all. Faking before mounting matters — the gc timer is armed the
    // moment the query is hydrated.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      render(<PersistedQueryProvider persisterFactory={fastPersister}><div /></PersistedQueryProvider>);
      // vi.waitFor polls on vitest's own (real) timers; RTL's waitFor would wait on the faked
      // setTimeout and never return, and wrapping the wait in act() would hold React's render
      // queue until it exits. So, as RTL's asyncWrapper does, take the act environment down
      // while the restore settles and put it back for the assertions.
      const actEnv = globalThis.IS_REACT_ACT_ENVIRONMENT;
      globalThis.IS_REACT_ACT_ENVIRONMENT = false;
      try {
        await vi.waitFor(() => expect(queryClient.getQueryCache().find({ queryKey: keyFor('A') })).toBeDefined());
      } finally {
        globalThis.IS_REACT_ACT_ENVIRONMENT = actEnv;
      }

      await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 1000); });

      const q = queryClient.getQueryCache().find({ queryKey: keyFor('A') });
      expect(q).toBeDefined();
      expect(q!.gcTime).toBe(PERSIST_DEFAULTS.gcTime);
      expect(q!.state.data).toEqual(['from-disk']);
    } finally {
      vi.useRealTimers();
    }
  });
});
