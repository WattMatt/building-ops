/**
 * CM Utility Management (source Page 3): loadshedding + municipal service
 * interruptions grids, plus the free-text Borehole-status and Generator-status
 * blocks. The two status blocks are stored generically in report_narratives
 * (section_key 'borehole_status' / 'generator_status') — no dedicated schema —
 * and this section owns only those two keys, preserving sibling narratives.
 */
import { useEffect, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { EditableGrid, type GridColumn } from '../EditableGrid';
import { SectionCard } from '../SectionCard';
import { useReportSection } from '@/hooks/useReportSection';
import type { ReportNarrative } from '@/integrations/supabase/fortress-db';
import type { SectionProps } from './types';

const LOADSHED_COLS: GridColumn[] = [
  { key: 'day', label: 'Day', type: 'date' },
  { key: 'week_no', label: 'Week', type: 'number' },
  { key: 'stage', label: 'Stage', type: 'text' },
  { key: 'hours', label: 'Hours', type: 'number' },
  { key: 'diesel_litres', label: 'Diesel (L)', type: 'number' },
  { key: 'diesel_date', label: 'Diesel Date', type: 'date' },
];

const INTERRUPTION_COLS: GridColumn[] = [
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'interruption_type', label: 'Type', type: 'text' },
  { key: 'start_time', label: 'Start', type: 'text' },
  { key: 'end_time', label: 'End', type: 'text' },
  { key: 'total_hours', label: 'Hours', type: 'number' },
  { key: 'council_ref', label: 'Council Ref', type: 'text' },
  { key: 'comment', label: 'Comment', type: 'text' },
];

// Free-text status blocks → report_narratives (generic section_key + heading + body).
const STATUS_BLOCKS: { key: string; label: string; placeholder: string }[] = [
  { key: 'borehole_status', label: 'Borehole Status', placeholder: 'e.g. Fully operational supplying about 50% water needs' },
  { key: 'generator_status', label: 'Generator Status', placeholder: 'e.g. Operational / N/A' },
];

type Draft = Record<string, string>;

function UtilityStatusNarratives({ reportId, buildingId, readOnly }: SectionProps) {
  const { rows, isLoading, saveAll, isSaving } = useReportSection<ReportNarrative>('report_narratives', reportId);
  const [draft, setDraft] = useState<Draft>({});
  const [dirty, setDirty] = useState(false);

  // This section owns only the status keys; sibling narratives are preserved.
  const ownKeys = new Set(STATUS_BLOCKS.map((b) => b.key));
  const others = rows.filter((r) => !ownKeys.has(r.section_key));

  useEffect(() => {
    const next: Draft = {};
    for (const b of STATUS_BLOCKS) next[b.key] = rows.find((r) => r.section_key === b.key)?.body ?? '';
    setDraft(next);
    setDirty(false);
  }, [rows]);

  const update = (key: string, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    const blocks = STATUS_BLOCKS
      .filter((b) => (draft[b.key] ?? '').trim() !== '')
      .map((b, i) => {
        const existing = rows.find((r) => r.section_key === b.key);
        return {
          id: existing?.id,
          building_id: buildingId,
          section_key: b.key,
          heading: b.label,
          sort_order: i,
          body: draft[b.key].trim(),
        };
      });
    await saveAll([...others, ...blocks] as unknown as ReportNarrative[]);
    setDirty(false);
  };

  return (
    <SectionCard title="Borehole & Generator Status" hint="Free-text status for the building's borehole and generator (CM source Page 3)." onSave={handleSave} saving={isSaving} dirty={dirty} readOnly={readOnly}>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-4">
          {STATUS_BLOCKS.map((b) => (
            <div key={b.key} className="space-y-1.5">
              <Label htmlFor={`util-status-${b.key}`}>{b.label}</Label>
              <Textarea
                id={`util-status-${b.key}`}
                value={draft[b.key] ?? ''}
                onChange={(e) => update(b.key, e.target.value)}
                placeholder={b.placeholder}
                rows={3}
                disabled={readOnly}
              />
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export const UtilityManagementSection = (p: SectionProps) => (
  <div className="space-y-6">
    <EditableGrid {...p} table="loadshedding_log" title="Loadshedding" hint="Per-day stage and diesel." columns={LOADSHED_COLS} addLabel="Add day" />
    <EditableGrid {...p} table="service_interruptions" title="Service Interruptions" hint="Municipal interruptions." columns={INTERRUPTION_COLS} addLabel="Add interruption" />
    <UtilityStatusNarratives {...p} />
  </div>
);
