/**
 * PPM — planned preventive maintenance matrix. Rows are contractor services; columns
 * are the 12 fiscal-year months (SA fiscal year starts July). Each cell is a service
 * status the manager sets: blank → due → done → missed → na → blank. Edits persist
 * immediately via useReportPpm (cells on click, text fields on blur). `readOnly`
 * collapses the grid to view-only. Registry key stays `ppm`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Plus, Trash2 } from 'lucide-react';
import { SectionCard } from '../SectionCard';
import { fdb } from '@/integrations/supabase/fortress-db';
import { useReportPpm } from '@/hooks/useReportPpm';
import type { PpmCellStatus, PpmCell } from '@/lib/ppmStatus';
import type { SectionProps } from './types';

/** Click-cycle order; blank is "no key". */
const CYCLE: (PpmCellStatus | null)[] = [null, 'due', 'done', 'missed', 'na'];
const STATUS_STYLE: Record<PpmCellStatus, { cls: string; label: string }> = {
  done: { cls: 'bg-emerald-500 text-white', label: 'Done' },
  due: { cls: 'bg-amber-400 text-amber-950', label: 'Due' },
  missed: { cls: 'bg-destructive text-destructive-foreground', label: 'Missed' },
  na: { cls: 'bg-muted text-muted-foreground', label: 'N/A' },
};
const SHORT: Record<PpmCellStatus, string> = { done: '✓', due: '•', missed: '✕', na: '—' };

/** "YYYY-MM" keys for the report's 12-month window, anchored on the SA fiscal year (July). */
function fiscalWindow(reportPeriod: string | null | undefined): string[] {
  // report_period is a YYYY-MM-DD first-of-month date; fall back to current month.
  const base = reportPeriod ? new Date(`${reportPeriod.slice(0, 10)}T00:00:00`) : new Date();
  const y = base.getFullYear();
  const m = base.getMonth(); // 0-based
  const startYear = m >= 6 ? y : y - 1; // July = month index 6
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(startYear, 6 + i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function colHeader(monthKey: string): { mon: string; yr: string } {
  const d = new Date(`${monthKey}-01T00:00:00`);
  return {
    mon: d.toLocaleDateString('en-ZA', { month: 'short' }),
    yr: `'${String(d.getFullYear()).slice(2)}`,
  };
}

function nextStatus(current: PpmCellStatus | undefined): PpmCellStatus | null {
  const idx = CYCLE.indexOf(current ?? null);
  return CYCLE[(idx + 1) % CYCLE.length];
}

export default function PpmSection({ reportId, buildingId, readOnly }: SectionProps) {
  const { services, isLoading, upsertService, isSaving, removeService } = useReportPpm(reportId, buildingId);

  const { data: report } = useQuery({
    queryKey: ['fortress-report-period', reportId],
    enabled: !!reportId,
    queryFn: async (): Promise<{ report_period: string | null }> => {
      const { data, error } = await fdb.from('reports').select('report_period').eq('id', reportId).maybeSingle();
      if (error) throw error;
      return { report_period: data?.report_period ?? null };
    },
  });

  const months = useMemo(() => fiscalWindow(report?.report_period), [report?.report_period]);

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
      months: svc.months,
    });
  };

  const cycleCell = (svcId: string, monthKey: string) => {
    const svc = services.find((s) => s.id === svcId);
    if (!svc) return;
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

  const legend = (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {(Object.keys(STATUS_STYLE) as PpmCellStatus[]).map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded-sm ${STATUS_STYLE[s].cls}`} />
          {STATUS_STYLE[s].label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-sm border border-border bg-background" />
        Blank
      </span>
    </div>
  );

  return (
    <SectionCard
      title="PPM"
      hint="Planned preventive maintenance schedule. Set each service's monthly status across the fiscal year."
      readOnly={readOnly}
      headerAccessory={<span className="text-sm text-muted-foreground">{services.length} {services.length === 1 ? 'service' : 'services'}</span>}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-3">
          {legend}
          {services.length === 0 ? (
            <p className="text-sm text-muted-foreground">No services scheduled yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="sticky left-0 z-10 bg-background px-2 py-2 text-left font-medium min-w-44">Service</th>
                    {!readOnly && <th className="px-2 py-2 text-left font-medium min-w-28">Frequency</th>}
                    {months.map((mk) => {
                      const { mon, yr } = colHeader(mk);
                      return (
                        <th key={mk} className="px-1 py-2 text-center font-medium whitespace-nowrap">
                          <div>{mon}</div><div className="text-[10px] text-muted-foreground">{yr}</div>
                        </th>
                      );
                    })}
                    {!readOnly && <th className="w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {services.map((svc) => {
                    const d = drafts[svc.id] ?? { service_name: svc.service_name ?? '', frequency: svc.frequency ?? '', comment: svc.comment ?? '' };
                    return (
                      <tr key={svc.id} className="border-b align-top">
                        <td className="sticky left-0 z-10 bg-background px-2 py-1.5 min-w-44">
                          {readOnly ? (
                            <>
                              <div className="font-medium">{svc.service_name}</div>
                              {svc.frequency && <div className="text-xs text-muted-foreground">{svc.frequency}</div>}
                              {svc.comment && <div className="text-xs text-muted-foreground italic">{svc.comment}</div>}
                            </>
                          ) : (
                            <div className="space-y-1">
                              <Input className="h-8" value={d.service_name}
                                onChange={(e) => setDraft(svc.id, 'service_name', e.target.value)}
                                onBlur={() => persistText(svc.id)} />
                              <Input className="h-7 text-xs" placeholder="Comment" value={d.comment}
                                onChange={(e) => setDraft(svc.id, 'comment', e.target.value)}
                                onBlur={() => persistText(svc.id)} />
                            </div>
                          )}
                        </td>
                        {!readOnly && (
                          <td className="px-2 py-1.5 min-w-28">
                            <Input className="h-8" placeholder="e.g. Monthly" value={d.frequency}
                              onChange={(e) => setDraft(svc.id, 'frequency', e.target.value)}
                              onBlur={() => persistText(svc.id)} />
                          </td>
                        )}
                        {months.map((mk) => {
                          const status = svc.months[mk]?.status;
                          const style = status ? STATUS_STYLE[status] : null;
                          return (
                            <td key={mk} className="px-0.5 py-1.5 text-center">
                              <button
                                type="button"
                                disabled={readOnly}
                                onClick={() => cycleCell(svc.id, mk)}
                                title={status ? STATUS_STYLE[status].label : 'Blank'}
                                className={[
                                  'h-7 w-7 rounded-sm text-xs font-semibold transition-colors',
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
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
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
            <div className="flex items-center gap-2">
              <Input
                className="h-9 max-w-xs"
                placeholder="New service name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addService(); } }}
              />
              <Button variant="outline" size="sm" onClick={addService} disabled={!newName.trim() || isSaving}>
                <Plus className="mr-2 h-4 w-4" /> Add service
              </Button>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
