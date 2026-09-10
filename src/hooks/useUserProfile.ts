import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { subscribePostgresChanges } from '@/lib/realtime/subscribePostgresChanges';

interface UserProfile {
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  email: string;
}

export function useUserProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const fetchProfile = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('full_name, avatar_url, phone, email')
          .eq('id', user.id)
          .maybeSingle();

        if (error) throw error;
        setProfile(data);
      } catch (error) {
        console.error('Error fetching profile:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();

    // The layout and the Dashboard page both call this hook at once. The registry keeps
    // ONE live channel per user for all consumers; the user id is part of the key because
    // listeners share the filter the key was opened with — see subscribePostgresChanges.
    return subscribePostgresChanges<UserProfile & Record<string, unknown>>(
      `profile-changes:${user.id}`,
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${user.id}`,
      },
      (payload) => {
        setProfile(payload.new as UserProfile);
      },
    );
  }, [user]);

  return { profile, loading };
}
