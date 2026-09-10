/**
 * Week view for phones: seven stacked day sections, Monday first, each event a 44 px row.
 * Read-only — moving a task is a month-grid affair; here a tap opens the entity.
 */
import { useMemo } from 'react';
import { addDays, format, startOfWeek } from 'date-fns';
import { cn } from '@/lib/utils';
import { todayInOperatingTz } from '@/lib/myWork';
import type { CalendarEvent } from '@/lib/calendar/events';
import { EventChip } from './EventChip';
import { localDate, toIso } from './CalendarGrid';

/** The Monday-first week containing `dayIso`, as seven YYYY-MM-DD strings. */
export function weekDays(dayIso: string): string[] {
  const monday = startOfWeek(localDate(dayIso), { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => toIso(addDays(monday, i)));
}

export interface CalendarWeekProps {
  /** Any day in the week to show, YYYY-MM-DD. */
  week: string;
  /** Already filtered; grouped by date here. */
  events: CalendarEvent[];
  /** YYYY-MM-DD in the operating timezone; injected by tests. */
  today?: string;
  onSelectEvent?: (event: CalendarEvent) => void;
  onSelectDate?: (dateIso: string) => void;
  className?: string;
}

export function CalendarWeek({ week, events, today = todayInOperatingTz(), onSelectEvent, onSelectDate, className }: CalendarWeekProps) {
  const days = useMemo(() => weekDays(week), [week]);
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const list = map.get(e.date);
      if (list) list.push(e); else map.set(e.date, [e]);
    }
    return map;
  }, [events]);

  return (
    <div className={cn('space-y-4', className)} data-testid="calendar-week">
      {days.map((dateIso) => {
        const date = localDate(dateIso);
        const isToday = dateIso === today;
        const dayEvents = byDate.get(dateIso) ?? [];
        const headingId = `week-day-${dateIso}`;
        return (
          <section key={dateIso} aria-labelledby={headingId} data-testid={`week-day-${dateIso}`}>
            <h3 id={headingId} className="mb-2 flex items-center gap-2 text-sm font-semibold">
              {onSelectDate ? (
                <button
                  type="button"
                  onClick={() => onSelectDate(dateIso)}
                  aria-current={isToday ? 'date' : undefined}
                  className={cn('min-h-11 rounded px-2 text-left hover:bg-muted', isToday && 'text-primary')}
                >
                  {format(date, 'EEEE d MMM')}
                </button>
              ) : (
                <span aria-current={isToday ? 'date' : undefined} className={cn('px-2', isToday && 'text-primary')}>
                  {format(date, 'EEEE d MMM')}
                </span>
              )}
              {isToday && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-normal text-primary">Today</span>}
              <span className="font-normal text-muted-foreground">· {dayEvents.length}</span>
            </h3>
            {dayEvents.length === 0 ? (
              <p className="px-2 text-sm text-muted-foreground">Nothing due.</p>
            ) : (
              <ul className="space-y-2">
                {dayEvents.map((event) => (
                  <li key={event.id}>
                    <EventChip event={event} variant="row" onClick={onSelectEvent} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default CalendarWeek;
