/**
 * Branded PDF export for a Fortress report. Mirrors the layout of the source Excel
 * (header band, building compliance %, section X/N-A marks, recoveries, turnover,
 * incidents) and themes with the org primary colour — same pdfmake setup as
 * pdfGenerator.ts. Satisfies ingestion gate G5 (round-trip render).
 */
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { fdb, type ReportType } from '@/integrations/supabase/fortress-db';
import { formatPeriodLabel, formatZAR } from '@/lib/fortressReports';

pdfMake.vfs = pdfFonts.vfs;

export interface ReportBranding { name: string; primaryColor: string }

const MARK: Record<string, string> = { yes: 'X', no: '—', na: 'N/A' };

export async function generateReportPdf(reportId: string, branding: ReportBranding): Promise<void> {
  const color = /^#([a-f\d]{6})$/i.test(branding.primaryColor) ? branding.primaryColor : '#2563eb';
  const report = (await fdb.from('reports').select('*').eq('id', reportId).maybeSingle()).data;
  if (!report) throw new Error('report not found');

  const content: Content[] = [
    {
      columns: [
        { width: '*', text: branding.name, fontSize: 12, bold: true, color },
        { width: 'auto', stack: [
          { text: report.title ?? 'Report', fontSize: 10, bold: true, color, alignment: 'right' },
          { text: formatPeriodLabel(report.report_period), fontSize: 9, color: '#6b7280', alignment: 'right' },
        ] },
      ],
      margin: [0, 0, 0, 12],
    },
    { canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 4, color }], margin: [0, 0, 0, 14] },
  ];
  const managers = [report.asset_manager, report.ops_manager, report.centre_manager].filter(Boolean);
  if (managers.length) content.push({ text: managers.join('  ·  '), fontSize: 9, color: '#6b7280', margin: [0, 0, 0, 12] });

  const section = (t: string) => content.push({ text: t, fontSize: 13, bold: true, color: '#111827', margin: [0, 12, 0, 4] });

  if (report.report_type === ('ops_monthly' as ReportType)) {
    // Compliance
    const score = (await fdb.from('compliance_scores').select('compliance_pct').eq('report_id', reportId).maybeSingle()).data;
    section('OHS Act Compliance');
    content.push({ text: `Building Compliance: ${score?.compliance_pct ?? '—'}%`, fontSize: 16, bold: true, color, margin: [0, 0, 0, 6] });
    const asmt = (await fdb.from('compliance_assessments').select('id').eq('report_id', reportId).maybeSingle()).data;
    if (asmt) {
      const resp = (await fdb.from('compliance_responses')
        .select('response,comment,compliance_template_items(item_no,prompt)')
        .eq('assessment_id', asmt.id)).data as any[] ?? [];
      content.push(table(['Item', 'Prompt', 'Y/N/A', 'Comment'],
        resp.slice(0, 80).map((r) => [
          r.compliance_template_items?.item_no ?? '', r.compliance_template_items?.prompt ?? '',
          MARK[r.response] ?? '', r.comment ?? '',
        ]), ['auto', '*', 'auto', 'auto']));
    }
    // Recoveries
    const rec = (await fdb.from('expense_recoveries').select('service,ytd_expense,ytd_recovery,pct_recovery').eq('report_id', reportId)).data ?? [];
    if (rec.length) {
      section('Expense Recoveries');
      content.push(table(['Service', 'YTD Expense', 'YTD Recovery', '% Rec'],
        rec.map((r) => [r.service ?? '', formatZAR(r.ytd_expense), formatZAR(r.ytd_recovery), `${r.pct_recovery ?? '—'}%`]),
        ['*', 'auto', 'auto', 'auto']));
    }
  }

  if (report.report_type === ('cm_monthly' as ReportType)) {
    const turn = (await fdb.from('tenant_turnover').select('tenant_name,annual_trading_density,annual_growth_pct,rank_band').eq('report_id', reportId)).data ?? [];
    if (turn.length) {
      section('Tenant Turnover');
      content.push(table(['Tenant', 'Density (R/m²)', 'Growth %', 'Band'],
        turn.map((t) => [t.tenant_name ?? '', String(t.annual_trading_density ?? '—'),
          t.annual_growth_pct != null ? `${Math.round(Number(t.annual_growth_pct) * 1000) / 10}%` : '—', t.rank_band ?? '']),
        ['*', 'auto', 'auto', 'auto']));
    }
    const inc = (await fdb.from('security_incidents').select('incident_type,count,period').eq('report_id', reportId)).data ?? [];
    if (inc.length) {
      section('Security Incidents');
      const total = inc.reduce((a, i) => a + (i.count ?? 0), 0);
      content.push({ text: `Total incidents: ${total}`, fontSize: 10, margin: [0, 0, 0, 4] });
    }
  }

  const doc: TDocumentDefinitions = {
    pageMargins: [40, 40, 40, 50],
    content,
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    footer: (cur, total) => ({ text: `${cur} / ${total}`, alignment: 'center', fontSize: 8, color: '#9ca3af', margin: [0, 10, 0, 0] }),
  };
  pdfMake.createPdf(doc).download(`${(report.title ?? 'report').replace(/[^\w]+/g, '_')}.pdf`);
}

function table(headers: string[], rows: string[][], widths: (string | number)[]): Content {
  return {
    table: {
      headerRows: 1,
      widths,
      body: [
        headers.map((h) => ({ text: h, bold: true, fontSize: 8, fillColor: '#f3f4f6' })),
        ...rows.map((r) => r.map((c) => ({ text: String(c ?? ''), fontSize: 8 }))),
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 4, 0, 12],
  };
}
