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
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

const storageKey = (userId: string | undefined) => `fortress.hints.${userId ?? 'anon'}`;

interface HintsContextValue {
  hintsEnabled: boolean;
  setHintsEnabled: (on: boolean) => void;
}

const HintsContext = createContext<HintsContextValue>({ hintsEnabled: true, setHintsEnabled: () => {} });

export function HintsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [hintsEnabled, setEnabled] = useState(true);

  // window.localStorage (not the bare global): Node exposes its own undefined
  // `localStorage` global that shadows the browser one under vitest.
  const readLocal = (userId: string | undefined) => {
    try {
      return window.localStorage.getItem(storageKey(userId)) !== 'off';
    } catch {
      return true;
    }
  };

  // Profile column is the source of truth; localStorage remains a fallback so the
  // toggle still works if the column is not yet migrated or the read fails.
  useEffect(() => {
    let cancelled = false;

    if (!user?.id) {
      setEnabled(readLocal(user?.id));
      return;
    }

    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('show_hints')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      const v = (data as { show_hints?: boolean } | null)?.show_hints;
      setEnabled(error || typeof v !== 'boolean' ? readLocal(user.id) : v);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const value = useMemo<HintsContextValue>(() => ({
    hintsEnabled,
    setHintsEnabled: (on: boolean) => {
      setEnabled(on);
      try {
        window.localStorage.setItem(storageKey(user?.id), on ? 'on' : 'off');
      } catch { /* best-effort; the in-memory state still applies for this session */ }

      if (user?.id) {
        void supabase
          .from('profiles')
          .update({ show_hints: on } as never)
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
