/** OHS Act Compliance — rendered entirely from compliance_templates (no hardcoded
 *  questions). Live building % updates as items are answered; N/A counts as a pass. */
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SectionCard } from '../SectionCard';
import { useComplianceSection } from '@/hooks/useComplianceSection';
import { formatPct } from '@/lib/fortressReports';
import type { YesNoNa, ComplianceTemplateItem } from '@/integrations/supabase/fortress-db';
import type { SectionProps } from './types';

export default function ComplianceSection({ reportId, buildingId, readOnly }: SectionProps) {
  const { items, responses, responseMap, isLoading, setResponse, liveBuildingPct, answered, scoredTotal } =
    useComplianceSection(reportId, buildingId);

  const grouped = useMemo(() => {
    const map = new Map<string, ComplianceTemplateItem[]>();
    for (const it of items) {
      const k = `${it.section_no ?? ''} ${it.section_title ?? ''}`.trim();
      const arr = map.get(k) ?? [];
      arr.push(it);
      map.set(k, arr);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <SectionCard
      title="OHS Act Compliance"
      hint="Weighted compliance scored live from the active template. N/A counts as compliant."
      headerAccessory={
        <div className="text-right">
          <Badge variant={liveBuildingPct != null && liveBuildingPct >= 90 ? 'default' : 'secondary'} className="text-sm">
            {formatPct(liveBuildingPct)}
          </Badge>
          <p className="mt-1 text-xs text-muted-foreground">{answered}/{scoredTotal} scored answered</p>
        </div>
      }
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading template…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active OHS template found.</p>
      ) : (
        <div className="space-y-6">
          {grouped.map(([section, secItems]) => (
            <div key={section} className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground">{section}</h4>
              {secItems.map((it) => {
                const current = responseMap[it.id];
                const comment = responses[it.id]?.comment ?? '';
                return (
                  <div key={it.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm">
                        <span className="text-muted-foreground">{it.item_no}</span> {it.prompt}
                        {it.is_critical && <Badge variant="outline" className="ml-2 text-[10px]">critical</Badge>}
                        {!it.is_scored && <Badge variant="outline" className="ml-2 text-[10px]">info</Badge>}
                      </div>
                      <ToggleGroup
                        type="single"
                        value={current ?? ''}
                        onValueChange={(v) => v && !readOnly && setResponse(it.id, v as YesNoNa, comment)}
                        disabled={readOnly}
                        className="shrink-0"
                      >
                        <ToggleGroupItem value="yes" className="h-8 px-3 text-xs">Yes</ToggleGroupItem>
                        <ToggleGroupItem value="no" className="h-8 px-3 text-xs">No</ToggleGroupItem>
                        <ToggleGroupItem value="na" className="h-8 px-3 text-xs">N/A</ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                    <Input
                      className="mt-2 h-8"
                      placeholder="Comment (optional)"
                      defaultValue={comment}
                      disabled={readOnly}
                      onBlur={(e) => {
                        if (readOnly || !current) return;
                        if (e.target.value !== comment) setResponse(it.id, current, e.target.value);
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
