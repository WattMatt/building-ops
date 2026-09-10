/**
 * Everything expiring within `days` (expired rows included) across building, tenant and contractor documents
 * and asset warranties / service dates, through the expiring_items() RPC (security invoker: RLS applies).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { snapshotQueryDefaults } from '@/lib/snapshotClient';
import type { ExpiringItem } from '@/lib/expiry';

export function useExpiringItems(days = 90) {
  return useQuery({
    queryKey: ['expiring-items', days],
    staleTime: 5 * 60_000,
    // Same cap as the snapshot readers: a missing function (PGRST202, before the migration) is never retried.
    retry: snapshotQueryDefaults.retry,
    queryFn: async (): Promise<ExpiringItem[]> => {
      const { data, error } = await supabase.rpc('expiring_items', { p_days: days });
      if (error) throw error;
      // The function returns `kind` and `entity_type` as text; the CASE that emits them is pinned to the
      // ExpiringKind / entity_type literals in supabase/functions/_shared/expiry.ts, which this narrows to.
      return (data ?? []) as ExpiringItem[];
    },
  });
}
