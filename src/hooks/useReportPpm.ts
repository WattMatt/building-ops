/**
 * PPM (planned preventive maintenance) data access for one OPS report.
 *
 *   const { services, isLoading, upsertService, removeService } = useReportPpm(reportId, buildingId);
 *
 * Each row is one contractor service with a 12-month `months` jsonb status grid.
 * `upsertService` writes a single row (insert or update, incl. its months grid) and
 * `removeService` deletes one. Both invalidate the report's PPM query on success.
 * Modelled on useReportSection.ts — client `id` keeps upserts idempotent.
 */
import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fdb, type PpmService } from '@/integrations/supabase/fortress-db';
import type { Json } from '@/integrations/supabase/fortress-types';
import type { PpmCell } from '@/lib/ppmStatus';

/** A row as edited in the grid before persistence — months typed for the matrix. */
export interface PpmServiceRow extends Omit<PpmService, 'months'> {
  months: Record<string, PpmCell>;
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

export function useReportPpm(reportId: string | undefined, buildingId: string | undefined) {
  const qc = useQueryClient();
  const key = ['fortress-ppm-services', reportId];

  const query = useQuery({
    queryKey: key,
    enabled: !!reportId,
    queryFn: async (): Promise<PpmServiceRow[]> => {
      const { data, error } = await fdb
        .from('ppm_services')
        .select('*')
        .eq('report_id', reportId!)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, months: (r.months as Record<string, PpmCell>) ?? {} }));
    },
  });

  const upsert = useMutation({
    mutationFn: async (row: PpmServiceInput): Promise<void> => {
      if (!reportId || !buildingId) throw new Error('missing report or building');
      const payload = {
        id: row.id ?? crypto.randomUUID(),
        report_id: reportId,
        building_id: buildingId,
        service_name: row.service_name,
        frequency: row.frequency ?? null,
        comment: row.comment ?? null,
        sort_order: row.sort_order ?? null,
        // cast at the client boundary only — PpmCell's optional fields aren't structurally Json.
        months: (row.months ?? {}) as Json,
      };
      const { error } = await fdb.from('ppm_services').upsert(payload, { onConflict: 'id' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: unknown) => {
      if (import.meta.env.DEV) console.error('Save PPM service failed:', e);
      toast.error('Could not save that service. Please try again.');
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
    upsertService: upsert.mutateAsync,
    isSaving: upsert.isPending,
    removeService,
  };
}
