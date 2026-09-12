/**
 * The one rule the invite dialog and the invite-user edge function both enforce (spec §4.3): a
 * field-staff account with no building can see nothing and receives nothing, so it must not be
 * created. Kept pure so the dialog's validation is unit-tested without rendering the page.
 */
export const FIELD_STAFF_NEEDS_BUILDING = 'Field staff need at least one building';
export const FIELD_STAFF_BUILDING_HELP = 'Field staff only see the buildings ticked here. Managers and admins see every building.';
export const SET_TEAM_ACTION_LABEL = 'Set what they do at each building';

/** Why the invite cannot be sent yet, or null when it can. */
export function inviteBlockedReason(role: string, buildingIds: string[]): string | null {
  return role === 'user' && buildingIds.length === 0 ? FIELD_STAFF_NEEDS_BUILDING : null;
}

export function teamTabUrl(buildingId: string): string {
  return `/buildings/${buildingId}?tab=team`;
}
