/** Annual Condition Inspection — 33-section template (condition_scale). Per item:
 *  applicable, condition rating, recommendation, capex estimate, comment. */
import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SectionCard } from '../SectionCard';
import { useInspectionSection } from '@/hooks/useInspectionSection';
import type { ConditionRating, InspectionTemplateItem } from '@/integrations/supabase/fortress-db';
import type { SectionProps } from './types';

const RATINGS: { value: ConditionRating; label: string }[] = [
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'critical', label: 'Critical' },
];

export default function ConditionInspectionSection({ reportId, buildingId, readOnly }: SectionProps) {
  const { items, responses, isLoading, setResponse } = useInspectionSection(reportId, buildingId, 'annual');

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

  const flagged = items.filter((it) => {
    const c = responses[it.id]?.condition_rating;
    return c === 'poor' || c === 'critical';
  }).length;

  return (
    <SectionCard
      title="Condition Inspection"
      hint="Annual equipment & fabric inspection across 33 sections. Poor/Critical items should carry a recommendation and capex estimate."
      headerAccessory={flagged > 0 ? <Badge variant="destructive">{flagged} flagged</Badge> : undefined}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading template…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active annual inspection template found.</p>
      ) : (
        <div className="space-y-6">
          {grouped.map(([section, secItems]) => (
            <div key={section} className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground">{section}</h4>
              {secItems.map((it) => {
                const r = responses[it.id];
                const applicable = r?.applicable ?? true;
                return (
                  <div key={it.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">{it.item_label}</div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        Applicable
                        <Switch checked={applicable} disabled={readOnly} onCheckedChange={(v) => setResponse(it.id, { applicable: v })} />
                      </label>
                    </div>
                    {applicable && (
                      <div className="mt-3 space-y-2">
                        <ToggleGroup
                          type="single"
                          value={r?.condition_rating ?? ''}
                          onValueChange={(v) => v && !readOnly && setResponse(it.id, { condition_rating: v as ConditionRating })}
                          disabled={readOnly}
                        >
                          {RATINGS.map((rt) => <ToggleGroupItem key={rt.value} value={rt.value} className="h-8 px-3 text-xs">{rt.label}</ToggleGroupItem>)}
                        </ToggleGroup>
                        <Textarea
                          placeholder="Recommendation (optional)"
                          defaultValue={r?.recommendation ?? ''}
                          rows={2}
                          disabled={readOnly}
                          onBlur={(e) => { if (!readOnly && e.target.value !== (r?.recommendation ?? '')) setResponse(it.id, { recommendation: e.target.value }); }}
                        />
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            className="h-8 w-44"
                            placeholder="Capex estimate (ZAR)"
                            defaultValue={r?.capex_estimate ?? ''}
                            disabled={readOnly}
                            onBlur={(e) => {
                              const v = e.target.value === '' ? null : Number(e.target.value);
                              if (!readOnly && v !== (r?.capex_estimate ?? null)) setResponse(it.id, { capex_estimate: v });
                            }}
                          />
                          <Input
                            className="h-8 flex-1"
                            placeholder="Comment (optional)"
                            defaultValue={r?.comment ?? ''}
                            disabled={readOnly}
                            onBlur={(e) => { if (!readOnly && e.target.value !== (r?.comment ?? '')) setResponse(it.id, { comment: e.target.value }); }}
                          />
                        </div>
                      </div>
                    )}
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
