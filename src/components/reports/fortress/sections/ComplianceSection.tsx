/** OHS Act Compliance — rendered entirely from compliance_templates (no hardcoded
 *  questions). Live building % updates as items are answered; N/A counts as a pass.
 *  A comment saves on blur whether or not the item is answered (S3): the row is upserted
 *  with a null response, and a plain guardrail line names the missing answer. */
import { useEffect, useMemo, useState } from 'react';
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
    useComplianceSection(reportId, buildingId, readOnly);

  // Comment text as typed, per item, until it is saved. Controlled rather than defaultValue so
  // the answer toggle can send what is in the box right now: with an uncontrolled input, picking
  // an answer after typing a comment sent the last SAVED comment and overwrote the new one.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // A draft has done its job once the server holds the same text: drop it so later changes
  // from elsewhere show through. A draft whose save failed is left standing — the server
  // still has the old comment, and the user must keep seeing the text that was not saved.
  useEffect(() => {
    setDrafts((d) => {
      const next = { ...d };
      let changed = false;
      for (const [itemId, text] of Object.entries(d)) {
        if (responses[itemId]?.comment === text) { delete next[itemId]; changed = true; }
      }
      return changed ? next : d;
    });
  }, [responses]);

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
      hint="Weighted compliance scored live from the active template. N/A counts as compliant. Answers and comments save automatically — there is no Save button here."
      headerAccessory={
        <div className="text-right">
          <Badge variant={liveBuildingPct != null && liveBuildingPct >= 90 ? 'default' : 'secondary'} className="text-sm">
            {formatPct(liveBuildingPct)}
          </Badge>
          <p className="mt-1 text-xs text-muted-foreground">Target 100%</p>
          <p className="text-xs text-muted-foreground">{answered}/{scoredTotal} scored answered</p>
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
                const saved = responses[it.id]?.comment ?? '';
                const comment = drafts[it.id] ?? saved;
                const needsAnswer = comment.trim() !== '' && !current;
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
                        data-item={it.id}
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
                      value={comment}
                      disabled={readOnly}
                      onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
                      onBlur={(e) => {
                        if (readOnly || comment === saved) return;
                        // Focus moving to this item's own answer toggle: the toggle carries the
                        // live comment itself, so one write instead of two racing ones.
                        if (e.relatedTarget?.closest(`[data-item="${it.id}"]`)) return;
                        // No answer yet is fine: the row is written with a null response so the
                        // comment survives, and the line below says an answer is still owed.
                        setResponse(it.id, current ?? null, comment);
                      }}
                    />
                    {/* Guardrail, not coaching — never routed through <Hint>, visible with hints off. */}
                    {needsAnswer && <p className="mt-1 text-xs text-destructive">Answer needed</p>}
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
