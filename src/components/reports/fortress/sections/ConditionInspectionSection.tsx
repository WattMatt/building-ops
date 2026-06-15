/** Annual Condition Inspection — 33-section template. A section navigator (one tab per
 *  section/header) shows that section's items; each item renders ONLY its own fields
 *  (inspection_template_items.field_keys — the item's real subset, e.g. CCTV's 10 fields),
 *  bound to inspection_responses.detail, plus condition / recommendation / capex / photos. */
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { SectionCard } from '../SectionCard';
import { SignedImage } from '@/components/ui/signed-image';
import { openStorageFile } from '@/integrations/supabase/storage';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useInspectionSection, type PhotoRef } from '@/hooks/useInspectionSection';
import type { ConditionRating, InspectionTemplateItem } from '@/integrations/supabase/fortress-db';
import { annualItemFields, type AnnualField } from '@/lib/annualFieldSets';
import type { SectionProps } from './types';

const RATINGS: { value: ConditionRating; label: string }[] = [
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'critical', label: 'Critical' },
];

const detailStr = (v: unknown): string => (v == null ? '' : String(v));
const isFlagged = (c: unknown) => c === 'poor' || c === 'critical';

export default function ConditionInspectionSection({ reportId, buildingId, readOnly }: SectionProps) {
  const { items, responses, isLoading, setResponse } = useInspectionSection(reportId, buildingId, 'annual');
  const [active, setActive] = useState<string | null>(null);

  const addPhoto = async (it: InspectionTemplateItem, file: File) => {
    const path = `documents/${buildingId}/annual/${it.section_no}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from('tenant-documents').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true });
    if (error) { if (import.meta.env.DEV) console.error('photo upload:', error); toast.error('Photo upload failed.'); return; }
    const existing = (responses[it.id]?.photo_urls as unknown as PhotoRef[] | undefined) ?? [];
    await setResponse(it.id, { photo_urls: [...existing, { ref: `${it.section_no}.${existing.length + 1}`, caption: it.item_label, path }] });
  };

  /** Merge a single detail key into the response's existing detail blob. */
  const setDetail = (it: InspectionTemplateItem, key: string, value: string) => {
    if (readOnly) return;
    const existing = (responses[it.id]?.detail as Record<string, unknown> | null) ?? {};
    if (detailStr(existing[key]) === value) return;
    const next = { ...existing };
    if (value === '') delete next[key];
    else next[key] = value;
    setResponse(it.id, { detail: next });
  };

  const grouped = useMemo(() => {
    const map = new Map<string, InspectionTemplateItem[]>();
    for (const it of items) {
      const k = it.section_title ?? 'Other';
      (map.get(k) ?? map.set(k, []).get(k)!).push(it);
    }
    return [...map.entries()];
  }, [items]);

  const totalFlagged = items.filter((it) => isFlagged(responses[it.id]?.condition_rating)).length;
  const activeSection = active ?? grouped[0]?.[0] ?? null;
  const activeItems = grouped.find(([s]) => s === activeSection)?.[1] ?? [];

  const fieldInput = (it: InspectionTemplateItem, f: AnnualField) => {
    const value = detailStr((responses[it.id]?.detail as Record<string, unknown> | null)?.[f.key]);
    return (
      <label key={f.key} className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{f.label}</span>
        {f.long
          ? <Textarea rows={2} defaultValue={value} disabled={readOnly} onBlur={(e) => setDetail(it, f.key, e.target.value)} />
          : <Input className="h-8" defaultValue={value} disabled={readOnly} onBlur={(e) => setDetail(it, f.key, e.target.value)} />}
      </label>
    );
  };

  // Some items are 2-D matrices flattened as `"<field> — <column>"` keys (e.g. Lifts/
  // Escalators/Goods, or Electricity/Water/Gas). Render those as a compact grid.
  const SEP = ' — ';
  const matrixGrid = (it: InspectionTemplateItem, fields: AnnualField[]) => {
    const rows: string[] = []; const cols: string[] = [];
    for (const f of fields) {
      const i = f.key.lastIndexOf(SEP);
      const row = i >= 0 ? f.key.slice(0, i) : f.key;
      const col = i >= 0 ? f.key.slice(i + SEP.length) : '';
      if (!rows.includes(row)) rows.push(row);
      if (!cols.includes(col)) cols.push(col);
    }
    cols.sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0)); // base/"General" column first
    const detail = (responses[it.id]?.detail as Record<string, unknown> | null) ?? null;
    return (
      <div className="overflow-x-auto rounded border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="p-1 text-left font-medium text-muted-foreground">Field</th>
              {cols.map((c) => <th key={c || 'general'} className="p-1 text-left font-medium text-muted-foreground">{c || 'General'}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row} className="border-t">
                <td className="p-1 align-top text-muted-foreground">{row.replace(/\s*[:?]\s*$/, '')}</td>
                {cols.map((c) => {
                  const key = c === '' ? row : `${row}${SEP}${c}`;
                  return (
                    <td key={c || 'general'} className="p-0.5">
                      <Input className="h-7" defaultValue={detailStr(detail?.[key])} disabled={readOnly} onBlur={(e) => setDetail(it, key, e.target.value)} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderItem = (it: InspectionTemplateItem) => {
    const r = responses[it.id];
    const applicable = r?.applicable ?? true;
    const detail = (r?.detail as Record<string, unknown> | null) ?? null;
    const fieldKeys = Array.isArray(it.field_keys) ? (it.field_keys as string[]) : [];
    const itemFields = annualItemFields(it.field_set, fieldKeys);
    const rendered = new Set(itemFields.map((f) => f.key));
    const otherKeys = detail ? Object.keys(detail).filter((k) => !rendered.has(k)) : [];
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
          <div className="mt-3 space-y-3">
            {itemFields.length > 0 && (
              itemFields.some((f) => f.key.includes(SEP))
                ? matrixGrid(it, itemFields)
                : <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{itemFields.map((f) => fieldInput(it, f))}</div>
            )}
            {it.field_set === 'equip' && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Next service due</span>
                <Input type="date" className="h-8 w-44" defaultValue={r?.next_service_due ?? ''} disabled={readOnly}
                  onBlur={(e) => { const v = e.target.value === '' ? null : e.target.value; if (!readOnly && v !== (r?.next_service_due ?? null)) setResponse(it.id, { next_service_due: v }); }} />
              </label>
            )}
            {otherKeys.length > 0 && (
              <div className="space-y-2 rounded border border-dashed p-2">
                <p className="text-xs font-medium text-muted-foreground">Other captured fields</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {otherKeys.map((k) => (
                    <label key={k} className="flex flex-col gap-1 text-xs">
                      <span className="text-muted-foreground">{k.replace(/\s*[:?]\s*$/, '')}</span>
                      <Input className="h-8" defaultValue={detailStr(detail?.[k])} disabled={readOnly} onBlur={(e) => setDetail(it, k, e.target.value)} />
                    </label>
                  ))}
                </div>
              </div>
            )}
            <ToggleGroup type="single" value={r?.condition_rating ?? ''} disabled={readOnly}
              onValueChange={(v) => v && !readOnly && setResponse(it.id, { condition_rating: v as ConditionRating })}>
              {RATINGS.map((rt) => <ToggleGroupItem key={rt.value} value={rt.value} className="h-8 px-3 text-xs">{rt.label}</ToggleGroupItem>)}
            </ToggleGroup>
            <Textarea placeholder="Recommendation (optional)" defaultValue={r?.recommendation ?? ''} rows={2} disabled={readOnly}
              onBlur={(e) => { if (!readOnly && e.target.value !== (r?.recommendation ?? '')) setResponse(it.id, { recommendation: e.target.value }); }} />
            <div className="flex gap-2">
              <Input type="number" className="h-8 w-44" placeholder="Capex estimate (ZAR)" defaultValue={r?.capex_estimate ?? ''} disabled={readOnly}
                onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (!readOnly && v !== (r?.capex_estimate ?? null)) setResponse(it.id, { capex_estimate: v }); }} />
              <Input className="h-8 flex-1" placeholder="Comment (optional)" defaultValue={r?.comment ?? ''} disabled={readOnly}
                onBlur={(e) => { if (!readOnly && e.target.value !== (r?.comment ?? '')) setResponse(it.id, { comment: e.target.value }); }} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {((r?.photo_urls as unknown as PhotoRef[] | undefined) ?? []).map((p, idx) => (
                <button key={idx} type="button" title={p.caption ?? ''} onClick={() => openStorageFile('/object/tenant-documents/' + p.path)} className="h-16 w-16 overflow-hidden rounded border">
                  <SignedImage src={'/object/tenant-documents/' + p.path} alt={p.caption ?? 'photo'} className="h-full w-full object-cover" />
                </button>
              ))}
              {!readOnly && (
                <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded border border-dashed text-xs text-muted-foreground hover:bg-muted">
                  + Photo
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) addPhoto(it, f); e.currentTarget.value = ''; }} />
                </label>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <SectionCard
      title="Condition Inspection"
      hint="Annual inspection across 33 sections. Pick a section; each item shows its own field set plus condition, recommendation and capex."
      headerAccessory={totalFlagged > 0 ? <Badge variant="destructive">{totalFlagged} flagged</Badge> : undefined}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading template…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active annual inspection template found.</p>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row">
          <nav className="flex shrink-0 gap-1 overflow-x-auto pb-2 sm:max-h-[70vh] sm:w-56 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:pb-0">
            {grouped.map(([section, secItems]) => {
              const f = secItems.filter((it) => isFlagged(responses[it.id]?.condition_rating)).length;
              return (
                <button
                  key={section}
                  type="button"
                  onClick={() => setActive(section)}
                  className={cn(
                    'flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded px-3 py-2 text-left text-xs sm:whitespace-normal',
                    activeSection === section ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  <span>{section}</span>
                  {f > 0 && <Badge variant="destructive" className="h-4 px-1 text-[10px]">{f}</Badge>}
                </button>
              );
            })}
          </nav>
          <div className="min-w-0 flex-1 space-y-3">
            {activeSection && <h4 className="text-sm font-semibold">{activeSection}</h4>}
            {activeItems.map(renderItem)}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
