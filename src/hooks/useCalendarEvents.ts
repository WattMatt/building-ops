/**
 * Every dated thing in a scope — tasks, issue deadlines, document expiries, asset services,
 * PPM months, my sign-off due dates, report periods — as one list of `CalendarEvent`s for a
 * date range. One hook so the portfolio calendar, the building tab and My Day's week strip
 * agree on what counts as an event.
 *
 * Seven source queries fan out in parallel, keyed `['calendar', scopeKey, source, from, to]`
 * so the page can invalidate the whole family with `['calendar']`. RLS already scopes every
 * table by `can_access_building`, so portfolio scope sends no building filter; building scope
 * adds `eq('building_id', id)` (sign-offs are joined through their submission).
 *
 * Persistence: a building's calendar, or a caretaker's own buildings, is small enough to keep
 * in the offline read cache. A manager's whole-portfolio month is not, so that one stays
 * network-only rather than filling the per-user store with rows they scroll past.
 */
import { useCallback, useMemo } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fdb } from '@/integrations/supabase/fortress-db';
import { useAuth } from '@/contexts/AuthContext';
import { todayInOperatingTz } from '@/lib/myWork';
import { PERSIST_DEFAULTS } from '@/lib/persist';
import { fetchMergedPpmGrids, type PpmGridSourceRow } from '@/hooks/useBuildingPpm';
import {
  assetEvent,
  documentEvent,
  groupByDate,
  inRange,
  issueEvent,
  ppmEvents,
  reportEvent,
  signoffEvent,
  sortEvents,
  taskEvent,
  type AssetRow,
  type CalendarEvent,
  type DocumentRow,
  type IssueRow,
  type PpmMonthCell,
  type PpmRow,
  type ReportRow,
  type SignoffRequestRow,
  type SignoffSubmissionRow,
  type TaskRow,
} from '@/lib/calendar/events';

export type CalendarScope = { kind: 'portfolio' } | { kind: 'building'; id: string };

export interface UseCalendarEventsArgs {
  scope: CalendarScope;
  /** Inclusive range, YYYY-MM-DD. */
  from: string;
  to: string;
}

export interface UseCalendarEventsResult {
  events: CalendarEvent[];
  byDate: Map<string, CalendarEvent[]>;
  /** id → name for every building in scope; handy for headers and the week strip. */
  buildingNames: Map<string, string>;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  /**
   * Move a task to another day. Rejects with a plain message when the caller may not edit
   * the task (RLS returns zero rows) or when the template already has an occurrence on that
   * day (the unique index reports 23505).
   */
  reschedule: (taskId: string, newDate: string) => Promise<void>;
}

/** The seven source queries, as the third segment of their query keys. */
export type CalendarSource = 'tasks' | 'issues' | 'documents' | 'assets' | 'ppm' | 'signoffs' | 'reports';

interface BuildingRow { id: string; name: string }
/** The mappers' row shapes plus the id the join needs. */
type SubmissionRow = SignoffSubmissionRow & { id: string };
interface SignoffPair { request: SignoffRequestRow; submission: SubmissionRow | null }

function scopeKeyOf(scope: CalendarScope): string {
  return scope.kind === 'building' ? `building:${scope.id}` : 'portfolio';
}

/** Postgres surfaces a unique-index violation as SQLSTATE 23505. */
const UNIQUE_VIOLATION = '23505';

/** Every `YYYY-MM` key from the month of `from` to the month of `to`, inclusive (both YYYY-MM-DD). */
export function monthKeysBetween(from: string, to: string): string[] {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const keys: string[] = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return keys;
}

/**
 * The body of a PostgREST `or=(...)` that keeps only `ppm_services` rows whose `months` grid
 * has a cell for at least one month in `[from, to]`, e.g.
 * `months->2026-08.not.is.null,months->2026-09.not.is.null`. PostgREST parses a `->` path
 * with a hyphenated key (checked against the project's REST endpoint: 200 for this shape,
 * 400 for a malformed tree). A cell's `date` is assumed to fall in its key's month; the
 * client-side `inRange` remains the second guard either way.
 */
