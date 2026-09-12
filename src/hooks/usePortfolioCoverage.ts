/**
 * One row per building the caller can see, from the `portfolio_coverage` RPC (SECURITY INVOKER,
 * so RLS does the scoping). Feeds the dashboard CoverageWidget, the "No team" badge on the
 * Buildings list and nothing else on the client; the digest calls the same function as the
 * service role. Admin/manager surfaces only — pass `enabled = isAdminOrManager`.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CoverageRow {
  building_id: string;
  building_name: string;
  /** Active `user`-role profiles with a user_buildings row here. */
  field_members: number;
  /** Rows in building_role_assignments for this building. */
  role_rules: number;
  /** A rule exists for label 'user' — the daily-task default. */
  has_user_rule: boolean;
  /** task_instances pending or overdue with nobody assigned. */
  unassigned_open: number;
  overdue_open: number;
  /** Daily tasks due yesterday (SAST) and how many of those were completed. */
  due_yesterday: number;
  completed_yesterday: number;
}

export const portfolioCoverageKey = ['portfolio-coverage'] as const;

/** Spec §4.3: a building "needs a team" when it has no field member or no daily-task default. */
export function needsTeam(r: CoverageRow): boolean {
  return r.field_members === 0 || !r.has_user_rule;
}

export function coverageGaps(rows: CoverageRow[]): CoverageRow[] {
  return rows.filter(needsTeam);
}

export function usePortfolioCoverage(enabled = true) {
  const query = useQuery({
    queryKey: portfolioCoverageKey,
    enabled,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<CoverageRow[]> => {
      const { data, error } = await supabase.rpc('portfolio_coverage');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  // One stable array per fetch, or the memos below would recompute on every render while loading.
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const gaps = useMemo(() => coverageGaps(rows), [rows]);
  const unassignedOpen = useMemo(() => rows.reduce((n, r) => n + r.unassigned_open, 0), [rows]);
  const byBuilding = useMemo(() => new Map(rows.map((r) => [r.building_id, r])), [rows]);
  return { ...query, gaps, unassignedOpen, byBuilding };
}
