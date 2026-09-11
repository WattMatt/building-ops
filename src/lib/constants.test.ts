import { describe, expect, it } from 'vitest';
import { ROLE_OPTIONS, ROLE_PRECEDENCE, ROLE_LABELS, ROLE_COLORS, type AppRole } from './constants';

// D4 / spec §5.3: the app has exactly three roles. `reviewer` was removed because no
// account held it and no RLS policy granted it anything — its only power was a client
// branch. This test pins the list so the role can't quietly creep back in one place.
describe('role constants', () => {
  it('ROLE_PRECEDENCE is admin > manager > user', () => {
    expect(ROLE_PRECEDENCE).toEqual(['admin', 'manager', 'user']);
  });

  it('ROLE_OPTIONS offers exactly three roles', () => {
    expect(ROLE_OPTIONS).toHaveLength(3);
    expect(ROLE_OPTIONS.map((o) => o.value)).toEqual(['admin', 'manager', 'user']);
  });

  it('labels and colours cover every role and nothing else', () => {
    const roles: AppRole[] = ['admin', 'manager', 'user'];
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...roles].sort());
    expect(Object.keys(ROLE_COLORS).sort()).toEqual([...roles].sort());
  });

  it('the AppRole union is exactly the three roles (type-level)', () => {
    // Assignability in both directions: a compile error here means the union drifted.
    type Expected = 'admin' | 'manager' | 'user';
    const toExpected: Expected = null as unknown as AppRole;
    const toAppRole: AppRole = null as unknown as Expected;
    // @ts-expect-error — 'reviewer' is no longer a role.
    const notARole: AppRole = 'reviewer';
    expect([toExpected, toAppRole, notARole]).toBeDefined();
  });
});
