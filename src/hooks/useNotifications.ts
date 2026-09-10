/**
 * The signed-in user's inbox: newest 50 rows, unread counts (total and per kind), mark-read,
 * and a realtime subscription so a new row appears without a reload. RLS restricts the table
 * to the recipient, so no client-side filtering is needed beyond the user id.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { NotificationKind } from '@/lib/notify';

export interface NotificationRow {
  id: string; kind: NotificationKind; entity_type: string; entity_id: string | null; building_id: string | null;
  actor_name: string | null; title: string; body: string | null; url: string; read_at: string | null; created_at: string;
}

const KEY = ['notifications'];
const PAGE = 50;

export function useNotifications() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [...KEY, user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<NotificationRow[]> => {
      // notifications is not yet in the generated types; regenerate after the migration ships.
      const { data, error } = await (supabase.from('notifications' as never) as any)
        .select('id, kind, entity_type, entity_id, building_id, actor_name, title, body, url, read_at, created_at')
        .eq('recipient_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(PAGE);
      if (error) throw new Error(error.message);
      return (data ?? []) as NotificationRow[];
    },
  });

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` }, () => {
        void qc.invalidateQueries({ queryKey: KEY });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, qc]);

  const items = useMemo(() => query.data ?? [], [query.data]);
  const unread = useMemo(() => items.filter((n) => !n.read_at).length, [items]);
  const unreadByKind = useCallback((kinds: NotificationKind[]) => items.filter((n) => !n.read_at && kinds.includes(n.kind)).length, [items]);

  const markRead = useCallback(async (id: string) => {
    qc.setQueryData<NotificationRow[]>([...KEY, user?.id], (old) => old?.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    const { error } = await (supabase.from('notifications' as never) as any).update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null);
    if (error) void qc.invalidateQueries({ queryKey: KEY });
  }, [qc, user?.id]);

  const markAllRead = useCallback(async () => {
    if (!user?.id) return;
    qc.setQueryData<NotificationRow[]>([...KEY, user.id], (old) => old?.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    const { error } = await (supabase.from('notifications' as never) as any).update({ read_at: new Date().toISOString() }).eq('recipient_id', user.id).is('read_at', null);
    if (error) void qc.invalidateQueries({ queryKey: KEY });
  }, [qc, user?.id]);

  return { items, unread, unreadByKind, markRead, markAllRead, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}
