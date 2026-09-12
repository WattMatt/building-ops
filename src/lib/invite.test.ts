import { describe, it, expect } from 'vitest';
import { inviteBlockedReason, teamTabUrl, FIELD_STAFF_BUILDING_HELP, FIELD_STAFF_NEEDS_BUILDING } from './invite';

describe('inviteBlockedReason', () => {
  it('blocks a field-staff invite with no building', () => {
    expect(inviteBlockedReason('user', [])).toBe(FIELD_STAFF_NEEDS_BUILDING);
    expect(FIELD_STAFF_NEEDS_BUILDING).toBe('Field staff need at least one building');
  });

  it('allows field staff with a building, and managers or admins with none', () => {
    expect(inviteBlockedReason('user', ['b1'])).toBeNull();
    expect(inviteBlockedReason('manager', [])).toBeNull();
    expect(inviteBlockedReason('admin', [])).toBeNull();
  });
});

describe('copy and links', () => {
  it('uses the spec wording for the building help text', () => {
    expect(FIELD_STAFF_BUILDING_HELP).toBe('Field staff only see the buildings ticked here. Managers and admins see every building.');
  });

  it('teamTabUrl deep-links to the Team tab', () => {
    expect(teamTabUrl('b1')).toBe('/buildings/b1?tab=team');
  });
});
