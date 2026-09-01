/**
 * Per-user preference for in-app hints & tips (guidance copy). Experienced users
 * switch hints off; anyone switches them back on for a refresher via the lightbulb
 * toggle in the header (HintsToggle). Defaults ON so first-time users get guidance.
 *
 * Scope: this gates COACHING copy only (the <Hint> component). Validation errors,
 * data-loss warnings, and state cues must never render through it — those stay
 * visible however experienced the user is.
 *
 * Persisted per user in localStorage so no schema change is needed; the profiles
 * table already carries per-user booleans (email_notifications, daily_digest, …),
 * so a `show_hints` column there is the natural upgrade when a migration is being
 * shipped anyway — only this file would change.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const storageKey = (userId: string | undefined) => `fortress.hints.${userId ?? 'anon'}`;

interface HintsContextValue {
  hintsEnabled: boolean;
  setHintsEnabled: (on: boolean) => void;
}

const HintsContext = createContext<HintsContextValue>({ hintsEnabled: true, setHintsEnabled: () => {} });

export function HintsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [hintsEnabled, setEnabled] = useState(true);

  // Re-read when the signed-in user changes; anyone with no stored choice gets hints.
  // window.localStorage (not the bare global): Node exposes its own undefined
  // `localStorage` global that shadows the browser one under vitest.
  useEffect(() => {
    try {
      setEnabled(window.localStorage.getItem(storageKey(user?.id)) !== 'off');
    } catch {
      setEnabled(true);
    }
  }, [user?.id]);

  const value = useMemo<HintsContextValue>(() => ({
    hintsEnabled,
    setHintsEnabled: (on: boolean) => {
      setEnabled(on);
      try {
        window.localStorage.setItem(storageKey(user?.id), on ? 'on' : 'off');
      } catch { /* best-effort; the in-memory state still applies for this session */ }
    },
  }), [hintsEnabled, user?.id]);

  return <HintsContext.Provider value={value}>{children}</HintsContext.Provider>;
}

export const useHints = () => useContext(HintsContext);
