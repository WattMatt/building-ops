/**
 * The printable A5 sheet for a building's intake QR code ("Report a problem in <building>").
 * Pure HTML so it is unit-tested; TenantIntakeCard opens it in a new window and prints.
 */
export interface IntakeSheetInput {
  buildingName: string;
  orgName: string;
  url: string;
  /** `qrcode.toDataURL` output (PNG data URL). */
  qrDataUrl: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function intakeSheetHtml(i: IntakeSheetInput): string {
  const building = escapeHtml(i.buildingName);
  const org = escapeHtml(i.orgName);
  const url = escapeHtml(i.url);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Report a problem — ${building}</title>
<style>
  @page { size: A5 portrait; margin: 12mm; }
  html, body { margin: 0; font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; }
  .sheet { width: 124mm; margin: 0 auto; text-align: center; }
  h1 { font-size: 22pt; margin: 0 0 4mm; }
  .building { font-size: 14pt; margin: 0 0 8mm; color: #333; }
  .qr { width: 80mm; height: 80mm; }
  .url { font-size: 9pt; word-break: break-all; color: #444; margin: 6mm 0 8mm; }
  ol { text-align: left; font-size: 11pt; padding-left: 8mm; margin: 0 0 8mm; }
  li { margin-bottom: 2mm; }
  .org { font-size: 9pt; color: #666; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style></head>
<body><div class="sheet">
  <h1>Report a problem</h1>
  <p class="building">${building}</p>
  <img class="qr" src="${i.qrDataUrl}" alt="QR code linking to the report form">
  <p class="url">${url}</p>
  <ol>
    <li>Scan the code with your phone camera.</li>
    <li>Describe the problem and add a photo.</li>
    <li>Keep the reference number you are given.</li>
  </ol>
  <p class="org">${org}</p>
</div>
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 150); });</script>
</body></html>`;
}

/** Opens the sheet in a new window (the PWA may block popups: returns false so the caller can say so). */
export function openPrintWindow(html: string): boolean {
  const w = window.open('', '_blank', 'noopener,width=600,height=850');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
