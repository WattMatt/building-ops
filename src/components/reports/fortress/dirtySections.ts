/**
 * Which report-section grids currently hold unsaved edits (finding D1).
 *
 * Grids keep their edits locally until "Save section"; switching section, pressing
 * Back, refreshing, or submitting used to unmount the grid and drop the edits with no
 * warning. This store lets the editor know a section is dirty so it can confirm before
 * navigating, guard `beforeunload`, and block Submit / Export until saved.
 *
 * Module-level rather than a React context so grids nested at any depth can report
 * without prop drilling, and so it is trivially unit-testable.
 */
import { useEffect, useSyncExternalStore } from 'react';

const ids = new Set<string>();
const listeners = new Set<() => void>();

function emit() { listeners.forEach((l) => l()); }

export const dirtySections = {
  set(id: string, dirty: boolean) {
    const had = ids.has(id);
    if (dirty && !had) { ids.add(id); emit(); }
    if (!dirty && had) { ids.delete(id); emit(); }
  },
  count() { return ids.size; },
  reset() { if (ids.size) { ids.clear(); emit(); } },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};

/** Report this grid's dirty state; clears itself on unmount. */
export function useReportDirty(id: string, dirty: boolean) {
  useEffect(() => {
    dirtySections.set(id, dirty);
    return () => dirtySections.set(id, false);
  }, [id, dirty]);
}

/** Number of grids with unsaved edits in the mounted section. */
export function useDirtyCount(): number {
  return useSyncExternalStore(dirtySections.subscribe, dirtySections.count, () => 0);
}
