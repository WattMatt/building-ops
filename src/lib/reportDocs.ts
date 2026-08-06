/**
 * Pure pdfmake document builders for the legacy report family (blank form,
 * filled form, H&S compliance, portfolio summary). No pdfmake runtime, no DOM,
 * no network — every builder takes already-fetched data (photos pre-embedded as
 * data URLs) and returns a pdfmake document definition. Mirrors the
 * `fortressReportDoc.ts` exemplar so the builders are unit-testable and
 * node-renderable. Fetch/embed/download stays in `pdfGenerator.ts`.
 */
import type {
  Content,
  CustomTableLayout,
  DynamicContent,
  StyleDictionary,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';
import { formatBuildingName } from '@/lib/buildingName';
import type { FormField } from './formFields';
import { assembleHsReportData, certificateStatus, type HsTask, type HsDocument } from './hsComplianceReport';
import { categoryMeta } from './compliance';
import { scoreBand, summarizePortfolio, type HsBuildingScore } from './hsScore';

export interface FormTemplateMeta {
  id: string;
  name: string;
  description: string;
  category: string;
}

export interface OrganizationBranding {
  name: string;
  logoUrl?: string | null;
  primaryColor: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export const FALLBACK_PRIMARY = '#2563eb';

/** Validated 6-digit hex or the app fallback blue. */
export function safePrimaryColor(hex: string): string {
  return /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.test(hex) ? hex : FALLBACK_PRIMARY;
}

/**
 * Repeating page header (standard C2): org name + report title on every page
 * EXCEPT page 1, which carries the cover-style inline header already.
 */
export function runningHeader(orgName: string, title: string): DynamicContent {
  return (currentPage: number) => {
    if (currentPage === 1) return undefined;
    return {
      columns: [
        { text: orgName, fontSize: 8, color: '#9ca3af', margin: [40, 14, 0, 0] },
        { text: title, fontSize: 8, color: '#9ca3af', alignment: 'right', margin: [0, 14, 40, 0] },
      ],
    };
  };
}

/** Standard "Page N of M" footer with a left-hand context label. */
function pageFooter(label: string): DynamicContent {
  return (currentPage: number, pageCount: number) => ({
    columns: [
      { text: label, style: 'footer', margin: [40, 20, 0, 0] },
      { text: `Page ${currentPage} of ${pageCount}`, style: 'footer', alignment: 'right', margin: [0, 20, 40, 0] },
    ],
  });
}

const DASHED_BOX_LAYOUT: CustomTableLayout = {
  hLineWidth: () => 1,
  vLineWidth: () => 1,
  hLineColor: () => '#d1d5db',
  vLineColor: () => '#d1d5db',
  hLineStyle: () => ({ dash: { length: 4, space: 2 } }),
  vLineStyle: () => ({ dash: { length: 4, space: 2 } }),
};

function coloredLine(color: string): Content {
  return {
    canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 4, color }],
    margin: [0, 0, 0, 15],
  };
}

function separatorLine(): Content {
  return {
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e5e7eb' }],
    margin: [0, 0, 0, 20],
  };
}

// ---------------------------------------------------------------------------
// Blank form
// ---------------------------------------------------------------------------

