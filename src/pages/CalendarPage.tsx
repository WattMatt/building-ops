/**
 * /calendar — every dated thing in the buildings the viewer can see (tasks, issue deadlines,
 * document expiries, asset services, PPM months, own sign-offs, report periods) on one month
 * or week grid. Site roles see their assigned buildings; admins and managers the portfolio,
 * narrowed by the building filter.
 *
 * The page's state lives in the URL (`?date=YYYY-MM-DD&view=month|week&building=<id>`) so
 * My Day's week strip, push links and the browser's back button all land on the same view.
 * The only thing not in the URL is the source filters, which `useSourceFilters` remembers
 * per user in localStorage.
 *
 * `CalendarView` is the reusable middle — toolbar, filters, grid, selected-day list, event
 * tap routing and (for admins/managers) drag-to-reschedule. The building Calendar tab mounts
 * the same component in building scope, so both surfaces behave identically.
 *
 * Tapping an event: a task opens `CompleteTaskDialog` (its photo/signature requirements are
 * fetched on open — the calendar rows do not carry them); an issue deep-links to `/issues?open=`;
 * everything else goes to the entity's `href`. A completed task goes to its checklist instead
 * of the completion dialog.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, addMonths, endOfMonth, format, startOfMonth } from 'date-fns';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import CompleteTaskDialog from '@/components/checklists/CompleteTaskDialog';
import { CalendarGrid, localDate, toIso } from '@/components/calendar/CalendarGrid';
import { CalendarWeek, weekDays } from '@/components/calendar/CalendarWeek';
import { EventChip } from '@/components/calendar/EventChip';
import { SourceFilters, applyFilters, useSourceFilters } from '@/components/calendar/SourceFilters';
import { useAuth } from '@/contexts/AuthContext';
import { useBuildings } from '@/hooks/useBuildings';
import { useCalendarEvents, type CalendarScope } from '@/hooks/useCalendarEvents';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { track } from '@/lib/analytics';
import { todayInOperatingTz } from '@/lib/myWork';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/lib/calendar/events';

export type CalendarViewMode = 'month' | 'week';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const VIEW_MODES: readonly [CalendarViewMode, string][] = [['month', 'Month'], ['week', 'Week']];
/** Tailwind's `sm` breakpoint: below it a month grid has no room for chips, so start in week view. */
export const WEEK_DEFAULT_BELOW_PX = 640;

export function isCalendarViewMode(value: unknown): value is CalendarViewMode {
  return value === 'month' || value === 'week';
}

/** Week on a phone, month everywhere else — decided once, when the page first renders. */
export function defaultViewMode(width: number = typeof window === 'undefined' ? Infinity : window.innerWidth): CalendarViewMode {
  return width < WEEK_DEFAULT_BELOW_PX ? 'week' : 'month';
}

/** The inclusive query window for a view anchored on `date`: the month's grid ± a week, or the week itself. */
export function rangeFor(view: CalendarViewMode, date: string): { from: string; to: string } {
  if (view === 'week') {
    const days = weekDays(date);
    return { from: days[0], to: days[6] };
  }
  const d = localDate(date);
  return { from: toIso(addDays(startOfMonth(d), -7)), to: toIso(addDays(endOfMonth(d), 7)) };
}

/** The anchor after moving one step back or forward in the given view. */
export function stepDate(view: CalendarViewMode, date: string, direction: -1 | 1): string {
  const d = localDate(date);
  return view === 'week' ? toIso(addDays(d, 7 * direction)) : toIso(addMonths(startOfMonth(d), direction));
}

export function rangeTitle(view: CalendarViewMode, date: string): string {
  if (view === 'month') return format(localDate(date), 'MMMM yyyy');
  const days = weekDays(date);
  return `${format(localDate(days[0]), 'd MMM')} – ${format(localDate(days[6]), 'd MMM yyyy')}`;
}

interface TaskToComplete {
  id: string;
  task_name: string;
  task_description: string | null;
  requires_photo: boolean;
  requires_signature: boolean;
}

