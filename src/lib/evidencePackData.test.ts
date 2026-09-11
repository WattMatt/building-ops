/**
 * The photo half of the evidence-pack loaders. `PhotoCollector` is the only piece that touches
 * the network, and its failure mode was silent: `fetch` resolves for a 403 from an expired
 * signed URL, a 404 or a 5xx, so the error BODY used to be zipped as `photos/01.jpg`, handed
 * to pdfmake as an image, and listed in `index.txt` as a file that was fetched successfully.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const resolveStorageUrl = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/storage', () => ({ resolveStorageUrl }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { PACK_PHOTO_CAP } from './evidencePack';
import { PACK_MANIFEST_NAME, PHOTO_UNAVAILABLE_CAPTION, PhotoCollector, photoUrlList, instant } from './evidencePackData';

/** A Response-shaped stub: only the four members `fetchOne` reads. */
const response = (init: { ok?: boolean; status?: number; type?: string; body?: string }) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? (init.type ?? null) : null) },
  blob: async () => new Blob([init.body ?? 'binary'], { type: init.type ?? 'image/jpeg' }),
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  resolveStorageUrl.mockReset();
  resolveStorageUrl.mockImplementation(async (stored: string) => `https://signed.example/${stored}`);
  vi.stubGlobal('fetch', fetchMock);
  // jsdom has no createImageBitmap; the loader falls back to a FileReader data URL, which is
  // enough to assert that a photo was embedded at all.
  vi.stubGlobal('createImageBitmap', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const collect = async (urls: string[]) => {
  const c = new PhotoCollector();
  const photos = c.request(urls, (i) => `Photo ${i + 1}`, 'issue');
  await c.run();
  return { c, photos };
};

/** jsdom's Blob has no `.text()`, so read it the way the browser code would. */
const blobText = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsText(blob);
  });

const manifest = async (c: PhotoCollector) => {
  const m = c.finish().find((f) => f.name === PACK_MANIFEST_NAME);
  return m ? await blobText(m.blob) : '';
};

describe('PhotoCollector.run — an unusable response is not a photo', () => {
  it('a 403 from an expired signed URL becomes the "unavailable" placeholder, not a JPEG', async () => {
    fetchMock.mockResolvedValue(response({ ok: false, status: 403, type: 'application/json', body: '{"error":"expired"}' }));
    const { c, photos } = await collect(['issues/a.jpg']);

    expect(photos[0].dataUrl).toBe('');
    expect(photos[0].caption).toBe(`Photo 1 — ${PHOTO_UNAVAILABLE_CAPTION}`);
    // Nothing was stored, so the zip carries no files at all — not an error body named .jpg.
    expect(c.originals).toHaveLength(0);
    expect(c.finish()).toHaveLength(0);
  });

  it('a 404 and a 5xx are treated the same way, and the body is never read', async () => {
    for (const status of [404, 500]) {
      fetchMock.mockResolvedValue(response({ ok: false, status, type: 'text/html', body: '<html>nope</html>' }));
      const { c, photos } = await collect(['issues/a.jpg']);
      expect(photos[0].dataUrl).toBe('');
      expect(c.originals).toHaveLength(0);
    }
  });

  it('a 200 that is not an image (an XML error body) is rejected on content-type', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, type: 'application/xml', body: '<Error>AccessDenied</Error>' }));
    const { c, photos } = await collect(['issues/a.jpg']);

    expect(photos[0].caption).toContain(PHOTO_UNAVAILABLE_CAPTION);
    expect(c.originals).toHaveLength(0);
  });

  it('records the failure as "(missing)" in the manifest rather than as a fetched file', async () => {
    fetchMock.mockResolvedValue(response({ ok: false, status: 403, type: 'application/json' }));
    const c = new PhotoCollector();
    c.request(['issues/ok.jpg', 'issues/bad.jpg'], (i) => `Photo ${i + 1}`, 'issue');
    fetchMock
      .mockResolvedValueOnce(response({ ok: true, type: 'image/jpeg' }))
      .mockResolvedValueOnce(response({ ok: false, status: 403, type: 'application/json' }));
    await c.run();

    const text = await manifest(c);
    expect(text).toContain('photos/01.jpg\tissue\tissues/ok.jpg');
    expect(text).toContain('(missing)\tissue\tissues/bad.jpg');
    expect(text).not.toContain('photos/02');
  });

  it('a URL that cannot be signed, and a network-level rejection, both fall into the same branch', async () => {
    resolveStorageUrl.mockResolvedValue(null);
    expect((await collect(['issues/a.jpg'])).c.originals).toHaveLength(0);

    resolveStorageUrl.mockImplementation(async (s: string) => `https://signed.example/${s}`);
    fetchMock.mockRejectedValue(new Error('offline'));
    expect((await collect(['issues/a.jpg'])).c.originals).toHaveLength(0);
  });
});

