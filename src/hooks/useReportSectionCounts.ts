/**
 * How many rows each section of a report actually holds.
 *
 * Without this the section navigator is a list of labels: a CM report shows thirteen tabs
 * of which eleven are empty for every building, and the only way to learn that is to click
 * all thirteen and wait for each query. This turns that into one glance.
 *
 * Counts come from SECTION_SOURCE, which deliberately points at the table holding the
 * user's ANSWERS rather than a parent/header row — `compliance_assessments` and
 * `building_inspections` are auto-created when a tab is first opened, so counting those
 * would report every section as filled.
 */
import { useQuery } from '@tanstack/react-query';
import { fdb } from '@/integrations/supabase/fortress-db';
import { REPORT_SECTIONS, SECTION_SOURCE } from '@/lib/fortressReports';
import type { ReportType } from '@/integrations/supabase/fortress-db';

/** null = could not be determined (missing table / query error), never silently 0. */
export type SectionCounts = Record<string, number | null>;

async function countFor(
  key: string,
  reportId: string,
  buildingId: string,
  parentIds: Map<string, string[]>,
): Promise<number | null> {
  const src = SECTION_SOURCE[key];
  if (!src) return null;
  try {
    if (src.via) {
      const ids = parentIds.get(src.via.table) ?? [];
      if (!ids.length) return 0;
      const { count, error } = await (fdb as any)
        .from(src.table)
        .select('id', { count: 'exact', head: true })
        .in(src.via.parentFk, ids);
      if (error) throw error;
      return count ?? 0;
    }
    let q = (fdb as any).from(src.table).select('id', { count: 'exact', head: true });
    q = src.key === 'building' ? q.eq('building_id', buildingId) : q.eq('report_id', reportId);
    if (src.table === 'tenant_shop_spec') q = q.eq('is_current', true);
    if (src.sectionKey) q = q.eq('section_key', src.sectionKey);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  } catch {
    // A section whose table we cannot read is reported as unknown, not as empty —
    // showing "0" for a permissions error would be a lie about the client's data.
    return null;
  }
}

export function useReportSectionCounts(
  reportId: string | undefined,
  buildingId: string | undefined,
  /** The row's report_type, which the generated DB types widen to `string`. */
  reportType: string | undefined,
) {
  return useQuery({
    queryKey: ['fortress-section-counts', reportId, reportType],
    enabled: !!reportId && !!buildingId && !!reportType,
    staleTime: 30_000,
    queryFn: async (): Promise<SectionCounts> => {
      const rid = reportId!;
      const bid = buildingId!;
      const sections = REPORT_SECTIONS[reportType as ReportType] ?? [];

      // Resolve the parent rows once for the sections whose answers hang off one.
      const parentTables = [
        ...new Set(sections.map((s) => SECTION_SOURCE[s.key]?.via?.table).filter(Boolean) as string[]),
      ];
      const parentIds = new Map<string, string[]>();
      await Promise.all(
        parentTables.map(async (t) => {
          try {
            const { data } = await (fdb as any).from(t).select('id').eq('report_id', rid);
            parentIds.set(t, (data ?? []).map((r: { id: string }) => r.id));
          } catch {
            parentIds.set(t, []);
          }
        }),
      );

      const entries = await Promise.all(
        sections.map(async (s) => [s.key, await countFor(s.key, rid, bid, parentIds)] as const),
      );
      return Object.fromEntries(entries);
    },
  });
}
