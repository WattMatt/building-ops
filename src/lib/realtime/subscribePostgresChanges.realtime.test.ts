import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RealtimeClient } from '@supabase/realtime-js';
import { FakeSocket, createFakeRealtimeClient, flush } from './fakeRealtimeServer';

/**
 * End-to-end proof against the real realtime-js: with the registry in front of the client,
 * two consumers on one key produce one join carrying one filter, the join is acknowledged as
 * SUBSCRIBED (no binding mismatch), and one consumer leaving does not close the other's feed.
 *
 * A RealtimeClient exposes the same channel()/removeChannel() surface the registry uses on
 * the SupabaseClient, so it stands in for `supabase` at the module seam.
 */
const holder = vi.hoisted(() => ({ client: null as unknown as RealtimeClient }));
vi.mock('@/integrations/supabase/client', () => ({
  get supabase() {
    return holder.client;
  },
}));

const ORG = { event: '*', schema: 'public', table: 'organizations' } as const;
type Subscribe = typeof import('./subscribePostgresChanges').subscribePostgresChanges;
let subscribePostgresChanges: Subscribe;

beforeEach(async () => {
  FakeSocket.reset();
  holder.client = createFakeRealtimeClient();
  vi.resetModules();
  ({ subscribePostgresChanges } = await import('./subscribePostgresChanges'));
});
afterEach(() => {
  holder.client.disconnect();
});

describe('subscribePostgresChanges over real realtime-js', () => {
  it('two consumers → one join with one filter, acknowledged without a mismatch', async () => {
    const seen: string[] = [];
    subscribePostgresChanges<{ name: string }>('organization-changes', ORG, (p) => seen.push(`a:${(p.new as { name?: string }).name}`));
    subscribePostgresChanges<{ name: string }>('organization-changes', ORG, (p) => seen.push(`b:${(p.new as { name?: string }).name}`));
    await flush();

    const socket = FakeSocket.latest();
    expect(socket.joins()).toHaveLength(1);
    expect((socket.joins()[0].payload.config as { postgres_changes: unknown[] }).postgres_changes).toHaveLength(1);

    socket.ackJoins();
    await flush();
    const [channel] = holder.client.getChannels();
    expect(channel.state).toBe('joined');

    socket.emitChange('realtime:organization-changes', 'organizations', 'UPDATE', { id: '1', name: 'Acme' });
    expect(seen).toEqual(['a:Acme', 'b:Acme']);
  });

  it('the first consumer leaving does not close the feed for the second', async () => {
    const seen: string[] = [];
    const releaseA = subscribePostgresChanges<{ name: string }>('organization-changes', ORG, () => seen.push('a'));
    subscribePostgresChanges<{ name: string }>('organization-changes', ORG, () => seen.push('b'));
    await flush();
    const socket = FakeSocket.latest();
    socket.ackJoins();
    await flush();

    releaseA();
    await flush();
    expect(socket.leaves()).toHaveLength(0);
    expect(holder.client.getChannels()).toHaveLength(1);

    socket.emitChange('realtime:organization-changes', 'organizations', 'UPDATE', { id: '1', name: 'Acme' });
    expect(seen).toEqual(['b']);
  });
});
