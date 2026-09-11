/**
 * One live Realtime subscription per key, shared by every consumer that asks for it.
 *
 * Why this exists (verified against @supabase/realtime-js 2.91.1, pinned by
 * ./channelCollision.test.ts):
 *  - `supabase.channel(name)` returns the EXISTING channel when one with that topic is open,
 *    so two hooks using a fixed name do not get two channels — the second `.on()` appends a
 *    binding to a channel that has already sent its join, `.subscribe()` is a no-op, and the
 *    join reply then carries fewer filters than the client has bindings. The library treats
 *    that as a mismatch, unsubscribes, and the channel ends in CHANNEL_ERROR for everyone.
 *  - `supabase.removeChannel(ch)` from any one consumer's cleanup tears the shared channel
 *    down under every other consumer.
 *
 * So a channel gets exactly one owner: this registry. The first subscriber for a key opens
 * the channel with a single binding, later subscribers attach to that binding, and the
 * channel is removed only when the last subscriber releases. A key must fully identify the
 * filter (put the user id in the key when the filter has one), because listeners share
 * whatever binding the key was first opened with.
 *
 * Re-acquiring a key while its previous channel is still leaving waits for the leave to
 * finish: until then `supabase.channel(name)` would hand back the departing channel.
 */
import type {
  RealtimeChannel,
  RealtimePostgresChangesFilter,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export interface PostgresChangesFilter {
  event: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  schema: string;
  table: string;
  filter?: string;
}

type Row = Record<string, unknown>;
type Listener<T extends Row> = (payload: RealtimePostgresChangesPayload<T>) => void;

interface Entry {
  channel: RealtimeChannel | null;
  listeners: Set<Listener<Row>>;
}

const entries = new Map<string, Entry>();
/** Per key: the in-flight removal of the previous channel, if any. */
const leaving = new Map<string, Promise<unknown>>();

export function subscribePostgresChanges<T extends Row = Row>(
  key: string,
  filter: PostgresChangesFilter,
  listener: Listener<T>,
): () => void {
  let entry = entries.get(key);
  if (!entry) {
    const fresh: Entry = { channel: null, listeners: new Set() };
    entry = fresh;
    entries.set(key, fresh);

    const open = () => {
      // Every listener released while we were waiting; nothing to open.
      if (entries.get(key) !== fresh) return;
      fresh.channel = supabase
        .channel(key)
        // The library types each event as its own overload; one binding takes any of them.
        .on('postgres_changes', filter as RealtimePostgresChangesFilter<'*'>, (payload: RealtimePostgresChangesPayload<Row>) => {
          // Snapshot: a listener may release itself while being called.
          for (const l of Array.from(fresh.listeners)) l(payload);
        })
        .subscribe();
    };
    const pending = leaving.get(key);
    if (pending) void pending.then(open, open);
    else open();
  }

  const listeners = entry.listeners;
  // Listeners on one key all see the same row shape; T only narrows the caller's view.
  const shared = listener as unknown as Listener<Row>;
  listeners.add(shared);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    listeners.delete(shared);
    if (listeners.size > 0 || entries.get(key) !== entry) return;

    entries.delete(key);
    const channel = entry.channel;
    if (!channel) return; // never opened (released while a previous leave was in flight)
    const removal = supabase.removeChannel(channel).catch(() => undefined).finally(() => {
      if (leaving.get(key) === removal) leaving.delete(key);
    });
    leaving.set(key, removal);
  };
}