function blankFieldContent(field: FormField): Content {
  const requiredMark = field.required ? ' *' : '';

  if (field.type === 'signature') {
    return {
      stack: [
        { text: field.label + requiredMark, style: 'fieldLabel' },
        {
          table: {
            widths: ['*'],
            body: [[{ text: 'Signature', alignment: 'center', color: '#9ca3af', margin: [0, 25, 0, 25] }]],
          },
          layout: DASHED_BOX_LAYOUT,
        },
      ],
      margin: [0, 0, 0, 10],
    };
  }

  if (field.type === 'checkbox') {
    return {
      columns: [
        {
          width: 14,
          stack: [{ canvas: [{ type: 'rect', x: 0, y: 2, w: 12, h: 12, lineWidth: 1, lineColor: '#6b7280' }] }],
        },
        { text: field.label + requiredMark, style: 'checkboxLabel', margin: [4, 0, 0, 0] },
      ],
      margin: [0, 0, 0, 10],
    };
  }

  if (field.type === 'textarea') {
    return {
      stack: [
        { text: field.label + requiredMark, style: 'fieldLabel' },
        {
          table: { widths: ['*'], body: [[{ text: '', margin: [0, 40, 0, 0] }]] },
          layout: 'lightHorizontalLines',
        },
      ],
      margin: [0, 0, 0, 10],
    };
  }

  if (field.type === 'select' && field.options) {
    return {
      stack: [
        { text: field.label + requiredMark, style: 'fieldLabel' },
        { text: `Options: ${field.options.join(' | ')}`, style: 'selectOptions' },
        {
          table: { widths: ['*'], body: [[{ text: '', margin: [0, 8, 0, 0] }]] },
          layout: 'lightHorizontalLines',
        },
      ],
      margin: [0, 0, 0, 10],
    };
  }

  if (field.type === 'photo') {
    return {
      stack: [
        { text: field.label + requiredMark, style: 'fieldLabel' },
        {
          table: {
            widths: ['*'],
            body: [
              [
                {
                  text: `[Photo upload - max ${field.maxPhotos || 5} images]`,
                  alignment: 'center',
                  color: '#9ca3af',
                  margin: [0, 15, 0, 15],
                  italics: true,
                },
              ],
            ],
          },
          layout: DASHED_BOX_LAYOUT,
        },
      ],
      margin: [0, 0, 0, 10],
    };
  }

  // text, date, time fields
  const placeholder = field.type === 'date' ? 'DD / MM / YYYY' : field.type === 'time' ? 'HH : MM' : '';
  return {
    stack: [
      { text: field.label + requiredMark, style: 'fieldLabel' },
      {
        table: { widths: ['*'], body: [[{ text: placeholder, color: '#9ca3af', margin: [0, 6, 0, 6] }]] },
        layout: 'lightHorizontalLines',
      },
    ],
    margin: [0, 0, 0, 10],
  };
}

/** Lay fields out honouring half-width pairing. */
function blankFieldRows(fields: FormField[]): Content[] {
  const content: Content[] = [];
  let currentRow: Content[] = [];

  const flushRow = () => {
    if (currentRow.length > 0) {
      content.push({
        columns: currentRow.map((col) => (typeof col === 'object' && !Array.isArray(col) ? { ...col, width: '48%' } : col)),
        columnGap: 15,
      });
      currentRow = [];
    }
  };

  fields.forEach((field, index) => {
    const fieldContent = blankFieldContent(field);
    if (field.width === 'half') {
      currentRow.push(fieldContent);
      if (currentRow.length === 2 || index === fields.length - 1) flushRow();
    } else {
      flushRow();
      content.push(fieldContent);
    }
  });
  flushRow();

  return content;
}

