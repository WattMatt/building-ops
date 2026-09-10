/**
 * Test double for the Supabase Realtime transport: a WebSocket-shaped class that
 * `RealtimeClient` instantiates via its `transport` option, plus a tiny "server" that
 * acknowledges joins the way the real service does — one `postgres_changes` entry per
 * filter it was sent, in order, each with an id.
 *
 * Used by the tests that pin the library behaviour behind `subscribePostgresChanges`.
 */
import { RealtimeClient, type RealtimeClientOptions } from '@supabase/realtime-js';

interface WireMessage {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
  ref: string | null;
  join_ref?: string | null;
}

export class FakeSocket {
  static instances: FakeSocket[] = [];
  static latest(): FakeSocket {
    const s = FakeSocket.instances[FakeSocket.instances.length - 1];
    if (!s) throw new Error('no FakeSocket has been constructed yet');
    return s;
  }
  static reset() {
    FakeSocket.instances = [];
  }

  readonly url: string;
  /** 1 = open, so RealtimeClient treats the connection as live immediately. */
  readyState = 1;
  sent: WireMessage[] = [];
  onopen: null | (() => void) = null;
  onmessage: null | ((e: { data: string }) => void) = null;
  onerror: null | ((e: unknown) => void) = null;
  onclose: null | ((e: unknown) => void) = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.({});
  }
  /** Deliver a message from the "server". */
  receive(msg: WireMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  joins() {
    return this.sent.filter((m) => m.event === 'phx_join');
  }
  leaves() {
    return this.sent.filter((m) => m.event === 'phx_leave');
  }

  /** Acknowledge every unanswered join, echoing back exactly the filters it carried. */
  ackJoins() {
    for (const join of this.joins()) {
      if (this.acked.has(join.ref!)) continue;
      this.acked.add(join.ref!);
      const config = join.payload.config as { postgres_changes?: Record<string, unknown>[] } | undefined;
      const filters = config?.postgres_changes ?? [];
      this.receive({
        topic: join.topic,
        event: 'phx_reply',
        ref: join.ref,
        payload: {
          status: 'ok',
          response: { postgres_changes: filters.map((f, i) => ({ id: i + 1, ...f })) },
        },
      });
    }
  }
  /** Acknowledge every unanswered leave. */
  ackLeaves() {
    for (const leave of this.leaves()) {
      if (this.acked.has(leave.ref!)) continue;
      this.acked.add(leave.ref!);
      this.receive({ topic: leave.topic, event: 'phx_reply', ref: leave.ref, payload: { status: 'ok', response: {} } });
    }
  }
  /** Push a row change for `table` on `topic`, addressed to server filter id 1. */
  emitChange(topic: string, table: string, type: 'INSERT' | 'UPDATE' | 'DELETE', record: Record<string, string>) {
    this.receive({
      topic,
      event: 'postgres_changes',
      ref: null,
      payload: {
        ids: [1],
        data: {
          type,
          schema: 'public',
          table,
          commit_timestamp: '2026-09-10T00:00:00Z',
          columns: Object.keys(record).map((name) => ({ name, type: 'text' })),
          record,
          old_record: {},
          errors: null,
        },
      },
    });
  }

  private acked = new Set<string>();
}

export function createFakeRealtimeClient() {
  return new RealtimeClient('ws://fake.local/realtime/v1', {
    params: { apikey: 'test-key' },
    transport: FakeSocket as unknown as NonNullable<RealtimeClientOptions['transport']>,
    vsn: '1.0.0',
    heartbeatIntervalMs: 60_000,
    timeout: 60_000,
  });
}

/** Let the client's internal promise chains (auth-then-flush) settle. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
