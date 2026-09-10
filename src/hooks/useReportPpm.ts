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
 * `setOverride` merges into the overrides the database holds AT WRITE TIME (a fresh
 * `select('overrides')` inside the mutation), not the cached row, so two managers pinning
 * different months of the same row do not drop each other's keys. The `_05` guard trigger
 * raises 42501 for a non-manager; that reads as the plain permission message.
 *
 * `seedPpmFromPlan(reportId, buildingId)` is the plain function behind the seeding: one row
 * per active plan line the report does not have yet, a same-name row linked instead of
 * duplicated, nothing when every line is already on the report. A plan line whose name is
 * already taken by a row linked to ANOTHER line is counted in `skipped` (the caller says so)
 * rather than silently dropped. The report lifecycle calls it on creation and on
 * carry-forward (useFortressReports.ts); the section's "Sync with the PPM plan" button
 * (`seedFromPlan`) re-runs it for plan lines added after the report was made.
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Json, Tables, TablesInsert } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import type { PpmCell, PpmCellStatus } from '@/lib/ppmStatus';
import { legacyMonthsOf, overridesOf, type PpmOverride } from '@/lib/ppmGrid';
import { rethrowPgError, throwIfRefused } from '@/lib/pgErrors';
import { describeRule, type RecurrenceRule } from '@/lib/recurrence';
import { useDerivedPpm } from '@/hooks/useBuildingPpm';

