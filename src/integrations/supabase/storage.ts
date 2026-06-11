import { supabase } from './client';

// Buckets that are public — their stored URLs work as-is, no signing needed.
const PUBLIC_BUCKETS = new Set(['building-logos', 'avatars', 'organization-logos']);

/**
 * Stored file URLs were saved as public-style URLs
 * (.../storage/v1/object/public/<bucket>/<path>). The `tenant-documents`
 * bucket is now PRIVATE, so those URLs 403. This resolves a stored URL to a
 * fresh signed URL for private buckets, and passes public ones through.
 * Mirrors the iOS app's resolveFileURL.
 */
export async function resolveStorageUrl(stored: string | null | undefined, expiresIn = 3600): Promise<string | null> {
  if (!stored) return null;
  const parsed = parseBucketPath(stored);
  if (!parsed) return stored; // not a recognizable storage URL — return verbatim
  if (PUBLIC_BUCKETS.has(parsed.bucket)) return stored;
  const { data, error } = await supabase.storage.from(parsed.bucket).createSignedUrl(parsed.path, expiresIn);
  if (error || !data) return null;
  return data.signedUrl;
}

function parseBucketPath(stored: string): { bucket: string; path: string } | null {
  // matches .../object/public/<bucket>/<path> or .../object/<bucket>/<path>
  const m = stored.match(/\/object\/(?:public\/)?([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: m[1], path: decodeURIComponent(m[2]) };
}

/** Open a stored private-bucket file in a new tab via a freshly signed URL. */
export async function openStorageFile(stored: string | null | undefined): Promise<void> {
  const url = await resolveStorageUrl(stored);
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}
