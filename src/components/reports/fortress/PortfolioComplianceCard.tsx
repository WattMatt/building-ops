/**
 * Admin portfolio OHS compliance dashboard (audit finding H1).
 *
 * Headline = portfolio average compliance (spec KPI O9) with a threshold colour band,
 * over a table of every building the admin/manager can see. Reads from
 * usePortfolioCompliance — null values render as honest "—" / "No approved report",
 * never fabricated. Compliance/critical cells are colour-banded via fortressKpis.
 */
import { Link } from 'react-router-dom';
import { formatBuildingName } from '@/lib/buildingName';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { classify, THRESHOLDS, STATUS_CLASS } from '@/lib/fortressKpis';
import { usePortfolioCompliance } from '@/hooks/usePortfolioCompliance';

function PctBadge({ value, threshold }: { value: number | null; threshold: typeof THRESHOLDS.compliance }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const c = STATUS_CLASS[classify(value, threshold)];
  return <Badge variant="outline" className={cn('border-0 font-medium tabular-nums', c.badge)}>{value}%</Badge>;
}

export function PortfolioComplianceCard() {
  const { rows, portfolioAvg, reportedCount, total, isLoading } = usePortfolioCompliance();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const avgClass = STATUS_CLASS[classify(portfolioAvg, THRESHOLDS.compliance)];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio OHS Compliance</CardTitle>
        <CardDescription>
          Latest approved monthly OPS compliance score per building.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Headline — O9 portfolio average */}
        <div>
          <p className={cn('text-4xl font-bold tabular-nums', avgClass.text)}>
            {portfolioAvg === null ? '—' : `${portfolioAvg}%`}
          </p>
          <p className="text-sm text-muted-foreground">
            {reportedCount} of {total} buildings reported
          </p>
        </div>

        {total === 0 ? (
          <p className="text-sm text-muted-foreground">No buildings available.</p>
        ) : reportedCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            No building has an approved monthly OPS report yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Building</th>
                  <th className="py-2 pr-4 font-medium">Compliance</th>
                  <th className="py-2 pr-4 font-medium">Critical</th>
                  <th className="py-2 pr-4 font-medium">Open NCs</th>
                  <th className="py-2 font-medium">Period</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const reported = r.compliancePct !== null;
                  return (
                    <tr key={r.buildingId} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <Link
                          to={`/buildings/${r.buildingId}?tab=reports`}
                          className="font-medium text-primary hover:underline"
                        >
                          {formatBuildingName(r.name)}
                        </Link>
                      </td>
                      {reported ? (
                        <>
                          <td className="py-2 pr-4">
                            <PctBadge value={r.compliancePct} threshold={THRESHOLDS.compliance} />
                          </td>
                          <td className="py-2 pr-4">
                            <PctBadge value={r.criticalPct} threshold={THRESHOLDS.critical} />
                          </td>
                          <td className="py-2 pr-4 tabular-nums">
                            {r.openNonCompliances ?? '—'}
                          </td>
                          <td className="py-2 text-muted-foreground tabular-nums">
                            {r.period ?? '—'}
                          </td>
                        </>
                      ) : (
                        <td className="py-2 text-muted-foreground" colSpan={4}>
                          No approved report
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
