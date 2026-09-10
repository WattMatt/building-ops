/**
 * Month grid: seven columns, Monday first, every cell a drop target. A cell shows up to
 * three chips and a "+N more" that opens the day. Today's number wears a ring.
 *
 * Rescheduling has two equal paths so it is not mouse-only:
 *  - drag a task chip onto another day (HTML5 drag/drop, `text/plain` carries the task id);
 *  - focus a task chip and press `m`: a native date input (44 px) replaces the chip's cell
 *    footer; picking a day calls the same `onReschedule`. Escape or blur puts it away.
 * Both are gated on `onReschedule` being provided — the parent decides who may move tasks.
 *
 * Date maths is on YYYY-MM-DD strings turned into local dates, the same convention the
 * other grids use, so a cell never shifts a day with the device timezone.
 */
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { addDays, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { todayInOperatingTz } from '@/lib/myWork';
import type { CalendarEvent } from '@/lib/calendar/events';
import { EventChip, isDraggable } from './EventChip';

export const MAX_CHIPS_PER_DAY = 3;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A Date carrying the ISO day as LOCAL components so date-fns formats the intended day. */
export function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const toIso = (d: Date): string => format(d, 'yyyy-MM-dd');

/** The 5–6 Monday-first weeks that cover the month containing `monthIso`. */
export function monthCells(monthIso: string): string[][] {
  const first = startOfMonth(localDate(monthIso));
  const start = startOfWeek(first, { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(first), { weekStartsOn: 1 });
  const weeks: string[][] = [];
  for (let d = start; d <= end; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => toIso(addDays(d, i))));
  }
  return weeks;
}

export interface CalendarGridProps {
  /** Any day in the month to show, YYYY-MM-DD. */
  month: string;
  /** Already filtered; grouped by date here. */
  events: CalendarEvent[];
  /** YYYY-MM-DD in the operating timezone; injected by tests. */
  today?: string;
  onSelectDate?: (dateIso: string) => void;
  onSelectEvent?: (event: CalendarEvent) => void;
  /** Present when the viewer may move tasks; absent makes the grid read-only. */
  onReschedule?: (taskId: string, dateIso: string) => void;
  className?: string;
}

export function CalendarGrid({ month, events, today = todayInOperatingTz(), onSelectDate, onSelectEvent, onReschedule, className }: CalendarGridProps) {
  const weeks = useMemo(() => monthCells(month), [month]);
  const monthDate = useMemo(() => localDate(month), [month]);
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const list = map.get(e.date);
      if (list) list.push(e); else map.set(e.date, [e]);
    }
    return map;
  }, [events]);

  const canDrag = !!onReschedule;
  // The id travels in dataTransfer, but some browsers hand back an empty string during
  // dragover/drop of a same-page drag; the ref is the belt to that brace.
  const draggingId = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  /** The task being moved by keyboard, if any. */
  const [moving, setMoving] = useState<CalendarEvent | null>(null);

  const handleDragOver = (dateIso: string) => (e: DragEvent<HTMLDivElement>) => {
    if (!canDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== dateIso) setDragOver(dateIso);
  };

  const handleDrop = (dateIso: string) => (e: DragEvent<HTMLDivElement>) => {
    if (!canDrag) return;
    e.preventDefault();
    const fromTransfer = e.dataTransfer?.getData('text/plain');
    const taskId = fromTransfer || draggingId.current;
    draggingId.current = null;
    setDragOver(null);
    if (!taskId) return;
    const dragged = events.find((ev) => ev.entityId === taskId && ev.kind === 'task');
    if (dragged && dragged.date === dateIso) return; // dropped where it started: nothing to do
    onReschedule?.(taskId, dateIso);
  };

  const handleChipKey = (e: KeyboardEvent<HTMLButtonElement>, event: CalendarEvent) => {
    if ((e.key === 'm' || e.key === 'M') && isDraggable(event, canDrag)) {
      e.preventDefault();
      setMoving(event);
    }
  };

  return (
    <div className={cn('space-y-2', className)} data-testid="calendar-grid">
      {canDrag && (
        <Hint>Drag a task to another day to move it, or focus a task and press M to pick a date.</Hint>
      )}
      <div role="grid" aria-label={format(monthDate, 'MMMM yyyy')} className="overflow-x-auto">
        <div role="row" className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map((d) => (
            <div key={d} role="columnheader" className="py-1 text-center text-xs font-medium text-muted-foreground">{d}</div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} role="row" className="grid grid-cols-7 gap-1 mb-1">
            {week.map((dateIso) => {
              const date = localDate(dateIso);
              const inMonth = isSameMonth(date, monthDate);
              const isToday = dateIso === today;
              const dayEvents = byDate.get(dateIso) ?? [];
              const visible = dayEvents.slice(0, MAX_CHIPS_PER_DAY);
              const overflow = dayEvents.length - visible.length;
              const isMovingHere = moving?.date === dateIso;
              return (
                <div
                  key={dateIso}
                  role="gridcell"
                  data-date={dateIso}
                  data-testid={`day-${dateIso}`}
                  aria-label={`${format(date, 'EEEE d MMMM')}${dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}` : ''}`}
                  onDragOver={handleDragOver(dateIso)}
                  onDragLeave={() => { if (dragOver === dateIso) setDragOver(null); }}
                  onDrop={handleDrop(dateIso)}
                  className={cn(
                    'flex min-h-24 flex-col gap-1 rounded-md border p-1 transition-colors',
                    !inMonth && 'bg-muted/40 text-muted-foreground',
                    dragOver === dateIso && 'border-primary bg-primary/5',
                  )}
                >
                  <button
                    type="button"
                    onClick={onSelectDate ? () => onSelectDate(dateIso) : undefined}
                    aria-label={`Open ${format(date, 'EEEE d MMMM')}`}
                    aria-current={isToday ? 'date' : undefined}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center self-start rounded-full text-xs font-medium sm:min-h-11 sm:min-w-11',
                      isToday && 'ring-2 ring-primary text-primary',
                      onSelectDate && 'hover:bg-muted',
                    )}
                  >
                    {format(date, 'd')}
                  </button>
                  <div className="flex flex-col gap-0.5">
                    {visible.map((event) => (
                      <EventChip
                        key={event.id}
                        event={event}
                        onClick={onSelectEvent}
                        canDrag={canDrag}
                        onDragStart={(ev) => { draggingId.current = ev.entityId; }}
                        onDragEnd={() => { draggingId.current = null; setDragOver(null); }}
                        onKeyDown={canDrag ? handleChipKey : undefined}
                      />
                    ))}
                    {overflow > 0 && (
                      <button
                        type="button"
                        onClick={() => onSelectDate?.(dateIso)}
                        className="min-h-6 rounded px-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
                        aria-label={`${overflow} more on ${format(date, 'd MMMM')}`}
                      >
                        +{overflow} more
                      </button>
                    )}
                  </div>
                  {isMovingHere && moving && (
                    <label className="mt-auto flex flex-col gap-1 text-xs">
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
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default CalendarGrid;
