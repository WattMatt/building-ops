/**
 * Dashboard widget for admins/managers (spec §4.3): the buildings where nobody would receive a
 * task — no field member, or no 'user' rule for daily tasks — each linking to that building's
 * Team tab, plus one line for how many open tasks across the portfolio have nobody assigned.
 * One TanStack query (usePortfolioCoverage); loading, error-with-retry and empty states are
 * rendered honestly, the way WaitingOnYouWidget does it.
 */
import { Link } from 'react-router-dom';
import { AlertTriangle, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBuildingName } from '@/lib/buildingName';
import { usePortfolioCoverage, type CoverageRow } from '@/hooks/usePortfolioCoverage';

/** Most buildings the widget lists; the heading badge carries the true count. */
export const MAX_ROWS = 6;

export function gapReason(r: CoverageRow): string {
  if (r.field_members === 0 && !r.has_user_rule) return 'No field staff and no default for daily tasks';
  if (r.field_members === 0) return 'No field staff';
  return 'No default for daily tasks';
}

export function unassignedLine(n: number): string {
  if (n === 0) return 'No open tasks are waiting for an owner.';
  return n === 1 ? '1 open task has nobody assigned' : `${n} open tasks have nobody assigned`;
}

export default function CoverageWidget() {
  const query = usePortfolioCoverage();
  const { gaps, unassignedOpen } = query;
  const shown = gaps.slice(0, MAX_ROWS);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <Users className="h-5 w-5" aria-hidden="true" />
          Buildings needing a team
          {query.isSuccess && gaps.length > 0 && (
            <Badge variant="destructive">{gaps.length} {gaps.length === 1 ? 'building' : 'buildings'}</Badge>
          )}
        </CardTitle>
        <CardDescription>Where a task would reach nobody</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isLoading ? (
          <div className="space-y-2" role="status" aria-label="Loading team coverage">
            {[1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : query.isError ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" aria-hidden="true" />
              <p className="text-xs text-muted-foreground truncate">Could not load team coverage.</p>
            </div>
            <Button onClick={() => void query.refetch()} variant="outline" size="sm" disabled={query.isFetching}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            {gaps.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Every building has field staff and a daily-task default.</p>
            ) : (
              <div className="space-y-2">
                {shown.map((r) => (
                  <Link key={r.building_id} to={`/buildings/${r.building_id}?tab=team`} className="block focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
                    <div className="flex items-center justify-between gap-3 p-3 min-h-11 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                      <p className="font-medium text-sm truncate">{formatBuildingName(r.building_name)}</p>
                      <p className="text-xs text-destructive whitespace-nowrap">{gapReason(r)}</p>
                    </div>
                  </Link>
                ))}
                {gaps.length > shown.length && (
                  <div className="text-center pt-1">
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/buildings">View all {gaps.length} in Buildings</Link>
                    </Button>
                  </div>
                )}
              </div>
            )}
            <p className={`text-sm ${unassignedOpen > 0 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>{unassignedLine(unassignedOpen)}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
