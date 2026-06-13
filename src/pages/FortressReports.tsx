/** Operational Reports — building-first. Lists the buildings you can access; each
 *  opens that building's reports + KPIs. Reports are authored per building, not from
 *  a global list. */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Building2, ChevronRight } from 'lucide-react';
import { useFortressReports } from '@/hooks/useFortressReports';
import { useBuildings } from '@/hooks/useBuildings';
import { usePortfolioCompliance } from '@/hooks/usePortfolioCompliance';
import { formatPeriodLabel, formatPct } from '@/lib/fortressReports';
import { classify, THRESHOLDS, STATUS_CLASS } from '@/lib/fortressKpis';
import { cn } from '@/lib/utils';

export default function FortressReports() {
  const navigate = useNavigate();
  const { buildings, loading } = useBuildings();
  const { data: reports } = useFortressReports();
  const { data: portfolio } = usePortfolioCompliance();

  const pctByBuilding = useMemo(
    () => new Map((portfolio ?? []).map((p) => [p.buildingId, p.pct])),
    [portfolio],
  );
  const reportStats = useMemo(() => {
    const m = new Map<string, { count: number; lastPeriod: string | null }>();
    for (const r of reports ?? []) {
      const cur = m.get(r.building_id) ?? { count: 0, lastPeriod: null };
      cur.count += 1;
      if (!cur.lastPeriod || r.report_period > cur.lastPeriod) cur.lastPeriod = r.report_period;
      m.set(r.building_id, cur);
    }
    return m;
  }, [reports]);

  const sorted = useMemo(() => [...buildings].sort((a, b) => a.name.localeCompare(b.name)), [buildings]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Operational Reports</h1>
        <p className="text-sm text-muted-foreground">Select a building to view and author its OPS, CM and annual reports.</p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading buildings…</p>
      ) : !sorted.length ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <Building2 className="h-8 w-8" />
          <p className="font-medium">No buildings available</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((b) => {
            const pct = pctByBuilding.get(b.id) ?? null;
            const stats = reportStats.get(b.id);
            const c = STATUS_CLASS[classify(pct, THRESHOLDS.compliance)];
            return (
              <button
                key={b.id}
                onClick={() => navigate(`/reports/fortress/building/${b.id}`)}
                className={cn('flex items-center justify-between rounded-lg border p-4 text-left ring-1 transition-colors hover:bg-muted/50', c.ring)}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{b.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {stats ? `${stats.count} report${stats.count === 1 ? '' : 's'} · latest ${formatPeriodLabel(stats.lastPeriod)}` : 'No reports yet'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {pct !== null && (
                    <div className="text-right">
                      <p className={cn('text-lg font-semibold tabular-nums', c.text)}>{formatPct(pct)}</p>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">OHS</p>
                    </div>
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
