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
      // expiring_items is not yet in the generated types; regenerate after the migration ships.
      const { data, error } = await (supabase as unknown as {
        rpc(fn: 'expiring_items', args: { p_days: number }): Promise<{ data: ExpiringItem[] | null; error: { message: string } | null }>;
      }).rpc('expiring_items', { p_days: days });
      if (error) throw error;
      return data ?? [];
    },
  });
}
