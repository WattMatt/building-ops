/** Throwaway: render EVERY June-2026 CM report at HEAD and measure page geometry. */
import fs from 'node:fs';
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
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const t = await r.text(); if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0,200)}`); return JSON.parse(t);
}
const vfs: any = (pdfFonts as any).vfs ?? (pdfFonts as any).pdfMake?.vfs ?? pdfFonts;
const F = (n: string) => Buffer.from(vfs[n], 'base64');
const printer = new (PdfPrinter as any)({ Roboto: { normal: F('Roboto-Regular.ttf'), bold: F('Roboto-Medium.ttf'), italics: F('Roboto-Italic.ttf'), bolditalics: F('Roboto-MediumItalic.ttf') } });
async function main() {
  const org = (await q(`SELECT name, primary_color FROM organizations LIMIT 1`))[0] ?? {};
  const reps = await q(`SELECT id,title,report_period,report_type,building_id FROM reports WHERE report_type='cm_monthly' AND report_period='2026-06-01' ORDER BY title`);
  fs.mkdirSync('/tmp/cmbatch2', { recursive: true });
  for (const rep of reps) {
    const tenants = await q(`SELECT id,shop_number,name,area FROM building_tenants WHERE building_id='${rep.building_id}'`);
    const byId = new Map(tenants.map((t: any) => [t.id, t]));
    const tc = await q(`SELECT tenant_id,occupancy_cert_no,electrical_coc_cert_no,electrical_coc_date,hvac_records_current,fire_sprinkler_annual,smoke_detection_annual_service,evac_plan_displayed FROM tenant_compliance WHERE report_id='${rep.id}'`);
    const ss = await q(`SELECT tenant_id,db_phase,actual_amps,generator_connection,hvac_units,lighting_type FROM tenant_shop_spec WHERE building_id='${rep.building_id}' AND is_current=true`);
    const sortByShop = <T extends { shop: string }>(rows: T[]) => rows.sort((a,b)=>a.shop.localeCompare(b.shop,undefined,{numeric:true}));
    const data: ReportData = {
      tenantCompliance: tc.length ? sortByShop(tc.map((r:any)=>{const t:any=byId.get(r.tenant_id);return{shop:t?.shop_number??'',tenant:t?.name??'',gla:t?.area==null?null:Number(t.area),occupancyCert:r.occupancy_cert_no??null,cocNumber:r.electrical_coc_cert_no??null,cocDate:r.electrical_coc_date??null,hvacRecords:r.hvac_records_current??null,sprinkler:r.fire_sprinkler_annual??null,smokeDetection:r.smoke_detection_annual_service??null,evacPlan:r.evac_plan_displayed??null};})) : undefined,
      shopSpec: ss.length ? sortByShop(ss.map((r:any)=>{const t:any=byId.get(r.tenant_id);return{shop:t?.shop_number??'',tenant:t?.name??'',phase:r.db_phase??null,actualAmps:r.actual_amps??null,generator:r.generator_connection??null,hvac:r.hvac_units??null,lighting:r.lighting_type??null};})) : undefined,
    };
    const doc = buildReportDoc({ title: rep.title, report_period: rep.report_period, report_type: rep.report_type, managers: [] }, data, { color: (org as any).primary_color ?? '#1f4e79', orgName: (org as any).name ?? '' });
    const pdfDoc: any = await printer.createPdfKitDocument(doc as any);
    const out = `/tmp/cmbatch2/${rep.id}.pdf`;
    await new Promise<void>((res,rej)=>{const ws=fs.createWriteStream(out);pdfDoc.pipe(ws);pdfDoc.on('error',rej);ws.on('finish',()=>res());pdfDoc.end();});
    console.log(`${rep.id}\t${tc.length}\t${ss.length}\t${rep.title}`);
  }
}
main().catch((e)=>{console.error('FAIL:',e?.message||e);process.exit(1);});
