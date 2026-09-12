/**
 * The building this user last reported an issue against (spec: field-readiness §8). A caretaker
 * with several buildings usually reports from the one they reported from last, so New Issue
 * pre-selects it when neither the URL nor a single-building roster decides.
 *
 * localStorage, not IndexedDB: one short id, read synchronously so the select never flashes
 * empty. Keyed per user for the same reason as the palette recents — a phone shared between
 * two caretakers must not carry one person's building to the next. Storage failures are
 * swallowed: this is a convenience, never worth an error in the form.
 */
const keyFor = (uid: string) => `fortress.lastBuilding.${uid}`;

export function readLastBuilding(uid: string): string {
  try {
    return window.localStorage.getItem(keyFor(uid)) ?? '';
  } catch {
    return '';
  }
}

export function writeLastBuilding(uid: string, buildingId: string): void {
  try {
    window.localStorage.setItem(keyFor(uid), buildingId);
  } catch {
    // Private mode / quota / storage disabled: remembering is best-effort.
  }
}
