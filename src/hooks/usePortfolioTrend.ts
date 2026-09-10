/**
 * Portfolio-wide series from the `portfolio_metrics_daily` view (one row per day, averaged over the
 * buildings the caller can see). Feeds the /trends page.
 */
import { useQuery } from '@tanstack/react-query';
import { daysAgo, portfolioSnapshots, type PortfolioRow } from '@/lib/snapshotClient';

export function usePortfolioTrend(days: number) {
  return useQuery({
    queryKey: ['portfolio-trend', days],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<PortfolioRow[]> => {
      const res = await portfolioSnapshots().gte('day', daysAgo(days)).order('day', { ascending: true }).range(0, 999);
      if (res.error) throw res.error;
      return res.data ?? [];
    },
  });
}
