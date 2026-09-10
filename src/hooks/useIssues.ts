/**
 * Custom hook for fetching and managing issues data
 * Centralizes issue-related data fetching logic
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { IssuePriority, IssueStatus } from '@/lib/constants';

export interface Issue {
  id: string;
  title: string;
  description: string;
  priority: IssuePriority;
  status: IssueStatus;
  deadline: string | null;
  created_at: string;
  building_id: string;
  building_name?: string;
  reported_by: string;
  assigned_to: string | null;
  corrective_action: string | null;
  photo_urls: string[] | null;
  task_instance_id: string | null;
  sla_target_hours: number | null;
  sla_breached_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
}

interface IssueStats {
  total: number;
  open: number;
  inProgress: number;
  escalated: number;
  resolved: number;
}

export type NewIssueInput = Omit<
  Issue,
  'id' | 'created_at' | 'building_name' | 'sla_target_hours' | 'sla_breached_at' | 'first_response_at' | 'resolved_at'
>;

interface UseIssuesOptions {
  autoFetch?: boolean;
  buildingId?: string;
}

interface UseIssuesReturn {
  issues: Issue[];
  stats: IssueStats;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  /** The DB fills the SLA columns (trigger) and resolved_at, so they are not part of a new issue. */
  createIssue: (issue: NewIssueInput) => Promise<string | null>;
  updateIssue: (id: string, updates: Partial<Issue>) => Promise<boolean>;
}

export function useIssues(
  options: UseIssuesOptions = { autoFetch: true }
): UseIssuesReturn {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const calculateStats = useCallback((issueList: Issue[]): IssueStats => ({
    total: issueList.length,
    open: issueList.filter((i) => i.status === 'open').length,
    inProgress: issueList.filter((i) => i.status === 'in_progress').length,
    escalated: issueList.filter((i) => i.status === 'escalated').length,
    resolved: issueList.filter((i) => i.status === 'resolved').length,
  }), []);

  const [stats, setStats] = useState<IssueStats>({
    total: 0,
    open: 0,
    inProgress: 0,
    escalated: 0,
    resolved: 0,
  });

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('issues')
        .select(`
          id,
          title,
          description,
          priority,
          status,
          deadline,
          created_at,
          building_id,
          reported_by,
          assigned_to,
          corrective_action,
          photo_urls,
          task_instance_id,
          sla_target_hours,
          sla_breached_at,
          first_response_at,
          resolved_at,
          buildings (name)
        `)
        .order('created_at', { ascending: false });

      if (options.buildingId) {
        query = query.eq('building_id', options.buildingId);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      // The generated Row types priority/status as plain text, created_at as nullable (it has a
      // default) and photo_urls as Json; the DB check constraints make these narrowings safe.
      const formattedIssues: Issue[] = (data || []).map((issue) => ({
        id: issue.id,
        title: issue.title,
        description: issue.description,
        priority: issue.priority as IssuePriority,
        status: issue.status as IssueStatus,
        deadline: issue.deadline,
        created_at: issue.created_at ?? '',
        building_id: issue.building_id,
        building_name: (issue.buildings as { name: string | null } | null)?.name || 'Unknown',
        reported_by: issue.reported_by,
        assigned_to: issue.assigned_to,
        corrective_action: issue.corrective_action,
        photo_urls: issue.photo_urls as string[] | null,
        task_instance_id: issue.task_instance_id,
        sla_target_hours: issue.sla_target_hours,
        sla_breached_at: issue.sla_breached_at,
        first_response_at: issue.first_response_at,
        resolved_at: issue.resolved_at,
      }));

      setIssues(formattedIssues);
      setStats(calculateStats(formattedIssues));
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch issues');
      setError(error);
      if (import.meta.env.DEV) console.error('Error fetching issues:', err);
      toast.error('Failed to load issues');
    } finally {
      setLoading(false);
    }
  }, [options.buildingId, calculateStats]);

  const createIssue = useCallback(
    async (issue: NewIssueInput): Promise<string | null> => {
      try {
        const { data, error: createError } = await supabase
          .from('issues')
          .insert(issue)
          .select('id')
          .single();

        if (createError) throw createError;

        toast.success('Issue reported successfully');
        await fetchIssues();
        return data.id;
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error creating issue:', err);
        toast.error('Failed to create issue');
        return null;
      }
    },
    [fetchIssues]
  );

  const updateIssue = useCallback(
    async (id: string, updates: Partial<Issue>): Promise<boolean> => {
      try {
        const { error: updateError } = await supabase
          .from('issues')
          .update(updates)
          .eq('id', id);

        if (updateError) throw updateError;

        toast.success('Issue updated successfully');
        await fetchIssues();
        return true;
      } catch (err) {
        if (import.meta.env.DEV) console.error('Error updating issue:', err);
        toast.error('Failed to update issue');
        return false;
      }
    },
    [fetchIssues]
  );

  useEffect(() => {
    if (options.autoFetch) {
      fetchIssues();
    }
  }, [options.autoFetch, fetchIssues]);

  return {
    issues,
    stats,
    loading,
    error,
    refetch: fetchIssues,
    createIssue,
    updateIssue,
  };
}
