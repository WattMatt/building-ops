/**
 * One event on the calendar: coloured by source, struck through when done, red when overdue.
 * Two shapes — a compact `chip` for month cells and a 44 px `row` for the week list — so the
 * two views share one look and one set of states.
 *
 * Tasks can be picked up and dragged when `canDrag` is set; the chip only announces the drag
 * (`text/plain` = task id). The drop target and the keyboard alternative live in CalendarGrid.
 */
import type { DragEvent, KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { KIND_COLORS, KIND_LABELS, type CalendarEvent } from '@/lib/calendar/events';

export interface EventChipProps {
  event: CalendarEvent;
  variant?: 'chip' | 'row';
  onClick?: (event: CalendarEvent) => void;
  /** Whether this chip may be dragged; only honoured for tasks. */
  canDrag?: boolean;
  onDragStart?: (event: CalendarEvent) => void;
  onDragEnd?: () => void;
  onKeyDown?: (key: KeyboardEvent<HTMLButtonElement>, event: CalendarEvent) => void;
  className?: string;
}

export function isDraggable(event: CalendarEvent, canDrag: boolean | undefined): boolean {
  return !!canDrag && event.kind === 'task' && event.status !== 'done';
}

export function EventChip({ event, variant = 'chip', onClick, canDrag, onDragStart, onDragEnd, onKeyDown, className }: EventChipProps) {
  const draggable = isDraggable(event, canDrag);
  const overdue = event.status === 'overdue';
  const done = event.status === 'done';
  const label = `${KIND_LABELS[event.kind]}: ${event.title}${event.buildingName ? ` · ${event.buildingName}` : ''}${overdue ? ' (overdue)' : done ? ' (done)' : ''}`;

  const handleDragStart = (e: DragEvent<HTMLButtonElement>) => {
    if (!draggable) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', event.entityId);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.(event);
  };

  return (
    <button
      type="button"
      draggable={draggable || undefined}
      onDragStart={draggable ? handleDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={onClick ? () => onClick(event) : undefined}
      onKeyDown={onKeyDown ? (e) => onKeyDown(e, event) : undefined}
      aria-label={label}
      data-event-id={event.id}
      data-kind={event.kind}
      className={cn(
        'flex w-full min-w-0 items-center gap-1.5 rounded border text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        variant === 'chip' ? 'min-h-6 px-1.5 py-0.5 text-xs' : 'min-h-11 px-3 py-2 text-sm',
        KIND_COLORS[event.kind],
        draggable && 'cursor-grab active:cursor-grabbing',
        done && 'opacity-60',
        className,
      )}
    >
      <span
        className={cn(
          'truncate',
          overdue && !done && 'font-medium text-destructive',
          done && 'line-through',
        )}
      >
        {event.title}
      </span>
      {variant === 'row' && event.buildingName && (
        <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">{event.buildingName}</span>
      )}
    </button>
  );
}

export default EventChip;
