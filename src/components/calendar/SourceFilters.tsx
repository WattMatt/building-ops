/**
 * One toggle chip per event source, with a count of what is in view. Pressed = shown.
 * The hidden set is remembered per user in localStorage (`fortress.calendar.filters.<uid>`)
 * so a caretaker who only ever wants tasks and issues is not re-ticking boxes every visit.
 * Storage can be missing or full (private mode, quota), so every read and write is guarded
 * and a failure just means the default — everything shown.
 */
import { useCallback, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { KIND_COLORS, KIND_LABELS, type CalendarEvent, type CalendarKind } from '@/lib/calendar/events';

export const ALL_KINDS = Object.keys(KIND_LABELS) as CalendarKind[];

export const filtersStorageKey = (uid: string | null | undefined) => `fortress.calendar.filters.${uid ?? 'anon'}`;

function readHidden(uid: string | null | undefined): Set<CalendarKind> {
  try {
    const raw = window.localStorage.getItem(filtersStorageKey(uid));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is CalendarKind => typeof k === 'string' && (ALL_KINDS as string[]).includes(k)));
  } catch {
    return new Set();
  }
}

function writeHidden(uid: string | null | undefined, hidden: Set<CalendarKind>): void {
  try {
    window.localStorage.setItem(filtersStorageKey(uid), JSON.stringify([...hidden]));
  } catch {
    /* storage unavailable: the choice lasts for this page view only */
  }
}

/** The hidden-kind set for a user, persisted across visits. */
export function useSourceFilters(uid: string | null | undefined) {
  const [hidden, setHiddenState] = useState<Set<CalendarKind>>(() => readHidden(uid));

  const setHidden = useCallback((next: Set<CalendarKind>) => {
    setHiddenState(next);
    writeHidden(uid, next);
  }, [uid]);

  const toggle = useCallback((kind: CalendarKind) => {
    setHiddenState((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      writeHidden(uid, next);
      return next;
    });
  }, [uid]);

  return { hidden, setHidden, toggle };
}

/** Drops events whose kind is hidden; a no-op copy when nothing is hidden. */
export function applyFilters(events: CalendarEvent[], hidden: Set<CalendarKind>): CalendarEvent[] {
  return hidden.size === 0 ? events : events.filter((e) => !hidden.has(e.kind));
}

export function countByKind(events: CalendarEvent[]): Record<CalendarKind, number> {
  const counts = Object.fromEntries(ALL_KINDS.map((k) => [k, 0])) as Record<CalendarKind, number>;
  for (const e of events) counts[e.kind] += 1;
  return counts;
}

export interface SourceFiltersProps {
  /** The unfiltered events in view; the chips show how many of each kind there are. */
  events: CalendarEvent[];
  hidden: Set<CalendarKind>;
  onToggle: (kind: CalendarKind) => void;
  className?: string;
}

export function SourceFilters({ events, hidden, onToggle, className }: SourceFiltersProps) {
  const counts = useMemo(() => countByKind(events), [events]);
  return (
    <div role="group" aria-label="Show on calendar" className={cn('flex flex-wrap gap-2', className)}>
      {ALL_KINDS.map((kind) => {
        const shown = !hidden.has(kind);
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={shown}
            onClick={() => onToggle(kind)}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              shown ? KIND_COLORS[kind] : 'border-dashed bg-transparent text-muted-foreground',
            )}
          >
            <span className={cn(!shown && 'line-through')}>{KIND_LABELS[kind]}</span>
            <span className="tabular-nums text-xs opacity-80" aria-label={`${counts[kind]} ${KIND_LABELS[kind]}`}>{counts[kind]}</span>
          </button>
        );
      })}
    </div>
  );
}

export default SourceFilters;
