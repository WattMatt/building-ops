import { useEffect, useState, type ReactNode } from 'react';
import { IsRestoringProvider, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClientRestore, persistQueryClientSubscribe } from '@tanstack/react-query-persist-client';
import { supabase } from '@/integrations/supabase/client';
import { queryClient } from '@/lib/queryClient';
import { createPersisterFor, shouldPersistQuery, MAX_AGE_MS } from '@/lib/persist';

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
 * `IsRestoringProvider` holds queries back until the initial session check and the
 * restore for that user have finished, so an offline reload renders the persisted rows
 * rather than a failed first fetch. Sign-out flips `uid` to null, which drops the
 * subscription; AuthContext's `signOut` clears the in-memory cache and the user's store.
 */
export function PersistedQueryProvider({ children }: { children: ReactNode }) {
  const [uid, setUid] = useState<string | null | undefined>(undefined);
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setUid(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setUid(session?.user.id ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (uid === undefined) return; // session not known yet: keep queries held back
    if (uid === null) { setIsRestoring(false); return; } // signed out: nothing to restore or persist
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const options = {
      queryClient,
      persister: createPersisterFor(uid),
      maxAge: MAX_AGE_MS,
      buster: uid,
      dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
    };
    setIsRestoring(true);
    persistQueryClientRestore(options)
      .catch(() => { /* corrupt or unreadable store: core already discarded it */ })
      .finally(() => {
        if (cancelled) return;
        setIsRestoring(false);
        unsubscribe = persistQueryClientSubscribe(options);
      });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [uid]);

  return (
    <QueryClientProvider client={queryClient}>
      <IsRestoringProvider value={isRestoring}>{children}</IsRestoringProvider>
    </QueryClientProvider>
  );
}
