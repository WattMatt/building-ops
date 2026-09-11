/**
 * `id, name` for every building the caller can see — the lookup pages use to label a building id.
 * Its own key on purpose: FortressReports also lists buildings but selects `report_types` too, and two
 * callers sharing one key with different select shapes hand each other rows missing columns.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface BuildingName { id: string; name: string }

export function useBuildingNames() {
  return useQuery({
    queryKey: ['buildings-names'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<BuildingName[]> => {
      const { data, error } = await supabase.from('buildings').select('id, name').order('name');
      if (error) throw error;
      return (data ?? []) as BuildingName[];
    },
  });
}
