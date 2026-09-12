// src/lib/imageFetch.ts
/**
 * The one way the browser fetches an image it means to EMBED (report PDF photos and logo, evidence
 * pack photos).
 *
 * `fetch` only rejects on a NETWORK failure: a 403 from an expired signed URL, a 404 or a 5xx all
 * RESOLVE, and their JSON/XML error body would otherwise be decoded as an image — or, worse, base64'd
 * into a data URL and handed to pdfmake, which fails the whole export over one bad photo. Status and
 * content type are therefore checked before the body is read at all. Callers decide what a refusal
 * means (skip the photo, print the org name instead of the logo); this module only refuses.
 */

export interface FetchImageOptions {
  /**
   * Content types the caller can actually embed, compared without parameters (e.g. 'image/png').
   * pdfmake takes PNG and JPEG only, so a caller that hands it the bytes as-is lists those two —
   * an SVG or a WebP would otherwise reach it and throw "Unknown image format", failing the whole
   * export. Absent = any image/* (the photo path, which re-encodes through a canvas anyway).
   */
  allow?: string[];
}

/**
 * Resolves the image body as a Blob (its `type` carries the response's content type, so a caller
 * that needs png-vs-jpg reads `blob.type`). Throws:
 *   `unreadable (HTTP <n>)`     — non-2xx; the body is never read
 *   `not an image (<type>)`     — content type does not start with image/ ("unknown" when absent)
 *   `not embeddable (<type>)`   — an image, but not one of `allow`
 */
export async function fetchImageBlob(signedUrl: string, opts: FetchImageOptions = {}): Promise<Blob> {
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`unreadable (HTTP ${res.status})`);
  const raw = res.headers.get('content-type') ?? '';
  const type = raw.split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/')) throw new Error(`not an image (${type || 'unknown'})`);
  if (opts.allow && !opts.allow.includes(type)) throw new Error(`not embeddable (${type})`);
  return res.blob();
}

/**
 * Decodes a blob to an ImageBitmap with EXIF orientation applied, so a portrait phone photo is not
 * embedded sideways. Older Safari rejects the options form with a TypeError; it gets the plain call
 * (and its own orientation handling). A blob that cannot be decoded rejects from both forms.
 */
export async function bitmapFromBlob(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(blob);
  }
}
