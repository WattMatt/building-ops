/**
 * Per-user preference for in-app hints & tips (guidance copy). Experienced users
 * switch hints off; anyone switches them back on for a refresher via the lightbulb
 * toggle in the header (HintsToggle). Defaults ON so first-time users get guidance.
 *
 * Scope: this gates COACHING copy only (the <Hint> component). Validation errors,
 * data-loss warnings, and state cues must never render through it — those stay
 * visible however experienced the user is.
 *
 * Persisted on `profiles.show_hints`, so the choice follows the user across
 * devices. localStorage remains a fallback: it's used while the profile row
 * hasn't loaded yet (or has no signed-in user), and if the profile read/write
 * fails for any reason — the column not being migrated yet included.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

const storageKey = (userId: string | undefined) => `fortress.hints.${userId ?? 'anon'}`;

// window.localStorage (not the bare global): Node exposes its own undefined
// `localStorage` global that shadows the browser one under vitest.
// Hoisted to module scope: it closes over nothing, so it's stable across renders
// and doesn't need to appear in any effect's dependency array.
const readLocal = (userId: string | undefined) => {
  try {
    return window.localStorage.getItem(storageKey(userId)) !== 'off';
  } catch {
    return true;
  }
};

interface HintsContextValue {
  hintsEnabled: boolean;
  setHintsEnabled: (on: boolean) => void;
}

const HintsContext = createContext<HintsContextValue>({ hintsEnabled: true, setHintsEnabled: () => {} });

export function HintsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Seed from localStorage synchronously so a signed-in user who turned hints off
  // never sees a flash of coaching copy while the profile read is in flight.
  const [hintsEnabled, setEnabled] = useState(() => readLocal(user?.id));
  // Bumped by setHintsEnabled so a slow/in-flight profile read can't clobber a
  // fresher choice the user just made by resolving after the fact.
  const touchedRef = useRef(false);

  // Profile column is the source of truth; localStorage remains a fallback so the
  // toggle still works if the column is not yet migrated or the read fails.
  useEffect(() => {
    let cancelled = false;
    touchedRef.current = false;

    if (!user?.id) {
      setEnabled(readLocal(user?.id));
      return;
    }

    // Sync from localStorage immediately (before the network round-trip) so
    // there's no flash of the previous state while the profile read resolves.
    setEnabled(readLocal(user.id));

    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('show_hints')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled || touchedRef.current) return;
      const v = (data as { show_hints?: boolean } | null)?.show_hints;
      if (error || typeof v !== 'boolean') {
        setEnabled(readLocal(user.id));
        return;
      }
      setEnabled(v);
      // Keep the local cache coherent with the server value across devices.
      try {
        window.localStorage.setItem(storageKey(user.id), v ? 'on' : 'off');
      } catch { /* best-effort; in-memory state still applies for this session */ }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const value = useMemo<HintsContextValue>(() => ({
    hintsEnabled,
    setHintsEnabled: (on: boolean) => {
      touchedRef.current = true;
      setEnabled(on);
      try {
        window.localStorage.setItem(storageKey(user?.id), on ? 'on' : 'off');
      } catch { /* best-effort; the in-memory state still applies for this session */ }

      if (user?.id) {
        void supabase
          .from('profiles')
          .update({ show_hints: on })
          .eq('id', user.id)
          .then(({ error }) => {
            if (error && import.meta.env.DEV) {
              console.warn('show_hints not saved to profile:', error.message);
            }
          });
      }
    },
  }), [hintsEnabled, user?.id]);

  return <HintsContext.Provider value={value}>{children}</HintsContext.Provider>;
}

export const useHints = () => useContext(HintsContext);
