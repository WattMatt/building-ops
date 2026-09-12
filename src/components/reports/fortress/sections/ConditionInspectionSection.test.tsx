// src/components/reports/fortress/sections/ConditionInspectionSection.test.tsx
/**
 * addPhoto: upload, then ONE server statement appends the ref/caption/path, then the returned row
 * is merged into the cache. The old read-modify-write (push onto the cached photo_urls and upsert
 * the whole array) is gone — two rapid adds cannot orphan the first upload any more.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InspectionResponse, InspectionTemplateItem } from '@/integrations/supabase/fortress-db';

const state = vi.hoisted(() => ({
  responses: {} as Record<string, InspectionResponse>,
  inspectionId: 'i1' as string | null,
  setResponse: vi.fn(async () => {}),
  mergeResponse: vi.fn(),
  rpc: vi.fn(),
  // Typed parameters so `upload.mock.calls[0][1]` below is not indexing an empty tuple.
  upload: vi.fn(async (_photos: unknown[], _opts: { prefix: string; paths?: string[] }) => ['documents/b1/annual/7/p.jpg']),
  toast: { success: vi.fn(), error: vi.fn() },
}));

const item: InspectionTemplateItem = {
  id: 'it1', template_id: 't1', section_no: '7', section_title: 'ROOF', item_label: 'Gutters', rating_type: 'condition_scale',
  allows_photo: true, allow_na: true, sort_order: 1, field_set: 'generic', field_keys: [], created_at: '', updated_at: '',
};

vi.mock('@/hooks/useInspectionSection', () => ({
  useInspectionSection: () => ({ template: null, items: [item], responses: state.responses, inspectionId: state.inspectionId, isLoading: false, setResponse: state.setResponse, mergeResponse: state.mergeResponse }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: state.rpc } }));
vi.mock('@/integrations/supabase/storage', () => ({ openStorageFile: vi.fn() }));
vi.mock('@/components/ui/signed-image', () => ({ SignedImage: () => null }));
vi.mock('@/lib/photos', () => ({ uploadPhotoPaths: state.upload, inspectionPhotoPrefix: (b: string, s: string) => `documents/${b}/annual/${s}` }));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: state.toast }));
// One button that "picks" a processed JPEG, the way PhotoCapture calls onPhotosChange.
vi.mock('@/components/ui/photo-capture', () => ({
  PhotoCapture: ({ onPhotosChange }: { onPhotosChange: (p: { file: File; preview: string }[]) => void }) => (
    <button type="button" onClick={() => onPhotosChange([{ file: new File(['x'], 'p.jpg', { type: 'image/jpeg' }), preview: 'blob:p' }])}>+ Photo</button>
  ),
}));

import ConditionInspectionSection from './ConditionInspectionSection';

const returnedRow: InspectionResponse = {
  id: 'r1', inspection_id: 'i1', template_item_id: 'it1', acceptable: null, condition_rating: null, action_required: null, risk_level: null,
  recommendation: null, comment: null, capex_estimate: null, applicable: true, next_service_due: null, detail: {},
  photo_urls: [{ ref: '7.1', caption: 'Gutters', path: 'documents/b1/annual/7/p.jpg' }], created_at: '', updated_at: '',
};

const revokeObjectURL = vi.fn();

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConditionInspectionSection reportId="rep1" buildingId="b1" readOnly={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.responses = {};
  state.inspectionId = 'i1';
  state.setResponse.mockClear();
  state.mergeResponse.mockClear();
  state.rpc.mockReset().mockResolvedValue({ data: returnedRow, error: null });
  state.upload.mockClear().mockResolvedValue(['documents/b1/annual/7/p.jpg']);
  state.toast.error.mockClear();
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
  revokeObjectURL.mockClear();
});

describe('ConditionInspectionSection.addPhoto', () => {
  it('uploads, appends through append_inspection_photo and merges the returned row — never a cached read-modify-write', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '+ Photo' }));
    await waitFor(() => expect(state.mergeResponse).toHaveBeenCalledTimes(1));

    expect(state.upload).toHaveBeenCalledTimes(1);
    expect(state.upload.mock.calls[0][1]).toEqual({ prefix: 'documents/b1/annual/7' });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenCalledWith('append_inspection_photo', {
      p_inspection: 'i1', p_template_item: 'it1', p_path: 'documents/b1/annual/7/p.jpg', p_caption: 'Gutters', p_section_no: '7',
    });
    expect(state.mergeResponse).toHaveBeenCalledWith(returnedRow);
    expect(state.setResponse).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:p');
    expect(state.toast.error).not.toHaveBeenCalled();
  });

  it('a failed append says so and leaves the cache alone', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: 'new row violates row-level security policy', code: '42501' } });
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '+ Photo' }));
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith('Photo uploaded but not attached to the item. Add it again.'));
    expect(state.mergeResponse).not.toHaveBeenCalled();
    expect(state.setResponse).not.toHaveBeenCalled();
  });

  it('an upload failure never reaches the RPC', async () => {
    state.upload.mockRejectedValue(new Error('Photo upload failed: 403'));
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '+ Photo' }));
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith('Photo upload failed.'));
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.mergeResponse).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:p');
  });

  it('does nothing without an inspection row (read-only view never created one)', async () => {
    state.inspectionId = null;
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '+ Photo' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
