/**
 * Inspection section: template-driven for both the monthly building inspection
 * (rating_type acceptable_yn) and the 33-section annual inspection (condition_scale).
 * Loads the active template for the cadence + items, ensures one building_inspection
 * per report, and tracks per-item responses.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fdb,
  type InspectionTemplate,
  type InspectionTemplateItem,
  type InspectionResponse,
  type YesNoNa,
  type ConditionRating,
  type ActionRequired,
} from '@/integrations/supabase/fortress-db';

export type InspectionCadence = 'monthly' | 'annual';

export interface PhotoRef {
  ref: string;
  caption?: string | null;
  path: string;
}

/**
 * A partial write to one response row. A key ABSENT from the patch keeps the stored value; a key
 * PRESENT with `null` clears it. The nullable columns say so explicitly; `applicable` is NOT NULL
 * and `detail` is replaced whole. `photo_urls` is deliberately NOT here: that column is written by
 * append_inspection_photo only (see setResponse).
 */
export type InspectionResponsePatch = Partial<{
  acceptable: YesNoNa | null;
  condition_rating: ConditionRating | null;
  action_required: ActionRequired | null;
  recommendation: string | null;
  comment: string | null;
  capex_estimate: number | null;
  applicable: boolean;
  next_service_due: string | null;
  detail: Record<string, unknown>;
}>;

/** What the section query holds. Named so `mergeResponse` can update it through setQueryData. */
export interface InspectionSectionData {
  template: InspectionTemplate | null;
  items: InspectionTemplateItem[];
  inspectionId: string | null;
  responses: Record<string, InspectionResponse>;
}