export function buildBlankFormDoc(
  form: FormTemplateMeta,
  fields: FormField[],
  branding: OrganizationBranding,
  now: Date = new Date(),
): TDocumentDefinitions {
  const primaryColor = safePrimaryColor(branding.primaryColor);
  const today = now.toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' });

  const styles: StyleDictionary = {
    header: { fontSize: 22, bold: true, color: primaryColor, margin: [0, 0, 0, 5] },
    subheader: { fontSize: 11, color: '#6b7280', margin: [0, 0, 0, 5] },
    category: { fontSize: 10, bold: true, color: '#ffffff' },
    fieldLabel: { fontSize: 10, bold: true, color: '#374151', margin: [0, 0, 0, 4] },
    checkboxLabel: { fontSize: 10, color: '#374151' },
    selectOptions: { fontSize: 8, color: '#9ca3af', italics: true, margin: [0, 0, 0, 4] },
    orgName: { fontSize: 12, bold: true, color: primaryColor },
    footer: { fontSize: 8, color: '#9ca3af' },
  };

  const headerContent: Content[] = [
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: branding.name, style: 'orgName' },
            ...(branding.address ? [{ text: branding.address, fontSize: 8, color: '#6b7280' } satisfies Content] : []),
            ...(branding.phone || branding.email
              ? [
                  {
                    text: [branding.phone, branding.email].filter(Boolean).join(' | '),
                    fontSize: 8,
                    color: '#6b7280',
                  } satisfies Content,
                ]
              : []),
          ],
        },
        { width: 'auto', text: today, fontSize: 9, color: '#6b7280', alignment: 'right' },
      ],
      margin: [0, 0, 0, 15],
    },
    coloredLine(primaryColor),
    { text: form.name, style: 'header', alignment: 'center' },
    { text: form.description, style: 'subheader', alignment: 'center' },
    {
      table: { body: [[{ text: form.category, style: 'category', fillColor: primaryColor, margin: [8, 4, 8, 4] }]] },
      layout: 'noBorders',
      alignment: 'center',
      margin: [0, 10, 0, 20],
    },
    separatorLine(),
  ];

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 60],
    content: [...headerContent, ...blankFieldRows(fields)],
    styles,
    header: runningHeader(branding.name, form.name),
    footer: pageFooter(`${branding.name} - ${form.name}`),
    defaultStyle: { font: 'Roboto' },
  };
}

// ---------------------------------------------------------------------------
// Filled form (submission)
// ---------------------------------------------------------------------------

function filledFieldValue(field: FormField, value: unknown): string {
  if (field.type === 'checkbox') return value ? '✓ Yes' : '✗ No';
  if (field.type === 'signature') return value ? '✓ Digitally Signed' : 'Not signed';
  if (field.type === 'photo') {
    const photoUrls = Array.isArray(value) ? value : [];
    return photoUrls.length > 0 ? `${photoUrls.length} photo(s) attached` : 'No photos attached';
  }
  return (value != null && String(value)) || '-';
}

export function buildFilledFormDoc(
  form: FormTemplateMeta,
  fields: FormField[],
  formData: Record<string, unknown>,
  branding: OrganizationBranding,
  submittedBy: string,
  submittedAt: Date,
): TDocumentDefinitions {
  const primaryColor = safePrimaryColor(branding.primaryColor);
  const submissionDate = submittedAt.toLocaleDateString('en-ZA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const styles: StyleDictionary = {
    header: { fontSize: 22, bold: true, color: primaryColor, margin: [0, 0, 0, 5] },
    fieldLabel: { fontSize: 9, bold: true, color: '#6b7280', margin: [0, 0, 0, 2] },
    fieldValue: { fontSize: 11, color: '#111827' },
    orgName: { fontSize: 12, bold: true, color: primaryColor },
    footer: { fontSize: 8, color: '#9ca3af' },
    submissionInfo: { fontSize: 9, color: '#6b7280', italics: true },
  };

  const tableBody: TableCell[][] = fields.map((field) => [
    { text: field.label, style: 'fieldLabel', border: [false, false, false, true] },
    { text: filledFieldValue(field, formData[field.label]), style: 'fieldValue', border: [false, false, false, true] },
  ]);

  const content: Content[] = [
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: branding.name, style: 'orgName' },
            ...(branding.address ? [{ text: branding.address, fontSize: 8, color: '#6b7280' } satisfies Content] : []),
          ],
        },
        {
          width: 'auto',
          stack: [
            { text: 'SUBMITTED FORM', fontSize: 10, bold: true, color: primaryColor, alignment: 'right' },
            { text: submissionDate, fontSize: 9, color: '#6b7280', alignment: 'right' },
          ],
        },
      ],
      margin: [0, 0, 0, 15],
    },
    coloredLine(primaryColor),
    { text: form.name, style: 'header', alignment: 'center' },
    { text: `Submitted by: ${submittedBy}`, style: 'submissionInfo', alignment: 'center', margin: [0, 5, 0, 20] },
    separatorLine(),
    {
      table: { widths: ['35%', '*'], body: tableBody },
      layout: {
        hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
        vLineWidth: () => 0,
        hLineColor: () => '#e5e7eb',
        paddingTop: () => 8,
        paddingBottom: () => 8,
      },
    },
  ];

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 60],
    content,
    styles,
    header: runningHeader(branding.name, `${form.name} — Submission`),
    footer: pageFooter(`${branding.name} - ${form.name}`),
    defaultStyle: { font: 'Roboto' },
  };
}

