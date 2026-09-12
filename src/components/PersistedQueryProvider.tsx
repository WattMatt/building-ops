import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IsRestoringProvider, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClientRestore, persistQueryClientSubscribe } from '@tanstack/react-query-persist-client';
import { supabase } from '@/integrations/supabase/client';
import { queryClient } from '@/lib/queryClient';
import { clearQueue } from '@/lib/offline/queue';
import { clearDraftStore } from '@/lib/offline/drafts';
import {
  createPersisterFor,
  clearPersistedCache,
  registerPersistStop,
  stopPersisting,
  shouldPersistQuery,
  MAX_AGE_MS,
  PERSIST_DEFAULTS,
} from '@/lib/persist';

/**
 * Wraps the app in the query provider and attaches a per-user IndexedDB persister to it.
 *
 * Deliberately NOT built on `PersistQueryClientProvider`: that component reads its
 * `persistOptions` through a ref, restores exactly once, and only re-subscribes on
 * `[client, isRestoring]` — so the only way to swap stores when the user changes is a
 * `key` remount, which would remount everything below it (BrowserRouter, AuthProvider,
 * the Auth page mid-sign-in, in-flight toasts). Instead this tracks the session itself
 * (AuthContext lives inside it) and re-runs restore/subscribe against the module
 * `queryClient` whenever the user id changes; children never remount.
 *
 * Restore gating — `isRestoring` is DERIVED during render, not set from the effect:
 * `restoredFor` records which uid's restore has settled, and queries are held back while
 * the session is unknown or `restoredFor !== uid`. Children's `useQuery` calls subscribe
 * on the same render that first sees a new uid, before any parent effect runs; a
 * state-driven flag would still be false on that render and the first fetch would race the
 * restore. Deriving it means the very first render after SIGNED_IN (or a user switch)
 * already holds queries back, so an offline reload renders the persisted rows rather than
 * a failed first fetch.
 *
 * User change — sessions also change without going through `signOut()` (a SIGNED_IN from
 * another tab, an other-tab sign-out, an expired token). When `uid` moves A→B or A→null,
 * this effect stops persisting, empties the in-memory cache and deletes A's store BEFORE
 * restoring B's; otherwise B's subscription would dehydrate A's `success` rows into
 * `bo-cache-B`. A's offline write queue (`bo-queue-A`) is dropped in the same step —
 * deliberately: unsynced writes never outlive the session that made them, so on a shared
 * device they can never replay under B. The issue draft store (`bo-drafts-A`) goes the same way.
 * The stop is registered in `src/lib/persist.ts` so `AuthContext.signOut`
 * can halt persistence before its own `queryClient.clear()` (see the ordering note there).
 *
 * Queries that opt in today (`...PERSIST_DEFAULTS`): `useMyWork` (tasks, issues, returned
 * reports) and `useBuildingMembers`. Spec §5.2 also lists the issue list for assigned
 * buildings, but `useIssues` is `useState`-based rather than a query and is deferred to R2b.
 */
export function PersistedQueryProvider({
  children,
  persisterFactory = createPersisterFor,
}: {
  children: ReactNode;
  /** Test seam: build the persister with a different throttle without touching production wiring. */
  persisterFactory?: typeof createPersisterFor;
}) {
  const [uid, setUid] = useState<string | null | undefined>(undefined);
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const prevUidRef = useRef<string | null | undefined>(undefined);
  // Read through a ref so an inline factory prop cannot re-run the restore effect every render.
  const persisterFactoryRef = useRef(persisterFactory);
  persisterFactoryRef.current = persisterFactory;

  // Session unknown: hold back. Signed out: nothing to restore. Signed in: hold back until
  // THIS uid's restore has settled (see the docblock for why this must be computed here).
  const isRestoring = uid === undefined || (uid !== null && restoredFor !== uid);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setUid(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setUid(session?.user.id ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const prevUid = prevUidRef.current;
    prevUidRef.current = uid;
    if (uid === undefined) return; // session not known yet: keep queries held back

    if (prevUid && prevUid !== uid) {
      // Someone else (or nobody) now owns this tab. Stop first so clear() cannot be
      // persisted, then drop the previous user's rows from memory and disk — read cache,
      // write queue AND issue draft, so A's unsynced ops cannot replay under B's session
      // and A's half-written issue is never offered to B.
      stopPersisting();
      queryClient.clear();
      void clearPersistedCache(prevUid);
      void clearQueue(prevUid);
      void clearDraftStore(prevUid);
    }

    if (uid === null) { setRestoredFor(null); return; } // signed out: nothing to restore or persist

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const persister = persisterFactoryRef.current(uid);
    const stop = () => {
      unsubscribe?.();
      unsubscribe = undefined;
      persister.dispose();
    };
    const options = {
      queryClient,
      persister,
      maxAge: MAX_AGE_MS,
      buster: uid,
      dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      // Restored queries are built from the persisted state alone — the `gcTime` a consumer
      // spreads in via PERSIST_DEFAULTS is not on disk. Without this they get the 5-minute
      // default and are collected (and the store rewritten without them) if the page that owns
      // them is not visited within 5 minutes of an offline launch.
      hydrateOptions: { defaultOptions: { queries: { gcTime: PERSIST_DEFAULTS.gcTime } } },
    };
    persistQueryClientRestore(options)
      .catch(() => { /* corrupt or unreadable store: core already discarded it */ })
      .finally(() => {
        if (cancelled) return;
        unsubscribe = persistQueryClientSubscribe(options);
        registerPersistStop(stop);
        setRestoredFor(uid);
      });
    return () => {
      cancelled = true;
      stop();
      registerPersistStop(null);
    };
  }, [uid]);

  return (
    <QueryClientProvider client={queryClient}>
      <IsRestoringProvider value={isRestoring}>{children}</IsRestoringProvider>
    </QueryClientProvider>
  );
}
