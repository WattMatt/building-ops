import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readLastBuilding, writeLastBuilding } from './lastBuilding';

describe('lastBuilding', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('round-trips per user under fortress.lastBuilding.<uid>', () => {
    expect(readLastBuilding('u1')).toBe('');
    writeLastBuilding('u1', 'b1');
    expect(window.localStorage.getItem('fortress.lastBuilding.u1')).toBe('b1');
    expect(readLastBuilding('u1')).toBe('b1');
    expect(readLastBuilding('u2')).toBe('');
  });

  it('overwrites the previous value', () => {
    writeLastBuilding('u1', 'b1');
    writeLastBuilding('u1', 'b2');
    expect(readLastBuilding('u1')).toBe('b2');
  });

  it('swallows storage failures (private mode, quota, disabled storage)', () => {
    // Do not spy on the methods: under Node 22's jsdom `window.localStorage` is a real Storage
    // proxy whose named-property setter turns the spy into a stored key ("setItem" → "[Function]")
    // and the real methods keep working, so the test passed locally (plain-object shim from
    // setup.ts) and failed in CI. Shadowing the property on the window instance works in both.
    const throwing = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    const w = window as unknown as Record<string, unknown>;
    const own = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const restore = own && !own.configurable
      // setup.ts's shim: an own, writable, non-configurable data property — reassign it.
      ? (() => { const prev = w.localStorage; w.localStorage = throwing; return () => { w.localStorage = prev; }; })()
      // Real jsdom Storage (own configurable accessor) or a prototype accessor — shadow it, then
      // put the original descriptor back so the other tests in this file keep a working store.
      : (() => {
          Object.defineProperty(window, 'localStorage', { configurable: true, value: throwing });
          return () => {
            if (own) Object.defineProperty(window, 'localStorage', own);
            else delete w.localStorage;
          };
        })();
    try {
      expect(() => writeLastBuilding('u1', 'b1')).not.toThrow();
      expect(readLastBuilding('u1')).toBe('');
    } finally {
      restore();
    }
  });
});
