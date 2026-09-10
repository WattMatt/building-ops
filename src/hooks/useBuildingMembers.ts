/**
 * People who can be assigned or mentioned on a building: admins/managers plus users with an
 * explicit building assignment. Served by the `building_members` SECURITY DEFINER RPC because
 * `profiles` is not readable across users (RLS: own row or manager) — the RPC returns display
 * fields only, and only to callers who can access the building themselves.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PERSIST_DEFAULTS } from '@/lib/persist';

export interface BuildingMember {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
}

export function memberDisplayName(m: BuildingMember): string {
  return m.full_name?.trim() || 'Unnamed user';
}

export function useBuildingMembers(buildingId: string | undefined) {
  const query = useQuery({
    queryKey: ['building-members', buildingId],
    ...PERSIST_DEFAULTS,
    enabled: !!buildingId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<BuildingMember[]> => {
      if (!buildingId) return [];
      const { data, error } = await supabase.rpc('building_members', { b: buildingId });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const byId = useMemo(() => new Map((query.data ?? []).map((m) => [m.id, m])), [query.data]);
  return { ...query, byId };
}
