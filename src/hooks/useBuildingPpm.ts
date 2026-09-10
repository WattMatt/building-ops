/**
 * Per-building PPM plan (R3c, spec §5.6 / D6).
 *
 *   const { lines, createLine, updateLine, setActive, generateNow, derived } = useBuildingPpm(buildingId, months);
 *
 * `lines` are the `building_ppm_services` rows (the plan). Occurrences are `task_instances`
 * rows the nightly `generate_ppm_tasks` job creates from the plan; `generateNow()` runs the
 * same function for this building so a new line shows up on the Checklists tab today. The
 * month grid is read from the `ppm_monthly_status` view (`derived`), never written here.
 *
 * Plan lines are NEVER hard-deleted: `task_instances.source_ppm_id` and
 * `ppm_services.plan_service_id` reference them, and the history behind a building's grid
 * would go with the row. `is_active = false` is the archive — an inactive line stops
 * generating occurrences and drops out of report seeding, but every past occurrence, report
 * row and derived month stays readable. There is deliberately no `deleteLine` here.
 *
 * Writes `.select('id')` so an RLS-filtered update (site users, another organisation) surfaces
 * as a plain permission message instead of a silent no-op.
 *
 * `fetchMergedPpmGrids(rows, months)` is the one place every read-only consumer of a report's
 * PPM grid (K11, the PDF, the calendar) turns `ppm_services` rows into merged cells, so none
 * of them can fall back to reading `months` alone.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fdb } from '@/integrations/supabase/fortress-db';
import type { RecurrenceRule } from '@/lib/recurrence';
import { mergePpmGrids, type DerivedRow, type MergedCell, type PpmGridRow } from '@/lib/ppmGrid';

export const BUILDING_PPM_KEY = (buildingId: string | undefined) => ['building-ppm', buildingId] as const;
export const PPM_DERIVED_KEY = (buildingId: string | undefined, months: readonly string[]) =>
  ['ppm-derived', buildingId, months.join(',')] as const;

/** Plain guardrail copy for a write that RLS refused or filtered to nothing. */
export const PPM_PERMISSION_MESSAGE = "Only admins and managers can change this building's PPM plan.";