/** One day's events as 44 px rows; shared by the desktop side panel and the phone sheet. */
function DayList({ date, events, onSelectEvent }: { date: string; events: CalendarEvent[]; onSelectEvent: (e: CalendarEvent) => void }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">Nothing due on {format(localDate(date), 'd MMMM')}.</p>;
  return (
    <ul className="space-y-2" aria-label={`Events on ${format(localDate(date), 'EEEE d MMMM')}`}>
      {events.map((event) => (
        <li key={event.id}>
          <EventChip event={event} variant="row" onClick={onSelectEvent} />
        </li>
      ))}
    </ul>
  );
}

export interface CalendarViewProps {
  scope: CalendarScope;
  view: CalendarViewMode;
  /** Anchor day, YYYY-MM-DD: any day of the month or week in view. */
  date: string;
  onViewChange: (view: CalendarViewMode) => void;
  onDateChange: (date: string) => void;
  /** Extra toolbar controls, rendered after the navigation (the page's building filter, the tab's Subscribe). */
  toolbar?: ReactNode;
}

export function CalendarView({ scope, view, date, onViewChange, onDateChange, toolbar }: CalendarViewProps) {
  const navigate = useNavigate();
  const { user, isAdminOrManager } = useAuth();
  const isMobile = useIsMobile();
  const today = todayInOperatingTz();
  const { from, to } = useMemo(() => rangeFor(view, date), [view, date]);
  const { events, isLoading, isError, refetch, reschedule } = useCalendarEvents({ scope, from, to });
  const { hidden, toggle } = useSourceFilters(user?.id);
  const visible = useMemo(() => applyFilters(events, hidden), [events, hidden]);

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [taskToComplete, setTaskToComplete] = useState<TaskToComplete | null>(null);

  useEffect(() => {
    track('calendar_viewed', { scope: scope.kind, view });
    // Once per mount: the view and scope at first paint are what the user came for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEvent = useCallback(async (event: CalendarEvent) => {
    setSelectedDay(null);
    if (event.kind === 'issue') {
      navigate(`/issues?open=${encodeURIComponent(event.entityId)}`);
      return;
    }
    if (event.kind === 'task' && event.status !== 'done') {
      // The calendar row is title + date only; the completion dialog needs to know whether a
      // photo or a signature is required, so read those from the task itself on open.
      const { data, error } = await supabase
        .from('task_instances')
        .select('id, task_name, task_description, requires_photo, requires_signature')
        .eq('id', event.entityId)
        .maybeSingle();
      if (error || !data) {
        toast.error('Could not open that task. Try again.');
        return;
      }
      setTaskToComplete({
        id: data.id,
        task_name: data.task_name,
        task_description: data.task_description,
        requires_photo: !!data.requires_photo,
        requires_signature: !!data.requires_signature,
      });
      return;
    }
    navigate(event.href);
  }, [navigate]);

  const handleReschedule = useCallback(async (taskId: string, dateIso: string) => {
    try {
      await reschedule(taskId, dateIso);
      track('task_rescheduled', { scope: scope.kind });
      toast.success(`Task moved to ${format(localDate(dateIso), 'EEE d MMM')}`);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Could not move the task.');
    }
  }, [reschedule, scope.kind]);

  const stepLabel = view === 'week' ? 'week' : 'month';
  const panelDay = selectedDay ?? today;
  const panelEvents = useMemo(() => visible.filter((e) => e.date === panelDay), [visible, panelDay]);
  const showSidePanel = view === 'month' && !isMobile;

  return (
    <div className="space-y-4" data-testid="calendar-view">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="View" className="inline-flex rounded-md border">
          {VIEW_MODES.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={view === mode}
              onClick={() => onViewChange(mode)}
              className={cn(
                'min-h-11 px-3 text-sm first:rounded-l-md last:rounded-r-md',
                view === mode ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1">
          <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label={`Previous ${stepLabel}`} onClick={() => onDateChange(stepDate(view, date, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => onDateChange(today)}>Today</Button>
          <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label={`Next ${stepLabel}`} onClick={() => onDateChange(stepDate(view, date, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2 className="text-lg font-semibold" aria-live="polite">{rangeTitle(view, date)}</h2>
        {toolbar && <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">{toolbar}</div>}
      </div>

      <SourceFilters events={events} hidden={hidden} onToggle={toggle} />

      {isLoading && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading calendar…
        </p>
      )}
      {isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <span>Could not load the calendar.</span>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      <div className={cn('grid gap-4', showSidePanel && 'lg:grid-cols-[minmax(0,1fr)_18rem]')}>
        {view === 'month' ? (
          <CalendarGrid
            month={date}
            today={today}
            events={visible}
            onSelectDate={setSelectedDay}
            onSelectEvent={openEvent}
            onReschedule={isAdminOrManager ? handleReschedule : undefined}
          />
        ) : (
          <CalendarWeek week={date} today={today} events={visible} onSelectEvent={openEvent} />
        )}
        {showSidePanel && (
          <aside aria-label="Selected day" className="space-y-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">{format(localDate(panelDay), 'EEEE d MMMM')}</h3>
            <Hint icon={false}>Tap a day on the grid to list everything due that day.</Hint>
            <DayList date={panelDay} events={panelEvents} onSelectEvent={openEvent} />
          </aside>
        )}
      </div>

      {!showSidePanel && (
        <ResponsiveDialog open={selectedDay !== null} onOpenChange={(open) => { if (!open) setSelectedDay(null); }}>
          <ResponsiveDialogContent className="max-w-md">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{selectedDay ? format(localDate(selectedDay), 'EEEE d MMMM') : ''}</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            {selectedDay && <DayList date={selectedDay} events={panelEvents} onSelectEvent={openEvent} />}
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}

      {taskToComplete && (
        <CompleteTaskDialog
          open
          onOpenChange={(open) => { if (!open) setTaskToComplete(null); }}
          taskId={taskToComplete.id}
          taskName={taskToComplete.task_name}
          taskDescription={taskToComplete.task_description}
          requiresPhoto={taskToComplete.requires_photo}
          requiresSignature={taskToComplete.requires_signature}
          onSuccess={() => { setTaskToComplete(null); refetch(); }}
        />
      )}
    </div>
  );
}

const ALL_BUILDINGS = 'all';

export default function CalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayInOperatingTz();
  const { buildings } = useBuildings();

  const dateParam = searchParams.get('date');
  const date = dateParam && ISO_DAY.test(dateParam) ? dateParam : today;
  const viewParam = searchParams.get('view');
  // Decided once: a phone starts in week view unless the link says otherwise.
  const [initialView] = useState(() => defaultViewMode());
  const view = isCalendarViewMode(viewParam) ? viewParam : initialView;
  const buildingId = searchParams.get('building');
  const scope = useMemo<CalendarScope>(
    () => (buildingId ? { kind: 'building', id: buildingId } : { kind: 'portfolio' }),
    [buildingId],
  );

  const setParam = useCallback((key: string, value: string | null) => {
    setSearchParams((prev) => {
      if (value) prev.set(key, value); else prev.delete(key);
      return prev;
    }, { replace: true });
  }, [setSearchParams]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Calendar</h1>
        <p className="text-sm text-muted-foreground">Tasks, deadlines, expiries and services across your buildings.</p>
      </div>
      <CalendarView
        scope={scope}
        view={view}
        date={date}
        onViewChange={(v) => setParam('view', v)}
        onDateChange={(d) => setParam('date', d)}
        toolbar={
          <Select value={buildingId ?? ALL_BUILDINGS} onValueChange={(v) => setParam('building', v === ALL_BUILDINGS ? null : v)}>
            <SelectTrigger aria-label="Building" className="min-h-11 w-full sm:w-56">
              <SelectValue placeholder="All buildings" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_BUILDINGS} className="min-h-11">All buildings</SelectItem>
              {buildings.map((b) => (
                <SelectItem key={b.id} value={b.id} className="min-h-11">{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </div>
  );
}
