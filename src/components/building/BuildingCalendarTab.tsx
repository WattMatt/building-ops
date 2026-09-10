/**
 * Building Details → Calendar: the same month/week calendar as /calendar, in building scope,
 * with the asset-service summary the old Maintenance tab used to show (overdue / due in the
 * next 30 days / next up) kept above the grid, and — for admins and managers — a Subscribe
 * button that hands out the building's ICS feed link.
 *
 * The summary has its own window (a year back to 30 days ahead) so it answers "what is
 * overdue" regardless of which month the grid is showing; the grid's own query is the
 * visible range, owned by `CalendarView`. The summary is one small, network-only read of
 * `building_assets` — not a second `useCalendarEvents` over a year, which would fan out all
 * seven sources and persist a year of rows for every building visited.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { AlertTriangle, CalendarPlus, Clock, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { SubscribeCard } from '@/components/calendar/SubscribeCard';
import { localDate, toIso } from '@/components/calendar/CalendarGrid';
import { useAuth } from '@/contexts/AuthContext';
import type { CalendarScope } from '@/hooks/useCalendarEvents';
import { supabase } from '@/integrations/supabase/client';
import { todayInOperatingTz } from '@/lib/myWork';
import { cn } from '@/lib/utils';
import { assetEvent, type CalendarEvent } from '@/lib/calendar/events';
import { CalendarView, defaultViewMode, type CalendarViewMode } from '@/pages/CalendarPage';

export interface BuildingCalendarTabProps {
  buildingId: string;
  buildingName: string;
}

/** How far back the summary looks for overdue services and how far ahead for "due soon". */
export const SUMMARY_LOOKBACK_DAYS = 365;
export const SUMMARY_LOOKAHEAD_DAYS = 30;

export interface AssetSummary {
  overdue: CalendarEvent[];
  dueSoon: CalendarEvent[];
  /** The nearest service on or after today, if any. */
  next: CalendarEvent | null;
}

/** Splits asset-service events into overdue and due-within-30-days, both sorted by date. */
export function summariseAssets(events: readonly CalendarEvent[], today: string): AssetSummary {
  const horizon = toIso(addDays(localDate(today), SUMMARY_LOOKAHEAD_DAYS));
  const assets = events.filter((e) => e.kind === 'asset').slice().sort((a, b) => a.date.localeCompare(b.date));
  const overdue = assets.filter((e) => e.status === 'overdue' || e.date < today);
  const upcoming = assets.filter((e) => e.date >= today);
  const dueSoon = upcoming.filter((e) => e.date <= horizon);
  return { overdue, dueSoon, next: upcoming[0] ?? null };
}

export default function BuildingCalendarTab({ buildingId, buildingName }: BuildingCalendarTabProps) {
  const { isAdminOrManager } = useAuth();
  const today = todayInOperatingTz();
  const [view, setView] = useState<CalendarViewMode>(() => defaultViewMode());
  const [date, setDate] = useState(today);
  const [subscribeOpen, setSubscribeOpen] = useState(false);

  const scope = useMemo<CalendarScope>(() => ({ kind: 'building', id: buildingId }), [buildingId]);
  const summaryRange = useMemo(() => ({
    from: toIso(addDays(localDate(today), -SUMMARY_LOOKBACK_DAYS)),
    to: toIso(addDays(localDate(today), SUMMARY_LOOKAHEAD_DAYS)),
  }), [today]);
  // Under the `['calendar']` family so a reschedule or any calendar invalidation refreshes
  // it too; deliberately NOT persisted (no PERSIST_DEFAULTS) — it is three numbers.
  const summaryQuery = useQuery({
    queryKey: ['calendar', `building:${buildingId}`, 'asset-summary', summaryRange.from, summaryRange.to],
    queryFn: async (): Promise<CalendarEvent[]> => {
      const { data, error } = await supabase
        .from('building_assets')
        .select('id, name, next_service_date')
        .eq('building_id', buildingId)
        .gte('next_service_date', summaryRange.from)
        .lte('next_service_date', summaryRange.to)
        .order('next_service_date');
      if (error) throw new Error(error.message);
      return (data ?? []).flatMap((row) => {
        const e = assetEvent({ ...row, building_id: buildingId }, buildingName, today);
        return e ? [e] : [];
      });
    },
  });
  const summary = useMemo(() => summariseAssets(summaryQuery.data ?? [], today), [summaryQuery.data, today]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3" data-testid="asset-summary">
        <Card className={cn(summary.overdue.length > 0 && 'border-destructive')}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className={cn('h-4 w-4', summary.overdue.length > 0 ? 'text-destructive' : 'text-muted-foreground')} aria-hidden="true" />
              Overdue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="asset-overdue-count">{summary.overdue.length}</div>
            <p className="text-xs text-muted-foreground">asset services past their date</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Clock className="h-4 w-4 text-warning" aria-hidden="true" />
              Due in 30 days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="asset-due-soon-count">{summary.dueSoon.length}</div>
            <p className="text-xs text-muted-foreground">asset services coming up</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Wrench className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Next service
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary.next ? (
              <>
                <div className="truncate text-base font-semibold" data-testid="asset-next">{summary.next.title}</div>
                <p className="text-xs text-muted-foreground">{format(localDate(summary.next.date), 'EEE d MMM yyyy')}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">None scheduled</p>
            )}
          </CardContent>
        </Card>
      </div>

      <CalendarView
        scope={scope}
        view={view}
        date={date}
        onViewChange={setView}
        onDateChange={setDate}
        toolbar={isAdminOrManager ? (
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setSubscribeOpen(true)}>
            <CalendarPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            Subscribe
          </Button>
        ) : undefined}
      />

      {isAdminOrManager && (
        <ResponsiveDialog open={subscribeOpen} onOpenChange={setSubscribeOpen}>
          <ResponsiveDialogContent className="max-w-lg">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Subscribe to this building's calendar</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                A feed of every dated item for {buildingName}, for Outlook, Google or Apple Calendar.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <SubscribeCard buildingId={buildingId} buildingName={buildingName} />
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}
    </div>
  );
}
