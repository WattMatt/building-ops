/**
 * Week view for phones: seven stacked day sections, Monday first, each event a 44 px row.
 * A tap on a row opens the entity.
 *
 * Rescheduling, when `onReschedule` is provided, mirrors the month grid's keyboard path but
 * needs no keyboard (phones have none): every open task row gets a 44 px "Move" button that
 * opens a native date input (44 px); picking a day calls `onReschedule(taskId, dateIso)`.
 * Focusing the row and pressing `m` opens the same input. Escape or blur puts it away. The
 * same rule as the grid decides which rows may move (`isDraggable`: open tasks only).
 */
import { useMemo, useState, type KeyboardEvent } from 'react';
import { addDays, format, startOfWeek } from 'date-fns';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { todayInOperatingTz } from '@/lib/myWork';
import type { CalendarEvent } from '@/lib/calendar/events';
import { EventChip, isDraggable } from './EventChip';
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
  /** Present when the viewer may move tasks; absent makes the week read-only. */
  onReschedule?: (taskId: string, dateIso: string) => void;
  className?: string;
}

export function CalendarWeek({ week, events, today = todayInOperatingTz(), onSelectEvent, onSelectDate, onReschedule, className }: CalendarWeekProps) {
  const days = useMemo(() => weekDays(week), [week]);
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const list = map.get(e.date);
      if (list) list.push(e); else map.set(e.date, [e]);
    }
    return map;
  }, [events]);

  const canMove = !!onReschedule;
  /** The task being moved, if any. */
  const [moving, setMoving] = useState<CalendarEvent | null>(null);

  const handleChipKey = (e: KeyboardEvent<HTMLButtonElement>, event: CalendarEvent) => {
    if ((e.key === 'm' || e.key === 'M') && isDraggable(event, canMove)) {
      e.preventDefault();
      setMoving(event);
    }
  };

  return (
    <div className={cn('space-y-4', className)} data-testid="calendar-week">
      {canMove && (
        <Hint>Tap Move on a task to pick another day, or focus a task and press M.</Hint>
      )}
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
                {dayEvents.map((event) => {
                  const movable = isDraggable(event, canMove);
                  const isMoving = moving?.id === event.id;
                  return (
                    <li key={event.id} className="flex flex-col gap-1">
                      <div className="flex items-stretch gap-2">
                        <EventChip
                          event={event}
                          variant="row"
                          onClick={onSelectEvent}
                          onKeyDown={movable ? handleChipKey : undefined}
                          className="min-w-0 flex-1"
                        />
                        {movable && (
                          <button
                            type="button"
                            aria-label={`Move ${event.title}`}
                            aria-expanded={isMoving}
                            onClick={() => setMoving(isMoving ? null : event)}
                            className="min-h-11 min-w-11 shrink-0 rounded border px-3 text-sm hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Move
                          </button>
                        )}
                      </div>
                      {isMoving && moving && (
                        <label className="flex flex-col gap-1 text-xs">
                          <span className="sr-only">Move {moving.title} to</span>
                          <input
                            type="date"
                            autoFocus
                            defaultValue={moving.date}
                            aria-label={`Move ${moving.title} to`}
                            className="min-h-11 w-full rounded border bg-background px-2 text-sm"
                            onChange={(e) => {
                              const next = e.target.value;
                              if (!next || next === moving.date) return;
                              setMoving(null);
                              onReschedule?.(moving.entityId, next);
                            }}
                            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setMoving(null); } }}
                            onBlur={() => setMoving(null)}
                          />
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default CalendarWeek;
