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
    // setup.ts installs a plain-object localStorage, so spying on its methods is enough.
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(() => writeLastBuilding('u1', 'b1')).not.toThrow();
    expect(readLastBuilding('u1')).toBe('');
  });
});
