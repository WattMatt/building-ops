/**
 * Generic per-report section grid hook. Every "list of rows belonging to a report"
 * section (expense recoveries, utilities, turnover, narratives, …) uses this:
 *   const { rows, isLoading, saveAll, removeRow } = useReportSection('expense_recoveries', reportId);
 *
 * `saveAll(localRows)` has "persist the grid as shown" semantics: it upserts every
 * provided row and deletes any server row no longer present. Rows carry a client
 * `id` (uuid) so inserts and updates are idempotent (SCHEMA_CONTRACT §2.1).
 */
import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fdb, type FTableName } from '@/integrations/supabase/fortress-db';

// supabase-js's generic table typing doesn't flow through a runtime string, so we
// keep the row shape at the call site and cast at the client boundary only.
type Row = { id?: string; [k: string]: unknown };

export function useReportSection<T extends Row>(table: FTableName, reportId: string | undefined) {
  const qc = useQueryClient();
  const key = ['fortress-section', table, reportId];

  const query = useQuery({
    queryKey: key,
    enabled: !!reportId,
    queryFn: async (): Promise<T[]> => {
      const { data, error } = await (fdb.from(table) as any)
        .select('*')
        .eq('report_id', reportId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });

  const mutation = useMutation({
    mutationFn: async (localRows: T[]): Promise<void> => {
      const withIds = localRows.map((r) => ({
        ...r,
        id: r.id ?? crypto.randomUUID(),
        report_id: reportId,
      }));

      const serverIds = new Set((query.data ?? []).map((r) => r.id));
      const localIds = new Set(withIds.map((r) => r.id));
      const toDelete = [...serverIds].filter((id) => id && !localIds.has(id as string)) as string[];

      if (withIds.length) {
        const { error } = await (fdb.from(table) as any).upsert(withIds, { onConflict: 'id' });
        if (error) throw error;
      }
      if (toDelete.length) {
        const { error } = await (fdb.from(table) as any).delete().in('id', toDelete);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      toast.success('Section saved.');
    },
    onError: (e: unknown) => {
      if (import.meta.env.DEV) console.error(`Save ${table} failed:`, e);
      toast.error('Could not save this section. Please try again.');
    },
  });

  const removeRow = useCallback(
    async (id: string) => {
      const { error } = await (fdb.from(table) as any).delete().eq('id', id);
      if (error) {
        if (import.meta.env.DEV) console.error(`Delete ${table} row failed:`, error);
        toast.error('Could not remove that row.');
        return;
      }
      qc.invalidateQueries({ queryKey: key });
    },
    [table, qc, key],
  );

  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    saveAll: mutation.mutateAsync,
    isSaving: mutation.isPending,
    removeRow,
  };
}
