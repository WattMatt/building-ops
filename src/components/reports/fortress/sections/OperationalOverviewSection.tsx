/** OPS Operational Overview — 13 fixed narrative categories → report_narratives. */
import { useEffect, useMemo, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionCard } from '../SectionCard';
import { useReportSection } from '@/hooks/useReportSection';
import type { ReportNarrative } from '@/integrations/supabase/fortress-db';
import type { SectionProps } from './types';

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'structural', label: 'Structural' },
  { key: 'cosmetic', label: 'Cosmetic' },
  { key: 'roofing', label: 'Roofing' },
  { key: 'gutters', label: 'Gutters & Downpipes' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'plumbing', label: 'Plumbing' },
  { key: 'solar', label: 'Solar' },
  { key: 'fire', label: 'Fire' },
  { key: 'tenant_movements', label: 'Tenant Movements' },
  { key: 'hvac', label: 'HVAC' },
  { key: 'signage', label: 'Signage' },
  { key: 'project_items', label: 'Project / Maintenance Items' },
  { key: 'building_overview', label: 'Building Overview' },
];

const FLAGS = [
  { value: 'ok', label: 'OK' },
  { value: 'attention', label: 'Attention' },
  { value: 'escalated', label: 'Escalated' },
];
const NONE = '__none__';

type Draft = Record<string, { body: string; status_flag: string }>;

export default function OperationalOverviewSection({ reportId, buildingId, readOnly }: SectionProps) {
  const { rows, isLoading, saveAll, isSaving } = useReportSection<ReportNarrative>('report_narratives', reportId);
  const [draft, setDraft] = useState<Draft>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const next: Draft = {};
    for (const c of CATEGORIES) {
      const existing = rows.find((r) => r.section_key === c.key);
      next[c.key] = { body: existing?.body ?? '', status_flag: existing?.status_flag ?? NONE };
    }
    setDraft(next);
    setDirty(false);
  }, [rows]);

  const update = (key: string, patch: Partial<Draft[string]>) => {
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
    setDirty(true);
  };

  const handleSave = async () => {
    const toSave = CATEGORIES.filter((c) => {
      const d = draft[c.key];
      return d && (d.body.trim() !== '' || d.status_flag !== NONE);
    }).map((c, i) => {
      const existing = rows.find((r) => r.section_key === c.key);
      const d = draft[c.key];
      return {
        id: existing?.id,
        building_id: buildingId,
        section_key: c.key,
        heading: c.label,
        sort_order: i,
        body: d.body.trim() || null,
        status_flag: d.status_flag === NONE ? null : d.status_flag,
      };
    });
    await saveAll(toSave as unknown as ReportNarrative[]);
    setDirty(false);
  };

  const filled = useMemo(
    () => Object.values(draft).filter((d) => d?.body?.trim()).length,
    [draft],
  );

  return (
    <SectionCard
      title="Operational Overview"
      hint="A short narrative per building system. Flag anything needing attention."
      headerAccessory={<span className="text-sm text-muted-foreground">{filled}/{CATEGORIES.length} written</span>}
      onSave={handleSave}
      saving={isSaving}
      dirty={dirty}
      readOnly={readOnly}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-5">
          {CATEGORIES.map((c) => (
            <div key={c.key} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor={`narr-${c.key}`}>{c.label}</Label>
                <Select
                  value={draft[c.key]?.status_flag ?? NONE}
                  onValueChange={(v) => update(c.key, { status_flag: v })}
                  disabled={readOnly}
                >
                  <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No flag</SelectItem>
                    {FLAGS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                id={`narr-${c.key}`}
                value={draft[c.key]?.body ?? ''}
                onChange={(e) => update(c.key, { body: e.target.value })}
                placeholder={`${c.label} status this period…`}
                disabled={readOnly}
                rows={2}
              />
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
