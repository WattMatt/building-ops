import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Organization = Tables<'organizations'>;
// organization_branding (id, name, logo_url, primary_color) is a view for signed-out branding; it is not yet in
// the generated types — regenerate after the migration ships.
type BrandingRow = Pick<Organization, 'id' | 'name' | 'logo_url' | 'primary_color'>;
interface BrandingClient {
  select(cols: string): { limit(n: number): { maybeSingle(): Promise<{ data: BrandingRow | null; error: { message: string } | null }> } };
}

export function useOrganization() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrganization = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data, error } = await supabase.from('organizations').select('*').limit(1).maybeSingle();
          if (error) throw error;
          setOrganization(data);
        } else {
          const { data, error } = await (supabase.from('organization_branding' as 'organizations') as unknown as BrandingClient)
            .select('id,name,logo_url,primary_color').limit(1).maybeSingle();
          if (error) throw error;
          setOrganization(data ? ({ ...data, email: null, created_at: null, updated_at: null } as Organization) : null);
        }
      } catch (error) {
        if (import.meta.env.DEV) console.error('Error fetching organization:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchOrganization();

    // Signing in swaps the branding view for the full row (and its settings); signing out swaps back.
    const { data: auth } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') void fetchOrganization();
    });

    const channel = supabase
      .channel('organization-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'organizations' }, (payload) => {
        if (payload.new) setOrganization(payload.new as Organization);
      })
      .subscribe();

    return () => {
      auth.subscription.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, []);

  return { organization, loading };
}
