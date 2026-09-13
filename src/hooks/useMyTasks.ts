/**
 * The tasks assigned to me, bucketed against the operating day (overdue / today / next 7 days).
 *
 * Split out of `useMyWork` so a surface that only lists tasks — the building page's "My work
 * here" card — pays for one query and reads one loading/error state, rather than the OR of
 * tasks, issues, returned reports and sign-offs. `useMyWork` composes this hook, so My Day
 * and the card read the same query key and can never disagree about what is mine.
 *
 * The key `['my-work', 'tasks', uid]` is load-bearing: OfflineQueueRunner, useBuildingPpm,
 * useCalendarEvents and Issues invalidate or read it by that name.
 */
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { bucketTasks, todayInOperatingTz, type MyTask } from '@/lib/myWork';
import { PERSIST_DEFAULTS } from '@/lib/persist';

/** A joined `buildings(name)` comes back as an object, or null when the row has no building. */
type JoinedBuilding = { name: string | null } | null;
/** The select below returns the task row plus the join, which the mapper flattens away. */
type RawTask = Omit<MyTask, 'building_name'> & { buildings: JoinedBuilding };

export function useMyTasks() {
  const { user } = useAuth();
  const uid = user?.id;
  const today = todayInOperatingTz();

  const tasks = useQuery({
    queryKey: ['my-work', 'tasks', uid],
    ...PERSIST_DEFAULTS,
    enabled: !!uid,
    queryFn: async (): Promise<MyTask[]> => {
      if (!uid) return [];
      const { data, error } = await supabase.from('task_instances')
        .select('id, task_name, task_description, due_date, building_id, requires_photo, requires_signature, status, buildings(name)')
        .eq('assigned_to', uid).in('status', ['pending', 'overdue']).order('due_date');
      if (error) throw new Error(error.message);
      return ((data ?? []) as RawTask[]).map((r) => { const { buildings, ...rest } = r; return { ...rest, building_name: buildings?.name ?? 'Unknown' }; });
    },
  });

  const buckets = useMemo(() => bucketTasks(tasks.data ?? [], today), [tasks.data, today]);
  const refetch = useCallback(() => { void tasks.refetch(); }, [tasks.refetch]);

  return { today, buckets, isLoading: tasks.isLoading, isError: tasks.isError, error: tasks.error, refetch };
}
