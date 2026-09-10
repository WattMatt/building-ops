import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** One row from `public.search_entities` — RLS applies, so only what the caller can see. */
export interface SearchHit {
  kind: 'building' | 'issue' | 'tenant' | 'document';
  id: string;
  building_id: string;
  title: string;
  subtitle: string | null;
}

const DEBOUNCE_MS = 200;
/** Matches the function's own minimum; shorter queries never leave the client. */
const MIN_CHARS = 2;

/**
 * Global search over buildings, issues, tenants and documents. Debounces the query
 * 200 ms so a fast typist causes one round-trip, not one per keystroke.
 */
export function useSearchEntities(q: string) {
  const trimmed = q.trim();
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trimmed]);

  return useQuery({
    queryKey: ['search', debounced.toLowerCase()],
    enabled: debounced.length >= MIN_CHARS,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_entities', { q: debounced, lim: 20 });
      if (error) throw error;
      // The function returns `kind` as plain text and `subtitle` as non-null text; the literal
      // union and nullable subtitle are the app's contract, so narrow once here.
      return (data ?? []) as SearchHit[];
    },
  });
}
