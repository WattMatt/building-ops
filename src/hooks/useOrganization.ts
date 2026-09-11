import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { subscribePostgresChanges } from '@/lib/realtime/subscribePostgresChanges';
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
    /** Non-null while this consumer holds the shared 'organization-changes' subscription. */
    let releaseRealtime: (() => void) | null = null;

    // The organizations table is authenticated-only, so a signed-out client would only ever get
    // CHANNEL_ERROR from it: subscribe while a session exists, tear down when it goes.
    //
    // Many components call this hook at once (the layout plus whatever page is inside it), so the
    // subscription goes through the registry, which keeps ONE live channel for all of them: opening
    // a channel per consumer under a fixed name errors the shared channel, and the first consumer
    // to unmount would remove it under the others — see subscribePostgresChanges. Sign-out releases
    // this consumer's hold; signing back in re-acquires the key, and the registry waits for the
    // previous channel's leave to be acknowledged before reopening it.
    const syncRealtime = (hasSession: boolean) => {
      if (hasSession && !releaseRealtime) {
        releaseRealtime = subscribePostgresChanges<Organization>(
          'organization-changes',
          { event: '*', schema: 'public', table: 'organizations' },
          (payload) => {
            if (!payload.new || cancelled) return;
            setOrganization(payload.new as Organization);
            // The settings editors read through useOrgSettings; a row change from elsewhere must reach them too.
            if ('settings' in payload.new) void qc.invalidateQueries({ queryKey: ORG_SETTINGS_KEY });
          },
        );
      } else if (!hasSession && releaseRealtime) {
        releaseRealtime();
        releaseRealtime = null;
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
