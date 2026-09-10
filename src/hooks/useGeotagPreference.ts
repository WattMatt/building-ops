import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

/**
 * The user's "Location on photos" profile preference as a single boolean.
 *
 * PhotoCapture only needs this one flag, not live profile updates, so it is
 * read through a cached query rather than `useUserProfile` (which opens a
 * realtime channel per instance and tears the shared channel down on
 * unmount). Profile.tsx invalidates `['profile', 'geotag']` after a save.
 *
 * Returns `false` while loading, when signed out, or when the row is absent.
 */
export function useGeotagPreference(): boolean {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['profile', 'geotag', user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('geotag_photos')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return !!data?.geotag_photos;
    },
  });
  return data ?? false;
}
