/**
 * OPS · OHS Hazard Log (fortress/16 §4.1 — "potential hazard + corrective action").
 * hazard_log rows are scoped by assessment_id (one compliance_assessments row per
 * report, UNIQUE(report_id)) — NOT report_id — so this cannot reuse the generic
 * report-scoped EditableGrid/useReportSection. It resolves (and creates if missing)
 * the report's assessment, then does the same upsert-all / delete-missing grid CRUD
 * keyed on assessment_id. Mirrors the EditableGrid look + save-on-section pattern.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { SectionCard } from '../SectionCard';
import { fdb } from '@/integrations/supabase/fortress-db';
import type { SectionProps } from './types';

const OHS_TEMPLATE_NAME = 'OHS Act Report';
const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'closed', label: 'Closed' },
];

type Row = { id?: string; hazard?: string | null; corrective_action?: string | null; status?: string | null; sort_order?: number };

export default function HazardLogSection({ reportId, buildingId, readOnly }: SectionProps) {
  const qc = useQueryClient();
  const key = ['fortress-hazard-log', reportId];

  const query = useQuery({
    queryKey: key,
    enabled: !!reportId && !!buildingId,
    queryFn: async (): Promise<{ assessmentId: string; rows: Row[] }> => {
      // Ensure one assessment per report (same contract as useComplianceSection).
      let { data: assessment } = await fdb
        .from('compliance_assessments')
        .select('id')
        .eq('report_id', reportId)
        .maybeSingle();
      if (!assessment) {
        const { data: tpl, error: tErr } = await fdb
          .from('compliance_templates')
          .select('id')
          .eq('name', OHS_TEMPLATE_NAME)
          .eq('active', true)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (tErr) throw tErr;
        if (!tpl) throw new Error('No active OHS template found.');
        const { data: created, error: aErr } = await fdb
          .from('compliance_assessments')
          .insert({ id: crypto.randomUUID(), report_id: reportId, building_id: buildingId, template_id: tpl.id })
          .select('id')
          .single();
        if (aErr) throw aErr;
        assessment = created;
      }
      const { data, error } = await fdb
        .from('hazard_log')
        .select('*')
        .eq('assessment_id', assessment.id)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return { assessmentId: assessment.id, rows: (data ?? []) as Row[] };
    },
  });

  const [draft, setDraft] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);

  const serverRows = query.data?.rows;
  useEffect(() => { setDraft((serverRows ?? []).map((r) => ({ ...r }))); setDirty(false); }, [serverRows]);

  const setCell = (i: number, k: keyof Row, v: unknown) => {
    setDraft((d) => d.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
    setDirty(true);
  };
  const addRow = () => { setDraft((d) => [...d, {}]); setDirty(true); };
  const removeRow = (i: number) => { setDraft((d) => d.filter((_, idx) => idx !== i)); setDirty(true); };

  const mutation = useMutation({
    mutationFn: async () => {
      const assessmentId = query.data?.assessmentId;
      if (!assessmentId) throw new Error('No assessment.');
      const withIds = draft.map((r, idx) => ({
        id: r.id ?? crypto.randomUUID(),
        assessment_id: assessmentId,
        building_id: buildingId,
        sort_order: idx,
        hazard: r.hazard ?? null,
        corrective_action: r.corrective_action ?? null,
        status: r.status ?? null,
      }));
      const serverIds = new Set((serverRows ?? []).map((r) => r.id));
      const localIds = new Set(withIds.map((r) => r.id));
      const toDelete = [...serverIds].filter((id) => id && !localIds.has(id as string)) as string[];
      if (withIds.length) {
        const { error } = await fdb.from('hazard_log').upsert(withIds, { onConflict: 'id' });
        if (error) throw error;
      }
      if (toDelete.length) {
        const { error } = await fdb.from('hazard_log').delete().in('id', toDelete);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setDirty(false); toast.success('Section saved.'); },
    onError: (e: unknown) => {
      if (import.meta.env.DEV) console.error('Save hazard_log failed:', e);
      toast.error('Could not save this section. Please try again.');
    },
  });

  return (
    <SectionCard
      title="Hazard Log"
      hint="Potential hazards and corrective actions (OHS §4.1)."
      onSave={() => mutation.mutate()}
      saving={mutation.isPending}
      dirty={dirty}
      readOnly={readOnly}
      headerAccessory={<span className="text-sm text-muted-foreground">{draft.length} {draft.length === 1 ? 'row' : 'rows'}</span>}
    >
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Potential Hazard</TableHead>
                  <TableHead>Corrective Action</TableHead>
                  <TableHead>Status</TableHead>
                  {!readOnly && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={readOnly ? 3 : 4} className="text-center text-sm text-muted-foreground">No hazards logged.</TableCell>
                  </TableRow>
                ) : draft.map((row, i) => (
                  <TableRow key={row.id ?? `new-${i}`}>
                    <TableCell>
                      <Input className="h-8 min-w-48" value={row.hazard ?? ''} disabled={readOnly}
                        onChange={(e) => setCell(i, 'hazard', e.target.value || null)} />
                    </TableCell>
                    <TableCell>
                      <Input className="h-8 min-w-48" value={row.corrective_action ?? ''} disabled={readOnly}
                        onChange={(e) => setCell(i, 'corrective_action', e.target.value || null)} />
                    </TableCell>
                    <TableCell>
                      <Select value={row.status ?? ''} onValueChange={(v) => setCell(i, 'status', v)} disabled={readOnly}>
                        <SelectTrigger className="h-8 min-w-28"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    {!readOnly && (
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeRow(i)}>
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {!readOnly && (
            <Button variant="outline" size="sm" onClick={addRow} disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add hazard
            </Button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
