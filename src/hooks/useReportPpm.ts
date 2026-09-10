/**
 * PPM (planned preventive maintenance) data access for one OPS report.
 *
 *   const { services, derived, upsertService, removeService, setOverride, seedFromPlan } =
 *     useReportPpm(reportId, buildingId, months);
 *
 * Each row is one service with a 12-month grid. Since R3c (spec §5.6 / D6) a row is usually
 * PLAN-BACKED (`plan_service_id` points at `building_ppm_services`): its grid is derived from
 * execution (`ppm_monthly_status`, read here as `derived` for the report's fiscal window) and a
 * manager can pin a cell with a noted override in `overrides`. `months` is never written for
 * plan-backed rows; legacy rows (no `plan_service_id`) keep the hand-edited `months` grid.
 *
 * `upsertService` writes a single row (insert or update) and `removeService` deletes one.
 * Modelled on useReportSection.ts — client `id` keeps upserts idempotent. `months` is sent
 * only when the caller passes it (legacy rows); an upsert without it leaves the column alone.
 *
 * `seedPpmFromPlan(reportId, buildingId)` is the plain function behind the seeding: one row
 * per active plan line the report does not have yet, a same-name row linked instead of
 * duplicated, nothing when every line is already on the report. The report lifecycle calls
 * it on creation and on carry-forward (useFortressReports.ts); the section's "Sync with the
 * PPM plan" button (`seedFromPlan`) re-runs it for plan lines added after the report was made.
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fdb, type PpmService } from '@/integrations/supabase/fortress-db';
import type { Json } from '@/integrations/supabase/fortress-types';
import { useAuth } from '@/contexts/AuthContext';
import type { PpmCell, PpmCellStatus } from '@/lib/ppmStatus';
import type { PpmOverride } from '@/lib/ppmGrid';
import { describeRule, type RecurrenceRule } from '@/lib/recurrence';
import { useDerivedPpm, type BuildingPpmLine } from '@/hooks/useBuildingPpm';

/** A row as edited in the grid before persistence — months typed for the matrix. */
// plan_service_id and overrides are not yet in the generated types; regenerate after the migration ships.
export interface PpmServiceRow extends Omit<PpmService, 'months'> {
  months: Record<string, PpmCell>;
  plan_service_id: string | null;
  overrides: Record<string, PpmOverride>;
}

/** Partial row for upsert — id optional (generated on insert). */
export type PpmServiceInput = {
  id?: string;
  service_name: string;
  frequency?: string | null;
  comment?: string | null;
  sort_order?: number | null;
  months?: Record<string, PpmCell>;
};

export type OverrideInput = { status: PpmCellStatus; note: string } | null;

/** Plain guardrail copy for a write that RLS refused or filtered to nothing. */
export const REPORT_PPM_PERMISSION_MESSAGE = "You don't have permission to change this report's PPM grid.";

/** True when the row's grid comes from the building plan (derived + overrides), not from `months`. */
export const isPlanBacked = (row: Pick<PpmServiceRow, 'plan_service_id'>): boolean => !!row.plan_service_id;

// building_ppm_services and the new ppm_services columns are not yet in the generated types;
// regenerate after the migration ships and drop this loosely typed handle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = fdb as unknown as { from: (table: string) => any };

interface PgError { code?: string; message?: string }
function permissionOrThrow(error: PgError | null, rows: unknown[] | null | undefined): void {
  if (error) {
    if (error.code === '42501') throw new Error(REPORT_PPM_PERMISSION_MESSAGE);
    throw error;
  }
  if (!rows || rows.length === 0) throw new Error(REPORT_PPM_PERMISSION_MESSAGE);
}

/** Narrow a `select('*')` row to the typed shape (plan_service_id/overrides are read off the raw row). */
function toServiceRow(r: PpmService): PpmServiceRow {
  const extra = r as unknown as { plan_service_id?: string | null; overrides?: Record<string, PpmOverride> | null };
  return {
    ...r,
    months: (r.months as Record<string, PpmCell>) ?? {},
    plan_service_id: extra.plan_service_id ?? null,
    overrides: extra.overrides ?? {},
  };
}

export async function fetchReportPpmRows(reportId: string): Promise<PpmServiceRow[]> {
  const { data, error } = await fdb
    .from('ppm_services')
    .select('*')
    .eq('report_id', reportId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toServiceRow);
}

export interface SeedPpmResult {
  /** Rows inserted for plan lines the report did not have. */
  added: number;
  /** Existing same-name rows that were linked to their plan line instead. */
  linked: number;
}

/**
 * Bring a report's `ppm_services` rows in line with the building's ACTIVE plan lines.
 * Idempotent: re-reads the report's rows every time, so a second run (creation, then
 * carry-forward, then the section button) inserts nothing. A building with no active plan
 * lines costs one read and changes nothing. Throws the plain permission message when RLS
 * refuses or filters a write to nothing.
 */
