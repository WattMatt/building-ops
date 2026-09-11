/**
 * Approval issues the final PDF (spec §5.7): the transition writes `status = 'approved'` first, then the
 * browser renders the report (no watermark, because generateReportPdf reads the status it just got) and
 * saves it as the current artifact. Never throws — a failed export must not undo an approval; the caller
 * says so in the toast and the distribution function reports `skipped_no_artifact` with an inbox nudge.
 */
import { generateReportPdf, type ReportBranding } from '@/lib/fortressReportPdf';
import { saveReportArtifact, type ReportArtifactKind } from '@/lib/reportArtifacts';

export interface ApprovalExportInput {
  reportId: string;
  orgId: string | null | undefined;
  userId: string | null | undefined;
  branding: ReportBranding;
}

export type ApprovalExportResult =
  | { ok: true; artifactId: string; reportType: string }
  | { ok: false; error: string };

export const APPROVAL_EXPORT_FAILED =
  'Approved, but the final PDF could not be saved — open the report and use Export PDF.';

export async function exportApprovedArtifact(
  input: ApprovalExportInput,
  deps: { generate: typeof generateReportPdf; save: typeof saveReportArtifact } = {
    generate: generateReportPdf,
    save: saveReportArtifact,
  },
): Promise<ApprovalExportResult> {
  if (!input.orgId || !input.userId) return { ok: false, error: 'organisation or user not loaded' };
  try {
    const generated = await deps.generate(input.reportId, input.branding, { download: false });
    // The render reads `reports.status` itself. A row that still says anything but approved means the
    // update this export follows did not land (or was undone) — issuing that PDF as the final one would
    // pin a DRAFT-watermarked file as the artifact distribution sends out.
    if (generated.reportStatus !== 'approved') return { ok: false, error: `report rendered as ${generated.reportStatus}` };
    const saved = await deps.save({
      orgId: input.orgId,
      kind: `fortress_${generated.reportType}` as ReportArtifactKind,
      blob: generated.blob,
      fileName: generated.fileName,
      generatedBy: input.userId,
      sourceId: input.reportId,
      buildingId: generated.buildingId,
      reportStatus: generated.reportStatus,
    });
    return saved.ok
      ? { ok: true, artifactId: saved.artifact.id, reportType: generated.reportType }
      : { ok: false, error: saved.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'export failed' };
  }
}
