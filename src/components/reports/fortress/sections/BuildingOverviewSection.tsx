/** CM Building Overview — single narrative → report_narratives ('building_overview'). */
import { useEffect, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { SectionCard } from '../SectionCard';
import { useReportSection } from '@/hooks/useReportSection';
import type { ReportNarrative } from '@/integrations/supabase/fortress-db';
import type { SectionProps } from './types';

const KEY = 'building_overview';

export default function BuildingOverviewSection({ reportId, buildingId, readOnly }: SectionProps) {
  const { rows, isLoading, saveAll, isSaving } = useReportSection<ReportNarrative>('report_narratives', reportId);
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);

  // Preserve sibling narratives (this section owns only the building_overview key).
  const existing = rows.find((r) => r.section_key === KEY);
  const others = rows.filter((r) => r.section_key !== KEY);

  useEffect(() => { setBody(existing?.body ?? ''); setDirty(false); }, [existing?.body]);

  const handleSave = async () => {
    const overview = body.trim()
      ? [{ id: existing?.id, building_id: buildingId, section_key: KEY, heading: 'Building Overview', sort_order: 0, body: body.trim() }]
      : [];
    await saveAll([...others, ...overview] as unknown as ReportNarrative[]);
    setDirty(false);
  };

  return (
    <SectionCard title="Building Overview" hint="A short narrative overview of the centre this period." onSave={handleSave} saving={isSaving} dirty={dirty} readOnly={readOnly}>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Textarea value={body} onChange={(e) => { setBody(e.target.value); setDirty(true); }} placeholder="Building overview…" rows={8} disabled={readOnly} />
      )}
    </SectionCard>
  );
}
