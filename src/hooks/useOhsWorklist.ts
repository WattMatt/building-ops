/**
 * OHS Compliance tab — Row D (equipment service register) + Row E (evacuation drill).
 *
 * Row D: from the building's LATEST APPROVED annual inspection (reports.report_type=
 * 'annual_inspection', status='approved'), read inspection_responses with a
 * next_service_due, joined to inspection_template_items for the label/section. Each
 * item is flagged overdue (next_service_due < today) vs upcoming, sorted by due date.
 * AbaQulusi has no service dates recorded → empty list (expected, honest empty-state).
 *
 * Row E: the most recent COMPLETED evacuation task — task_completions joined to
 * task_instances where building_id = bid and task_name ILIKE '%evac%', latest
 * created_at. Null when there is no completion (AbaQulusi has evac tasks but none done).
 *
 * Reads only the SQL tables; no client math that can drift. Null-safe throughout.
 */
import { useQuery } from '@tanstack/react-query';
import { fdb } from '@/integrations/supabase/fortress-db';

export interface ServiceItem {
  responseId: string;
  label: string;
  section: string;
  nextDue: string; // ISO date
  overdue: boolean;
}

export interface EvacDrill {
  date: string; // ISO timestamp
  daysAgo: number;
}

export interface OhsWorklist {
  serviceItems: ServiceItem[];
  evac: EvacDrill | null;
}

const today = () => new Date().toISOString().slice(0, 10);

export function useOhsWorklist(buildingId: string | undefined) {
  const query = useQuery({
    queryKey: ['ohs-worklist', buildingId],
    enabled: !!buildingId,
    queryFn: async (): Promise<OhsWorklist> => {
      const bid = buildingId!;

      // ---- Row D: equipment service register ---------------------------------
      // Latest APPROVED annual inspection report for this building.
      const repRes = await fdb
        .from('reports')
        .select('id')
        .eq('building_id', bid)
        .eq('report_type', 'annual_inspection')
        .eq('status', 'approved')
        .order('report_period', { ascending: false })
        .limit(1);
      const annualReportId = repRes.data?.[0]?.id ?? null;

      let serviceItems: ServiceItem[] = [];
      if (annualReportId) {
        const inspRes = await fdb
          .from('building_inspections')
          .select('id')
          .eq('report_id', annualReportId);
        const inspIds = (inspRes.data ?? []).map((r) => r.id);

        if (inspIds.length) {
          const respRes = await fdb
            .from('inspection_responses')
            .select('id,next_service_due,template_item_id,inspection_template_items(item_label,section_no,section_title)')
            .in('inspection_id', inspIds)
            .not('next_service_due', 'is', null);

          const td = today();
          serviceItems = ((respRes.data ?? []) as RawResponse[])
            .filter((r) => !!r.next_service_due)
            .map((r) => {
              const item = r.inspection_template_items;
              const sectionNo = item?.section_no ?? '';
              const sectionTitle = item?.section_title ?? '';
              return {
                responseId: r.id,
                label: item?.item_label ?? 'Equipment',
                section: `${sectionNo} ${sectionTitle}`.trim(),
                nextDue: r.next_service_due!,
                overdue: r.next_service_due! < td,
              };
            })
            .sort((a, b) => a.nextDue.localeCompare(b.nextDue));
        }
      }

      // ---- Row E: most recent completed evacuation drill ---------------------
      const evacTasks = await fdb
        .from('task_instances')
        .select('id')
        .eq('building_id', bid)
        .ilike('task_name', '%evac%');
      const evacIds = (evacTasks.data ?? []).map((t) => t.id);

      let evac: EvacDrill | null = null;
      if (evacIds.length) {
        const comps = await fdb
          .from('task_completions')
          .select('created_at')
          .in('task_instance_id', evacIds)
          .order('created_at', { ascending: false })
          .limit(1);
        const last = comps.data?.[0]?.created_at as string | null | undefined;
        if (last) {
          evac = {
            date: last,
            daysAgo: Math.floor((Date.now() - new Date(last).getTime()) / 86400000),
          };
        }
      }

      return { serviceItems, evac };
    },
  });

  return {
    serviceItems: query.data?.serviceItems ?? [],
    evac: query.data?.evac ?? null,
    isLoading: query.isLoading,
  };
}

// Shape of the embedded PostgREST row (single related row, typed loosely as the
// generated FortressDatabase doesn't carry the new template-bank join).
interface RawResponse {
  id: string;
  next_service_due: string | null;
  template_item_id: string;
  inspection_template_items: {
    item_label: string | null;
    section_no: string | null;
    section_title: string | null;
  } | null;
}
