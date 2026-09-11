import { describe, it, expect, vi, beforeEach } from 'vitest';

type UploadOpts = { contentType?: string; upsert?: boolean };
const storage = vi.hoisted(() => ({
  buckets: [] as string[],
  upload: vi.fn<(path: string, file: File, opts?: UploadOpts) => Promise<{ error: { message: string } | null }>>(async () => ({ error: null })),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        storage.buckets.push(bucket);
        return {
          upload: storage.upload,
          getPublicUrl: (p: string) => ({ data: { publicUrl: `https://x/${p}` } }),
        };
      },
    },
  },
}));

import { uploadPhotos, uploadPhotoPaths, photoPrefix, inspectionPhotoPrefix, photoPath, PHOTO_BUCKET } from './photos';

const photo = (name = 'a.jpg', type = 'image/jpeg') => {
  const file = new File(['x'], name, { type });
  return { file, preview: 'blob:preview' };
};

describe('photos', () => {
  beforeEach(() => {
    storage.upload.mockClear();
    storage.buckets = [];
  });

  it('uploadPhotos writes under photos/<uid>/ in tenant-documents and returns public-style URLs', async () => {
    const p = photo();
    const urls = await uploadPhotos([p], { prefix: photoPrefix('u1') });
    expect(urls).toHaveLength(1);
    expect(urls[0].startsWith('https://x/photos/u1/')).toBe(true);
    expect(storage.upload).toHaveBeenCalledTimes(1);
    const [path, file, opts] = storage.upload.mock.calls[0];
    expect(path).toMatch(/^photos\/u1\/\d+-[0-9a-f-]{36}\.jpg$/);
    expect(file).toBe(p.file);
    expect(opts).toEqual({ contentType: p.file.type, upsert: true });
    expect(new Set(storage.buckets)).toEqual(new Set([PHOTO_BUCKET]));
    expect(PHOTO_BUCKET).toBe('tenant-documents');
  });

  it('uploads every photo in order and returns one URL per photo', async () => {
    const urls = await uploadPhotos([photo('a.jpg'), photo('b.jpg')], { prefix: photoPrefix('u1') });
    expect(urls).toHaveLength(2);
    expect(storage.upload).toHaveBeenCalledTimes(2);
    expect(storage.upload.mock.calls[0][1].name).toBe('a.jpg');
    expect(storage.upload.mock.calls[1][1].name).toBe('b.jpg');
  });

  it('falls back to image/jpeg when the file has no type', async () => {
    await uploadPhotos([photo('a.jpg', '')], { prefix: photoPrefix('u1') });
    expect(storage.upload.mock.calls[0][2]).toEqual({ contentType: 'image/jpeg', upsert: true });
  });

  it('rejects with the storage message on upload error (evidence is never silently dropped)', async () => {
    storage.upload.mockResolvedValueOnce({ error: { message: 'row-level security' } });
    await expect(uploadPhotos([photo()], { prefix: photoPrefix('u1') })).rejects.toThrow('Photo upload failed: row-level security');
  });

  it('uploadPhotoPaths returns storage paths under the inspection prefix', async () => {
    const paths = await uploadPhotoPaths([photo()], { prefix: inspectionPhotoPrefix('b1', 3) });
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/^documents\/b1\/annual\/3\/\d+-[0-9a-f-]{36}\.jpg$/);
    expect(storage.upload.mock.calls[0][0]).toBe(paths[0]);
  });

  it('opts.paths pre-assigns the storage path per photo (used by the offline queue)', async () => {
    const paths = await uploadPhotoPaths([photo('a.jpg'), photo('b.jpg')], {
      prefix: photoPrefix('u1'),
      paths: ['photos/u1/fixed-a.jpg'],
    });
    expect(paths[0]).toBe('photos/u1/fixed-a.jpg');
    expect(paths[1]).toMatch(/^photos\/u1\/\d+-[0-9a-f-]{36}\.jpg$/);
    const urls = await uploadPhotos([photo()], { prefix: photoPrefix('u1'), paths: ['photos/u1/fixed.jpg'] });
    expect(urls).toEqual(['https://x/photos/u1/fixed.jpg']);
  });

  it('prefix helpers and photoPath compose the documented layouts', () => {
    expect(photoPrefix('u1')).toBe('photos/u1');
    expect(inspectionPhotoPrefix('b1', '12')).toBe('documents/b1/annual/12');
    expect(photoPath('photos/u1', 'n.jpg')).toBe('photos/u1/n.jpg');
    expect(photoPath('photos/u1')).toMatch(/^photos\/u1\/\d+-[0-9a-f-]{36}\.jpg$/);
  });

  it('uploads nothing and returns [] for an empty list', async () => {
    expect(await uploadPhotos([], { prefix: photoPrefix('u1') })).toEqual([]);
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
