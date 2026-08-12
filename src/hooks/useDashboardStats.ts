/**
 * Custom hook for fetching dashboard statistics
 * Centralizes dashboard data fetching logic
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface DashboardStats {
  buildings: number;
  pendingTasks: number;
  completedToday: number;
  openIssues: number;
}

interface UpcomingTask {
  id: string;
  task_name: string;
  building_name: string;
  due_date: string;
  frequency: string;
}

interface RecentIssue {
  id: string;
  title: string;
  building_name: string;
  priority: string;
  status: string;
}

interface UseDashboardStatsReturn {
  stats: DashboardStats;
  upcomingTasks: UpcomingTask[];
  recentIssues: RecentIssue[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useDashboardStats(): UseDashboardStatsReturn {
  const [stats, setStats] = useState<DashboardStats>({
    buildings: 0,
    pendingTasks: 0,
    completedToday: 0,
    openIssues: 0,
  });
  const [upcomingTasks, setUpcomingTasks] = useState<UpcomingTask[]>([]);
  const [recentIssues, setRecentIssues] = useState<RecentIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Local-day boundaries as UTC instants (no '+' in the encoded query).
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

      // Parallel fetch for performance
      const [
        buildingsResult,
        pendingResult,
        completedResult,
        issuesResult,
        tasksResult,
        recentIssuesResult,
      ] = await Promise.all([
        // Buildings count
        supabase.from('buildings').select('*', { count: 'exact', head: true }),
        // Open tasks = pending OR overdue (matches the iOS F-06 semantics; the
        // old status='pending' match silently dropped overdue-status tasks).
        supabase
          .from('task_instances')
          .select('*', { count: 'exact', head: true })
          .in('status', ['pending', 'overdue']),
        // Completed today = completed WITH completed_at falling in the local
        // day (was due_date=today, which miscounts: a task completed today but
        // due another day wasn't counted, and vice-versa).
        supabase
          .from('task_instances')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'completed')
          .gte('completed_at', startOfToday)
          .lt('completed_at', startOfTomorrow),
        // Open issues
        supabase
          .from('issues')
          .select('*', { count: 'exact', head: true })
          .neq('status', 'resolved'),
        // Upcoming tasks
        supabase
          .from('task_instances')
          .select(`
            id,
            task_name,
            due_date,
            frequency,
            building_id,
            buildings (name)
          `)
          .eq('status', 'pending')
          .order('due_date')
          .limit(4),
        // Recent issues
        supabase
          .from('issues')
          .select(`
            id,
            title,
            priority,
            status,
            building_id,
            buildings (name)
          `)
          .neq('status', 'resolved')
          .order('created_at', { ascending: false })
          .limit(3),
      ]);

      // supabase-js RESOLVES with { data: null, error } instead of rejecting, so
      // without this the catch below can never fire: every `count || 0` would
      // quietly become 0 and the dashboard would report an empty portfolio as
      // fact during an outage.
      const failed = [
        buildingsResult,
        pendingResult,
        completedResult,
        issuesResult,
        tasksResult,
        recentIssuesResult,
      ].find((r) => r.error);
      if (failed?.error) throw failed.error;

      const pendingCount = pendingResult.count || 0;
      const completedCount = completedResult.count || 0;

      setStats({
        buildings: buildingsResult.count || 0,
        pendingTasks: pendingCount,
        completedToday: completedCount,
        openIssues: issuesResult.count || 0,
      });

      if (tasksResult.data) {
        setUpcomingTasks(
          tasksResult.data.map((task) => ({
            id: task.id,
            task_name: task.task_name,
            building_name: (task.buildings as any)?.name || 'Unknown',
            due_date: task.due_date,
            frequency: task.frequency,
          }))
        );
      }

      if (recentIssuesResult.data) {
        setRecentIssues(
          recentIssuesResult.data.map((issue) => ({
            id: issue.id,
            title: issue.title,
            building_name: (issue.buildings as any)?.name || 'Unknown',
            priority: issue.priority,
            status: issue.status,
          }))
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch dashboard data');
      setError(error);
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  return {
    stats,
    upcomingTasks,
    recentIssues,
    loading,
    error,
    refetch: fetchDashboardData,
  };
}
