/**
 * OHS Act compliance section: template-driven (zero hardcoded questions).
 * Loads the active OHS template + items, ensures one assessment per report, tracks
 * per-item responses, and computes the live building % using the group-weighted,
 * N/A-is-pass model (11_MARKING_AND_PERCENTAGES.md) so the score updates as the user
 * answers — the persisted compliance_scores view is the source of truth on reload.
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fdb,
  type ComplianceTemplate,
  type ComplianceTemplateItem,
  type ComplianceResponse,
  type YesNoNa,
} from '@/integrations/supabase/fortress-db';
import { computeBuildingPct } from '@/lib/fortressReports';

const OHS_TEMPLATE_NAME = 'OHS Act Report';

export function useComplianceSection(reportId: string | undefined, buildingId: string | undefined) {
  const qc = useQueryClient();
  const key = ['fortress-compliance', reportId];

  const query = useQuery({
    queryKey: key,
    enabled: !!reportId && !!buildingId,
    queryFn: async () => {
      // active OHS template (latest version)
      const { data: tpl, error: tErr } = await fdb
        .from('compliance_templates')
        .select('*')
        .eq('name', OHS_TEMPLATE_NAME)
        .eq('active', true)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (tErr) throw tErr;
      if (!tpl) return { template: null, items: [], assessmentId: null, responses: {} as Record<string, ComplianceResponse> };

      const { data: items, error: iErr } = await fdb
        .from('compliance_template_items')
        .select('*')
        .eq('template_id', tpl.id)
        .order('sort_order', { ascending: true });
      if (iErr) throw iErr;

      // ensure one assessment per report
      let { data: assessment } = await fdb
        .from('compliance_assessments')
        .select('*')
        .eq('report_id', reportId!)
        .maybeSingle();
      if (!assessment) {
        const { data: created, error: aErr } = await fdb
          .from('compliance_assessments')
          .insert({ id: crypto.randomUUID(), report_id: reportId!, building_id: buildingId!, template_id: tpl.id })
          .select('*')
          .single();
        if (aErr) throw aErr;
        assessment = created;
      }

      const { data: resp, error: rErr } = await fdb
        .from('compliance_responses')
        .select('*')
        .eq('assessment_id', assessment.id);
      if (rErr) throw rErr;

      const responses: Record<string, ComplianceResponse> = {};
      for (const r of resp ?? []) responses[r.template_item_id] = r;

      return {
        template: tpl as ComplianceTemplate,
        items: (items ?? []) as ComplianceTemplateItem[],
        assessmentId: assessment.id as string,
        responses,
      };
    },
  });

  const setResponse = useCallback(
    async (templateItemId: string, response: YesNoNa, comment?: string) => {
      const assessmentId = query.data?.assessmentId;
      if (!assessmentId) return;
      const existing = query.data?.responses[templateItemId];
      const { error } = await fdb.from('compliance_responses').upsert(
        {
          id: existing?.id ?? crypto.randomUUID(),
          assessment_id: assessmentId,
          template_item_id: templateItemId,
          response,
          comment: comment ?? existing?.comment ?? null,
        },
        { onConflict: 'assessment_id,template_item_id' },
      );
      if (error) {
        if (import.meta.env.DEV) console.error('setResponse failed:', error);
        toast.error('Could not save that answer.');
        return;
      }
      qc.invalidateQueries({ queryKey: key });
    },
    [query.data, qc, key],
  );

  const responseMap = useMemo(() => {
    const m: Record<string, YesNoNa | undefined> = {};
    for (const [k, v] of Object.entries(query.data?.responses ?? {})) {
      m[k] = (v.response as YesNoNa | null) ?? undefined;
    }
    return m;
  }, [query.data]);

  const liveBuildingPct = useMemo(
    () => computeBuildingPct(query.data?.items ?? [], responseMap),
    [query.data, responseMap],
  );

  const answered = Object.values(responseMap).filter(Boolean).length;
  const scoredTotal = (query.data?.items ?? []).filter((i) => i.is_scored).length;

  return {
    template: query.data?.template ?? null,
    items: query.data?.items ?? [],
    responses: query.data?.responses ?? {},
    responseMap,
    isLoading: query.isLoading,
    setResponse,
    liveBuildingPct,
    answered,
    scoredTotal,
  };
}