export function useInspectionSection(
  reportId: string | undefined,
  buildingId: string | undefined,
  cadence: InspectionCadence,
  /** When true, viewing must not create a building_inspections row. */
  readOnly = false,
) {
  const qc = useQueryClient();
  const key = ['fortress-inspection', cadence, reportId, readOnly];

  const query = useQuery<InspectionSectionData>({
    queryKey: key,
    enabled: !!reportId && !!buildingId,
    queryFn: async (): Promise<InspectionSectionData> => {
      const { data: tpl, error: tErr } = await fdb
        .from('inspection_templates')
        .select('*')
        .eq('cadence', cadence)
        .eq('active', true)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (tErr) throw tErr;
      if (!tpl) return { template: null, items: [], inspectionId: null, responses: {} as Record<string, InspectionResponse> };

      const { data: items, error: iErr } = await fdb
        .from('inspection_template_items')
        .select('*')
        .eq('template_id', tpl.id)
        .order('sort_order', { ascending: true });
      if (iErr) throw iErr;

      let { data: inspection } = await fdb
        .from('building_inspections')
        .select('*')
        .eq('report_id', reportId!)
        .eq('template_id', tpl.id)
        .maybeSingle();
      if (!inspection) {
        // Reading a report must never write to it — opening this tab used to create the
        // inspection row even on reports the viewer cannot edit.
        if (readOnly) {
          return { template: tpl, items: items ?? [], inspectionId: null, responses: {} as Record<string, InspectionResponse> };
        }
        const { data: created, error: bErr } = await fdb
          .from('building_inspections')
          .insert({ id: crypto.randomUUID(), report_id: reportId!, building_id: buildingId!, template_id: tpl.id })
          .select('*')
          .single();
        if (bErr) throw bErr;
        inspection = created;
      }

      const { data: resp, error: rErr } = await fdb
        .from('inspection_responses')
        .select('*')
        .eq('inspection_id', inspection.id);
      if (rErr) throw rErr;

      const responses: Record<string, InspectionResponse> = {};
      for (const r of resp ?? []) responses[r.template_item_id] = r;

      return {
        template: tpl as InspectionTemplate,
        items: (items ?? []) as InspectionTemplateItem[],
        inspectionId: inspection.id as string,
        responses,
      };
    },
  });

  const setResponse = useCallback(
    async (templateItemId: string, patch: InspectionResponsePatch) => {
      const inspectionId = query.data?.inspectionId;
      if (!inspectionId) return;
      // The row is read from the CACHE, not from this render's closure: a second blur that lands
      // before the first has round-tripped must build on the first's optimistic patch (below), or
      // its payload is assembled without it and the first write is silently lost.
      const snapshot = qc.getQueryData<InspectionSectionData>(key);
      const existing = snapshot?.responses[templateItemId] ?? query.data?.responses[templateItemId];
      // A key absent from the patch keeps the stored value; a key present with null clears it.
      // `??` used to collapse the two, so clearing a capex estimate or a comment silently re-saved
      // the old value. An explicit `undefined` counts as absent (TS lets optional fields spread in).
      const pick = <K extends keyof InspectionResponsePatch, V>(k: K, current: V) =>
        (k in patch && patch[k] !== undefined ? patch[k] : current) as Exclude<InspectionResponsePatch[K], undefined> | V;
      // No `id` (the column defaults; on conflict the stored id stays — sending one could rewrite
      // the PK) and no `photo_urls`: that column is written by append_inspection_photo ONLY. Sending
      // the cached list here would overwrite a photo appended between the RPC and the refetch —
      // the orphaned-upload bug by another route. It is `not null default '[]'`, so a first insert
      // is fine and the on-conflict update leaves it untouched.
      const row = {
        inspection_id: inspectionId,
        template_item_id: templateItemId,
        acceptable: pick('acceptable', existing?.acceptable ?? null),
        condition_rating: pick('condition_rating', existing?.condition_rating ?? null),
        action_required: pick('action_required', existing?.action_required ?? null),
        recommendation: pick('recommendation', existing?.recommendation ?? null),
        comment: pick('comment', existing?.comment ?? null),
        capex_estimate: pick('capex_estimate', existing?.capex_estimate ?? null),
        applicable: pick('applicable', existing?.applicable ?? true),
        next_service_due: pick('next_service_due', existing?.next_service_due ?? null),
        detail: pick('detail', (existing?.detail ?? {}) as Record<string, unknown>),
      };
      // Optimistic merge BEFORE the round trip, so the cache (and the next blur) shows this patch
      // now. Rolled back to the snapshot on error; the invalidation then refetches server truth.
      if (snapshot) {
        const optimistic = {
          id: '', risk_level: null, created_at: '', updated_at: '', photo_urls: [],
          ...existing, ...row,
        } as unknown as InspectionResponse;
        qc.setQueryData<InspectionSectionData>(key, { ...snapshot, responses: { ...snapshot.responses, [templateItemId]: optimistic } });
      }
      const { error } = await fdb.from('inspection_responses').upsert(
        { ...row, detail: row.detail as never },
        { onConflict: 'inspection_id,template_item_id' },
      );
      if (error) {
        if (import.meta.env.DEV) console.error('inspection setResponse failed:', error);
        toast.error('Could not save that item.');
        if (snapshot) qc.setQueryData<InspectionSectionData>(key, snapshot);
        qc.invalidateQueries({ queryKey: key });
        return;
      }
      qc.invalidateQueries({ queryKey: key });
    },
    [query.data, qc, key],
  );

  /**
   * Put a server-returned row into the cached responses NOW, then invalidate. Used after an RPC
   * that has already changed the row (append_inspection_photo): the UI shows the real row at once,
   * and a second rapid add sees the appended list rather than a stale copy. No-op when nothing is
   * cached yet (the invalidation still runs and is harmless).
   */
  const mergeResponse = useCallback(
    (row: InspectionResponse) => {
      qc.setQueryData<InspectionSectionData>(key, (old) =>
        old ? { ...old, responses: { ...old.responses, [row.template_item_id]: row } } : old);
      qc.invalidateQueries({ queryKey: key });
    },
    [qc, key],
  );

  return {
    template: query.data?.template ?? null,
    items: query.data?.items ?? [],
    responses: query.data?.responses ?? {},
    inspectionId: query.data?.inspectionId ?? null,
    isLoading: query.isLoading,
    setResponse,
    mergeResponse,
  };
}
