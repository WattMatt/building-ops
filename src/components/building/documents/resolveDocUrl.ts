import { resolveStorageUrl } from '@/integrations/supabase/storage';
import type { UnifiedDocument } from './types';

/**
 * Resolve a document to a URL safe to embed/download.
 * Managed docs live in the PRIVATE tenant-documents bucket and must be signed
 * (the stored public-style URL 403s). Insight-linker docs are on public buckets.
 */
export async function resolveDocUrl(doc: UnifiedDocument): Promise<string | null> {
  if (!doc.storedUrl) return null;
  if (doc.source === 'insight_linker') return doc.storedUrl;
  return resolveStorageUrl(doc.storedUrl);
}
