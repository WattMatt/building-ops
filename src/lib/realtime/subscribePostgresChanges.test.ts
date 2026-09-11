import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Unit tests for the ref-counted subscription registry, with the Supabase client stubbed
 * at the module seam. The fake channel records the binding it was given so a test can
 * push a payload through the single server-facing binding.
 */
const stub = vi.hoisted(() => {
  type Payload = { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> };
  type Binding = (p: Payload) => void;
  interface FakeChannel {
    topic: string;
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  }
  const state = {
    channels: [] as Array<{ name: string; channel: FakeChannel | null; bindings: Binding[] }>,
    removeChannel: vi.fn(async () => 'ok'),
  };
  const channel = vi.fn((name: string) => {
    const entry: (typeof state.channels)[number] = { name, channel: null, bindings: [] };
    const chan: FakeChannel = {
      topic: `realtime:${name}`,
      on: vi.fn((_type: string, _filter: unknown, cb: Binding) => {
        entry.bindings.push(cb);
        return chan;
      }),
      subscribe: vi.fn(() => chan),
    };
    entry.channel = chan;
    state.channels.push(entry);
    return chan;
  });
  return { state, channel };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { channel: stub.channel, removeChannel: stub.state.removeChannel },
}));

const ORG = { event: '*', schema: 'public', table: 'organizations' } as const;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

type Subscribe = typeof import('./subscribePostgresChanges').subscribePostgresChanges;
let subscribePostgresChanges: Subscribe;

beforeEach(async () => {
  stub.state.channels = [];
  stub.channel.mockClear();
  stub.state.removeChannel.mockClear();
  stub.state.removeChannel.mockImplementation(async () => 'ok');
  vi.resetModules();
  ({ subscribePostgresChanges } = await import('./subscribePostgresChanges'));
});

describe('subscribePostgresChanges', () => {
  it('opens one channel with one binding for two listeners on the same key', () => {
    subscribePostgresChanges('organization-changes', ORG, () => {});
    subscribePostgresChanges('organization-changes', ORG, () => {});

    expect(stub.channel).toHaveBeenCalledTimes(1);
    expect(stub.channel).toHaveBeenCalledWith('organization-changes');
    const [entry] = stub.state.channels;
    expect(entry.channel!.on).toHaveBeenCalledTimes(1);
    expect(entry.channel!.on).toHaveBeenCalledWith('postgres_changes', ORG, expect.any(Function));
    expect(entry.channel!.subscribe).toHaveBeenCalledTimes(1);
  });

  it('fans one payload out to every listener', () => {
    const seen: string[] = [];
    subscribePostgresChanges<{ name: string }>('organization-changes', ORG, (p) => seen.push(`a:${(p.new as { name: string }).name}`));
    subscribePostgresChanges<{ name: string }>('organization-changes', ORG, (p) => seen.push(`b:${(p.new as { name: string }).name}`));

    stub.state.channels[0].bindings[0]({ eventType: 'UPDATE', new: { name: 'Acme' }, old: {} });
    expect(seen).toEqual(['a:Acme', 'b:Acme']);
  });

  it('keeps the channel open until the last listener releases, then removes it once', async () => {
    const releaseA = subscribePostgresChanges('organization-changes', ORG, () => {});
    const releaseB = subscribePostgresChanges('organization-changes', ORG, () => {});

    releaseA();
    expect(stub.state.removeChannel).not.toHaveBeenCalled();

    releaseB();
    expect(stub.state.removeChannel).toHaveBeenCalledTimes(1);
    expect(stub.state.removeChannel).toHaveBeenCalledWith(stub.state.channels[0].channel);
    await flush();
    expect(stub.state.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('stops delivering to a listener that has released while others stay live', () => {
    const seen: string[] = [];
    const releaseA = subscribePostgresChanges('organization-changes', ORG, () => seen.push('a'));
    subscribePostgresChanges('organization-changes', ORG, () => seen.push('b'));
    releaseA();

    stub.state.channels[0].bindings[0]({ eventType: 'UPDATE', new: {}, old: {} });
    expect(seen).toEqual(['b']);
  });

  it('gives different keys their own channels', () => {
    subscribePostgresChanges('organization-changes', ORG, () => {});
    subscribePostgresChanges('profile-changes:u1', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: 'id=eq.u1' }, () => {});
    expect(stub.channel).toHaveBeenCalledTimes(2);
  });

  it('does not reopen a key until the previous channel has finished leaving', async () => {
    let finishLeave!: () => void;
    stub.state.removeChannel.mockImplementation(() => new Promise<string>((r) => { finishLeave = () => r('ok'); }));

    const release = subscribePostgresChanges('organization-changes', ORG, () => {});
    release();
    expect(stub.state.removeChannel).toHaveBeenCalledTimes(1);

    // Re-acquire while the leave is still in flight: supabase.channel(name) would hand back
    // the leaving channel, so the registry must wait.
    const seen: string[] = [];
    subscribePostgresChanges('organization-changes', ORG, () => seen.push('late'));
    expect(stub.channel).toHaveBeenCalledTimes(1);

    finishLeave();
    await flush();
    expect(stub.channel).toHaveBeenCalledTimes(2);
    stub.state.channels[1].bindings[0]({ eventType: 'UPDATE', new: {}, old: {} });
    expect(seen).toEqual(['late']);
  });

  it('does not open a channel for a listener that released while waiting on a leave', async () => {
    let finishLeave!: () => void;
    stub.state.removeChannel.mockImplementation(() => new Promise<string>((r) => { finishLeave = () => r('ok'); }));

    subscribePostgresChanges('organization-changes', ORG, () => {})();
    const releaseLate = subscribePostgresChanges('organization-changes', ORG, () => {});
    releaseLate();

    finishLeave();
    await flush();
    expect(stub.channel).toHaveBeenCalledTimes(1);
    expect(stub.state.removeChannel).toHaveBeenCalledTimes(1);
  });
});
