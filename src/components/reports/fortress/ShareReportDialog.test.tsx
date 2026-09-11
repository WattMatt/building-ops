import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// jsdom lacks the Pointer Events capture API Radix Select relies on; polyfill so the combobox opens.
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const shares = vi.hoisted(() => ({
  createMutate: vi.fn(),
  revokeMutate: vi.fn(),
  rows: [] as unknown[],
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/reportShares', async (orig) => ({
  ...(await orig<typeof import('@/lib/reportShares')>()),
  useReportShares: () => ({
    shares: shares.rows,
    isLoading: false,
    create: { mutate: shares.createMutate, isPending: false },
    revoke: { mutate: shares.revokeMutate, isPending: false },
  }),
}));

import { ShareReportDialog } from './ShareReportDialog';
import type { ReportArtifactRow } from '@/lib/reportArtifacts';
import type { ReportShareRow } from '@/lib/reportShares';

const artifact = (over: Partial<ReportArtifactRow> = {}): ReportArtifactRow => ({
  id: 'a1',
  org_id: 'org1',
  kind: 'fortress_ops_monthly',
  source_id: 'r1',
  building_id: 'b1',
  version: 2,
  file_path: 'org1/fortress_ops_monthly/1-report.pdf',
  file_name: 'report.pdf',
  size_bytes: 1024,
  generated_by: 'u1',
  created_at: '2026-09-10T08:00:00.000Z',
  status: 'issued',
  superseded_by: null,
  report_status: 'approved',
  ...over,
});

const share = (over: Partial<ReportShareRow> = {}): ReportShareRow => ({
  id: 's1',
  report_id: 'r1',
  artifact_id: 'a1',
  token: 'T'.repeat(43),
  created_by: 'u1',
  created_at: '2026-09-10T08:00:00.000Z',
  expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  view_count: 3,
  last_viewed_at: null,
  revoked_at: null,
  ...over,
});

const renderDialog = (artifacts: ReportArtifactRow[], initialArtifactId?: string) =>
  render(
    <ShareReportDialog reportId="r1" artifacts={artifacts} initialArtifactId={initialArtifactId} open onOpenChange={vi.fn()} />,
  );

beforeEach(() => {
  shares.createMutate.mockReset();
  shares.revokeMutate.mockReset();
  shares.rows = [];
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('ShareReportDialog', () => {
  it('defaults to the current issued version and says nothing about a watermark', () => {
    renderDialog([artifact({ id: 'a2', version: 1, status: 'superseded' }), artifact()]);
    expect(screen.getByRole('combobox', { name: 'Version to share' })).toHaveTextContent('v2');
    expect(screen.queryByText('This version carries a DRAFT watermark.')).toBeNull();
  });

  it('warns in plain copy when the chosen version was exported before approval', () => {
    renderDialog([artifact({ report_status: 'submitted' })]);
    expect(screen.getByText('This version carries a DRAFT watermark.')).toBeInTheDocument();
  });

  it('offers no Create button when the report has no saved PDF', () => {
    renderDialog([]);
    expect(screen.queryByRole('button', { name: /Create link/ })).toBeNull();
    expect(screen.getByText(/no saved PDF yet/)).toBeInTheDocument();
  });

  it('creates a link with the chosen expiry and passcode, then shows it', async () => {
    const token = 'K'.repeat(43);
    shares.createMutate.mockImplementation((_input, opts) =>
      opts?.onSuccess?.({ id: 's9', token, expiresAt: '2026-10-10T08:00:00.000Z' }),
    );
    renderDialog([artifact()]);
    fireEvent.click(screen.getByLabelText('7 days'));
    fireEvent.change(screen.getByLabelText('Passcode (optional)'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: /Create link/ }));
    expect(shares.createMutate.mock.calls[0][0]).toEqual({
      reportId: 'r1',
      artifactId: 'a1',
      expiresInDays: 7,
      passcode: 'hunter2',
    });
    expect(await screen.findByTestId('share-link')).toHaveTextContent(`/share/${token}`);
    expect(screen.getByText('Passcode required')).toBeInTheDocument();
  });

  it('blocks Create while the passcode is too short and says why', () => {
    renderDialog([artifact()]);
    fireEvent.change(screen.getByLabelText('Passcode (optional)'), { target: { value: 'ab' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Passcode must be at least 4 characters.');
    expect(screen.getByRole('button', { name: /Create link/ })).toBeDisabled();
  });

  it('copies the created link to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    shares.createMutate.mockImplementation((_i, opts) =>
      opts?.onSuccess?.({ id: 's9', token: 'Z'.repeat(43), expiresAt: '2026-10-10T08:00:00.000Z' }),
    );
    renderDialog([artifact()]);
    fireEvent.click(screen.getByRole('button', { name: /Create link/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Copy link/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/share/${'Z'.repeat(43)}`));
    expect(await screen.findByRole('button', { name: /Copied/ })).toBeInTheDocument();
  });

  it('lists active links and revokes one only after a confirm', async () => {
    shares.rows = [share(), share({ id: 's2', revoked_at: '2026-09-11T08:00:00.000Z' })];
    renderDialog([artifact()]);
    expect(screen.getByText(/3 views/)).toBeInTheDocument();
    expect(screen.getByText('1 older link is expired or revoked.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(shares.revokeMutate).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm revoke' }));
    expect(shares.revokeMutate.mock.calls[0][0]).toBe('s1');
  });
});