// building_ppm_services is not yet in the generated types; regenerate after the migration ships.
export interface BuildingPpmLine {
  id: string;
  building_id: string;
  service_name: string;
  contractor_id: string | null;
  recurrence: RecurrenceRule;
  sort_order: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BuildingPpmLineInput {
  service_name: string;
  recurrence: RecurrenceRule;
  contractor_id?: string | null;
  notes?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

// building_ppm_services / generate_ppm_tasks / the rewritten ppm_monthly_status are not yet in
// the generated types; regenerate after the migration ships and drop this loosely typed handle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = fdb as unknown as { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

interface PgError { code?: string; message?: string }

function permissionOrThrow(error: PgError | null, rows: unknown[] | null | undefined): void {
  if (error) {
    if (error.code === '42501') throw new Error(PPM_PERMISSION_MESSAGE);
    throw error;
  }
  if (!rows || rows.length === 0) throw new Error(PPM_PERMISSION_MESSAGE);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function queryDerived(scope: (q: any) => any, months: readonly string[]): Promise<DerivedRow[]> {
  if (months.length === 0) return [];
  const { data, error } = await scope(
    db.from('ppm_monthly_status').select('ppm_service_id, service_name, period_month, status, done_on'),
  ).in('period_month', [...months]);
  if (error) throw error;
  return (data ?? []) as DerivedRow[];
}

/** The view rows for one building across `months` ("YYYY-MM" keys). Empty months → no query. */
export async function fetchDerivedPpm(buildingId: string, months: readonly string[]): Promise<DerivedRow[]> {
  return queryDerived((q) => q.eq('building_id', buildingId), months);
}

/** The view rows for several buildings at once (the portfolio calendar). No buildings → no query. */
export async function fetchDerivedPpmForBuildings(buildingIds: readonly string[], months: readonly string[]): Promise<DerivedRow[]> {
  if (buildingIds.length === 0) return [];
  return queryDerived((q) => q.in('building_id', [...buildingIds]), months);
}

/** A `ppm_services` row as the merged-grid consumers read it (`select('*')`, then narrowed). */
export interface PpmGridSourceRow extends PpmGridRow {
  building_id: string;
}

/**
 * One merged grid per `ppm_services` row: override > derived > legacy `months` > blank, over
 * `months` (a report's fiscal window, or the calendar's range). Reads `ppm_monthly_status`
 * once for the buildings the plan-backed rows belong to; rows with no plan line cost no
 * query and simply get their `months` back as legacy cells.
 */
export async function fetchMergedPpmGrids(
  rows: readonly PpmGridSourceRow[],
  months: readonly string[],
): Promise<Map<string, Record<string, MergedCell>>> {
  const buildingIds = [...new Set(rows.filter((r) => r.plan_service_id).map((r) => r.building_id))];
  const derived = await fetchDerivedPpmForBuildings(buildingIds, months);
  return mergePpmGrids(rows, derived, months);
}

/** Derived month statuses for a building over a window. Shared by the tab and the report section. */
export function useDerivedPpm(buildingId: string | undefined, months: readonly string[]) {
  return useQuery({
    queryKey: PPM_DERIVED_KEY(buildingId, months),
    enabled: !!buildingId && months.length > 0,
    queryFn: () => fetchDerivedPpm(buildingId!, months),
  });
}

export function useBuildingPpm(buildingId: string | undefined, monthsWindow: readonly string[] = []) {
  const qc = useQueryClient();
  const key = BUILDING_PPM_KEY(buildingId);

  const linesQuery = useQuery({
    queryKey: key,
    enabled: !!buildingId,
    queryFn: async (): Promise<BuildingPpmLine[]> => {
      const { data, error } = await db
        .from('building_ppm_services')
        .select('*')
        .eq('building_id', buildingId!)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as BuildingPpmLine[];
    },
  });

  const derivedQuery = useDerivedPpm(buildingId, monthsWindow);

  const invalidatePlan = () => {
    qc.invalidateQueries({ queryKey: key });
  };
  const invalidateOccurrences = () => {
    qc.invalidateQueries({ queryKey: ['building-ppm'] });
    qc.invalidateQueries({ queryKey: ['ppm-derived'] });
    qc.invalidateQueries({ queryKey: ['my-work'] });
    qc.invalidateQueries({ queryKey: ['calendar'] });
  };
  const reportError = (fallback: string) => (e: unknown) => {
    if (import.meta.env.DEV) console.error('PPM plan write failed:', e);
    const msg = e instanceof Error && e.message === PPM_PERMISSION_MESSAGE ? e.message : fallback;
    toast.error(msg);
  };

  const create = useMutation({
    mutationFn: async (input: BuildingPpmLineInput): Promise<string> => {
      if (!buildingId) throw new Error('missing building');
      const payload = {
        building_id: buildingId,
        service_name: input.service_name.trim(),
        recurrence: input.recurrence,
        contractor_id: input.contractor_id ?? null,
        notes: input.notes?.trim() || null,
        sort_order: input.sort_order ?? 0,
        is_active: input.is_active ?? true,
      };
      const { data, error } = await db.from('building_ppm_services').insert(payload).select('id');
      permissionOrThrow(error, data);
      return (data as { id: string }[])[0].id;
    },
    onSuccess: invalidatePlan,
    onError: reportError('Could not add that service. Please try again.'),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<BuildingPpmLineInput> }): Promise<void> => {
      const body: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
      if (typeof patch.service_name === 'string') body.service_name = patch.service_name.trim();
      if ('notes' in patch) body.notes = patch.notes?.trim() || null;
      const { data, error } = await db.from('building_ppm_services').update(body).eq('id', id).select('id');
      permissionOrThrow(error, data);
    },
    onSuccess: invalidatePlan,
    onError: reportError('Could not save that service. Please try again.'),
  });

  const generate = useMutation({
    mutationFn: async (): Promise<number> => {
      if (!buildingId) throw new Error('missing building');
      const { data, error } = await db.rpc('generate_ppm_tasks', { p_building: buildingId, p_horizon_days: 365 });
      if (error) {
        if ((error as PgError).code === '42501') throw new Error(PPM_PERMISSION_MESSAGE);
        throw error;
      }
      return typeof data === 'number' ? data : Number(data ?? 0);
    },
    onSuccess: (n) => {
      invalidateOccurrences();
      toast.success(n === 0 ? 'Nothing new to generate — the next year is already scheduled.' : `Generated ${n} PPM occurrence${n === 1 ? '' : 's'} for the next year.`);
    },
    onError: reportError('Could not generate PPM occurrences. Please try again.'),
  });

  return {
    lines: linesQuery.data ?? [],
    isLoading: linesQuery.isLoading,
    isError: linesQuery.isError,
    error: linesQuery.error,
    createLine: create.mutateAsync,
    updateLine: (id: string, patch: Partial<BuildingPpmLineInput>) => update.mutateAsync({ id, patch }),
    setActive: (id: string, is_active: boolean) => update.mutateAsync({ id, patch: { is_active } }),
    isSaving: create.isPending || update.isPending,
    generateNow: generate.mutateAsync,
    isGenerating: generate.isPending,
    derived: derivedQuery.data ?? [],
    derivedLoading: derivedQuery.isLoading,
  };
}