export function ppmMonthsFilter(from: string, to: string): string {
  return monthKeysBetween(from, to).map((k) => `months->${k}.not.is.null`).join(',');
}

/**
 * The full PPM row filter: every PLAN-BACKED row (its grid is derived server-side from
 * execution, so `months` says nothing about it) plus the legacy rows `ppmMonthsFilter`
 * admits. Plan-backed rows are narrowed to the range after the merge, by month key.
 */
export function ppmRowsFilter(from: string, to: string): string {
  return ['plan_service_id.not.is.null', ppmMonthsFilter(from, to)].filter(Boolean).join(',');
}

/** A `ppm_services` row as the calendar reads it (`select('*')`, narrowed). */
type CalendarPpmRow = PpmRow & PpmGridSourceRow & { created_at?: string | null };

/**
 * Turn the fetched rows into the `PpmRow`s `ppmEvents` expands: legacy rows pass through
 * with their `months`; plan-backed rows get their MERGED grid (override > derived > legacy)
 * over the range's months, and one row per plan line — every report month carries a row for
 * the same line, so the newest report's row (its overrides) speaks for it.
 */
export async function mergedPpmRows(rows: readonly CalendarPpmRow[], from: string, to: string): Promise<PpmRow[]> {
  const monthKeys = monthKeysBetween(from, to);
  const planBacked = rows.filter((r) => r.plan_service_id);
  const grids = await fetchMergedPpmGrids(planBacked, monthKeys);
  const newestPerLine = new Map<string, CalendarPpmRow>();
  for (const r of planBacked) {
    const cur = newestPerLine.get(r.plan_service_id!);
    if (!cur || (r.created_at ?? '') > (cur.created_at ?? '')) newestPerLine.set(r.plan_service_id!, r);
  }
  const out: PpmRow[] = [];
  for (const r of rows) {
    if (!r.plan_service_id) { out.push(r); continue; }
    if (newestPerLine.get(r.plan_service_id) !== r) continue;
    const months: Record<string, PpmMonthCell> = {};
    for (const [mk, cell] of Object.entries(grids.get(r.id) ?? {})) {
      if (cell.status) months[mk] = { status: cell.status, date: cell.doneOn ?? null };
    }
    out.push({ id: r.id, service_name: r.service_name, building_id: r.building_id, report_id: r.report_id, months });
  }
  return out;
}

