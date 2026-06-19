/**
 * Pure pdfmake document builder for Fortress reports. No pdfmake runtime, no DOM,
 * no network — `buildReportDoc(report, data, opts)` takes already-fetched data
 * (photos pre-embedded as data URLs) and returns a pdfmake document definition.
 * Kept separate from fortressReportPdf.ts so it is unit-testable and node-renderable.
 */
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { ReportType } from '@/integrations/supabase/fortress-db';
import { formatPeriodLabel, formatZAR } from '@/lib/fortressReports';

/** A photo already resolved to an embeddable data URL. */
export interface EmbeddedPhoto { dataUrl: string; caption?: string | null }

/** One condition-inspection line item, photos pre-embedded. */
export interface AnnualItem {
  label: string;
  rating?: string | null;
  recommendation?: string | null;
  comment?: string | null;
  capexEstimate?: number | null;
  applicable?: boolean | null;
  /** Per-archetype detail fields (catalogue order), non-empty only. */
  fields?: { label: string; value: string }[];
  photos: EmbeddedPhoto[];
}
export interface AnnualSection { title: string; items: AnnualItem[] }

/** Everything the doc builder needs, already fetched + photo-embedded. */
export interface ReportData {
  // ops
  compliancePct?: number | null;
  compliance?: { itemNo: string; prompt: string; mark: string; comment: string }[];
  recoveries?: { service: string; ytdExpense: number | null; ytdRecovery: number | null; pctRecovery: string }[];
  ppm?: { service: string; frequency: string | null; servicedMonths: string[] }[];
  // cm
  turnover?: { tenant: string; density: string; growth: string; band: string }[];
  incidentsTotal?: number | null;
  // annual
  annualSections?: AnnualSection[];
  annualFlagged?: number;
  annualCapexTotal?: number | null;
  capex?: { description: string; estimate: number | null }[];
  electricalCompliance?: { shop_number: string; tenant_name: string; coc_number: string; coc_type: string; coc_status: string; coc_issue_date: string; coc_expiry_date: string; certificate_url: string; certificate_name: string }[];
  // all types — section narratives (report_narratives), e.g. building overview,
  // loadshedding, maintenance/project items, centre security incidents commentary
  narratives?: { heading: string; body: string; statusFlag?: string | null }[];
}

export interface DocOptions { color: string; orgName: string; logoDataUrl?: string | null }

export const MARK: Record<string, string> = { yes: 'X', no: '—', na: 'N/A' };
const FLAGGED = new Set(['poor', 'critical']);
const PHOTOS_PER_ROW = 3;
const PHOTO_W = 150;

