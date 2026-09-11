import { describe, it, expect, vi } from 'vitest';
import { exportApprovedArtifact, type ApprovalExportInput } from './reportApproval';
import type { GeneratedFortressPdf } from '@/lib/fortressReportPdf';
import type { SaveReportArtifactResult } from '@/lib/reportArtifacts';

const BRANDING = { name: 'Fortress', primaryColor: '#2563eb', logoUrl: null };

const input = (over: Partial<ApprovalExportInput> = {}): ApprovalExportInput => ({
  reportId: 'r1',
  orgId: 'org1',
  userId: 'u1',
  branding: BRANDING,
  ...over,
});

const generated = (over: Partial<GeneratedFortressPdf> = {}): GeneratedFortressPdf => ({
  blob: new Blob(['pdf']),
  fileName: 'report.pdf',
  buildingId: 'b1',
  reportType: 'ops_monthly',
  reportStatus: 'approved',
  ...over,
});

// Only `artifact.id` is read here; the rest of the row is irrelevant to this module.
const savedOk = { ok: true, artifact: { id: 'a1' } } as unknown as SaveReportArtifactResult;

describe('exportApprovedArtifact', () => {
  it('renders without downloading and saves the artifact', async () => {
    const generate = vi.fn().mockResolvedValue(generated());
    const save = vi.fn().mockResolvedValue(savedOk);
    const result = await exportApprovedArtifact(input(), { generate, save });
    expect(result).toEqual({ ok: true, artifactId: 'a1', reportType: 'ops_monthly' });
    expect(generate).toHaveBeenCalledWith('r1', BRANDING, { download: false });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org1',
        kind: 'fortress_ops_monthly',
        generatedBy: 'u1',
        sourceId: 'r1',
        buildingId: 'b1',
        reportStatus: 'approved',
        fileName: 'report.pdf',
      }),
    );
  });

  it('refuses a render that did not come back approved (stale read)', async () => {
    const generate = vi.fn().mockResolvedValue(generated({ reportStatus: 'submitted' }));
    const save = vi.fn();
    const result = await exportApprovedArtifact(input(), { generate, save });
    expect(result).toEqual({ ok: false, error: 'report rendered as submitted' });
    expect(save).not.toHaveBeenCalled();
  });

  it('reports a generate failure instead of throwing', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('Could not read the report'));
    const save = vi.fn();
    const result = await exportApprovedArtifact(input(), { generate, save });
    expect(result).toEqual({ ok: false, error: 'Could not read the report' });
    expect(save).not.toHaveBeenCalled();
  });

  it('propagates a save failure', async () => {
    const generate = vi.fn().mockResolvedValue(generated());
    const save = vi.fn().mockResolvedValue({ ok: false, error: 'Upload failed: quota' });
    const result = await exportApprovedArtifact(input(), { generate, save });
    expect(result).toEqual({ ok: false, error: 'Upload failed: quota' });
  });

  it('does not render at all when the organisation or user is not loaded', async () => {
    const generate = vi.fn();
    const save = vi.fn();
    expect(await exportApprovedArtifact(input({ orgId: null }), { generate, save }))
      .toEqual({ ok: false, error: 'organisation or user not loaded' });
    expect(await exportApprovedArtifact(input({ userId: undefined }), { generate, save }))
      .toEqual({ ok: false, error: 'organisation or user not loaded' });
    expect(generate).not.toHaveBeenCalled();
  });
});
