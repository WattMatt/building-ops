/**
 * PPM — planned preventive maintenance matrix. Rows are services; columns are the 12
 * fiscal-year months (SA fiscal year starts July). Registry key stays `ppm`.
 *
 * Two kinds of row since R3c (spec §5.6 / D6):
 *  - PLAN-BACKED (`plan_service_id` set): the cell status is DERIVED from execution
 *    (`ppm_monthly_status`, via useReportPpm.derived) and shown in the usual colours. A
 *    manager can pin a cell with a noted override — tap the cell, pick a status, write why —
 *    stored in `ppm_services.overrides` and shown with a small chip; the note appears on
 *    hover / in the popover. `months` is never written for these rows.
 *  - LEGACY (no `plan_service_id`, reports from before the plan existed): the original
 *    click-cycling on `months` (blank → due → done → missed → na → blank) stays as it was.
 *
 * Rows are seeded from the building plan when the report is created and on carry-forward
 * (useFortressReports.ts). "Sync with the PPM plan" (admin/manager, draft only) re-runs the
 * same idempotent seed for plan lines added after that — it never duplicates a row.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Plus, Trash2, ListPlus } from 'lucide-react';
import { SectionCard } from '../SectionCard';
import { Hint } from '@/components/ui/hint';
import { PpmLegend } from '@/components/ppm/PpmLegend';
import { fdb } from '@/integrations/supabase/fortress-db';
import { useAuth } from '@/contexts/AuthContext';
import { useReportPpm, isPlanBacked, type PpmServiceRow } from '@/hooks/useReportPpm';
import { ppmCompletion, type PpmCellStatus, type PpmCell } from '@/lib/ppmStatus';
import {
  asPpmStatus, colHeader, derivedByService, fiscalWindow, mergePpmGrid, occurrenceSummary,
  PPM_STATUSES, PPM_STATUS_SHORT, PPM_STATUS_STYLE, type MergedCell,
} from '@/lib/ppmGrid';
import { cn } from '@/lib/utils';
import type { SectionProps } from './types';

/** Click-cycle order for legacy rows; blank is "no key". */
const CYCLE: (PpmCellStatus | null)[] = [null, 'due', 'done', 'missed', 'na'];
const STATUS_STYLE = PPM_STATUS_STYLE;
const SHORT = PPM_STATUS_SHORT;
/** 44 px on phones, compact with a mouse. */
const CELL = 'h-11 w-11 sm:h-7 sm:w-7 rounded-sm text-xs font-semibold transition-colors';
/** Plan-backed rows are removed by deactivating the line, never from a report (coaching copy, so a Hint). */
const PLAN_ROW_HINT = "Rows from the building's PPM plan can't be deleted here — to take a service off future reports, deactivate its line on the building's PPM tab.";

function nextStatus(current: PpmCellStatus | null | undefined): PpmCellStatus | null {
  const idx = CYCLE.indexOf(current ?? null);
  return CYCLE[(idx + 1) % CYCLE.length];
}

function cellTitle(cell: MergedCell): string {
  const label = cell.status ? STATUS_STYLE[cell.status].label : 'No occurrence';
  const several = occurrenceSummary(cell);
  if (cell.source === 'override') {
    const derived = cell.derivedStatus ? STATUS_STYLE[cell.derivedStatus].label : 'no occurrence';
    return `${label} (override — execution says ${derived}${several ? `; ${several}` : ''}): ${cell.note ?? ''}`;
  }
  if (cell.source === 'legacy') return `${label} (captured by hand)`;
  const base = cell.doneOn ? `${label} on ${cell.doneOn}` : label;
  return several ? `${base} (${several})` : base;
}

