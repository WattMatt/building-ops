import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { SearchHit } from '@/hooks/useSearchEntities';

const MAX = 8;

function keyFor(uid: string) {
  return `fortress.palette.recent.${uid}`;
}

function load(uid: string): SearchHit[] {
  try {
    const raw = window.localStorage.getItem(keyFor(uid));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SearchHit[]) : [];
  } catch {
    return [];
  }
}

function save(uid: string, hits: SearchHit[]) {
  try {
    window.localStorage.setItem(keyFor(uid), JSON.stringify(hits));
  } catch {
    // Private mode / quota: recents are a convenience, never worth an error.
  }
}

/**
 * The last few palette destinations this user chose, most recent first, keyed per user
 * so a shared device never leaks one person's recents to the next.
 */
export function useRecentSearches(): { recent: SearchHit[]; remember: (hit: SearchHit) => void } {
  const { user } = useAuth();
  const uid = user?.id ?? 'anon';
  const [recent, setRecent] = useState<SearchHit[]>(() => load(uid));

  useEffect(() => { setRecent(load(uid)); }, [uid]);

  const remember = useCallback((hit: SearchHit) => {
    setRecent((prev) => {
      const next = [hit, ...prev.filter((h) => !(h.kind === hit.kind && h.id === hit.id))].slice(0, MAX);
      save(uid, next);
      return next;
    });
  }, [uid]);

  return { recent, remember };
}
