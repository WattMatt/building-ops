/**
 * Delivery for the evidence packs (R4b, spec §5.9): load → build the doc → render → download,
 * optionally zipped with the original (full-resolution) photos so the recipient gets the files
 * as captured, not just the downscaled copies embedded in the PDF.
 */
import { zipSync } from 'fflate';
import { buildEvidencePackDoc, packFileName, type PackMeta } from '@/lib/evidencePack';
import { loadEvidencePack } from '@/lib/evidencePackData';
import { renderPdfBlob } from '@/lib/pdfGenerator';
import { track } from '@/lib/analytics';

/** Object URL + anchor click, the same path exportCsv and the XLSX writers use inside the PWA sandbox. */
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

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
  opts: { withOriginals: boolean },
): Promise<void> {
  const { pack, originals } = await loadEvidencePack(kind, id, meta);
  const pdf = await renderPdfBlob(buildEvidencePackDoc(pack));
  const name = packFileName(pack);
  if (!opts.withOriginals) {
    download(pdf, name);
    track('evidence_pack', { kind, originals: false });
    return;
  }
  const files = await packZipFiles(pdf, name, originals);
  // JPEGs and PDFs are already compressed; storing them keeps the zip fast and the size the same.
  const zip = zipSync(files, { level: 0 });
  download(new Blob([zip], { type: 'application/zip' }), name.replace(/\.pdf$/, '.zip'));
  track('evidence_pack', { kind, originals: true, files: originals.length });
}