/** One plan-backed cell: derived colour, override chip, and the override popover when editable. */
function PlanCell({ svc, month, cell, readOnly, onSave }: {
  svc: PpmServiceRow;
  month: string;
  cell: MergedCell;
  readOnly: boolean;
  onSave: (value: { status: PpmCellStatus; note: string } | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PpmCellStatus | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const style = cell.status ? STATUS_STYLE[cell.status] : null;
  const title = cellTitle(cell);
  const label = `${svc.service_name} ${month}: ${title}`;

  const face = (
    <>
      {cell.status ? SHORT[cell.status] : ''}
      {cell.source === 'override' && (
        <span aria-hidden="true" data-testid="override-chip" className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />
      )}
    </>
  );
  const faceCls = cn('relative mx-auto flex items-center justify-center', CELL, style ? style.cls : 'border border-border bg-background');

  if (readOnly) {
    return <div role="img" aria-label={label} title={title} className={faceCls}>{face}</div>;
  }

  const onOpenChange = (next: boolean) => {
    if (next) {
      setStatus(cell.source === 'override' ? cell.status : null);
      setNote(cell.source === 'override' ? (cell.note ?? '') : '');
    }
    setOpen(next);
  };
  const submit = async (value: { status: PpmCellStatus; note: string } | null) => {
    setSaving(true);
    try { await onSave(value); setOpen(false); } catch { /* the hook has shown the plain error */ } finally { setSaving(false); }
  };
  const derivedLabel = cell.derivedStatus ? STATUS_STYLE[cell.derivedStatus].label : 'no occurrence';
  const canSave = !!status && note.trim().length > 0 && !(cell.source === 'override' && status === cell.status && note.trim() === (cell.note ?? '').trim());

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} title={title} className={cn(faceCls, 'hover:opacity-80 cursor-pointer')}>
          {face}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72 space-y-3">
        <div>
          <p className="text-sm font-medium">{svc.service_name} · {colHeader(month).mon} {colHeader(month).yr}</p>
          <p className="text-xs text-muted-foreground">Execution says: {derivedLabel}{cell.doneOn ? ` (${cell.doneOn})` : ''}</p>
        </div>
        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Override status">
          {PPM_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={cn(
                'min-h-11 rounded-md border text-xs font-medium',
                status === s ? `${STATUS_STYLE[s].cls} border-transparent ring-2 ring-ring` : 'bg-background hover:bg-muted',
              )}
            >
              {STATUS_STYLE[s].label}
            </button>
          ))}
        </div>
        <div className="space-y-1">
          <label htmlFor={`ppm-note-${svc.id}-${month}`} className="text-xs font-medium">Why (required)</label>
          <Textarea id={`ppm-note-${svc.id}-${month}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Serviced under warranty, no task logged" />
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="outline" size="sm" className="min-h-11" disabled={saving || cell.source !== 'override'} onClick={() => void submit(null)}>
            Keep derived ({derivedLabel})
          </Button>
          <Button size="sm" className="min-h-11" disabled={!canSave || saving} onClick={() => status && void submit({ status, note })}>
            {saving ? 'Saving…' : 'Save override'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function PpmSection({ reportId, buildingId, readOnly }: SectionProps) {
  const { isAdminOrManager } = useAuth();

  const { data: report } = useQuery({
    queryKey: ['fortress-report-period', reportId],
    enabled: !!reportId,
    queryFn: async (): Promise<{ report_period: string | null }> => {
      const { data, error } = await fdb.from('reports').select('report_period').eq('id', reportId).maybeSingle();
      if (error) throw error;
      return { report_period: data?.report_period ?? null };
    },
  });

  // The window waits for the report: computing it from `undefined` would anchor on today,
  // fetch the derived grid once for that window and again for the real one, and flash.
  const months = useMemo(() => (report ? fiscalWindow(report.report_period) : []), [report]);

  const {
    services, isLoading, derived, upsertService, isSaving, removeService, setOverride, seedFromPlan, isSeeding,
  } = useReportPpm(reportId, buildingId, months);

  const byService = useMemo(() => derivedByService(derived), [derived]);
  const grids = useMemo(() => {
    const out = new Map<string, Record<string, MergedCell>>();
    for (const svc of services) {
      if (!isPlanBacked(svc)) continue;
      out.set(svc.id, mergePpmGrid(months, byService.get(svc.plan_service_id!) ?? [], svc.overrides, svc.months));
    }
    return out;
  }, [services, months, byService]);

  // K11 over what the grid shows: merged cells for plan-backed rows, `months` for legacy rows.
  const completion = useMemo(
    () => ppmCompletion(services.map((s) => ({ months: grids.get(s.id) ?? s.months }))),
    [services, grids],
  );

  // Local text drafts so typing isn't a network call per keystroke; persist on blur.
  const [drafts, setDrafts] = useState<Record<string, { service_name: string; frequency: string; comment: string }>>({});
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const s of services) {
        if (!next[s.id]) {
          next[s.id] = { service_name: s.service_name ?? '', frequency: s.frequency ?? '', comment: s.comment ?? '' };
        }
      }
      return next;
    });
  }, [services]);

  const [newName, setNewName] = useState('');

  const setDraft = (id: string, k: 'service_name' | 'frequency' | 'comment', v: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [k]: v } }));

  const persistText = (id: string) => {
    const svc = services.find((s) => s.id === id);
    const d = drafts[id];
    if (!svc || !d) return;
    if (d.service_name === (svc.service_name ?? '') && d.frequency === (svc.frequency ?? '') && d.comment === (svc.comment ?? '')) return;
    if (!d.service_name.trim()) return; // service_name is NOT NULL
    void upsertService({
      id: svc.id,
      service_name: d.service_name.trim(),
      frequency: d.frequency.trim() || null,
      comment: d.comment.trim() || null,
      sort_order: svc.sort_order,
      // `months` is written for legacy rows only; a plan-backed row's grid is derived + overrides.
      ...(isPlanBacked(svc) ? {} : { months: svc.months }),
    });
  };

  const cycleCell = (svcId: string, monthKey: string) => {
    const svc = services.find((s) => s.id === svcId);
    if (!svc || isPlanBacked(svc)) return;
    const cur = svc.months[monthKey]?.status;
    const nxt = nextStatus(cur);
    const months = { ...svc.months };
    if (nxt === null) delete months[monthKey];
    else {
      const existing = months[monthKey] ?? {};
      const cell: PpmCell = { ...existing, status: nxt };
      months[monthKey] = cell;
    }
    void upsertService({
      id: svc.id,
      service_name: svc.service_name,
      frequency: svc.frequency,
      comment: svc.comment,
      sort_order: svc.sort_order,
      months,
    });
  };

  const addService = () => {
    const name = newName.trim();
    if (!name) return;
    const maxSort = services.reduce((m, s) => Math.max(m, s.sort_order ?? 0), 0);
    void upsertService({ service_name: name, sort_order: maxSort + 1, months: {} });
    setNewName('');
  };

  const canSeed = !readOnly && isAdminOrManager;
  const seedButton = canSeed && (
    <Button variant="outline" size="sm" className="min-h-11" onClick={() => void seedFromPlan().catch(() => {})} disabled={isSeeding}
      title="Adds any active plan line this report does not have yet; never duplicates a row">
      <ListPlus className="mr-2 h-4 w-4" /> {isSeeding ? 'Syncing…' : 'Sync with the PPM plan'}
    </Button>
  );

  const hasPlanRows = services.some(isPlanBacked);

  return (
    <SectionCard
      title="PPM"
      hint="Planned maintenance status. Rows from the building's PPM plan fill in from completed occurrences; tap a cell to pin a different status with a note. Older rows still cycle on click."
      readOnly={readOnly}
      headerAccessory={
        <span className="text-sm text-muted-foreground">
          {services.length} {services.length === 1 ? 'service' : 'services'}
          {completion.total > 0 && ` · ${completion.doneCount}/${completion.total} serviced`}
        </span>
      }
    >
      {isLoading || !report ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-3">
          <PpmLegend blankLabel="Blank" showOverride />
          {!readOnly && hasPlanRows && <Hint>{PLAN_ROW_HINT}</Hint>}
          {services.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">No services on this report yet.</p>
              {seedButton}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="sticky left-0 z-10 bg-background px-2 py-2 text-left font-medium min-w-44">Service</th>
                    {!readOnly && <th scope="col" className="px-2 py-2 text-left font-medium min-w-28">Frequency</th>}
                    {months.map((mk) => {
                      const { mon, yr } = colHeader(mk);
                      return (
                        <th key={mk} scope="col" className="px-1 py-2 text-center font-medium whitespace-nowrap">
                          <div>{mon}</div><div className="text-[10px] text-muted-foreground">{yr}</div>
                        </th>
                      );
                    })}
                    {!readOnly && <th scope="col" className="w-8"><span className="sr-only">Remove</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {services.map((svc) => {
                    const planBacked = isPlanBacked(svc);
                    const grid = grids.get(svc.id);
                    const d = drafts[svc.id] ?? { service_name: svc.service_name ?? '', frequency: svc.frequency ?? '', comment: svc.comment ?? '' };
                    return (
                      <tr key={svc.id} className="border-b align-top" data-plan-backed={planBacked ? 'true' : undefined}>
                        <th scope="row" className="sticky left-0 z-10 bg-background px-2 py-1.5 min-w-44 text-left font-normal">
                          {readOnly ? (
                            <>
                              <div className="font-medium">{svc.service_name}</div>
                              {svc.frequency && <div className="text-xs text-muted-foreground">{svc.frequency}</div>}
                              {svc.comment && <div className="text-xs text-muted-foreground italic">{svc.comment}</div>}
                            </>
                          ) : (
                            <div className="space-y-1">
                              {planBacked ? (
                                <div className="font-medium leading-8" title="Named on the building's PPM plan">{svc.service_name}</div>
                              ) : (
                                <Input className="h-8" value={d.service_name}
                                  onChange={(e) => setDraft(svc.id, 'service_name', e.target.value)}
                                  onBlur={() => persistText(svc.id)} />
                              )}
                              <Input className="h-7 text-xs" placeholder="Comment" value={d.comment}
                                onChange={(e) => setDraft(svc.id, 'comment', e.target.value)}
                                onBlur={() => persistText(svc.id)} />
                            </div>
                          )}
                        </th>
                        {!readOnly && (
                          <td className="px-2 py-1.5 min-w-28">
                            {planBacked ? (
                              <div className="text-xs text-muted-foreground leading-8">{svc.frequency ?? ''}</div>
                            ) : (
                              <Input className="h-8" placeholder="e.g. Monthly" value={d.frequency}
                                onChange={(e) => setDraft(svc.id, 'frequency', e.target.value)}
                                onBlur={() => persistText(svc.id)} />
                            )}
                          </td>
                        )}
                        {months.map((mk) => {
                          if (planBacked && grid) {
                            return (
                              <td key={mk} className="px-0.5 py-1.5 text-center">
                                <PlanCell svc={svc} month={mk} cell={grid[mk]} readOnly={readOnly}
                                  onSave={(value) => setOverride(svc.id, mk, value)} />
                              </td>
                            );
                          }
                          // Straight off jsonb: a status the grid does not know renders as blank, not a crash.
                          const status = asPpmStatus(svc.months[mk]?.status);
                          const style = status ? STATUS_STYLE[status] : null;
                          return (
                            <td key={mk} className="px-0.5 py-1.5 text-center">
                              <button
                                type="button"
                                disabled={readOnly}
                                onClick={() => cycleCell(svc.id, mk)}
                                aria-label={`${svc.service_name} ${mk}: ${status ? STATUS_STYLE[status].label : 'Blank'}`}
                                title={status ? STATUS_STYLE[status].label : 'Blank'}
                                className={[
                                  'mx-auto flex items-center justify-center', CELL,
                                  style ? style.cls : 'border border-border bg-background',
                                  readOnly ? '' : 'hover:opacity-80 cursor-pointer',
                                ].join(' ')}
                              >
                                {status ? SHORT[status] : ''}
                              </button>
                            </td>
                          );
                        })}
                        {!readOnly && (
                          <td className="px-1 py-1.5 text-center">
                            {/* A plan-backed row is not deleted from a report: deactivate the plan line instead (see PLAN_ROW_HINT). */}
                            {!planBacked && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" aria-label={`Remove ${svc.service_name}`}>
                                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Remove this service?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      “{svc.service_name}” and its monthly status grid will be permanently deleted.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => void removeService(svc.id)}>Delete</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-11 max-w-xs"
                aria-label="Ad-hoc service (not on the plan)"
                placeholder="Ad-hoc service (not on the plan)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addService(); } }}
              />
              <Button variant="outline" size="sm" className="min-h-11" onClick={addService} disabled={!newName.trim() || isSaving}>
                <Plus className="mr-2 h-4 w-4" /> Add service
              </Button>
              {services.length > 0 && seedButton}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