export function useCalendarEvents({ scope, from, to }: UseCalendarEventsArgs): UseCalendarEventsResult {
  const { user, isAdminOrManager } = useAuth();
  const uid = user?.id;
  const queryClient = useQueryClient();
  const today = todayInOperatingTz();
  const scopeKey = scopeKeyOf(scope);
  const buildingId = scope.kind === 'building' ? scope.id : null;

  // A caretaker only ever sees their own buildings, so their portfolio is as small as a
  // building's; a manager's portfolio is the whole estate and stays out of the offline store.
  const persist = scope.kind === 'building' || !isAdminOrManager;
  const persistMeta = persist ? PERSIST_DEFAULTS : {};

  const buildings = useQuery({
    queryKey: ['calendar', scopeKey, 'buildings'],
    ...persistMeta,
    enabled: !!uid,
    queryFn: async (): Promise<BuildingRow[]> => {
      let q = supabase.from('buildings').select('id, name');
      if (buildingId) q = q.eq('id', buildingId);
      const { data, error } = await q.order('name');
      if (error) throw new Error(error.message);
      return (data ?? []) as BuildingRow[];
    },
  });

  const keyFor = (source: CalendarSource) => ['calendar', scopeKey, source, from, to];

  const sources = useQueries({
    queries: [
      {
        queryKey: keyFor('tasks'),
        ...persistMeta,
        enabled: !!uid,
        queryFn: async (): Promise<TaskRow[]> => {
          let q = supabase.from('task_instances')
            .select('id, task_name, due_date, status, building_id')
            .gte('due_date', from).lte('due_date', to);
          if (buildingId) q = q.eq('building_id', buildingId);
          const { data, error } = await q.order('due_date');
          if (error) throw new Error(error.message);
          return (data ?? []) as TaskRow[];
        },
      },
      {
        queryKey: keyFor('issues'),
        ...persistMeta,
        enabled: !!uid,
        queryFn: async (): Promise<IssueRow[]> => {
          let q = supabase.from('issues')
            .select('id, title, deadline, status, building_id')
            .gte('deadline', from).lte('deadline', to);
          if (buildingId) q = q.eq('building_id', buildingId);
          const { data, error } = await q.order('deadline');
          if (error) throw new Error(error.message);
          return (data ?? []) as IssueRow[];
        },
      },
      {
        queryKey: keyFor('documents'),
        ...persistMeta,
        enabled: !!uid,
        queryFn: async (): Promise<DocumentRow[]> => {
          let q = supabase.from('building_documents')
            .select('id, name, expiry_date, building_id')
            .gte('expiry_date', from).lte('expiry_date', to);
          if (buildingId) q = q.eq('building_id', buildingId);
          const { data, error } = await q.order('expiry_date');
          if (error) throw new Error(error.message);
          return (data ?? []) as DocumentRow[];
        },
      },
      {
        queryKey: keyFor('assets'),
        ...persistMeta,
        enabled: !!uid,
        queryFn: async (): Promise<AssetRow[]> => {
          let q = supabase.from('building_assets')
            .select('id, name, next_service_date, building_id')
            .gte('next_service_date', from).lte('next_service_date', to);
          if (buildingId) q = q.eq('building_id', buildingId);
          const { data, error } = await q.order('next_service_date');
          if (error) throw new Error(error.message);
          return (data ?? []) as AssetRow[];
        },
      },
      {
        // Legacy rows keep their months in a jsonb map and are limited server-side to those
        // with a cell in one of the range's months (so a month step does not re-download the
        // whole table). Plan-backed rows are all fetched and merged with `ppm_monthly_status`
        // for the range's months (`mergedPpmRows`); the day-level range is then applied after
        // expansion (see `events`).
        queryKey: keyFor('ppm'),
        ...persistMeta,
        enabled: !!uid,
        queryFn: async (): Promise<PpmRow[]> => {
          // plan_service_id / overrides are not yet in the generated types — read the whole row and narrow.
          let q = supabase.from('ppm_services').select('*').or(ppmRowsFilter(from, to));
          if (buildingId) q = q.eq('building_id', buildingId);
          const { data, error } = await q.order('service_name');
          if (error) throw new Error(error.message);
          return mergedPpmRows((data ?? []) as unknown as CalendarPpmRow[], from, to);
        },
      },
      {
        // Own sign-offs only, the same shape useMySignoffs reads; the range is applied after
        // the timestamp is turned into an operating-timezone date by the mapper.
        queryKey: keyFor('signoffs'),
        ...persistMeta,
        enabled: !!uid,
        queryFn: async (): Promise<SignoffPair[]> => {
          const { data, error } = await supabase.from('form_signoff_requests')
            .select('id, submission_id, due_at, status')
            .eq('assigned_to', uid!).eq('active', true).eq('status', 'pending')
            .not('due_at', 'is', null)
            .order('due_at', { nullsFirst: false });
          if (error) throw new Error(error.message);
          const reqs = (data ?? []) as SignoffRequestRow[];
          const subIds = [...new Set(reqs.map((r) => r.submission_id))];
          if (subIds.length === 0) return [];
          let sq = supabase.from('form_submissions').select('id, form_name, building_id').in('id', subIds);
          if (buildingId) sq = sq.eq('building_id', buildingId);
          const { data: subs, error: subsError } = await sq.order('form_name');
          if (subsError) throw new Error(subsError.message);
          const subMap = new Map(((subs ?? []) as SubmissionRow[]).map((s) => [s.id, s]));
          return reqs
            .map((request) => ({ request, submission: subMap.get(request.submission_id) ?? null }))
            // In building scope a request whose submission belongs elsewhere drops out here.
            .filter((p) => !buildingId || p.submission !== null);
        },
      },
      {
        queryKey: keyFor('reports'),
        ...persistMeta,
        enabled: !!uid,
        queryFn: async (): Promise<ReportRow[]> => {
          let q = fdb.from('reports').select('id, building_id, report_period, status')
            .gte('report_period', from).lte('report_period', to);
          if (buildingId) q = q.eq('building_id', buildingId);
          const { data, error } = await q.order('report_period');
          if (error) throw new Error(error.message);
          return (data ?? []) as ReportRow[];
        },
      },
    ],
  });

  const [tasks, issues, documents, assets, ppm, signoffs, reports] = sources;

  const buildingNames = useMemo(
    () => new Map((buildings.data ?? []).map((b) => [b.id, b.name])),
    [buildings.data],
  );

  const events = useMemo(() => {
    const nameOf = (id: string | null | undefined) => (id ? buildingNames.get(id) ?? null : null);
    const all: CalendarEvent[] = [
      ...(tasks.data ?? []).map((r) => taskEvent(r, nameOf(r.building_id), today)),
      ...(issues.data ?? []).flatMap((r) => { const e = issueEvent(r, nameOf(r.building_id), today); return e ? [e] : []; }),
      ...(documents.data ?? []).flatMap((r) => { const e = documentEvent(r, nameOf(r.building_id), today); return e ? [e] : []; }),
      ...(assets.data ?? []).flatMap((r) => { const e = assetEvent(r, nameOf(r.building_id), today); return e ? [e] : []; }),
      ...(ppm.data ?? []).flatMap((r) => ppmEvents(r, nameOf(r.building_id), today)),
      ...(signoffs.data ?? []).flatMap((p) => {
        const e = signoffEvent(p.request, p.submission, nameOf(p.submission?.building_id), today);
        return e ? [e] : [];
      }),
      ...(reports.data ?? []).map((r) => reportEvent(r, nameOf(r.building_id), today)),
    ];
    return sortEvents(inRange(all, from, to));
  }, [tasks.data, issues.data, documents.data, assets.data, ppm.data, signoffs.data, reports.data, buildingNames, today, from, to]);

  const byDate = useMemo(() => groupByDate(events), [events]);

  const isLoading = buildings.isLoading || sources.some((s) => s.isLoading);
  const isError = buildings.isError || sources.some((s) => s.isError);
  const error = (buildings.error ?? sources.find((s) => s.error)?.error ?? null) as Error | null;

  const refetch = useCallback(() => {
    void buildings.refetch();
    for (const s of sources) void s.refetch();
    // `sources` is a fresh array each render; its refetch functions are stable per query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings.refetch, ...sources.map((s) => s.refetch)]);

  const reschedule = useCallback(async (taskId: string, newDate: string) => {
    const { data, error: updateError } = await supabase.from('task_instances')
      .update({ due_date: newDate })
      .eq('id', taskId)
      .select('id');
    if (updateError) {
      if (updateError.code === UNIQUE_VIOLATION) throw new Error('That task already has an occurrence on that day.');
      throw new Error(updateError.message);
    }
    // RLS filters the row out of an UPDATE silently: no error, no rows. That is a permission
    // problem, not a success, so say so instead of leaving the chip where it was dropped.
    if (!data || data.length === 0) throw new Error('You do not have permission to move this task.');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['calendar'] }),
      queryClient.invalidateQueries({ queryKey: ['my-work'] }),
      queryClient.invalidateQueries({ queryKey: ['building-overview'] }),
    ]);
  }, [queryClient]);

  return { events, byDate, buildingNames, isLoading, isError, error, refetch, reschedule };
}
