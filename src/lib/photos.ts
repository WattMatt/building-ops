/**
 * The one upload path for evidence photos. Non-admins may only write photos/<uid>/… in the
 * private tenant-documents bucket (storage policy "td write own photos"); annual inspection
 * photos live under documents/<building>/annual/<section>/ and are written by admins/managers.
 * Public-style URLs are stored by convention and re-signed on read by SignedImage. A failure
 * throws — silently dropping compliance evidence the user believes they attached is worse than
 * a failed submit.
 */
import { supabase } from '@/integrations/supabase/client';
import type { PhotoFile } from '@/components/ui/photo-capture';

export const PHOTO_BUCKET = 'tenant-documents';
export const photoPrefix = (userId: string) => `photos/${userId}`;
export const inspectionPhotoPrefix = (buildingId: string, sectionNo: string | number) =>
  `documents/${buildingId}/annual/${sectionNo}`;

export function photoPath(prefix: string, name = `${Date.now()}-${crypto.randomUUID()}.jpg`) {
  return `${prefix}/${name}`;
}

async function putOne(path: string, file: File) {
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);
}

/** Uploads and returns storage PATHS (for callers that store paths, e.g. inspection photo refs). */
export async function uploadPhotoPaths(
  photos: PhotoFile[],
  opts: { prefix: string; paths?: string[] },
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < photos.length; i++) {
    const path = opts.paths?.[i] ?? photoPath(opts.prefix);
    await putOne(path, photos[i].file);
    out.push(path);
  }
  return out;
}

/** Uploads and returns public-style URLs (what issues/tasks/forms store in photo_urls). */
export async function uploadPhotos(
  photos: PhotoFile[],
  opts: { prefix: string; paths?: string[] },
): Promise<string[]> {
  const paths = await uploadPhotoPaths(photos, opts);
  return paths.map((p) => supabase.storage.from(PHOTO_BUCKET).getPublicUrl(p).data.publicUrl);
}
