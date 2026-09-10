/**
 * Building Details → PPM tab (R3c, spec §5.6 / §8).
 *
 * Two things live here: the PLAN (one line per service: name, cadence, contractor, active)
 * and the read-only 12-month grid DERIVED from execution (`ppm_monthly_status`). Nobody
 * edits a month cell on this tab — occurrences are generated nightly from the plan and
 * completed on the Checklists tab; the report section is where a manager can pin a cell
 * with a noted override. Admin/manager write the plan; everyone with access reads it.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Download, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Hint } from '@/components/ui/hint';
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogFooter,
  ResponsiveDialogHeader, ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import RecurrenceEditor, { recurrenceProblem } from '@/components/checklists/RecurrenceEditor';
import { ContractorPicker } from '@/components/contractors/ContractorPicker';
import { useAuth } from '@/contexts/AuthContext';
import { useBuildingPpm, type BuildingPpmLine } from '@/hooks/useBuildingPpm';
import { fdb } from '@/integrations/supabase/fortress-db';
import { exportCsv } from '@/lib/exportCsv';
import { describeRule, type RecurrenceRule } from '@/lib/recurrence';
import { todayInOperatingTz } from '@/lib/myWork';
import { PpmLegend } from '@/components/ppm/PpmLegend';
import {
  colHeader, derivedByService, fiscalWindow, mergePpmGrid, occurrenceSummary, PPM_STATUS_SHORT, PPM_STATUS_STYLE,
} from '@/lib/ppmGrid';
import { cn } from '@/lib/utils';

const DEFAULT_RULE: RecurrenceRule = { every: 1, unit: 'month', monthDay: 1 };

/** Plain-text reason the plan line cannot be saved, or null. Checked on top of the editor's own rule. */
function ppmLineProblem(
  name: string,
  rule: RecurrenceRule,
  existingNames: readonly string[],
): string | null {
  if (!name.trim()) return 'Enter a service name';
  if (existingNames.some((n) => n.trim().toLowerCase() === name.trim().toLowerCase())) {
    return 'A service with that name already exists for this building';
  }
  if (rule.unit !== 'month' && rule.unit !== 'year') return 'PPM services repeat monthly or yearly. Choose months or years.';
  return recurrenceProblem(rule);
}

interface Props { buildingId: string }

