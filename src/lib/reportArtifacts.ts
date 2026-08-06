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
 * The `report_artifacts` table is not in the generated `types.ts` yet, so the
 * runtime client is re-typed through a narrow structural interface (same
 * pattern as `fortress-db.ts`), which also makes the module unit-testable with
 * a mocked client.
 */
import { supabase } from '@/integrations/supabase/client';

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

export interface ReportArtifactRow {
  id: string;
  org_id: string;
  kind: string;
  source_id: string | null;
  building_id: string | null;
  version: number;
  file_path: string;
  file_name: string;
  size_bytes: number;
  generated_by: string;
  created_at: string;
  status: string;
  superseded_by: string | null;
}

export type ReportArtifactInsert = Omit<ReportArtifactRow, 'id' | 'created_at' | 'superseded_by'>;

interface PgErr {
  message: string;
}

interface ArtifactSelectBuilder extends PromiseLike<{ data: ReportArtifactRow[] | null; error: PgErr | null }> {
  eq(column: string, value: string): ArtifactSelectBuilder;
  is(column: string, value: null): ArtifactSelectBuilder;
  order(column: string, opts: { ascending: boolean }): ArtifactSelectBuilder;
  limit(count: number): ArtifactSelectBuilder;
}

interface ArtifactUpdateBuilder extends PromiseLike<{ error: PgErr | null }> {
  eq(column: string, value: string): ArtifactUpdateBuilder;
  is(column: string, value: null): ArtifactUpdateBuilder;
  neq(column: string, value: string): ArtifactUpdateBuilder;
}

interface ArtifactTable {
  select(columns: string): ArtifactSelectBuilder;
  insert(row: ReportArtifactInsert): {
    select(): { single(): Promise<{ data: ReportArtifactRow | null; error: PgErr | null }> };
  };
  update(patch: { status: string; superseded_by: string }): ArtifactUpdateBuilder;
}

interface ArtifactBucket {
  upload(
    path: string,
    body: Blob,
    opts: { contentType: string; upsert: boolean }
  ): Promise<{ data: { path: string } | null; error: PgErr | null }>;
  remove(paths: string[]): Promise<{ data: unknown; error: PgErr | null }>;
  createSignedUrl(
    path: string,
    expiresIn: number,
    opts?: { download?: string | boolean }
  ): Promise<{ data: { signedUrl: string } | null; error: PgErr | null }>;
}

export interface ReportArtifactsClient {
  from(table: 'report_artifacts'): ArtifactTable;
  storage: { from(bucket: string): ArtifactBucket };
}

// Same runtime client, re-typed to the narrow surface this module uses
// (fortress-db.ts pattern; report_artifacts is not in the generated types yet).
const defaultClient = supabase as unknown as ReportArtifactsClient;

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

  // 1) Next version in the (org, kind, source) chain.
  let versionQuery = client.from('report_artifacts').select('version').eq('org_id', orgId).eq('kind', kind);
  versionQuery = sourceId ? versionQuery.eq('source_id', sourceId) : versionQuery.is('source_id', null);
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
    })
    .select()
    .single();
  if (insertError || !artifact) {
    const { error: removeError } = await client.storage.from(GENERATED_REPORTS_BUCKET).remove([filePath]);
    const orphanNote = removeError ? ` (orphan cleanup also failed: ${removeError.message})` : '';
    return { ok: false, error: `Could not record the report: ${insertError?.message ?? 'no row returned'}${orphanNote}` };
  }

  // 4) Supersede prior issued versions of the same (kind, source). Best-effort:
  //    the new artifact is already safely issued; a failure here only leaves an
  //    older row still marked issued.
  let supersede = client
    .from('report_artifacts')
    .update({ status: 'superseded', superseded_by: artifact.id })
    .eq('org_id', orgId)
    .eq('kind', kind);
  supersede = sourceId ? supersede.eq('source_id', sourceId) : supersede.is('source_id', null);
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
