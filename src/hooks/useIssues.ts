/**
 * Custom hook for fetching and managing issues data
 * Centralizes issue-related data fetching logic
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { IssuePriority, IssueStatus } from '@/lib/constants';

interface Issue {
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
}

interface IssueStats {
  total: number;
  open: number;
  inProgress: number;
  escalated: number;
  resolved: number;
}

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
  createIssue: (issue: Omit<Issue, 'id' | 'created_at' | 'building_name'>) => Promise<string | null>;
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
          buildings (name)
        `)
        .order('created_at', { ascending: false });

      if (options.buildingId) {
        query = query.eq('building_id', options.buildingId);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      const formattedIssues: Issue[] = (data || []).map((issue) => ({
        id: issue.id,
        title: issue.title,
        description: issue.description,
        priority: issue.priority,
        status: issue.status,
        deadline: issue.deadline,
        created_at: issue.created_at,
        building_id: issue.building_id,
        building_name: (issue.buildings as any)?.name || 'Unknown',
        reported_by: issue.reported_by,
        assigned_to: issue.assigned_to,
        corrective_action: issue.corrective_action,
        photo_urls: issue.photo_urls,
        task_instance_id: issue.task_instance_id,
      }));

      setIssues(formattedIssues);
      setStats(calculateStats(formattedIssues));
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch issues');
      setError(error);
      console.error('Error fetching issues:', err);
      toast.error('Failed to load issues');
    } finally {
      setLoading(false);
    }
  }, [options.buildingId, calculateStats]);

  const createIssue = useCallback(
    async (issue: Omit<Issue, 'id' | 'created_at' | 'building_name'>): Promise<string | null> => {
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
        console.error('Error creating issue:', err);
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
        console.error('Error updating issue:', err);
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
