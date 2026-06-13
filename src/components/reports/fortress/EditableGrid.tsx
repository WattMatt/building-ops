/**
 * Generic editable grid bound to a report section table. Most OPS/CM sections are
 * "a list of typed rows for this report" — they declare columns and reuse this,
 * rather than each re-implementing add/remove/edit/save. Computed columns (e.g.
 * % recovery) are read-only and derived live from the row.
 */
import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { SectionCard } from './SectionCard';
import { useReportSection } from '@/hooks/useReportSection';
import type { FTableName } from '@/integrations/supabase/fortress-db';

export type GridColType = 'text' | 'number' | 'date' | 'select' | 'bool';

export interface GridColumn {
  key: string;
  label: string;
  type: GridColType;
  options?: { value: string; label: string }[];
  /** read-only derived value (e.g. % = recovery/expense) */
  compute?: (row: Row) => string | number | null;
  /** format a stored value for display in computed/readonly cells */
  format?: (v: unknown) => string;
}

type Row = Record<string, unknown> & { id?: string };

interface EditableGridProps {
  reportId: string;
  buildingId: string;
  readOnly: boolean;
  table: FTableName;
  title: string;
  hint?: string;
  columns: GridColumn[];
  addLabel?: string;
}

export function EditableGrid({ reportId, buildingId, readOnly, table, title, hint, columns, addLabel = 'Add row' }: EditableGridProps) {
  const { rows, isLoading, saveAll, isSaving } = useReportSection<Row>(table, reportId);
  const [draft, setDraft] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setDraft(rows.map((r) => ({ ...r }))); setDirty(false); }, [rows]);

  const setCell = (i: number, key: string, value: unknown) => {
    setDraft((d) => d.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
    setDirty(true);
  };
  const addRow = () => { setDraft((d) => [...d, { building_id: buildingId }]); setDirty(true); };
  const removeRow = (i: number) => { setDraft((d) => d.filter((_, idx) => idx !== i)); setDirty(true); };

  const handleSave = async () => {
    const cleaned = draft.map((r) => ({ ...r, building_id: buildingId }));
    await saveAll(cleaned as never);
    setDirty(false);
  };

  const numericKeys = useMemo(() => new Set(columns.filter((c) => c.type === 'number').map((c) => c.key)), [columns]);

  return (
    <SectionCard
      title={title}
      hint={hint}
      onSave={handleSave}
      saving={isSaving}
      dirty={dirty}
      readOnly={readOnly}
      headerAccessory={<span className="text-sm text-muted-foreground">{draft.length} {draft.length === 1 ? 'row' : 'rows'}</span>}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}
                  {!readOnly && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length + 1} className="text-center text-sm text-muted-foreground">
                      No rows yet.
                    </TableCell>
                  </TableRow>
                ) : draft.map((row, i) => (
                  <TableRow key={(row.id as string) ?? `new-${i}`}>
                    {columns.map((c) => (
                      <TableCell key={c.key}>
                        {c.compute ? (
                          <span className="text-sm text-muted-foreground">{c.format ? c.format(c.compute(row)) : String(c.compute(row) ?? '—')}</span>
                        ) : c.type === 'bool' ? (
                          <Select
                            value={row[c.key] === true ? 'yes' : row[c.key] === false ? 'no' : ''}
                            onValueChange={(v) => setCell(i, c.key, v === 'yes')}
                            disabled={readOnly}
                          >
                            <SelectTrigger className="h-8 min-w-20"><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="yes">Yes</SelectItem>
                              <SelectItem value="no">No</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : c.type === 'select' ? (
                          <Select value={(row[c.key] as string) ?? ''} onValueChange={(v) => setCell(i, c.key, v)} disabled={readOnly}>
                            <SelectTrigger className="h-8 min-w-28"><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              {c.options?.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            className="h-8 min-w-28"
                            type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                            value={(row[c.key] as string | number) ?? ''}
                            disabled={readOnly}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setCell(i, c.key, raw === '' ? null : numericKeys.has(c.key) ? Number(raw) : raw);
                            }}
                          />
                        )}
                      </TableCell>
                    ))}
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
            <Button variant="outline" size="sm" onClick={addRow} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              {addLabel}
            </Button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
