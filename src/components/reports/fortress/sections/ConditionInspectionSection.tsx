/** Annual Condition Inspection — 33-section template (condition_scale). Per item:
 *  applicable, condition rating, recommendation, capex estimate, comment, photos —
 *  PLUS the full per-archetype field set (ANNUAL_FIELD_SETS[item.field_set]) whose
 *  answers live in inspection_responses.detail, keyed by the verbatim source label. */
import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SectionCard } from '../SectionCard';
import { SignedImage } from '@/components/ui/signed-image';
import { openStorageFile } from '@/integrations/supabase/storage';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useInspectionSection, type PhotoRef } from '@/hooks/useInspectionSection';
import type { ConditionRating, InspectionTemplateItem } from '@/integrations/supabase/fortress-db';
import { ANNUAL_FIELD_SETS, type AnnualField } from '@/lib/annualFieldSets';
import type { SectionProps } from './types';

const RATINGS: { value: ConditionRating; label: string }[] = [
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'critical', label: 'Critical' },
];

/** Stringify a detail value for an input; null/undefined → ''. */
function detailStr(v: unknown): string {
  return v == null ? '' : String(v);
}

export default function ConditionInspectionSection({ reportId, buildingId, readOnly }: SectionProps) {
  const { items, responses, isLoading, setResponse } = useInspectionSection(reportId, buildingId, 'annual');

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

  /** Catalogue field input (text or textarea), bound to detail[key]. */
  const fieldInput = (it: InspectionTemplateItem, f: AnnualField) => {
    const detail = (responses[it.id]?.detail as Record<string, unknown> | null) ?? null;
    const value = detailStr(detail?.[f.key]);
    return (
      <label key={f.key} className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{f.label}</span>
        {f.long ? (
          <Textarea
            rows={2}
            defaultValue={value}
            disabled={readOnly}
            onBlur={(e) => setDetail(it, f.key, e.target.value)}
          />
        ) : (
          <Input
            className="h-8"
            defaultValue={value}
            disabled={readOnly}
            onBlur={(e) => setDetail(it, f.key, e.target.value)}
          />
        )}
      </label>
    );
  };

  return (
    <SectionCard
      title="Condition Inspection"
      hint="Annual equipment & fabric inspection across 33 sections. Each item captures its full archetype field set plus condition, recommendation and capex."
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
                const catalogue = ANNUAL_FIELD_SETS[it.field_set] ?? [];
                const catalogueKeys = new Set(catalogue.map((f) => f.key));
                const detail = (r?.detail as Record<string, unknown> | null) ?? null;
                const isEquip = it.field_set === 'equip';
                // detail keys present on the response but not in the catalogue — surface them.
                const otherKeys = detail ? Object.keys(detail).filter((k) => !catalogueKeys.has(k)) : [];
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
                        {/* Per-archetype field set (verbatim detail keys) */}
                        {catalogue.length > 0 && (
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {catalogue.map((f) => fieldInput(it, f))}
                          </div>
                        )}

                        {/* Equipment register driver */}
                        {isEquip && (
                          <label className="flex flex-col gap-1 text-xs">
                            <span className="text-muted-foreground">Next service due</span>
                            <Input
                              type="date"
                              className="h-8 w-44"
                              defaultValue={r?.next_service_due ?? ''}
                              disabled={readOnly}
                              onBlur={(e) => {
                                const v = e.target.value === '' ? null : e.target.value;
                                if (!readOnly && v !== (r?.next_service_due ?? null)) setResponse(it.id, { next_service_due: v });
                              }}
                            />
                          </label>
                        )}

                        {/* Detail keys captured on the response but outside the catalogue */}
                        {otherKeys.length > 0 && (
                          <div className="space-y-2 rounded border border-dashed p-2">
                            <p className="text-xs font-medium text-muted-foreground">Other captured fields</p>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {otherKeys.map((k) => (
                                <label key={k} className="flex flex-col gap-1 text-xs">
                                  <span className="text-muted-foreground">{k.replace(/\s*[:?]\s*$/, '')}</span>
                                  <Input
                                    className="h-8"
                                    defaultValue={detailStr(detail?.[k])}
                                    disabled={readOnly}
                                    onBlur={(e) => setDetail(it, k, e.target.value)}
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Common controls */}
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
              })}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
