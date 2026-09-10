/**
 * Network half of the PPM grid — no React — shared by the building tab hook, the report
 * section hook, K11 and the PDF builder.
 *
 *   const derived = await fetchDerivedPpm(buildingId, months);          // one building
 *   const grids   = await fetchMergedPpmGrids(ppmServiceRows, months);   // one grid per report row
 *
 * `ppm_monthly_status` is the view that derives a month status per plan line from its
 * `task_instances` occurrences (R3c, spec §5.6 / D6). Reads go through the typed client:
 * the view's columns are nullable in the generated types, so rows missing a line id or a
 * month are dropped here rather than typed away.
 *
 * `fetchMergedPpmGrids(rows, months)` is the one place every read-only consumer of a report's
 * PPM grid turns `ppm_services` rows into merged cells (override > derived > legacy), so none
 * of them can fall back to reading `months` alone.
 */
import { supabase } from '@/integrations/supabase/client';
import { mergePpmGrids, type DerivedRow, type MergedCell, type PpmGridRow } from '@/lib/ppmGrid';

const VIEW_COLUMNS = 'ppm_service_id, service_name, period_month, status, done_on';

type Scope = { buildingId: string } | { buildingIds: readonly string[] };

async function queryDerived(scope: Scope, months: readonly string[]): Promise<DerivedRow[]> {
  if (months.length === 0) return [];
  let q = supabase.from('ppm_monthly_status').select(VIEW_COLUMNS).in('period_month', [...months]);
  q = 'buildingId' in scope ? q.eq('building_id', scope.buildingId) : q.in('building_id', [...scope.buildingIds]);
  const { data, error } = await q;
  if (error) throw error;
  const out: DerivedRow[] = [];
  for (const r of data ?? []) {
    if (!r.ppm_service_id || !r.period_month) continue;
    out.push({ ppm_service_id: r.ppm_service_id, service_name: r.service_name, period_month: r.period_month, status: r.status, done_on: r.done_on });
  }
  return out;
}

/** The view rows for one building across `months` ("YYYY-MM" keys). Empty months → no query. */
export async function fetchDerivedPpm(buildingId: string, months: readonly string[]): Promise<DerivedRow[]> {
  return queryDerived({ buildingId }, months);
}

/** The view rows for several buildings at once. No buildings → no query. */
export async function fetchDerivedPpmForBuildings(buildingIds: readonly string[], months: readonly string[]): Promise<DerivedRow[]> {
  if (buildingIds.length === 0) return [];
  return queryDerived({ buildingIds }, months);
}

/** A `ppm_services` row as the merged-grid consumers read it. */
export interface PpmGridSourceRow extends PpmGridRow {
  building_id: string;
}

/**
 * One merged grid per `ppm_services` row: override > derived > legacy `months` > blank, over
 * `months` (a report's fiscal window). Reads `ppm_monthly_status` once for the buildings the
 * plan-backed rows belong to; rows with no plan line cost no query and simply get their
 * `months` back as legacy cells.
 */
export async function fetchMergedPpmGrids(
  rows: readonly PpmGridSourceRow[],
  months: readonly string[],
): Promise<Map<string, Record<string, MergedCell>>> {
  const buildingIds = [...new Set(rows.filter((r) => r.plan_service_id).map((r) => r.building_id))];
  const derived = await fetchDerivedPpmForBuildings(buildingIds, months);
  return mergePpmGrids(rows, derived, months);
}
