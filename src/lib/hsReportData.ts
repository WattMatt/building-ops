import { supabase } from '@/integrations/supabase/client';
import { resolveStorageUrl } from '@/integrations/supabase/storage';
import { generateHsCompliancePdf } from './pdfGenerator';
import { saveReportArtifact } from './reportArtifacts';
import type { HsTask, HsDocument } from './hsComplianceReport';

const MAX_EMBEDDED_PHOTOS = 30;

/** Outcome of the save-on-generate persistence step (download always happens). */
export type HsReportPersistOutcome =
  | { persisted: 'saved' }
  | { persisted: 'failed'; error: string }
  | { persisted: 'skipped' };

export interface HsReportBranding {
  name: string;
  logoUrl?: string | null;
  primaryColor: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * Assemble one building's H&S evidence data over a date range and download a
 * branded PDF. Shared by the org Reports page (building picker) and the
 * per-building Reports tab so both produce an identical report.
 *
 * When `persist` is provided the rendered blob is also saved as a versioned
 * report artifact (standard D1/D2). Persistence failing never blocks the
 * download — the outcome is returned so callers can toast both results.
 */
export async function generateBuildingHsReport(opts: {
  buildingId: string;
  buildingName: string;
  rangeStart: string; // yyyy-MM-dd
  rangeEnd: string;
  branding: HsReportBranding;
  persist?: { orgId: string; userId: string };
}): Promise<HsReportPersistOutcome> {
  const { buildingId, buildingName, rangeStart, rangeEnd, branding, persist } = opts;

  const { data: taskRows, error: tasksError } = await supabase
    .from('task_instances')
    .select('id, task_name, category, status, due_date, completed_at, completed_by, completion_notes, photo_urls, signature_url')
    .eq('building_id', buildingId)
    .gte('due_date', rangeStart)
    .lte('due_date', rangeEnd)
    .not('category', 'is', null)
    .order('due_date');
  if (tasksError) throw tasksError;

  const completerIds = [...new Set((taskRows || []).map((t) => t.completed_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (completerIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', completerIds);
    (profiles || []).forEach((p) => names.set(p.id, p.full_name ?? 'Unknown'));
  }

  const tasks: HsTask[] = (taskRows || []).map((t) => ({
    id: t.id,
    task_name: t.task_name,
    category: t.category,
    status: t.status,
    due_date: t.due_date,
    completed_at: t.completed_at,
    completed_by_name: t.completed_by ? (names.get(t.completed_by) ?? 'Unknown') : null,
    completion_notes: t.completion_notes,
    photo_urls: Array.isArray(t.photo_urls) ? (t.photo_urls as string[]) : [],
    signature_confirmed: Boolean(t.signature_url),
  }));

  const { data: docRows, error: docsError } = await supabase
    .from('building_documents')
    .select('id, name, document_type, expiry_date, issuing_authority, reference_number')
    .eq('building_id', buildingId)
    .order('document_type');
  if (docsError) throw docsError;
  const documents: HsDocument[] = (docRows || []).map((d) => ({ ...d, document_type: d.document_type ?? 'other' }));

  const photoDataUrls: Record<string, string[]> = {};
  let embedded = 0;
  const completedWithPhotos = tasks
    .filter((t) => t.status === 'completed' && t.photo_urls.length > 0)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  for (const t of completedWithPhotos) {
    if (embedded >= MAX_EMBEDDED_PHOTOS) break;
    try {
      const signed = await resolveStorageUrl(t.photo_urls[0]);
      if (!signed) continue;
      const blob = await (await fetch(signed)).blob();
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      photoDataUrls[t.id] = [dataUrl];
      embedded += 1;
    } catch {
      // photo unavailable — report shows "N photo(s) on file" without thumbnail
    }
  }

  const { blob, fileName } = await generateHsCompliancePdf({
    buildingName,
    rangeStart,
    rangeEnd,
    tasks,
    documents,
    photoDataUrls,
    branding,
  });

  if (!persist) return { persisted: 'skipped' };
  const saved = await saveReportArtifact({
    orgId: persist.orgId,
    kind: 'hs_compliance',
    blob,
    fileName,
    generatedBy: persist.userId,
    buildingId,
  });
  if (!saved.ok) return { persisted: 'failed', error: saved.error };
  return { persisted: 'saved' };
}
