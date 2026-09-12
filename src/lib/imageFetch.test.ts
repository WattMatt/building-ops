// src/lib/imageFetch.test.ts
/**
 * `fetch` only rejects on a NETWORK failure: a 403 from an expired signed URL, a 404 or a 5xx all
 * RESOLVE, and their JSON/XML error body would otherwise be decoded as an image — or base64'd into
 * a data URL and handed to pdfmake, which then fails the whole export. These tests pin the three
 * refusals (status, content type, SVG) and the bitmap fallback for browsers that reject the
 * options form of createImageBitmap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchImageBlob, bitmapFromBlob } from './imageFetch';

/** A Response-shaped stub: only the members fetchImageBlob reads. `blob` is a spy so a test can prove the body was never read. */
const response = (init: { ok?: boolean; status?: number; type?: string | null; body?: string }) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? (init.type === undefined ? 'image/jpeg' : init.type) : null) },
  blob: vi.fn(async () => new Blob([init.body ?? 'binary'], { type: init.type ?? 'image/jpeg' })),
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchImageBlob', () => {
  it('rejects a non-2xx before reading the body', async () => {
    const res = response({ ok: false, status: 403, type: 'application/json', body: '{"error":"expired"}' });
    fetchMock.mockResolvedValue(res);
    await expect(fetchImageBlob('https://signed.example/a.jpg')).rejects.toThrow('unreadable (HTTP 403)');
    expect(res.blob).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('https://signed.example/a.jpg');
  });

  it('rejects a 200 whose content type is not an image, naming the type', async () => {
    const res = response({ ok: true, type: 'application/xml', body: '<Error>AccessDenied</Error>' });
    fetchMock.mockResolvedValue(res);
    await expect(fetchImageBlob('https://signed.example/a.jpg')).rejects.toThrow('not an image (application/xml)');
    expect(res.blob).not.toHaveBeenCalled();
  });

  it('a missing content type reads as "unknown"', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, type: null }));
    await expect(fetchImageBlob('https://signed.example/a.jpg')).rejects.toThrow('not an image (unknown)');
  });

  it('accepts image/* with a parameter suffix and returns the blob', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, type: 'image/png; charset=binary' }));
    const blob = await fetchImageBlob('https://signed.example/a.png');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png; charset=binary');
  });

  it('rejects SVG only when asked to', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, type: 'image/svg+xml', body: '<svg/>' }));
    await expect(fetchImageBlob('https://signed.example/logo.svg', { rejectSvg: true })).rejects.toThrow('svg not embeddable');
    fetchMock.mockResolvedValue(response({ ok: true, type: 'image/svg+xml', body: '<svg/>' }));
    await expect(fetchImageBlob('https://signed.example/logo.svg')).resolves.toBeInstanceOf(Blob);
  });

  it('a network-level rejection propagates as-is', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(fetchImageBlob('https://signed.example/a.jpg')).rejects.toThrow('offline');
  });
});

describe('bitmapFromBlob', () => {
  const blob = new Blob(['x'], { type: 'image/jpeg' });
  const bitmap = { width: 4, height: 3, close: vi.fn() };

  it('asks for EXIF-corrected orientation', async () => {
    const cib = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', cib);
    await expect(bitmapFromBlob(blob)).resolves.toBe(bitmap);
    expect(cib).toHaveBeenCalledTimes(1);
    expect(cib).toHaveBeenCalledWith(blob, { imageOrientation: 'from-image' });
  });

  it('falls back to the plain call when the options form is rejected (older Safari)', async () => {
    const cib = vi.fn()
      .mockRejectedValueOnce(new TypeError('imageOrientation is not a valid enum value'))
      .mockResolvedValueOnce(bitmap);
    vi.stubGlobal('createImageBitmap', cib);
    await expect(bitmapFromBlob(blob)).resolves.toBe(bitmap);
    expect(cib).toHaveBeenCalledTimes(2);
    expect(cib.mock.calls[1]).toEqual([blob]);
  });

  it('a blob that cannot be decoded rejects from both forms', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new DOMException('decode', 'InvalidStateError')));
    await expect(bitmapFromBlob(blob)).rejects.toThrow('decode');
  });

  it('rejects, rather than hangs, when createImageBitmap does not exist at all', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    await expect(bitmapFromBlob(blob)).rejects.toThrow();
  });
});
