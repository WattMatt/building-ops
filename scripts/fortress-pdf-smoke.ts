/**
 * Render-proof for the Fortress Annual PDF. Pulls the real AbaQulusi annual report
 * from prod (Management API), embeds the on-disk inspection photos, builds the doc
 * via the SAME buildReportDoc the app uses, and renders a real PDF with pdfmake's
 * node printer. Verification harness only — not app code. Run: npx vite-node scripts/fortress-pdf-smoke.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import pdfFonts from 'pdfmake/build/vfs_fonts';

const require = createRequire(import.meta.url);
const PrinterMod: any = require('pdfmake/js/Printer.js');
const PdfPrinter = PrinterMod.default ?? PrinterMod;
import { buildReportDoc, type ReportData } from '@/lib/fortressReportDoc';

const REF = 'qdzgkttiosahdfqresvz';
let tok = execSync('security find-generic-password -s "Supabase CLI" -w', { encoding: 'utf8' }).trim();
if (tok.startsWith('go-keyring-base64:')) tok = Buffer.from(tok.slice(18), 'base64').toString('utf8').trim();

async function q(sql: string): Promise<any[]> {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

const PHOTO_BASE = '/Users/spud/Documents/DEVELOPER/GMI/fortress/seed/annual_photos';
function localPhoto(p: string): string | null {
  const i = p.indexOf('/annual-2025/');
  if (i < 0) return null;
  const fp = path.join(PHOTO_BASE, p.slice(i + '/annual-2025/'.length));
  return fs.existsSync(fp) ? fp : null;
}

const ANNUAL = 'b42c47f6-f2fc-516a-a300-d9535d5fd96d';
const CAP = 30; // embed a representative subset for the proof artifact

async function main() {
  const rep = (await q(`SELECT title,report_period,report_type,asset_manager,ops_manager,centre_manager FROM reports WHERE id='${ANNUAL}'`))[0];
  const insp = (await q(`SELECT id,template_id FROM building_inspections WHERE report_id='${ANNUAL}'`))[0];
  const items = await q(`SELECT id,section_no,section_title,item_label,sort_order FROM inspection_template_items WHERE template_id='${insp.template_id}' ORDER BY sort_order`);
  const resps = await q(`SELECT template_item_id,condition_rating,recommendation,comment,capex_estimate,applicable,photo_urls FROM inspection_responses WHERE inspection_id='${insp.id}'`);
  const byItem = new Map(resps.map((r) => [r.template_item_id, r]));

  let embedded = 0, flagged = 0, capexTotal = 0;
  const sectionMap = new Map<string, any[]>();
  for (const it of items) {
    const r: any = byItem.get(it.id);
    const rating = r?.condition_rating ?? null;
    if (rating && ['poor', 'critical'].includes(rating)) flagged++;
    if (r?.capex_estimate) capexTotal += Number(r.capex_estimate);
    const refs: any[] = Array.isArray(r?.photo_urls) ? r.photo_urls : [];
    const photos: any[] = [];
    for (const ref of refs) {
      if (embedded >= CAP) break;
      const fp = localPhoto(ref.path);
      if (fp) { photos.push({ dataUrl: 'data:image/jpeg;base64,' + fs.readFileSync(fp).toString('base64'), caption: ref.caption ?? ref.ref ?? null }); embedded++; }
    }
    const title = it.section_title ?? 'Other';
    const arr = sectionMap.get(title) ?? [];
    arr.push({ label: it.item_label ?? '', rating, recommendation: r?.recommendation ?? null, comment: r?.comment ?? null, capexEstimate: r?.capex_estimate ?? null, applicable: r?.applicable ?? true, photos });
    sectionMap.set(title, arr);
  }

  const data: ReportData = {
    annualSections: [...sectionMap.entries()].map(([title, its]) => ({ title, items: its })),
    annualFlagged: flagged,
    annualCapexTotal: capexTotal || null,
    capex: [],
  };
  const doc = buildReportDoc(
    { title: rep.title, report_period: rep.report_period, report_type: rep.report_type, managers: [rep.asset_manager, rep.ops_manager, rep.centre_manager].filter(Boolean) },
    data,
    { color: '#1f4e79', orgName: 'GMI Operations' },
  );

  const vfs: Record<string, string> = (pdfFonts as any).vfs ?? (pdfFonts as any).pdfMake?.vfs ?? (pdfFonts as any);
  const F = (n: string) => Buffer.from(vfs[n], 'base64');
  const printer = new (PdfPrinter as any)({
    Roboto: { normal: F('Roboto-Regular.ttf'), bold: F('Roboto-Medium.ttf'), italics: F('Roboto-Italic.ttf'), bolditalics: F('Roboto-MediumItalic.ttf') },
  });
  const pdfDoc: any = await printer.createPdfKitDocument(doc as any);
  const out = '/Users/spud/Documents/DEVELOPER/GMI/fortress/build/abaqulusi_annual_TEST.pdf';
  const stream = typeof pdfDoc.pipe === 'function' ? pdfDoc : (typeof pdfDoc.getStream === 'function' ? pdfDoc.getStream() : null);
  if (stream) {
    await new Promise<void>((res, rej) => {
      const ws = fs.createWriteStream(out);
      stream.pipe(ws);
      stream.on('error', rej);
      ws.on('finish', () => res());
      stream.end();
    });
  } else if (typeof pdfDoc.getBuffer === 'function') {
    const buf: Buffer = await new Promise((res) => pdfDoc.getBuffer((b: Buffer) => res(b)));
    fs.writeFileSync(out, buf);
  } else {
    throw new Error('unknown pdfmake output API: ' + Object.getOwnPropertyNames(Object.getPrototypeOf(pdfDoc)).join(','));
  }
  console.log(`OK wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB) — sections=${data.annualSections!.length}, photosEmbedded=${embedded}, flagged=${flagged}, capexTotalR=${capexTotal}`);
}
main().catch((e) => { console.error('SMOKE FAIL:', e?.message || e); process.exit(1); });
