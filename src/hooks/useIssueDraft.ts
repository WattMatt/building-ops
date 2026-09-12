/**
 * The New Issue form's draft (spec: field-readiness §8). Reads the user's draft once on mount,
 * debounces saves so typing does not hammer IndexedDB, flushes a pending save when the page
 * unmounts (leaving for the camera or the list must not lose the last keystrokes), and cancels
 * the pending save on clear() so a submit or discard can never be overwritten by a stale timer.
 *
 * `restored` is what the store held at mount and never changes afterwards; the page applies it
 * once. `ready` gates the page's own save effect: saving before the read settles would
 * overwrite the draft with an empty form.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { clearIssueDraft, readIssueDraft, saveIssueDraft, type IssueDraft } from '@/lib/offline/drafts';

export const DRAFT_DEBOUNCE_MS = 400;

export type IssueDraftInput = Omit<IssueDraft, 'savedAt'>;

export interface UseIssueDraft {
  restored: IssueDraft | null;
  ready: boolean;
  save: (draft: IssueDraftInput) => void;
  clear: () => void;
}

export function useIssueDraft(uid: string | undefined): UseIssueDraft {
  const [restored, setRestored] = useState<IssueDraft | null>(null);
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<IssueDraftInput | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setRestored(null);
    if (!uid) { setReady(true); return; }
    void readIssueDraft(uid).then((draft) => {
      if (cancelled) return;
      setRestored(draft);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, [uid]);

  const write = useCallback((draft: IssueDraftInput) => {
    if (!uid) return;
    void saveIssueDraft(uid, { ...draft, savedAt: Date.now() }).catch(() => {
      // Quota / private mode: the draft is a convenience, never worth an error in the form.
    });
  }, [uid]);

  const save = useCallback((draft: IssueDraftInput) => {
    if (!uid) return;
    pending.current = draft;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const next = pending.current;
      pending.current = null;
      if (next) write(next);
    }, DRAFT_DEBOUNCE_MS);
  }, [uid, write]);

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    pending.current = null;
    if (uid) void clearIssueDraft(uid);
  }, [uid]);

  // Flush on unmount: a draft is meant to outlive the page. clear() has already emptied
  // `pending`, so a submitted or discarded form is never resurrected here.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const next = pending.current;
    pending.current = null;
    if (next) write(next);
  }, [write]);

  return { restored, ready, save, clear };
}