// ---------------------------------------------------------------------------
// H&S compliance report
// ---------------------------------------------------------------------------

const CERT_STATUS_LABEL: Record<string, { text: string; color: string }> = {
  expired: { text: 'EXPIRED', color: '#dc2626' },
  expiring_soon: { text: 'Expiring soon', color: '#d97706' },
  current: { text: 'Current', color: '#16a34a' },
  no_expiry: { text: 'No expiry recorded', color: '#6b7280' },
};

export const HS_EMPTY_COMPLETED_COPY = 'No completed H&S checks in this period.';

function categoryLabel(cat: string): string {
  return categoryMeta(cat)?.label ?? (cat === 'uncategorised' ? 'Uncategorised' : cat);
}

export interface HsComplianceDocOptions {
  buildingName: string;
  rangeStart: string; // yyyy-MM-dd
  rangeEnd: string;
  tasks: HsTask[];
  documents: HsDocument[];
  photoDataUrls: Record<string, string[]>; // task id -> thumbnail dataURLs
  branding: OrganizationBranding;
  /** Injectable clock so builders stay pure/deterministic in tests. */
  now?: Date;
}

export function buildHsComplianceDoc(opts: HsComplianceDocOptions): TDocumentDefinitions {
  const { buildingName, rangeStart, rangeEnd, tasks, documents, photoDataUrls, branding } = opts;
  const primaryColor = safePrimaryColor(branding.primaryColor);
  const today = opts.now ?? new Date();
  const data = assembleHsReportData(tasks, documents, today);
  const reportTitle = `H&S Compliance Report — ${formatBuildingName(buildingName)}`;

  const content: Content[] = [];

  content.push({
    columns: [
      { width: '*', stack: [{ text: branding.name, style: 'orgName' }] },
      {
        width: 'auto',
        stack: [
          { text: 'H&S COMPLIANCE REPORT', fontSize: 10, bold: true, color: primaryColor, alignment: 'right' },
          { text: `${rangeStart} to ${rangeEnd}`, fontSize: 9, color: '#6b7280', alignment: 'right' },
          { text: `Generated ${today.toLocaleDateString('en-ZA')}`, fontSize: 8, color: '#9ca3af', alignment: 'right' },
        ],
      },
    ],
    margin: [0, 0, 0, 15],
  });
  content.push(coloredLine(primaryColor));
  content.push({ text: formatBuildingName(buildingName), style: 'header', alignment: 'center', margin: [0, 0, 0, 20] });

  // 1. Summary by compliance category
  content.push({ text: '1. Compliance Summary', style: 'sectionTitle' });
  content.push({
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto', 'auto'],
      body: [
        ['Category', 'Completed', 'Outstanding', 'Overdue'].map((h): TableCell => ({ text: h, bold: true, fontSize: 9 })),
        ...data.summary.map((s): TableCell[] => [
          { text: categoryLabel(s.category), fontSize: 9 },
          { text: String(s.completed), fontSize: 9, alignment: 'center' },
          { text: String(s.outstanding), fontSize: 9, alignment: 'center' },
          { text: String(s.overdue), fontSize: 9, alignment: 'center', color: s.overdue > 0 ? '#dc2626' : '#111827' },
        ]),
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 5, 0, 20],
  });

  // 2. Completed tasks with evidence
  content.push({ text: '2. Completed Checks (evidence)', style: 'sectionTitle' });
  if (data.completedTasks.length === 0) {
    content.push({ text: HS_EMPTY_COMPLETED_COPY, fontSize: 9, italics: true, color: '#6b7280', margin: [0, 5, 0, 20] });
  } else {
    const body: TableCell[][] = [
      ['Check', 'Category', 'Completed', 'By', 'Evidence'].map((h): TableCell => ({ text: h, bold: true, fontSize: 9 })),
    ];
    for (const t of data.completedTasks) {
      const photos = photoDataUrls[t.id] ?? [];
      const evidence: Content[] = [];
      if (photos.length > 0) {
        evidence.push({ columns: photos.map((p) => ({ image: p, fit: [60, 45], margin: [0, 0, 4, 0] })) });
      }
      const extraPhotos = (t.photo_urls?.length ?? 0) - photos.length;
      evidence.push({
        text: [
          t.photo_urls?.length
            ? `${t.photo_urls.length} photo(s) on file${extraPhotos > 0 ? ` (${extraPhotos} not shown)` : ''}`
            : 'No photos',
          t.signature_confirmed ? ' · signed' : '',
        ].join(''),
        fontSize: 7,
        color: '#6b7280',
      });
      body.push([
        {
          stack: [
            { text: t.task_name, fontSize: 9 },
            ...(t.completion_notes ? [{ text: t.completion_notes, fontSize: 7, color: '#6b7280' } satisfies Content] : []),
          ],
        },
        { text: categoryLabel(t.category ?? 'uncategorised'), fontSize: 8 },
        { text: t.completed_at ? new Date(t.completed_at).toLocaleDateString('en-ZA') : '-', fontSize: 8 },
        { text: t.completed_by_name ?? '-', fontSize: 8 },
        { stack: evidence },
      ]);
    }
    content.push({
      table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 140], body },
      layout: 'lightHorizontalLines',
      margin: [0, 5, 0, 20],
    });
  }

  // 3. Outstanding & overdue
  content.push({ text: '3. Outstanding & Overdue Items', style: 'sectionTitle' });
  if (data.outstandingTasks.length === 0) {
    content.push({ text: 'Nothing outstanding in this period.', fontSize: 9, italics: true, color: '#16a34a', margin: [0, 5, 0, 20] });
  } else {
    const todayStr = today.toISOString().slice(0, 10);
    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 'auto', 'auto', 'auto'],
        body: [
          ['Check', 'Category', 'Due', 'Status'].map((h): TableCell => ({ text: h, bold: true, fontSize: 9 })),
          ...data.outstandingTasks.map((t): TableCell[] => [
            { text: t.task_name, fontSize: 9 },
            { text: categoryLabel(t.category ?? 'uncategorised'), fontSize: 8 },
            { text: t.due_date, fontSize: 8 },
            t.due_date < todayStr
              ? { text: 'OVERDUE', fontSize: 8, bold: true, color: '#dc2626' }
              : { text: 'Pending', fontSize: 8, color: '#6b7280' },
          ]),
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 5, 0, 20],
    });
  }

  // 4. Statutory certificate register
  content.push({ text: '4. Statutory Certificate Register', style: 'sectionTitle' });
  if (documents.length === 0) {
    content.push({ text: 'No documents on file for this building.', fontSize: 9, italics: true, color: '#dc2626', margin: [0, 5, 0, 10] });
  } else {
    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 'auto', 'auto', 'auto', 'auto'],
        body: [
          ['Document', 'Type', 'Authority', 'Expiry', 'Status'].map((h): TableCell => ({ text: h, bold: true, fontSize: 9 })),
          ...documents.map((d): TableCell[] => {
            const cs = certificateStatus(d, today);
            const label = CERT_STATUS_LABEL[cs.status];
            return [
              { text: d.name, fontSize: 9 },
              { text: d.document_type.replace(/_/g, ' '), fontSize: 8 },
              { text: d.issuing_authority ?? '-', fontSize: 8 },
              { text: d.expiry_date ?? '-', fontSize: 8 },
              {
                text: cs.daysRemaining !== null && cs.status !== 'expired' ? `${label.text} (${cs.daysRemaining}d)` : label.text,
                fontSize: 8,
                bold: cs.status === 'expired',
                color: label.color,
              },
            ];
          }),
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 5, 0, 10],
    });
  }

  content.push({
    text: 'Generated from Building Ops checklist completion records and the building document register. Photo evidence is retained in the system of record.',
    fontSize: 7,
    color: '#9ca3af',
    margin: [0, 10, 0, 0],
  });

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 60],
    content,
    styles: {
      header: { fontSize: 20, bold: true, color: primaryColor },
      orgName: { fontSize: 12, bold: true, color: primaryColor },
      sectionTitle: { fontSize: 13, bold: true, color: '#111827', margin: [0, 10, 0, 4] },
      footer: { fontSize: 8, color: '#9ca3af' },
    },
    header: runningHeader(branding.name, reportTitle),
    footer: pageFooter(`${branding.name} — ${reportTitle}`),
    defaultStyle: { font: 'Roboto' },
  };
}

