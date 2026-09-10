/**
 * Upload issue evidence photos to the private tenant-documents bucket under the user's prefix.
 * `getPublicUrl` is stored by convention (matching NewIssue) even though the bucket is private;
 * it is re-signed on read by `SignedImage`. A failure partway through the loop leaves earlier
 * uploads in this call orphaned in storage — acceptable for now.
 */
import { supabase } from '@/integrations/supabase/client';
import type { PhotoFile } from '@/components/ui/photo-capture';

export async function uploadIssuePhotos(photos: PhotoFile[], userId: string): Promise<string[]> {
  const urls: string[] = [];
  for (const photo of photos) {
    const fileName = `photos/${userId}/${Date.now()}-${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from('tenant-documents').upload(fileName, photo.file, { contentType: photo.file.type });
    if (error) throw new Error(`Photo upload failed: ${error.message}`);
    const { data } = supabase.storage.from('tenant-documents').getPublicUrl(fileName);
    if (data?.publicUrl) urls.push(data.publicUrl);
  }
  return urls;
}
