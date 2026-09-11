import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { RealtimeClient } from '@supabase/realtime-js';
import { FakeSocket, createFakeRealtimeClient, flush } from './fakeRealtimeServer';

/**
 * Pins the realtime-js (2.91.x) behaviour that makes a fixed channel name unsafe to share
 * between independent consumers. These tests exercise the real library over a fake
 * transport; they do NOT test app code. If a library upgrade makes them fail, the
 * ref-counted wrapper in ./subscribePostgresChanges.ts may no longer be necessary.
 */
const FILTER = { event: '*', schema: 'public', table: 'organizations' } as const;

describe('realtime-js: two consumers on one channel name', () => {
  let client: RealtimeClient;
  beforeEach(() => {
    FakeSocket.reset();
    client = createFakeRealtimeClient();
  });
  afterEach(() => {
    client.disconnect();
  });

  it('errors the shared channel with a binding mismatch when both subscribe', async () => {
    const statuses: string[] = [];
    const errors: string[] = [];
    const track = (tag: string) => (s: string, err?: Error) => {
      statuses.push(`${tag}:${s}`);
      if (err) errors.push(err.message);
    };
    const a = client.channel('organization-changes').on('postgres_changes', FILTER, () => {}).subscribe(track('a'));
    const b = client.channel('organization-changes').on('postgres_changes', FILTER, () => {}).subscribe(track('b'));
    await flush();

    // Same object: the second consumer did not get its own channel.
    expect(b).toBe(a);
    const socket = FakeSocket.latest();
    const joins = socket.joins();
    // One join, carrying only the filter that existed when subscribe() ran.
    expect(joins).toHaveLength(1);
    expect((joins[0].payload.config as { postgres_changes: unknown[] }).postgres_changes).toHaveLength(1);
    // ...but the channel now holds two client bindings.
    const bindings = (a as unknown as { bindings: { postgres_changes?: unknown[] } }).bindings;
    expect(bindings.postgres_changes).toHaveLength(2);

    socket.ackJoins();
    await flush();

    expect(statuses).toContain('a:CHANNEL_ERROR');
    expect(statuses.filter((s) => s.startsWith('b:'))).toEqual([]); // b's subscribe() was a no-op
    expect(errors).toEqual(['mismatch between server and client bindings for postgres changes']);
    expect(a.state).toBe('errored');
    expect(socket.leaves()).toHaveLength(1);
  });

  it('lets the first consumer to unmount tear the channel down under the second', async () => {
    const received: string[] = [];
    const a = client.channel('organization-changes').on('postgres_changes', FILTER, () => received.push('a')).subscribe();
    await flush();
    const socket = FakeSocket.latest();
    socket.ackJoins();
    await flush();
    expect(a.state).toBe('joined');

    // Second consumer arrives after the first has joined and adds its own binding.
    client.channel('organization-changes').on('postgres_changes', FILTER, () => received.push('b'));

    // First consumer's effect cleanup.
    void client.removeChannel(a);
    socket.ackLeaves();
    await flush();

    expect(client.getChannels()).toHaveLength(0);
    socket.emitChange('realtime:organization-changes', 'organizations', 'UPDATE', { id: '1', name: 'x' });
    expect(received).toEqual([]);
  });
});
