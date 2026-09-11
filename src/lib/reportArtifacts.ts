/**
 * Persistent report artifacts (standard D1/D2): every generated PDF is saved
 * into the private `generated-reports` bucket with a versioned
 * `report_artifacts` row, fail-closed:
 *
 *   upload (upsert:false) → insert row → on insert failure REMOVE the uploaded
 *   object and return an error → supersede prior issued rows of the same
 *   (kind, source).
 *
 * A failure at any step never leaves a client-visible artifact row without a
 * file, and never leaves an orphaned file that a row claims doesn't exist.
 * Persistence failing is NON-fatal to the download itself — callers download
 * first, then report both outcomes (degradation ladder, standard D2/D4).
 *
 * `report_artifacts` IS in the generated `types.ts` (regenerated from production
 * after R4a), so every query here type-checks against the real table rather than
 * a hand-rolled structural interface. The client is still a parameter — narrowed
 * to the two surfaces this module touches — so the module stays unit-testable
 * with a mocked client.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export const GENERATED_REPORTS_BUCKET = 'generated-reports';
export const ARTIFACT_SIGNED_URL_TTL_SECONDS = 600;

export type ReportArtifactKind =
  | 'hs_compliance'
  | 'portfolio_summary'
  | 'fortress_ops_monthly'
  | 'fortress_cm_monthly'
  | 'fortress_annual_inspection';

export const REPORT_KIND_LABELS: Record<ReportArtifactKind, string> = {
  hs_compliance: 'H&S Compliance Report',
  portfolio_summary: 'Portfolio Compliance Summary',
  fortress_ops_monthly: 'Monthly OPS Report',
  fortress_cm_monthly: 'Monthly CM Report',
  fortress_annual_inspection: 'Annual Inspection Report',
};

export type ReportArtifactRow = Tables<'report_artifacts'>;
export type ReportArtifactInsert = TablesInsert<'report_artifacts'>;

/** The two surfaces this module touches, typed straight off the generated client (injectable for tests). */
export type ReportArtifactsClient = Pick<typeof supabase, 'from' | 'storage'>;

const defaultClient: ReportArtifactsClient = supabase;

/** Filesystem/storage-safe file name stem: keeps letters, digits, `._-`. */
export function sanitizeReportFileName(name: string): string {
  const stem = name
    .replace(/\.pdf$/i, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 80);
  return `${stem || 'report'}.pdf`;
}

export interface SaveReportArtifactInput {
  orgId: string;
  kind: ReportArtifactKind;
  blob: Blob;
  fileName: string;
  generatedBy: string;
  /** Row the report was generated from (e.g. Fortress report id). Null for ad-hoc reports. */
  sourceId?: string | null;
  /** Building scope; null for portfolio-level reports. */
  buildingId?: string | null;
  /** Lifecycle status of the source report at export time; omit for ad-hoc kinds. */
  reportStatus?: string | null;
}

export type SaveReportArtifactResult =
  | { ok: true; artifact: ReportArtifactRow; supersedeWarning?: string }
  | { ok: false; error: string };

