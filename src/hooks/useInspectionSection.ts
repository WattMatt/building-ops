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

export interface InspectionResponsePatch {
  acceptable?: YesNoNa | null;
  condition_rating?: ConditionRating | null;
  action_required?: ActionRequired | null;
  recommendation?: string | null;
  comment?: string | null;
  capex_estimate?: number | null;
  applicable?: boolean;
  next_service_due?: string | null;
  detail?: Record<string, unknown>;
}

export function useInspectionSection(
  reportId: string | undefined,
  buildingId: string | undefined,
  cadence: InspectionCadence,
) {
  const qc = useQueryClient();
  const key = ['fortress-inspection', cadence, reportId];

  const query = useQuery({
    queryKey: key,
    enabled: !!reportId && !!buildingId,
    queryFn: async () => {
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
      const existing = query.data?.responses[templateItemId];
      const { error } = await fdb.from('inspection_responses').upsert(
        {
          id: existing?.id ?? crypto.randomUUID(),
          inspection_id: inspectionId,
          template_item_id: templateItemId,
          acceptable: patch.acceptable ?? existing?.acceptable ?? null,
          condition_rating: patch.condition_rating ?? existing?.condition_rating ?? null,
          action_required: patch.action_required ?? existing?.action_required ?? null,
          recommendation: patch.recommendation ?? existing?.recommendation ?? null,
          comment: patch.comment ?? existing?.comment ?? null,
          capex_estimate: patch.capex_estimate ?? existing?.capex_estimate ?? null,
          applicable: patch.applicable ?? existing?.applicable ?? true,
          next_service_due: patch.next_service_due ?? existing?.next_service_due ?? null,
          detail: (patch.detail ?? existing?.detail ?? {}) as never,
        },
        { onConflict: 'inspection_id,template_item_id' },
      );
      if (error) {
        if (import.meta.env.DEV) console.error('inspection setResponse failed:', error);
        toast.error('Could not save that item.');
        return;
      }
      qc.invalidateQueries({ queryKey: key });
    },
    [query.data, qc, key],
  );

  return {
    template: query.data?.template ?? null,
    items: query.data?.items ?? [],
    responses: query.data?.responses ?? {},
    inspectionId: query.data?.inspectionId ?? null,
    isLoading: query.isLoading,
    setResponse,
  };
}