export async function seedPpmFromPlan(reportId: string, buildingId: string): Promise<SeedPpmResult> {
  const { data: planData, error: planError } = await db
    .from('building_ppm_services')
    .select('*')
    .eq('building_id', buildingId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (planError) throw planError;
  const plan = (planData ?? []) as BuildingPpmLine[];
  if (plan.length === 0) return { added: 0, linked: 0 };

  const existing = await fetchReportPpmRows(reportId);
  const linkedIds = new Set(existing.map((r) => r.plan_service_id).filter(Boolean));
  const byName = new Map(existing.map((r) => [r.service_name.trim().toLowerCase(), r]));
  let maxSort = existing.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0);
  const inserts: Record<string, unknown>[] = [];
  let linked = 0;
  for (const line of plan) {
    if (linkedIds.has(line.id)) continue;
    const sameName = byName.get(line.service_name.trim().toLowerCase());
    if (sameName && !sameName.plan_service_id) {
      const { data, error } = await db.from('ppm_services').update({ plan_service_id: line.id }).eq('id', sameName.id).select('id');
      permissionOrThrow(error, data);
      linked += 1;
      continue;
    }
    if (sameName) continue; // same name already linked to another plan line — leave it
    inserts.push({
      id: crypto.randomUUID(),
      report_id: reportId,
      building_id: buildingId,
      service_name: line.service_name,
      frequency: describeRule(line.recurrence as RecurrenceRule),
      comment: null,
      sort_order: ++maxSort,
      months: {},
      plan_service_id: line.id,
      overrides: {},
    });
  }
  if (inserts.length > 0) {
    const { data, error } = await db.from('ppm_services').insert(inserts).select('id');
    permissionOrThrow(error, data);
  }
  return { added: inserts.length, linked };
}

export function useReportPpm(reportId: string | undefined, buildingId: string | undefined, months: readonly string[] = []) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const key = useMemo(() => ['fortress-ppm-services', reportId], [reportId]);

  const query = useQuery({
    queryKey: key,
    enabled: !!reportId,
    queryFn: () => fetchReportPpmRows(reportId!),
  });

  const derivedQuery = useDerivedPpm(buildingId, months);

  const upsert = useMutation({
    mutationFn: async (row: PpmServiceInput): Promise<void> => {
      if (!reportId || !buildingId) throw new Error('missing report or building');
      const payload: Record<string, unknown> = {
        id: row.id ?? crypto.randomUUID(),
        report_id: reportId,
        building_id: buildingId,
        service_name: row.service_name,
        frequency: row.frequency ?? null,
        comment: row.comment ?? null,
        sort_order: row.sort_order ?? null,
      };
      // Only legacy rows pass `months`; a plan-backed row's frozen grid is left untouched
      // (PostgREST upserts set only the columns present in the payload).
      // cast at the client boundary only — PpmCell's optional fields aren't structurally Json.
      if (row.months !== undefined) payload.months = row.months as Json;
      const { error } = await fdb.from('ppm_services').upsert(payload as never, { onConflict: 'id' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: unknown) => {
      if (import.meta.env.DEV) console.error('Save PPM service failed:', e);
      toast.error('Could not save that service. Please try again.');
    },
  });

  const override = useMutation({
    mutationFn: async ({ rowId, month, value }: { rowId: string; month: string; value: OverrideInput }): Promise<void> => {
      const row = (qc.getQueryData<PpmServiceRow[]>(key) ?? []).find((r) => r.id === rowId);
      if (!row) throw new Error('missing service row');
      const overrides: Record<string, PpmOverride> = { ...row.overrides };
      if (value === null) delete overrides[month];
      else overrides[month] = { status: value.status, note: value.note.trim(), by: user?.id ?? null, at: new Date().toISOString() };
      const { data, error } = await db.from('ppm_services').update({ overrides }).eq('id', rowId).select('id');
      permissionOrThrow(error, data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: unknown) => {
      if (import.meta.env.DEV) console.error('Save PPM override failed:', e);
      toast.error(e instanceof Error && e.message === REPORT_PPM_PERMISSION_MESSAGE ? e.message : 'Could not save that override. Please try again.');
    },
  });

  const seed = useMutation({
    mutationFn: async (): Promise<SeedPpmResult> => {
      if (!reportId || !buildingId) throw new Error('missing report or building');
      return seedPpmFromPlan(reportId, buildingId);
    },
    onSuccess: ({ added, linked }) => {
      qc.invalidateQueries({ queryKey: key });
      if (added === 0 && linked === 0) toast.success('Every active plan line is already on this report.');
      else toast.success(`Added ${added} service${added === 1 ? '' : 's'} from the building plan${linked ? ` and linked ${linked} existing` : ''}.`);
    },
    onError: (e: unknown) => {
      if (import.meta.env.DEV) console.error('Sync PPM with plan failed:', e);
      toast.error(e instanceof Error && e.message === REPORT_PPM_PERMISSION_MESSAGE ? e.message : 'Could not sync the PPM services with the plan.');
    },
  });

  const removeService = useCallback(
    async (id: string) => {
      const { error } = await fdb.from('ppm_services').delete().eq('id', id);
      if (error) {
        if (import.meta.env.DEV) console.error('Delete PPM service failed:', error);
        toast.error('Could not remove that service.');
        return;
      }
      qc.invalidateQueries({ queryKey: key });
    },
    [qc, key],
  );

  return {
    services: query.data ?? [],
    isLoading: query.isLoading,
    derived: derivedQuery.data ?? [],
    derivedLoading: derivedQuery.isLoading,
    upsertService: upsert.mutateAsync,
    isSaving: upsert.isPending || override.isPending,
    removeService,
    setOverride: (rowId: string, month: string, value: OverrideInput) => override.mutateAsync({ rowId, month, value }),
    seedFromPlan: seed.mutateAsync,
    isSeeding: seed.isPending,
  };
}
