// src/components/ui/photo-capture.test.tsx
/**
 * PhotoCapture's validate-and-process path: HEIC detection by extension when the browser sets no
 * MIME type, the 40 MB source gate (before HEIC conversion or any canvas work), and the plain
 * accept path. Compression and the caption are switched off through props so nothing here
 * needs a canvas or image decoding, which jsdom does not provide (see src/test/setup.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
// Typed parameter so `heic2any.mock.calls[0][0]` below is not indexing an empty tuple.
const heic2any = vi.hoisted(() =>
  vi.fn(async (_opts: { blob: Blob; toType?: string; quality?: number }) => new Blob(['jpeg-bytes'], { type: 'image/jpeg' })));
vi.mock('sonner', () => ({ toast }));
vi.mock('heic2any', () => ({ default: heic2any }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/useGeotagPreference', () => ({ useGeotagPreference: () => false }));
vi.mock('@/hooks/useGeotag', () => ({ useGeotag: () => ({ position: null }) }));
vi.mock('@/hooks/useHints', () => ({ useHints: () => ({ hintsEnabled: true, setHintsEnabled: vi.fn() }) }));

import { PhotoCapture, MAX_SOURCE_BYTES, type PhotoFile } from './photo-capture';

const createObjectURL = vi.fn((_blob: Blob) => 'blob:preview');

/**
 * The gallery input is the second hidden file input (the first is the camera one).
 * `extra` overrides props; the source-gate edge case raises `maxSizeMB` so the existing
 * POST-processing cap (default 10 MB) does not mask what the SOURCE gate decided.
 */
function renderCapture(extra: { maxSizeMB?: number } = {}) {
  const onPhotosChange = vi.fn<(photos: PhotoFile[]) => void>();
  const { container } = render(
    <PhotoCapture photos={[]} onPhotosChange={onPhotosChange} enableCompression={false} caption={{ time: false }} {...extra} />,
  );
  const input = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
  const pick = (file: File) => fireEvent.change(input, { target: { files: [file] } });
  return { onPhotosChange, pick };
}

/** A File whose reported size is `bytes` without allocating that much memory. */
function fileOfSize(name: string, type: string, bytes: number): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

beforeEach(() => {
  toast.error.mockClear(); toast.warning.mockClear();
  heic2any.mockClear();
  createObjectURL.mockClear();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
});

describe('PhotoCapture', () => {
  it('treats a .heic file with an empty MIME type as HEIC and converts it to JPEG', async () => {
    const { onPhotosChange, pick } = renderCapture();
    pick(new File(['heic-bytes'], 'IMG_0001.HEIC', { type: '' }));
    await waitFor(() => expect(onPhotosChange).toHaveBeenCalledTimes(1));
    expect(heic2any).toHaveBeenCalledTimes(1);
    expect(heic2any.mock.calls[0][0]).toMatchObject({ toType: 'image/jpeg', quality: 0.9 });
    const [photos] = onPhotosChange.mock.calls[0];
    expect(photos).toHaveLength(1);
    expect(photos[0].file.name).toBe('IMG_0001.jpg');
    expect(photos[0].file.type).toBe('image/jpeg');
    expect(photos[0].preview).toBe('blob:preview');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('refuses a source larger than 40 MB before HEIC conversion or any decoding', async () => {
    const { onPhotosChange, pick } = renderCapture();
    pick(fileOfSize('huge.heic', '', MAX_SOURCE_BYTES + 1));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith("huge.heic is larger than 40 MB and can't be processed on this device. Take the photo with the camera instead.");
    expect(heic2any).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(onPhotosChange).not.toHaveBeenCalled();
  });

  it('exactly 40 MB is still accepted by the source gate', async () => {
    // maxSizeMB raised to 40 so the post-processing cap is not what decides this case.
    const { onPhotosChange, pick } = renderCapture({ maxSizeMB: 40 });
    pick(fileOfSize('edge.jpg', 'image/jpeg', MAX_SOURCE_BYTES));
    await waitFor(() => expect(onPhotosChange).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('an accepted JPEG produces exactly one PhotoFile with a preview URL', async () => {
    const { onPhotosChange, pick } = renderCapture();
    const jpeg = new File(['jpeg-bytes'], 'site.jpg', { type: 'image/jpeg' });
    pick(jpeg);
    await waitFor(() => expect(onPhotosChange).toHaveBeenCalledTimes(1));
    const [photos] = onPhotosChange.mock.calls[0];
    expect(photos).toEqual([{ file: jpeg, preview: 'blob:preview' }]);
    expect(createObjectURL).toHaveBeenCalledWith(jpeg);
    expect(heic2any).not.toHaveBeenCalled();
  });

  it('a non-image is refused by name', async () => {
    const { onPhotosChange, pick } = renderCapture();
    pick(new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('scan.pdf is not a supported image format'));
    expect(onPhotosChange).not.toHaveBeenCalled();
  });
});