/** A `ppm_services` row as edited in the grid — the jsonb columns narrowed for the matrix. */
export interface PpmServiceRow extends Omit<Tables<'ppm_services'>, 'months' | 'overrides'> {
  months: Record<string, PpmCell>;
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
/** Plain copy for a 23505 while seeding (the row for that plan line already exists). */
export const REPORT_PPM_EXISTS_MESSAGE = 'That service is already on this report.';
/** The row vanished between the cache and the write (deleted, or no longer visible). */
export const REPORT_PPM_ROW_GONE_MESSAGE = 'That service is no longer on this report. Refresh and try again.';

/** True when the row's grid comes from the building plan (derived + overrides), not from `months`. */
export const isPlanBacked = (row: Pick<PpmServiceRow, 'plan_service_id'>): boolean => !!row.plan_service_id;

/** Narrow a `select('*')` row: the jsonb columns become typed maps ({} for anything malformed). */
function toServiceRow(r: Tables<'ppm_services'>): PpmServiceRow {
  return { ...r, months: legacyMonthsOf(r.months), overrides: overridesOf(r.overrides) };
}

/** PpmCell / PpmOverride are plain data; the cast only tells the client they are jsonb. */
const toJson = (v: Record<string, PpmCell> | Record<string, PpmOverride>): Json => v as unknown as Json;

export async function fetchReportPpmRows(reportId: string): Promise<PpmServiceRow[]> {
  const { data, error } = await supabase
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
  /** Plan lines left off because a same-name row is already linked to a different line. */
  skipped: number;
}

/**
 * Bring a report's `ppm_services` rows in line with the building's ACTIVE plan lines.
 * Idempotent: re-reads the report's rows every time, so a second run (creation, then
 * carry-forward, then the section button) inserts nothing. A building with no active plan
 * lines costs one read and changes nothing. Throws the plain permission message when RLS
 * refuses or filters a write to nothing.
 */
export async function seedPpmFromPlan(reportId: string, buildingId: string): Promise<SeedPpmResult> {
  const { data: plan, error: planError } = await supabase
    .from('building_ppm_services')
    .select('id, service_name, recurrence')
    .eq('building_id', buildingId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (planError) throw planError;
  if (!plan || plan.length === 0) return { added: 0, linked: 0, skipped: 0 };

  const existing = await fetchReportPpmRows(reportId);
  const linkedIds = new Set(existing.map((r) => r.plan_service_id).filter(Boolean));
  const byName = new Map(existing.map((r) => [r.service_name.trim().toLowerCase(), r]));
  let maxSort = existing.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0);
  const inserts: TablesInsert<'ppm_services'>[] = [];
  let linked = 0;
  let skipped = 0;
  for (const line of plan) {
    if (linkedIds.has(line.id)) continue;
    const sameName = byName.get(line.service_name.trim().toLowerCase());
    if (sameName && !sameName.plan_service_id) {
      const { data, error } = await supabase.from('ppm_services').update({ plan_service_id: line.id }).eq('id', sameName.id).select('id');
      throwIfRefused(error, data, REPORT_PPM_PERMISSION_MESSAGE, REPORT_PPM_EXISTS_MESSAGE);
      linked += 1;
      continue;
    }
    if (sameName) { skipped += 1; continue; } // same name already linked to another plan line
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
    const { data, error } = await supabase.from('ppm_services').insert(inserts).select('id');
    throwIfRefused(error, data, REPORT_PPM_PERMISSION_MESSAGE, REPORT_PPM_EXISTS_MESSAGE);
  }
  return { added: inserts.length, linked, skipped };
}

/** One sentence for a seed result; the section's Sync toast and the lifecycle share it. */
export function describeSeed({ added, linked, skipped }: SeedPpmResult): string {
  if (added === 0 && linked === 0 && skipped === 0) return 'Every active plan line is already on this report.';
  const parts: string[] = [];
  if (added > 0 || linked > 0) parts.push(`Added ${added} service${added === 1 ? '' : 's'} from the building plan${linked ? ` and linked ${linked} existing` : ''}.`);
  if (skipped > 0) parts.push(`${skipped} plan line${skipped === 1 ? ' was' : 's were'} skipped: a service with the same name is already linked to another plan line.`);
  return parts.join(' ');
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
      const payload: TablesInsert<'ppm_services'> = {
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
      if (row.months !== undefined) payload.months = toJson(row.months);
      const { error } = await supabase.from('ppm_services').upsert(payload, { onConflict: 'id' });
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
      // Read-merge-write against the row as it is NOW, not as this tab last saw it.
      const { data: fresh, error: readError } = await supabase.from('ppm_services').select('overrides').eq('id', rowId).maybeSingle();
      rethrowPgError(readError, REPORT_PPM_PERMISSION_MESSAGE);
      if (!fresh) throw new Error(REPORT_PPM_ROW_GONE_MESSAGE);
      const overrides: Record<string, PpmOverride> = { ...overridesOf(fresh.overrides) };
      if (value === null) delete overrides[month];
      else overrides[month] = { status: value.status, note: value.note.trim(), by: user?.id ?? null, at: new Date().toISOString() };
      const { data, error } = await supabase.from('ppm_services').update({ overrides: toJson(overrides) }).eq('id', rowId).select('id');
      throwIfRefused(error, data, REPORT_PPM_PERMISSION_MESSAGE);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: unknown) => {
      if (import.meta.env.DEV) console.error('Save PPM override failed:', e);
      const plain = e instanceof Error && (e.message === REPORT_PPM_PERMISSION_MESSAGE || e.message === REPORT_PPM_ROW_GONE_MESSAGE);
      toast.error(plain ? (e as Error).message : 'Could not save that override. Please try again.');
    },
  });

  const seed = useMutation({
    mutationFn: async (): Promise<SeedPpmResult> => {
      if (!reportId || !buildingId) throw new Error('missing report or building');
      return seedPpmFromPlan(reportId, buildingId);
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: key });
      const message = describeSeed(result);
      if (result.skipped > 0) toast.warning(message);
      else toast.success(message);
    },
    onError: (e: unknown) => {
      if (import.meta.env.DEV) console.error('Sync PPM with plan failed:', e);
      const plain = e instanceof Error && (e.message === REPORT_PPM_PERMISSION_MESSAGE || e.message === REPORT_PPM_EXISTS_MESSAGE);
      toast.error(plain ? (e as Error).message : 'Could not sync the PPM services with the plan.');
    },
  });

  const removeService = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('ppm_services').delete().eq('id', id);
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