// ---------------------------------------------------------------------------
// Portfolio compliance summary
// ---------------------------------------------------------------------------

export interface PortfolioSummaryDocOptions {
  rows: HsBuildingScore[];
  generatedAt: string; // yyyy-MM-dd
  branding: OrganizationBranding;
}

export function buildPortfolioSummaryDoc(opts: PortfolioSummaryDocOptions): TDocumentDefinitions {
  const { rows, generatedAt, branding } = opts;
  const s = summarizePortfolio(rows);
  const statusLabel: Record<string, string> = { good: 'Good', warning: 'Watch', critical: 'Critical', none: 'No checks' };
  const reportTitle = 'Portfolio Compliance Summary';

  const headerRow: TableCell[] = ['Building', 'Done / Total', 'Score', 'Status', 'Cert'].map(
    (t): TableCell => ({ text: t, style: 'th' }),
  );
  const dataRows: TableCell[][] = rows.map((r): TableCell[] => [
    { text: r.name },
    { text: `${r.completed} / ${r.total}` },
    { text: r.score === null ? 'N/A' : `${r.score}%` },
    { text: statusLabel[scoreBand(r.score)] },
    { text: r.hasExpiredCert ? 'EXPIRED' : 'OK' },
  ]);

  return {
    pageMargins: [40, 50, 40, 40],
    content: [
      { text: branding.name, style: 'org' },
      { text: reportTitle, style: 'title' },
      { text: `Generated ${generatedAt}`, style: 'meta' },
      {
        text: `${s.total} buildings · ${s.avgScore === null ? 'no scored buildings' : `portfolio average ${s.avgScore}%`} · ${s.good} good, ${s.warning} warning, ${s.critical} critical, ${s.none} no data · ${s.expiredCerts} with an expired certificate`,
        style: 'summary',
      },
      {
        margin: [0, 12, 0, 0],
        layout: 'lightHorizontalLines',
        table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto'], body: [headerRow, ...dataRows] },
      },
    ],
    styles: {
      org: { color: branding.primaryColor, bold: true, fontSize: 12, margin: [0, 0, 0, 2] },
      title: { fontSize: 20, bold: true, margin: [0, 0, 0, 2] },
      meta: { color: '#6b7280', fontSize: 10, margin: [0, 0, 0, 8] },
      summary: { fontSize: 11, margin: [0, 0, 0, 4] },
      th: { bold: true, fontSize: 10, color: branding.primaryColor },
      footer: { fontSize: 8, color: '#9ca3af' },
    },
    header: runningHeader(branding.name, reportTitle),
    footer: pageFooter(`${branding.name} — ${reportTitle}`),
    defaultStyle: { font: 'Roboto', fontSize: 10 },
  };
}
