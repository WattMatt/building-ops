import { useQuery } from '@tanstack/react-query';
import { supabase } from './client';

export interface ILDoc { file_name: string | null; file_url: string | null; file_size: number | null; coc_type: string | null; coc_status: string | null; coc_expiry_date: string | null; }
export interface ILPhoto { inspection_title: string | null; photo_url: string | null; }
export interface ILShop {
  subsection_id: string; name: string | null; tenant_name: string | null; category: string | null;
  meter_serial_number: string | null; ct_ratio: string | null; metering_status: string | null;
  coc: { number: string | null; status: string | null; type: string | null; issue_date: string | null; expiry: string | null };
  matched_tenant: { id: string; shop_number: string | null; shop_name: string | null } | null;
  documents: ILDoc[]; doc_count: number; photos: ILPhoto[]; photo_count: number;
}
export interface ILBuilding {
  linked: boolean; fetched_at: string;
  site?: { il_site_id: string; name: string | null; supply_authority: string | null; nominated_max_demand: string | null; site_image_url: string | null };
  counts?: { shops: number; with_docs: number; with_photos: number };
  coc_rollup?: { docs: number; pass: number; fail: number; pending: number };
  shops?: ILShop[];
  site_documents?: { file_name: string | null; file_url: string | null }[];
}

/** Call the building-scoped RPC. The function isn't in the generated Database types yet, so the name is cast. */
export async function fetchBuildingInsightLinker(buildingId: string): Promise<ILBuilding> {
  const { data, error } = await supabase.rpc('building_insight_linker' as never, { p_building_id: buildingId } as never);
  if (error) throw error;
  return data as unknown as ILBuilding;
}

export function useBuildingInsightLinker(buildingId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['insight-linker', buildingId],
    queryFn: () => fetchBuildingInsightLinker(buildingId),
    enabled: enabled && !!buildingId,
    staleTime: 5 * 60 * 1000,
  });
}

export interface ElecComplianceRow {
  shop_number: string | null; tenant_name: string | null;
  coc_number: string | null; coc_type: string | null; coc_status: string | null;
  coc_issue_date: string | null; coc_expiry_date: string | null;
  certificate_url: string | null; certificate_name: string | null;
}
export interface ElecCompliance { linked: boolean; fetched_at: string; rows: ElecComplianceRow[]; }

export async function fetchReportElectricalCompliance(buildingId: string): Promise<ElecCompliance> {
  const { data, error } = await supabase.rpc('report_electrical_compliance' as never, { p_building_id: buildingId } as never);
  if (error) throw error;
  const d = (data as unknown as Partial<ElecCompliance>) ?? {};
  return { linked: !!d.linked, fetched_at: d.fetched_at ?? '', rows: d.rows ?? [] };
}

export function useReportElectricalCompliance(buildingId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['report-electrical-compliance', buildingId],
    queryFn: () => fetchReportElectricalCompliance(buildingId),
    enabled: enabled && !!buildingId,
    staleTime: 5 * 60 * 1000,
  });
}
