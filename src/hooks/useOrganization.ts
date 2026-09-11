import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { ORG_SETTINGS_KEY } from '@/hooks/useOrgSettings';

type Organization = Tables<'organizations'>;

export function useOrganization() {
  const qc = useQueryClient();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // null until the first read has seen the session; afterwards "was the last read anonymous?".
    let wasAnon: boolean | null = null;
    let channel: RealtimeChannel | null = null;

    // The organizations table is authenticated-only, so a signed-out client would only ever get
    // CHANNEL_ERROR from it: subscribe while a session exists, tear down when it goes.
    const syncRealtime = (hasSession: boolean) => {
      if (hasSession && !channel) {
        channel = supabase
          .channel('organization-changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'organizations' }, (payload) => {
            if (!payload.new || cancelled) return;
            setOrganization(payload.new as Organization);
            // The settings editors read through useOrgSettings; a row change from elsewhere must reach them too.
            if ('settings' in payload.new) void qc.invalidateQueries({ queryKey: ORG_SETTINGS_KEY });
          })
          .subscribe();
      } else if (!hasSession && channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };

    const fetchOrganization = async (session: Session | null) => {
      wasAnon = !session;
      syncRealtime(!!session);
      try {
        if (session) {
          const { data, error } = await supabase.from('organizations').select('*').limit(1).maybeSingle();
          if (error) throw error;
          if (!cancelled) setOrganization(data);
        } else {
          // The signed-out branding view: id, name, logo_url, primary_color only. The generator types a view's
          // columns nullable; `id` is the table's key and never is. The columns the view does not expose are
          // nulled/emptied here — an anonymous page must not read a setting from this row (see useOrgSettings).
          const { data, error } = await supabase.from('organization_branding').select('id,name,logo_url,primary_color').limit(1).maybeSingle();
          if (error) throw error;
          if (!cancelled) {
            setOrganization(data?.id ? { ...data, id: data.id, email: null, created_at: null, updated_at: null, settings: {} } : null);
          }
        }
      } catch (error) {
        if (import.meta.env.DEV) console.error('Error fetching organization:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!cancelled) await fetchOrganization(session);
    })();

    // Signing in swaps the branding view for the full row (and its settings); signing out swaps back. Any
    // event that keeps the same shape (token refresh, user update) changes nothing this hook reads.
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      const nowAnon = !session;
      if (wasAnon !== null && wasAnon === nowAnon) return;
      void fetchOrganization(session);
    });

    return () => {
      cancelled = true;
      auth.subscription.unsubscribe();
      syncRealtime(false);
    };
  }, [qc]);

  return { organization, loading };
}
