/**
 * Everything that is "mine" today: tasks assigned to me (overdue / today / next 7 days),
 * issues assigned to me, sign-offs waiting for me, reports returned to me, and the unread
 * inbox count. One hook so the My Day page and the digest agree on what counts as mine.
 */
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fdb } from '@/integrations/supabase/fortress-db';
import { useAuth } from '@/contexts/AuthContext';
import { useMySignoffs } from '@/hooks/useMySignoffs';
import { useNotifications } from '@/hooks/useNotifications';
import { bucketTasks, todayInOperatingTz, type MyTask } from '@/lib/myWork';
import type { IssuePriority, IssueStatus } from '@/lib/constants';

export interface MyIssue { id: string; title: string; priority: IssuePriority; status: IssueStatus; deadline: string | null; building_id: string; building_name: string; created_at: string; reported_by: string; assigned_to: string | null; description: string; corrective_action: string | null; photo_urls: string[] | null; task_instance_id: string | null }
export interface ReturnedReport { id: string; title: string | null; building_id: string; report_period: string; review_notes: string | null }

/** A joined `buildings(name)` comes back as an object, or null when the row has no building. */
type JoinedBuilding = { name: string | null } | null;
/** The two selects below return the target row plus the join, which the mappers flatten away. */
type RawTask = Omit<MyTask, 'building_name'> & { buildings: JoinedBuilding };
type RawIssue = Omit<MyIssue, 'building_name'> & { buildings: JoinedBuilding };

export function useMyWork() {
  const { user } = useAuth();
  const uid = user?.id;
  const today = todayInOperatingTz();

  const tasks = useQuery({
    queryKey: ['my-work', 'tasks', uid],
    enabled: !!uid,
    queryFn: async (): Promise<MyTask[]> => {
      // The one sanctioned boundary cast: assigned_to is not yet in the generated types,
      // which makes .eq() on it a type error; regenerate after the migration ships. The
      // `as RawTask[]` on the result re-establishes the row shape immediately after.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('task_instances') as any)
        .select('id, task_name, task_description, due_date, building_id, requires_photo, requires_signature, status, buildings(name)')
        .eq('assigned_to', uid).in('status', ['pending', 'overdue']).order('due_date');
      if (error) throw new Error(error.message);
      return ((data ?? []) as RawTask[]).map((r) => { const { buildings, ...rest } = r; return { ...rest, building_name: buildings?.name ?? 'Unknown' }; });
    },
  });

  const issues = useQuery({
    queryKey: ['my-work', 'issues', uid],
    enabled: !!uid,
    queryFn: async (): Promise<MyIssue[]> => {
      const { data, error } = await supabase.from('issues')
        .select('id, title, priority, status, deadline, building_id, created_at, reported_by, assigned_to, description, corrective_action, photo_urls, task_instance_id, buildings(name)')
        .eq('assigned_to', uid!).neq('status', 'resolved').order('deadline', { ascending: true, nullsFirst: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as RawIssue[]).map((r) => { const { buildings, ...rest } = r; return { ...rest, building_name: buildings?.name ?? 'Unknown' }; });
    },
  });

  const returned = useQuery({
    queryKey: ['my-work', 'returned-reports', uid],
    enabled: !!uid,
    queryFn: async (): Promise<ReturnedReport[]> => {
      const { data, error } = await fdb.from('reports').select('id, title, building_id, report_period, review_notes')
        .eq('author_id', uid!).eq('status', 'rejected').order('report_period', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ReturnedReport[];
    },
  });

  const signoffs = useMySignoffs();
  const { unread } = useNotifications();

  const buckets = useMemo(() => bucketTasks(tasks.data ?? [], today), [tasks.data, today]);
  const isLoading = tasks.isLoading || issues.isLoading || returned.isLoading || signoffs.loading;
  const isError = tasks.isError || issues.isError || returned.isError || !!signoffs.error;
  // useMySignoffs is not a TanStack query, so its failure arrives as a message string
  // rather than an Error; wrap it so callers get one uniform `error` to render. All four
  // sources are represented, which is what keeps a sign-off failure from being reported
  // to the user as "nothing is waiting on you".
  const error = tasks.error ?? issues.error ?? returned.error ?? (signoffs.error ? new Error(signoffs.error) : null);
  const isEmpty = !isLoading && !isError && buckets.overdue.length + buckets.today.length + buckets.upcoming.length === 0 && (issues.data?.length ?? 0) === 0 && signoffs.items.length === 0 && (returned.data?.length ?? 0) === 0;

  const refetch = useCallback(() => {
    void tasks.refetch(); void issues.refetch(); void returned.refetch(); void signoffs.reload();
  }, [tasks.refetch, issues.refetch, returned.refetch, signoffs.reload]);

  return { today, buckets, issues: issues.data ?? [], signoffs: signoffs.items, returnedReports: returned.data ?? [], unread, isLoading, isError, error, isEmpty, refetch };
}
