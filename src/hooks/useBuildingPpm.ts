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
 * Changing a line's `is_active` or `recurrence` reschedules it SYNCHRONOUSLY: the database
 * trigger (`trg_building_ppm_services_reschedule`, migration _05) drops the line's future
 * untouched occurrences and regenerates them under the new rule before the update returns.
 * Such a patch therefore invalidates the occurrence consumers (derived grid, My Work, the
 * calendar) exactly as `generateNow` does; a name/contractor/notes edit only refreshes the plan.
 *
 * Plan lines are NEVER hard-deleted: `task_instances.source_ppm_id` and
 * `ppm_services.plan_service_id` reference them, and the history behind a building's grid
 * would go with the row. `is_active = false` is the archive — an inactive line stops
 * generating occurrences and drops out of report seeding, but every past occurrence, report
 * row and derived month stays readable. There is deliberately no `deleteLine` here.
 *
 * Writes `.select('id')` so an RLS-filtered update (site users, another organisation) surfaces
 * as a plain permission message instead of a silent no-op (`throwIfRefused`). `updated_at` is
 * the touch trigger's; the client never sends it.
 *
 * The network half of the grid (`fetchDerivedPpm`, `fetchMergedPpmGrids`, …) lives in
 * src/lib/ppmGridFetch.ts (no React) and is re-exported here for the hooks that use it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import type { RecurrenceRule } from '@/lib/recurrence';
import { rethrowPgError, throwIfRefused } from '@/lib/pgErrors';
import { fetchDerivedPpm } from '@/lib/ppmGridFetch';

export { fetchDerivedPpm, fetchDerivedPpmForBuildings, fetchMergedPpmGrids, type PpmGridSourceRow } from '@/lib/ppmGridFetch';

export const BUILDING_PPM_KEY = (buildingId: string | undefined) => ['building-ppm', buildingId] as const;
export const PPM_DERIVED_KEY = (buildingId: string | undefined, months: readonly string[]) =>
  ['ppm-derived', buildingId, months.join(',')] as const;

/** Plain guardrail copy for a write that RLS refused or filtered to nothing. */
export const PPM_PERMISSION_MESSAGE = "Only admins and managers can change this building's PPM plan.";
/** Plain copy for a 23505 on the plan (a same-name line for the building). */
export const PPM_EXISTS_MESSAGE = 'A service with that name already exists for this building.';

/** A plan line as the app reads it: the generated row with `recurrence` narrowed from jsonb. */
export type BuildingPpmLine = Omit<Tables<'building_ppm_services'>, 'recurrence'> & { recurrence: RecurrenceRule };

export interface BuildingPpmLineInput {
  service_name: string;
  recurrence: RecurrenceRule;
  contractor_id?: string | null;
  notes?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

/** `recurrence` is jsonb in the generated types; the app's RecurrenceRule is a plain object, so the cast is one-way at the boundary. */
const toLine = (r: Tables<'building_ppm_services'>): BuildingPpmLine => ({ ...r, recurrence: r.recurrence as RecurrenceRule });
const ruleToJson = (rule: RecurrenceRule): Json => rule as Json;

/** True when a patch changes something the reschedule trigger acts on. */
export function patchReschedules(patch: Partial<BuildingPpmLineInput>): boolean {
  return 'is_active' in patch || 'recurrence' in patch;
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
      const { data, error } = await supabase
        .from('building_ppm_services')
        .select('*')
        .eq('building_id', buildingId!)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(toLine);
    },
  });

  const derivedQuery = useDerivedPpm(buildingId, monthsWindow);

  const invalidatePlan = () => {
    qc.invalidateQueries({ queryKey: key });
  };
  /** The plan plus everything that shows occurrences — after generation or a reschedule. */
  const invalidateOccurrences = () => {
    qc.invalidateQueries({ queryKey: ['building-ppm'] });
    qc.invalidateQueries({ queryKey: ['ppm-derived'] });
    qc.invalidateQueries({ queryKey: ['my-work'] });
    qc.invalidateQueries({ queryKey: ['calendar'] });
  };
  const reportError = (fallback: string) => (e: unknown) => {
    if (import.meta.env.DEV) console.error('PPM plan write failed:', e);
    const plain = e instanceof Error && (e.message === PPM_PERMISSION_MESSAGE || e.message === PPM_EXISTS_MESSAGE);
    toast.error(plain ? (e as Error).message : fallback);
  };

  const create = useMutation({
    mutationFn: async (input: BuildingPpmLineInput): Promise<string> => {
      if (!buildingId) throw new Error('missing building');
      const payload: TablesInsert<'building_ppm_services'> = {
        building_id: buildingId,
        service_name: input.service_name.trim(),
        recurrence: ruleToJson(input.recurrence),
        contractor_id: input.contractor_id ?? null,
        notes: input.notes?.trim() || null,
        sort_order: input.sort_order ?? 0,
        is_active: input.is_active ?? true,
      };
      const { data, error } = await supabase.from('building_ppm_services').insert(payload).select('id');
      throwIfRefused(error, data, PPM_PERMISSION_MESSAGE, PPM_EXISTS_MESSAGE);
      return data![0].id;
    },
    onSuccess: invalidatePlan,
    onError: reportError('Could not add that service. Please try again.'),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<BuildingPpmLineInput> }): Promise<void> => {
      const body: TablesUpdate<'building_ppm_services'> = {};
      if (typeof patch.service_name === 'string') body.service_name = patch.service_name.trim();
      if (patch.recurrence !== undefined) body.recurrence = ruleToJson(patch.recurrence);
      if ('contractor_id' in patch) body.contractor_id = patch.contractor_id ?? null;
      if ('notes' in patch) body.notes = patch.notes?.trim() || null;
      if (patch.sort_order !== undefined) body.sort_order = patch.sort_order;
      if (patch.is_active !== undefined) body.is_active = patch.is_active;
      const { data, error } = await supabase.from('building_ppm_services').update(body).eq('id', id).select('id');
      throwIfRefused(error, data, PPM_PERMISSION_MESSAGE, PPM_EXISTS_MESSAGE);
    },
    onSuccess: (_result, { patch }) => {
      // is_active / recurrence: the trigger has already rescheduled the line's occurrences.
      if (patchReschedules(patch)) invalidateOccurrences();
      else invalidatePlan();
    },
    onError: reportError('Could not save that service. Please try again.'),
  });

  const generate = useMutation({
    mutationFn: async (): Promise<number> => {
      if (!buildingId) throw new Error('missing building');
      const { data, error } = await supabase.rpc('generate_ppm_tasks', { p_building: buildingId, p_horizon_days: 365 });
      rethrowPgError(error, PPM_PERMISSION_MESSAGE);
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
