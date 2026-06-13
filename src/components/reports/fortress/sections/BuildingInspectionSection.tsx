/** Monthly Building Inspection — rendered from the monthly inspection template.
 *  Per item: Acceptable yes/no/na + action required + comment. */
import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionCard } from '../SectionCard';
import { useInspectionSection } from '@/hooks/useInspectionSection';
import type { YesNoNa, ActionRequired, InspectionTemplateItem } from '@/integrations/supabase/fortress-db';
import type { SectionProps } from './types';

const ACTIONS = [
  { value: 'none', label: 'No action' },
  { value: 'within_3_months', label: 'Within 3 months' },
  { value: 'immediate', label: 'Immediate' },
];

export default function BuildingInspectionSection({ reportId, buildingId, readOnly }: SectionProps) {
  const { items, responses, isLoading, setResponse } = useInspectionSection(reportId, buildingId, 'monthly');

  const grouped = useMemo(() => {
    const map = new Map<string, InspectionTemplateItem[]>();
    for (const it of items) {
      const k = it.section_title ?? 'Other';
      const arr = map.get(k) ?? [];
      arr.push(it);
      map.set(k, arr);
    }
    return [...map.entries()];
  }, [items]);

  const acceptableCount = items.filter((it) => responses[it.id]?.acceptable === 'yes').length;
  const answered = items.filter((it) => responses[it.id]?.acceptable).length;

  return (
    <SectionCard
      title="Building Inspection"
      hint="Monthly walk-through. Mark each point acceptable and flag any action required."
      headerAccessory={<span className="text-sm text-muted-foreground">{acceptableCount}/{answered || 0} acceptable</span>}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading template…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active monthly inspection template found.</p>
      ) : (
        <div className="space-y-6">
          {grouped.map(([section, secItems]) => (
            <div key={section} className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground">{section}</h4>
              {secItems.map((it) => {
                const r = responses[it.id];
                return (
                  <div key={it.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm">{it.item_label}</div>
                      <ToggleGroup
                        type="single"
                        value={r?.acceptable ?? ''}
                        onValueChange={(v) => v && !readOnly && setResponse(it.id, { acceptable: v as YesNoNa })}
                        disabled={readOnly}
                        className="shrink-0"
                      >
                        <ToggleGroupItem value="yes" className="h-8 px-3 text-xs">Yes</ToggleGroupItem>
                        <ToggleGroupItem value="no" className="h-8 px-3 text-xs">No</ToggleGroupItem>
                        <ToggleGroupItem value="na" className="h-8 px-3 text-xs">N/A</ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                    {r?.acceptable === 'no' && (
                      <div className="mt-2 flex gap-2">
                        <Select
                          value={r?.action_required ?? ''}
                          onValueChange={(v) => !readOnly && setResponse(it.id, { action_required: v as ActionRequired })}
                          disabled={readOnly}
                        >
                          <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Action required" /></SelectTrigger>
                          <SelectContent>
                            {ACTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <Input
                      className="mt-2 h-8"
                      placeholder="Comment (optional)"
                      defaultValue={r?.comment ?? ''}
                      disabled={readOnly}
                      onBlur={(e) => {
                        if (readOnly) return;
                        if (e.target.value !== (r?.comment ?? '')) setResponse(it.id, { comment: e.target.value });
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
