/**
 * Standard tenant ordering — the single source of truth for how tenant lists are
 * sorted across the app. Natural/numeric on `shop_number` so lists always read
 * 1, 2, …, 9, 10, 11 (NOT lexicographic 1, 10, 11, 2). Numeric codes sort ahead of
 * named units (BUS TICKET OFFICE, F/STANDING, KIOSK 01, …) and lettered bays
 * (31 A … 31 E) fall in sensible places.
 *
 * Use `byShopNumber` everywhere tenants are listed (Tenants tab, in-report Shop Spec
 * and OHS/compliance grids, PDF, …) so ordering is consistent everywhere.
 */
export function compareShopNumber(a: string | null | undefined, b: string | null | undefined): number {
  return (a || '').localeCompare(b || '', undefined, { numeric: true, sensitivity: 'base' });
}

/** Array.sort comparator for any object carrying a `shop_number`. */
export const byShopNumber = <T extends { shop_number?: string | null }>(a: T, b: T): number =>
  compareShopNumber(a.shop_number, b.shop_number);