export default function PpmTab({ buildingId }: Props) {
  const { isAdminOrManager } = useAuth();
  const months = useMemo(() => fiscalWindow(todayInOperatingTz()), []);
  const {
    lines, isLoading, isError, createLine, updateLine, setActive, isSaving,
    generateNow, isGenerating, derived, derivedLoading,
  } = useBuildingPpm(buildingId, months);

  const contractorIds = useMemo(
    () => Array.from(new Set(lines.map((l) => l.contractor_id).filter((id): id is string => !!id))).sort(),
    [lines],
  );
  const { data: contractorNames } = useQuery({
    queryKey: ['ppm-contractor-names', contractorIds],
    enabled: contractorIds.length > 0,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await fdb.from('contractors').select('id, company_name').in('id', contractorIds);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((c) => [c.id, c.company_name]));
    },
  });
  const contractorName = (id: string | null) => (id ? contractorNames?.[id] ?? '' : '');

  // ---- Add / edit sheet ----------------------------------------------------------------
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BuildingPpmLine | null>(null);
  const [name, setName] = useState('');
  const [rule, setRule] = useState<RecurrenceRule>(DEFAULT_RULE);
  const [contractorId, setContractorId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const openNew = () => {
    setEditing(null); setName(''); setRule(DEFAULT_RULE); setContractorId(null); setNotes(''); setOpen(true);
  };
  const openEdit = (line: BuildingPpmLine) => {
    setEditing(line); setName(line.service_name); setRule(line.recurrence); setContractorId(line.contractor_id);
    setNotes(line.notes ?? ''); setOpen(true);
  };

  const otherNames = lines.filter((l) => l.id !== editing?.id).map((l) => l.service_name);
  const problem = ppmLineProblem(name, rule, otherNames);

  const save = async () => {
    if (problem) return;
    const payload = { service_name: name, recurrence: rule, contractor_id: contractorId, notes: notes || null };
    try {
      if (editing) await updateLine(editing.id, payload);
      else await createLine({ ...payload, sort_order: lines.reduce((m, l) => Math.max(m, l.sort_order), -1) + 1 });
      setOpen(false);
    } catch {
      // the hook has already shown the plain error; keep the sheet open so nothing typed is lost
    }
  };

  const exportPlan = () => {
    exportCsv(
      lines,
      [
        { key: 'service_name', header: 'Service' },
        { key: 'recurrence', header: 'Cadence', format: (v) => describeRule(v as RecurrenceRule) },
        { key: 'contractor_id', header: 'Contractor', format: (v) => contractorName((v as string | null) ?? null) },
        { key: 'is_active', header: 'Active', format: (v) => (v ? 'Yes' : 'No') },
        { key: 'notes', header: 'Notes', format: (v) => (v as string | null) ?? '' },
      ],
      `ppm-plan-${buildingId}.csv`,
    );
  };

  // ---- Derived grid ----------------------------------------------------------------------
  const byService = useMemo(() => derivedByService(derived), [derived]);
  const grids = useMemo(
    () => new Map(lines.map((l) => [l.id, mergePpmGrid(months, byService.get(l.id) ?? [], {})])),
    [lines, months, byService],
  );
  const fy = `${months[0].slice(0, 4)}/${months[11].slice(2, 4)}`;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">PPM plan</h3>
            <p className="text-sm text-muted-foreground">
              {lines.length} {lines.length === 1 ? 'service' : 'services'}
              {lines.some((l) => !l.is_active) && ` · ${lines.filter((l) => !l.is_active).length} inactive`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="min-h-11" onClick={exportPlan} disabled={lines.length === 0}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
            {isAdminOrManager && (
              <>
                <Button variant="outline" className="min-h-11" onClick={() => void generateNow().catch(() => {})}
                  disabled={isGenerating || lines.every((l) => !l.is_active)}>
                  <Play className="mr-2 h-4 w-4" /> {isGenerating ? 'Generating…' : 'Generate now'}
                </Button>
                <Button className="min-h-11" onClick={openNew}>
                  <Plus className="mr-2 h-4 w-4" /> Add service
                </Button>
              </>
            )}
          </div>
        </div>
        <Hint>Occurrences are generated every night for the next year; completing them on the Checklists tab fills this grid.</Hint>
        <Hint>Inactive lines stop generating tasks; history is kept. Lines are never deleted.</Hint>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">Could not load the PPM plan. Pull to refresh or try again later.</p>
        ) : lines.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">No PPM services planned for this building yet.</p>
            {isAdminOrManager && (
              <Button variant="outline" className="mt-3 min-h-11" onClick={openNew}>
                <Plus className="mr-2 h-4 w-4" /> Add the first service
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th scope="col" className="px-3 py-2 font-medium">Service</th>
                  <th scope="col" className="px-3 py-2 font-medium">Cadence</th>
                  <th scope="col" className="px-3 py-2 font-medium min-w-48">Contractor</th>
                  <th scope="col" className="px-3 py-2 font-medium">Active</th>
                  {isAdminOrManager && <th scope="col" className="w-12"><span className="sr-only">Edit</span></th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className={cn('border-b last:border-0 align-middle', !line.is_active && 'opacity-60')}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{line.service_name}</div>
                      {line.notes && <div className="text-xs text-muted-foreground">{line.notes}</div>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{describeRule(line.recurrence)}</td>
                    <td className="px-3 py-2">
                      {isAdminOrManager ? (
                        <ContractorPicker
                          value={line.contractor_id}
                          onChange={(id) => void updateLine(line.id, { contractor_id: id }).catch(() => {})}
                          disabled={isSaving}
                          aria-label={`Contractor for ${line.service_name}`}
                        />
                      ) : (
                        <span>{contractorName(line.contractor_id) || <span className="text-muted-foreground">None</span>}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <label className="flex min-h-11 items-center gap-2">
                        <Switch
                          checked={line.is_active}
                          disabled={!isAdminOrManager || isSaving}
                          onCheckedChange={(v) => void setActive(line.id, v).catch(() => {})}
                          aria-label={`${line.service_name} active`}
                        />
                        <span className="text-xs text-muted-foreground">{line.is_active ? 'Active' : 'Inactive'}</span>
                      </label>
                    </td>
                    {isAdminOrManager && (
                      <td className="px-1 py-2 text-right">
                        <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => openEdit(line)} aria-label={`Edit ${line.service_name}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {lines.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold">Fiscal year {fy}</h3>
            <PpmLegend blankLabel="No occurrence" />
          </div>
          {derivedLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full border-collapse text-sm" aria-label="PPM month grid">
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="sticky left-0 z-10 bg-background px-3 py-2 text-left font-medium min-w-44">Service</th>
                    {months.map((mk) => {
                      const { mon, yr } = colHeader(mk);
                      return (
                        <th key={mk} scope="col" className="px-1 py-2 text-center font-medium whitespace-nowrap">
                          <div>{mon}</div><div className="text-[10px] text-muted-foreground">{yr}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const grid = grids.get(line.id)!;
                    return (
                      <tr key={line.id} className={cn('border-b last:border-0', !line.is_active && 'opacity-60')}>
                        <th scope="row" className="sticky left-0 z-10 bg-background px-3 py-1.5 text-left font-medium min-w-44">{line.service_name}</th>
                        {months.map((mk) => {
                          const cell = grid[mk];
                          const style = cell.status ? PPM_STATUS_STYLE[cell.status] : null;
                          const several = occurrenceSummary(cell);
                          const title = cell.status
                            ? `${PPM_STATUS_STYLE[cell.status].label}${cell.doneOn ? ` on ${cell.doneOn}` : ''}${several ? ` (${several})` : ''}`
                            : 'No occurrence';
                          return (
                            <td key={mk} className="px-0.5 py-1.5 text-center">
                              <div
                                role="img"
                                aria-label={`${line.service_name} ${mk}: ${title}`}
                                title={title}
                                className={cn(
                                  'mx-auto flex h-7 w-7 items-center justify-center rounded-sm text-xs font-semibold',
                                  style ? style.cls : 'border border-border bg-background',
                                )}
                              >
                                {cell.status ? PPM_STATUS_SHORT[cell.status] : ''}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{editing ? 'Edit service' : 'Add service'}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {editing ? 'Future untouched occurrences are rescheduled now.' : 'A planned maintenance service for this building.'}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ppm-name">Service</Label>
              <Input id="ppm-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lift service" autoFocus />
            </div>
            <RecurrenceEditor idPrefix="ppm-recurrence" value={rule} onChange={(r) => setRule(r)} />
            <div className="space-y-2">
              <Label htmlFor="ppm-contractor">Contractor</Label>
              <ContractorPicker id="ppm-contractor" value={contractorId} onChange={setContractorId} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ppm-notes">Notes</Label>
              <Textarea id="ppm-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="What the contractor must cover" />
            </div>
            {problem && name.trim() !== '' && <p className="text-sm text-destructive" role="alert">{problem}</p>}
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="min-h-11" onClick={() => void save()} disabled={!!problem || isSaving}>
              {isSaving ? 'Saving…' : editing ? 'Save' : 'Add service'}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
