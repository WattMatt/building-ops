/**
 * Dashboard card: what happened on issues across every building the viewer can see, over the
 * last seven days. One TanStack query, grouped by local day (Today / Yesterday / formatted
 * date); each row links straight to the issue. RLS already scopes issue_activity — and the
 * issues/buildings it joins — to the buildings the signed-in user can access.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Activity as ActivityIcon, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { formatBuildingName } from '@/lib/buildingName';
import { describeActivity, groupByDay, type FeedRow } from '@/lib/activityFeed';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function todayInOperatingTz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function fetchActivityFeed(): Promise<FeedRow[]> {
  const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const { data, error } = await supabase
    .from('issue_activity')
    .select(
      'id, issue_id, activity_type, old_value, new_value, comment, author_name, created_at, issues(title, building_id, buildings(name))'
    )
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id: r.id,
    issue_id: r.issue_id,
    activity_type: r.activity_type,
    old_value: r.old_value,
    new_value: r.new_value,
    comment: r.comment,
    author_name: r.author_name,
    created_at: r.created_at,
    issue_title: r.issues?.title ?? 'Issue',
    building_name: r.issues?.buildings?.name ?? null,
  }));
}

export default function ActivityFeedCard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['activity-feed'],
    queryFn: fetchActivityFeed,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ActivityIcon className="h-5 w-5" />
            Last 7 days
          </CardTitle>
          <CardDescription>Recent issue activity</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Last 7 days
          </CardTitle>
          <CardDescription>Activity could not be loaded</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <p className="text-sm font-medium mb-1">Failed to load activity</p>
            <p className="text-xs text-muted-foreground max-w-sm mb-4">
              Recent issue activity may exist but is not visible right now.
            </p>
            <Button onClick={() => refetch()} variant="outline" size="sm">
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const rows = data ?? [];
  const groups = groupByDay(rows, todayInOperatingTz());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ActivityIcon className="h-5 w-5" />
          Last 7 days
        </CardTitle>
        <CardDescription>Recent issue activity across your buildings</CardDescription>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Quiet week so far</p>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.day}>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">{group.day}</h4>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <Link key={item.id} to={`/issues?open=${item.issue_id}`} className="block">
                      <div className="flex items-start justify-between gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors min-h-10">
                        <div className="min-w-0">
                          <p className="text-sm truncate">
                            <span className="font-medium">{item.author_name ?? 'Someone'}</span>{' '}
                            <span className="text-muted-foreground">{describeActivity(item)}</span>
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {item.issue_title}
                            {item.building_name ? ` • ${formatBuildingName(item.building_name)}` : ''}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0 pt-0.5">
                          {format(new Date(item.created_at), 'HH:mm')}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
