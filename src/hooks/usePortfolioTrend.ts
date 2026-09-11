/**
 * Portfolio-wide series from the `portfolio_metrics_daily` view (one row per day, averaged over the
 * buildings the caller can see). Feeds the /trends page, whose CSV export prints every column — so this
 * is the one snapshot read that keeps `*`.
 */
import { useQuery } from '@tanstack/react-query';
import { daysAgo, fetchAll, isPortfolioRow, portfolioSnapshots, snapshotQueryDefaults, type PortfolioRow } from '@/lib/snapshotClient';

export function usePortfolioTrend(days: number) {
  return useQuery({
    queryKey: ['portfolio-trend', days],
    ...snapshotQueryDefaults,
    queryFn: async (): Promise<PortfolioRow[]> => {
      // One row per day, so 365 d is 365 rows — under the cap today, but fetchAll costs nothing and the
      // range can grow. `days - 1`: 30 d means today and the 29 before it.
      const res = await fetchAll(() => portfolioSnapshots().gte('day', daysAgo(days - 1)).order('day', { ascending: true }));
      if (res.error) throw res.error;
      // The view's key columns are typed nullable by the generator but never are; see isPortfolioRow.
      return res.data.filter(isPortfolioRow);
    },
  });
}
