/**
 * The signed-in user's inbox: newest 50 rows, an exact unread total, per-kind counts and
 * mark-read. RLS restricts the table to the recipient, so no client-side filtering is needed
 * beyond the user id.
 *
 * The realtime subscription deliberately does NOT live in this hook — see
 * `useNotificationsRealtime` below, which must be called exactly once per app.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { NotificationKind } from '@/lib/notify';

export interface NotificationRow {
  id: string; kind: NotificationKind;
  actor_name: string | null; title: string; body: string | null; url: string; read_at: string | null; created_at: string;
}

const KEY = ['notifications'];
const LIMIT = 50;
/** Trailing debounce: markAllRead fans out one realtime event per row, and one refetch is enough. */
const INVALIDATE_DEBOUNCE_MS = 150;

// notifications is not yet in the generated types; regenerate after the migration ships.
const table = () => supabase.from('notifications' as never) as any;

const rowsKeyFor = (uid: string | undefined) => [...KEY, uid];
const countKeyFor = (uid: string | undefined) => [...KEY, 'unread-count', uid];

/**
 * Owns the single realtime channel for the signed-in user's notifications. Call this ONCE,
 * from the layout that persists across routes — never from a component that mounts per page.
 *
 * Why once: `supabase.channel(topic)` returns the EXISTING channel for a topic that is already
 * open, so a second caller does not get its own channel — it appends another binding to a
 * channel that has already joined. `.subscribe()` is then a no-op, and the binding count in the
 * join reply no longer matches what the server acknowledged, which errors the channel: live
 * updates stop working for everybody. Worse, the first consumer to unmount calls
 * `removeChannel` and tears the shared channel down under the others. One owner, one channel.
 */
export function useNotificationsRealtime() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` }, () => {
        if (debounce.current) clearTimeout(debounce.current);
        debounce.current = setTimeout(() => {
          debounce.current = null;
          // The ['notifications'] prefix covers both the row list and the exact unread count.
          void qc.invalidateQueries({ queryKey: KEY });
        }, INVALIDATE_DEBOUNCE_MS);
      })
      .subscribe();
    return () => {
      if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
      supabase.removeChannel(channel);
    };
  }, [user?.id, qc]);
}

export function useNotifications() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id;

  const query = useQuery({
    queryKey: rowsKeyFor(uid),
    enabled: !!uid,
    queryFn: async (): Promise<NotificationRow[]> => {
      const { data, error } = await table()
        .select('id, kind, actor_name, title, body, url, read_at, created_at')
        .eq('recipient_id', uid)
        .order('created_at', { ascending: false })
        .limit(LIMIT);
      if (error) throw new Error(error.message);
      return (data ?? []) as NotificationRow[];
    },
  });

  // The unread total has to stay right past the LIMIT-row window, so it is a head-only
  // exact count rather than a tally of the rows we happen to have loaded.
  const countQuery = useQuery({
    queryKey: countKeyFor(uid),
    enabled: !!uid,
    queryFn: async (): Promise<number> => {
      const { count, error } = await table()
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', uid)
        .is('read_at', null);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });

  const items = useMemo(() => query.data ?? [], [query.data]);
  const loadedUnread = useMemo(() => items.filter((n) => !n.read_at).length, [items]);
  /** Exact; falls back to the loaded-rows tally only while the count query is in flight. */
  const unread = countQuery.data ?? loadedUnread;

  /**
   * Approximate by design: computed over the newest LIMIT rows only, so a kind whose unread
   * rows have fallen outside that window is undercounted. `unread` above is the exact total.
   */
  const unreadByKind = useCallback(
    (kinds: NotificationKind[]) => items.filter((n) => !n.read_at && kinds.includes(n.kind)).length,
    [items],
  );

  const adjustCount = useCallback((delta: number) => {
    qc.setQueryData<number>(countKeyFor(uid), (old) => (typeof old === 'number' ? Math.max(0, old + delta) : old));
  }, [qc, uid]);

  const markRead = useCallback(async (id: string) => {
    if (!uid) return;
    const now = new Date().toISOString();
    const wasUnread = !!qc.getQueryData<NotificationRow[]>(rowsKeyFor(uid))?.some((n) => n.id === id && !n.read_at);
    qc.setQueryData<NotificationRow[]>(rowsKeyFor(uid), (old) => old?.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? now } : n)));
    if (wasUnread) adjustCount(-1);
    const { error } = await table().update({ read_at: now }).eq('id', id).is('read_at', null);
    if (error) void qc.invalidateQueries({ queryKey: KEY });
  }, [qc, uid, adjustCount]);

  const markAllRead = useCallback(async () => {
    if (!uid) return;
    const now = new Date().toISOString();
    qc.setQueryData<NotificationRow[]>(rowsKeyFor(uid), (old) => old?.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    qc.setQueryData<number>(countKeyFor(uid), 0);
    const { error } = await table().update({ read_at: now }).eq('recipient_id', uid).is('read_at', null);
    if (error) void qc.invalidateQueries({ queryKey: KEY });
  }, [qc, uid]);

  const refetch = useCallback(() => {
    void countQuery.refetch();
    return query.refetch();
  }, [query, countQuery]);

  return { items, unread, unreadByKind, markRead, markAllRead, isLoading: query.isLoading, isError: query.isError, refetch };
}
