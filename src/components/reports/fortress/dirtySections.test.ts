import { describe, it, expect, beforeEach } from 'vitest';
import { dirtySections } from './dirtySections';

describe('dirtySections store', () => {
  beforeEach(() => dirtySections.reset());

  it('starts clean', () => {
    expect(dirtySections.count()).toBe(0);
  });

  it('tracks ids and notifies subscribers', () => {
    let seen = -1;
    const off = dirtySections.subscribe(() => { seen = dirtySections.count(); });
    dirtySections.set('expense_recoveries', true);
    dirtySections.set('utility_readings', true);
    expect(seen).toBe(2);
    dirtySections.set('expense_recoveries', false);
    expect(seen).toBe(1);
    off();
  });

  it('does not notify when state is unchanged', () => {
    let notifications = 0;
    const off = dirtySections.subscribe(() => { notifications += 1; });
    dirtySections.set('a', true);
    dirtySections.set('a', true);
    dirtySections.set('b', false);
    expect(notifications).toBe(1);
    off();
  });

  it('reset clears everything', () => {
    dirtySections.set('a', true);
    dirtySections.reset();
    expect(dirtySections.count()).toBe(0);
  });
});