describe('PhotoCollector.run — the good path', () => {
  it('stores an image, numbers it in pack order and embeds a data URL', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, type: 'image/png' }));
    const { c, photos } = await collect(['issues/a.png', 'issues/b.png']);

    expect(c.originals.map((o) => o.name)).toEqual(['photos/01.png', 'photos/02.png']);
    expect(photos.every((p) => p.dataUrl.startsWith('data:'))).toBe(true);
    expect(c.finish().map((f) => f.name)).toEqual(['photos/01.png', 'photos/02.png', PACK_MANIFEST_NAME]);
  });

  it('numbers by PACK order even when the fetches finish out of order', async () => {
    const order: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      // The second URL resolves after the third, so completion order != request order.
      if (url.endsWith('b.jpg')) await new Promise((r) => setTimeout(r, 10));
      order.push(url);
      return response({ ok: true, type: 'image/jpeg' });
    });
    const c = new PhotoCollector();
    c.request(['a.jpg', 'b.jpg', 'c.jpg'], (i) => `Photo ${i + 1}`, 'issue');
    await c.run();

    expect(order[order.length - 1]).toContain('b.jpg');
    const text = await manifest(c);
    const lines = text.trim().split('\n').slice(1);
    expect(lines.map((l) => l.split('\t')[2])).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('reports progress once per photo, ending at n of n', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, type: 'image/jpeg' }));
    const c = new PhotoCollector();
    c.request(['a.jpg', 'b.jpg', 'c.jpg'], (i) => `Photo ${i + 1}`, 'issue');
    expect(c.pending).toBe(3);
    const seen: [number, number][] = [];
    await c.run((done, total) => seen.push([done, total]));

    expect(seen).toHaveLength(3);
    expect(seen.map(([, total]) => total)).toEqual([3, 3, 3]);
    expect(seen[seen.length - 1][0]).toBe(3);
  });
});

describe('PhotoCollector — the cap', () => {
  it('fetches at most PACK_PHOTO_CAP photos and counts the rest as omitted', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, type: 'image/jpeg' }));
    const c = new PhotoCollector();
    const urls = Array.from({ length: PACK_PHOTO_CAP + 5 }, (_, i) => `p${i}.jpg`);
    const photos = c.request(urls, (i) => `Photo ${i + 1}`, 'issue');

    expect(photos).toHaveLength(PACK_PHOTO_CAP);
    expect(c.pending).toBe(PACK_PHOTO_CAP);
    expect(c.omitted).toBe(5);
    await c.run();
    expect(fetchMock).toHaveBeenCalledTimes(PACK_PHOTO_CAP);
  });

  it('counts across sections, and puts the count on the document meta', async () => {
    const c = new PhotoCollector();
    c.request(Array.from({ length: PACK_PHOTO_CAP }, (_, i) => `a${i}.jpg`), () => 'x', 'issue');
    c.request(['late1.jpg', 'late2.jpg'], () => 'y', 'comment');

    expect(c.omitted).toBe(2);
    const meta = { orgName: 'F', primaryColor: '#000', generatedAt: 'now', generatedBy: 'me', buildingName: 'B' };
    expect(c.metaWith(meta).photosOmitted).toBe(2);
  });

  it('leaves meta untouched when nothing was left out', () => {
    const meta = { orgName: 'F', primaryColor: '#000', generatedAt: 'now', generatedBy: 'me', buildingName: 'B' };
    expect(new PhotoCollector().metaWith(meta)).toBe(meta);
  });
});

describe('photoUrlList / instant', () => {
  it('keeps only non-empty strings out of the Json column', () => {
    expect(photoUrlList(['a', '', null, 3, 'b'])).toEqual(['a', 'b']);
    expect(photoUrlList(null)).toEqual([]);
  });

  it('never returns a raw ISO string, and survives a bad one', () => {
    expect(instant('2026-09-01T08:00:00Z')).not.toBe('2026-09-01T08:00:00Z');
    expect(instant('not a date')).toBeNull();
    expect(instant(null)).toBeNull();
  });
});