export function buildReportDoc(
  report: { title?: string | null; report_period?: string | null; report_type: ReportType; managers?: string[] },
  data: ReportData,
  opts: DocOptions,
): TDocumentDefinitions {
  const color = opts.color;
  const titleStack: Content = {
    width: 'auto',
    stack: [
      // Building names always display uppercase; the name is baked into the composed title.
      { text: (report.title ?? 'Report').toUpperCase(), fontSize: 10, bold: true, color, alignment: 'right' },
      { text: formatPeriodLabel(report.report_period ?? null), fontSize: 9, color: '#6b7280', alignment: 'right' },
    ],
  };
  const left: Content = opts.logoDataUrl
    ? { width: 'auto', image: opts.logoDataUrl, fit: [130, 40] }
    : { width: '*', text: opts.orgName, fontSize: 12, bold: true, color };
  const content: Content[] = [
    { columns: [left, titleStack], margin: [0, 0, 0, 8] },
    { canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 4, color }], margin: [0, 0, 0, 12] },
  ];
  // when a logo is shown, still print the org name as a small caption line under it
  if (opts.logoDataUrl) content.splice(1, 0, { text: opts.orgName, fontSize: 9, color: '#6b7280', margin: [0, 2, 0, 0] });
  if (report.managers && report.managers.length) {
    content.push({ text: report.managers.join('  ·  '), fontSize: 9, color: '#6b7280', margin: [0, 0, 0, 12] });
  }

  const section = (t: string) => content.push({ text: t, fontSize: 13, bold: true, color: '#111827', margin: [0, 12, 0, 4] });

  if (report.report_type === ('ops_monthly' as ReportType)) {
    section('OHS Act Compliance');
    content.push({ text: `Building Compliance: ${data.compliancePct ?? '—'}%`, fontSize: 16, bold: true, color, margin: [0, 0, 0, 6] });
    if (data.compliance && data.compliance.length) {
      content.push(table(['Item', 'Prompt', 'Y/N/A', 'Comment'],
        data.compliance.slice(0, 80).map((r) => [r.itemNo, r.prompt, r.mark, r.comment]),
        ['auto', '*', 'auto', 'auto']));
    }
    if (data.recoveries && data.recoveries.length) {
      section('Expense Recoveries');
      content.push(table(['Service', 'YTD Expense', 'YTD Recovery', '% Rec'],
        data.recoveries.map((r) => [r.service, formatZAR(r.ytdExpense), formatZAR(r.ytdRecovery), r.pctRecovery]),
        ['*', 'auto', 'auto', 'auto']));
    }
    if (data.ppm && data.ppm.length) {
      section('PPM Schedule');
      content.push(table(['Service', 'Frequency', 'Months serviced'],
        data.ppm.map((p) => [p.service, p.frequency ?? '—', p.servicedMonths.length ? p.servicedMonths.join(', ') : '—']),
        ['*', 'auto', '*']));
    }
  }

  if (report.report_type === ('cm_monthly' as ReportType)) {
    if (data.turnover && data.turnover.length) {
      section('Tenant Turnover');
      content.push(table(['Tenant', 'Density (R/m²)', 'Growth %', 'Band'],
        data.turnover.map((t) => [t.tenant, t.density, t.growth, t.band]),
        ['*', 'auto', 'auto', 'auto']));
    }
    if (data.incidentsTotal != null) {
      section('Security Incidents');
      content.push({ text: `Total incidents: ${data.incidentsTotal}`, fontSize: 10, margin: [0, 0, 0, 4] });
    }
  }

  if (report.report_type === ('annual_inspection' as ReportType)) {
    section('Condition Inspection');
    const summary: string[] = [];
    const sectionCount = data.annualSections?.length ?? 0;
    summary.push(`${sectionCount} section${sectionCount === 1 ? '' : 's'}`);
    if (data.annualFlagged != null) summary.push(`${data.annualFlagged} flagged (poor/critical)`);
    if (data.annualCapexTotal) summary.push(`Capex estimate: ${formatZAR(data.annualCapexTotal)}`);
    content.push({ text: summary.join('  ·  '), fontSize: 10, color: '#6b7280', margin: [0, 0, 0, 8] });

    for (const sec of data.annualSections ?? []) {
      content.push({ text: sec.title, fontSize: 11, bold: true, color, margin: [0, 8, 0, 4] });
      for (const it of sec.items) {
        if (it.applicable === false) {
          content.push({ text: `${it.label} — N/A`, fontSize: 9, color: '#9ca3af', margin: [0, 0, 0, 2] });
          continue;
        }
        const meta: string[] = [];
        if (it.rating) meta.push(`Condition: ${it.rating}`);
        if (it.capexEstimate) meta.push(`Capex: ${formatZAR(it.capexEstimate)}`);
        content.push({
          text: [{ text: it.label, bold: true }, meta.length ? `  (${meta.join(', ')})` : ''],
          fontSize: 9.5,
          color: it.rating && FLAGGED.has(it.rating) ? '#b91c1c' : '#111827',
          margin: [0, 2, 0, it.recommendation || it.comment || it.photos.length ? 1 : 4],
        });
        if (it.recommendation) content.push({ text: `Recommendation: ${it.recommendation}`, fontSize: 8.5, color: '#374151', margin: [8, 0, 0, 0] });
        if (it.comment) content.push({ text: it.comment, fontSize: 8.5, italics: true, color: '#6b7280', margin: [8, 0, 0, 0] });
        for (const f of it.fields ?? []) {
          if (!f.value) continue;
          content.push({ text: [{ text: `${f.label}: `, bold: true }, f.value], fontSize: 8.5, color: '#374151', margin: [8, 0, 0, 0] });
        }
        if (it.photos.length) content.push(...photoRows(it.photos));
      }
    }

    if (data.capex && data.capex.length) {
      section('Capex Register');
      content.push(table(['Description', 'Estimate'],
        data.capex.map((c) => [c.description, formatZAR(c.estimate)]),
        ['*', 'auto']));
    }

    if (data.electricalCompliance && data.electricalCompliance.length) {
      section('Electrical Compliance');
      content.push({ text: 'Live snapshot from insight-linker at generation time.', fontSize: 8, italics: true, color: '#6b7280', margin: [0, 0, 0, 4] });
      content.push({
        table: {
          headerRows: 1,
          widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto', '*'],
          body: [
            ['Shop', 'Tenant', 'COC #', 'Type', 'Status', 'Issued', 'Expires', 'Certificate'].map((h) => ({ text: h, bold: true, fontSize: 8, fillColor: '#f3f4f6' })),
            ...data.electricalCompliance.map((r) => [
              { text: r.shop_number || '', fontSize: 8 },
              { text: r.tenant_name || '', fontSize: 8 },
              { text: r.coc_number || '', fontSize: 8 },
              { text: r.coc_type || '', fontSize: 8 },
              { text: r.coc_status || '', fontSize: 8 },
              { text: r.coc_issue_date || '', fontSize: 8 },
              { text: r.coc_expiry_date || '', fontSize: 8 },
              r.certificate_url
                ? { text: r.certificate_name || 'View', link: r.certificate_url, fontSize: 8, color: '#2563eb', decoration: 'underline' }
                : { text: '—', fontSize: 8 },
            ]),
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 4, 0, 12],
      } as Content);
    }
  }

  // Section narratives (all report types) — building overview, loadshedding,
  // maintenance/project items, centre security incidents, etc.
  if (data.narratives && data.narratives.length) {
    section('Notes & Commentary');
    for (const n of data.narratives) {
      if (n.heading) content.push({ text: n.heading, fontSize: 11, bold: true, color, margin: [0, 8, 0, 2] });
      if (n.body) content.push({ text: n.body, fontSize: 9, color: '#374151', margin: [0, 0, 0, 4], preserveLeadingSpaces: true });
    }
  }

  return {
    pageMargins: [40, 40, 40, 50],
    content,
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    footer: (cur: number, total: number) => ({ text: `${cur} / ${total}`, alignment: 'center', fontSize: 8, color: '#9ca3af', margin: [0, 10, 0, 0] }),
  };
}

/** Chunk pre-embedded photos into rows of thumbnails with captions. */
function photoRows(photos: EmbeddedPhoto[]): Content[] {
  const rows: Content[] = [];
  for (let i = 0; i < photos.length; i += PHOTOS_PER_ROW) {
    const slice = photos.slice(i, i + PHOTOS_PER_ROW);
    rows.push({
      columns: slice.map((p) => ({
        width: 'auto',
        stack: [
          { image: p.dataUrl, fit: [PHOTO_W, PHOTO_W * 0.75] },
          ...(p.caption ? [{ text: p.caption, fontSize: 7, color: '#6b7280', width: PHOTO_W } as Content] : []),
        ],
      })),
      columnGap: 8,
      margin: [8, 4, 0, 8],
    });
  }
  return rows;
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