export async function saveReportArtifact(
  input: SaveReportArtifactInput,
  client: ReportArtifactsClient = defaultClient
): Promise<SaveReportArtifactResult> {
  const { orgId, kind, blob, generatedBy } = input;
  const sourceId = input.sourceId ?? null;
  const buildingId = input.buildingId ?? null;

  // 1) Next version in the (org, kind, source) chain — or (org, kind, building) for a
  //    kind that has no source row. The H&S report is per BUILDING and carries no
  //    source_id, so keying on source_id alone put every building in one chain:
  //    generating building B's pack marked building A's as superseded, and versions
  //    counted up across unrelated buildings. Scope by building when there is no source.
  let versionQuery = client.from('report_artifacts').select('version').eq('org_id', orgId).eq('kind', kind);
  if (sourceId) {
    versionQuery = versionQuery.eq('source_id', sourceId);
  } else {
    versionQuery = versionQuery.is('source_id', null);
    versionQuery = buildingId ? versionQuery.eq('building_id', buildingId) : versionQuery.is('building_id', null);
  }
  const { data: prior, error: versionError } = await versionQuery.order('version', { ascending: false }).limit(1);
  if (versionError) {
    return { ok: false, error: `Could not read report history: ${versionError.message}` };
  }
  const version = (prior?.[0]?.version ?? 0) + 1;

  // 2) Upload — immutable object, never overwrite (upsert:false).
  const fileName = sanitizeReportFileName(input.fileName);
  const filePath = `${orgId}/${kind}/${Date.now()}-${fileName}`;
  const { error: uploadError } = await client.storage
    .from(GENERATED_REPORTS_BUCKET)
    .upload(filePath, blob, { contentType: 'application/pdf', upsert: false });
  if (uploadError) {
    return { ok: false, error: `Upload failed: ${uploadError.message}` };
  }

  // 3) Insert the artifact row. On failure, remove the uploaded object so no
  //    orphan file survives (fail-closed).
  const { data: artifact, error: insertError } = await client
    .from('report_artifacts')
    .insert({
      org_id: orgId,
      kind,
      source_id: sourceId,
      building_id: buildingId,
      version,
      file_path: filePath,
      file_name: fileName,
      size_bytes: blob.size,
      generated_by: generatedBy,
      status: 'issued',
      report_status: input.reportStatus ?? null,
    })
    .select()
    .single();
  if (insertError || !artifact) {
    const { error: removeError } = await client.storage.from(GENERATED_REPORTS_BUCKET).remove([filePath]);
    const orphanNote = removeError ? ` (orphan cleanup also failed: ${removeError.message})` : '';
    return { ok: false, error: `Could not record the report: ${insertError?.message ?? 'no row returned'}${orphanNote}` };
  }

  // 4) Supersede prior issued versions of the same chain. Best-effort:
  //    the new artifact is already safely issued; a failure here only leaves an
  //    older row still marked issued.
  let supersede = client
    .from('report_artifacts')
    .update({ status: 'superseded', superseded_by: artifact.id })
    .eq('org_id', orgId)
    .eq('kind', kind);
  if (sourceId) {
    supersede = supersede.eq('source_id', sourceId);
  } else {
    supersede = supersede.is('source_id', null);
    // Must mirror the version scope above, or one building's pack supersedes another's.
    supersede = buildingId ? supersede.eq('building_id', buildingId) : supersede.is('building_id', null);
  }
  const { error: supersedeError } = await supersede.eq('status', 'issued').neq('id', artifact.id);
  if (supersedeError) {
    return { ok: true, artifact, supersedeWarning: `Prior versions were not marked superseded: ${supersedeError.message}` };
  }

  return { ok: true, artifact };
}

/** Newest-first artifact listing for the saved-reports browser (RLS-scoped). */
export async function listReportArtifacts(
  limit = 50,
  client: ReportArtifactsClient = defaultClient
): Promise<{ data: ReportArtifactRow[]; error: string | null }> {
  const { data, error } = await client
    .from('report_artifacts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
}

/**
 * The saved PDFs for ONE source report, newest first.
 *
 * Separate from listReportArtifacts rather than an extra parameter on it, so the existing
 * positional (limit, client) signature and its callers stay untouched. Used by the report
 * editor to show a report its own issued versions — without this, a generated PDF is only
 * findable on the portfolio-wide Saved Reports card, with no route back from the report
 * that produced it.
 */
export async function listReportArtifactsForSource(
  sourceId: string,
  limit = 20,
  client: ReportArtifactsClient = defaultClient
): Promise<{ data: ReportArtifactRow[]; error: string | null }> {
  const { data, error } = await client
    .from('report_artifacts')
    .select('*')
    .eq('source_id', sourceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
}

/** Short-lived signed URL for preview (inline) or download (attachment). */
export async function createArtifactSignedUrl(
  filePath: string,
  opts?: { downloadAs?: string },
  client: ReportArtifactsClient = defaultClient
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await client.storage
    .from(GENERATED_REPORTS_BUCKET)
    .createSignedUrl(filePath, ARTIFACT_SIGNED_URL_TTL_SECONDS, opts?.downloadAs ? { download: opts.downloadAs } : undefined);
  if (error || !data?.signedUrl) return { url: null, error: error?.message ?? 'No signed URL returned' };
  return { url: data.signedUrl, error: null };
}
