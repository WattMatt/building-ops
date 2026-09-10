import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { subscribePostgresChanges } from '@/lib/realtime/subscribePostgresChanges';
import type { Tables } from '@/integrations/supabase/types';

type Organization = Tables<'organizations'>;

export function useOrganization() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrganization = async () => {
      try {
        const { data, error } = await supabase
          .from('organizations')
          .select('*')
          .limit(1)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Error fetching organization:', error);
        }
        
        setOrganization(data);
      } catch (error) {
        console.error('Error fetching organization:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchOrganization();

    // Many components call this hook at once (the layout plus whatever page is inside
    // it). The registry keeps ONE live channel for all of them; opening a channel per
    // consumer under a fixed name errors the shared channel — see subscribePostgresChanges.
    return subscribePostgresChanges<Organization>(
      'organization-changes',
      { event: '*', schema: 'public', table: 'organizations' },
      (payload) => {
        if (payload.new) {
          setOrganization(payload.new as Organization);
        }
      },
    );
  }, []);

  return { organization, loading };
}
