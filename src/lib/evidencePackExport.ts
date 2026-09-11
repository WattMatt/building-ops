/**
 * Delivery for the evidence packs (R4b, spec §5.9): load → build the doc → render → download,
 * optionally zipped with the original (full-resolution) photos so the recipient gets the files
 * as captured, not just the downscaled copies embedded in the PDF.
 */
import { zipSync } from 'fflate';
import { buildEvidencePackDoc, packFileName, type PackMeta } from '@/lib/evidencePack';
import { loadEvidencePack, type PackProgress } from '@/lib/evidencePackData';
import { renderPdfBlob } from '@/lib/pdfGenerator';
import { downloadBlob } from '@/lib/exportCsv';
import { track } from '@/lib/analytics';

/** Builds the zip entries for a pack: the PDF at the root, then `photos/…` alongside it. */
export async function packZipFiles(
  pdf: Blob,
  pdfName: string,
  originals: readonly { name: string; blob: Blob }[],
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = { [pdfName]: new Uint8Array(await pdf.arrayBuffer()) };
  for (const o of originals) files[o.name] = new Uint8Array(await o.blob.arrayBuffer());
  return files;
}

export async function downloadEvidencePack(
  kind: 'issue' | 'task' | 'asset',
  id: string,
  meta: PackMeta,
  opts: { withOriginals: boolean; onProgress?: PackProgress },
): Promise<void> {
  const { pack, originals, photoCount } = await loadEvidencePack(kind, id, meta, opts.onProgress);
  const pdf = await renderPdfBlob(buildEvidencePackDoc(pack));
  const name = packFileName(pack);
  if (!opts.withOriginals) {
    downloadBlob(pdf, name);
    track('evidence_pack', { kind, originals: false });
    return;
  }
  const files = await packZipFiles(pdf, name, originals);
  // JPEGs and PDFs are already compressed; storing them keeps the zip fast and the size the same.
  const zip = zipSync(files, { level: 0 });
  downloadBlob(new Blob([zip], { type: 'application/zip' }), name.replace(/\.pdf$/, '.zip'));
  // `photoCount` is the photos, counted before `finish()` appends the manifest — `originals`
  // carries `photos/index.txt` too, and a manifest is not a piece of evidence.
  track('evidence_pack', { kind, originals: true, files: photoCount });
}
