/**
 * OHS Act compliance section: template-driven (zero hardcoded questions).
 * Loads the active OHS template + items, ensures one assessment per report, tracks
 * per-item responses, and computes the live building % using the group-weighted,
 * N/A-is-pass model (11_MARKING_AND_PERCENTAGES.md) so the score updates as the user
 * answers — the persisted compliance_scores view is the source of truth on reload.
 *
 * A response row may carry a comment and no answer (S3): `response` is nullable and its
 * CHECK only constrains non-null values, and the score trigger maps null to a null score —
 * so a comment-only row is stored, never scored, and never counted as answered here. The
 * live compliance_scores view (2026-06-19_02) still puts every joined row in its per-group
 * denominator, null response included; 2026-09-15_03 (canonical in ../GMI/sql) re-creates
 * the three views with `response is not null` so a comment-only row stops depressing the %.
 */
import { useCallback, useMemo, useRef } from 'react';
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

export function useComplianceSection(
  reportId: string | undefined,
  buildingId: string | undefined,
  /** When true, viewing must not create anything — see the assessment block below. */
  readOnly = false,
) {
  const qc = useQueryClient();
  const key = ['fortress-compliance', reportId, readOnly];

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
        // Reading a report must never write to it. This insert used to run inside the
        // query, so merely OPENING the OHS tab created an assessment row — on reports the
        // viewer had no right to edit — and because the submit gate counts rows in this
        // very table, that made the gate pass on a report with no answers in it.
        if (readOnly) {
          return { template: tpl, items: items ?? [], assessmentId: null, responses: {} as Record<string, ComplianceResponse> };
        }
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

  // Writes for one item run in call order. A comment blur (null answer) followed at once by
  // the answer toggle must not land reversed and put the null back over the answer.
  const inflight = useRef(new Map<string, Promise<void>>());

  const setResponse = useCallback(
    async (templateItemId: string, response: YesNoNa | null, comment?: string) => {
      const assessmentId = query.data?.assessmentId;
      if (!assessmentId) return;
      const existing = query.data?.responses[templateItemId];
      const write = async () => {
        // `response` null is a legal row: a comment typed before (or without) an answer is
        // saved instead of thrown away. An undefined `comment` keeps whatever is saved. No
        // `id`: the column default fills it, and the (assessment_id, template_item_id) key
        // resolves the conflict — so two fresh writes racing each other cannot each carry a
        // different primary key for the same row.
        const { error } = await fdb.from('compliance_responses').upsert(
          {
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
      };
      const prev = inflight.current.get(templateItemId) ?? Promise.resolve();
      const run = prev.then(write, write);
      inflight.current.set(templateItemId, run);
      try {
        await run;
      } finally {
        if (inflight.current.get(templateItemId) === run) inflight.current.delete(templateItemId);
      }
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
