import pdfMake from 'pdfmake/build/pdfmake';
import { formatBuildingName } from '@/lib/buildingName';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { FormField } from './formFields';
import { assembleHsReportData, certificateStatus, type HsTask, type HsDocument } from './hsComplianceReport';
import { categoryMeta } from './compliance';
import { scoreBand, summarizePortfolio, type HsBuildingScore } from './hsScore';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

// Initialize pdfMake with fonts
pdfMake.vfs = pdfFonts.vfs;

interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface OrganizationBranding {
  name: string;
  logoUrl?: string | null;
  primaryColor: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

// Convert hex color to RGB for pdfMake
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? hex : '#2563eb';
}

// Create a colored header line
function createColoredLine(color: string): any {
  return {
    canvas: [
      {
        type: 'rect',
        x: 0,
        y: 0,
        w: 515,
        h: 4,
        color: color,
      },
    ],
    margin: [0, 0, 0, 15],
  };
}

// Generate form field content for PDF
function generateFieldContent(fields: FormField[], primaryColor: string): any[] {
  const content: any[] = [];
  let currentRow: any[] = [];

  fields.forEach((field, index) => {
    const isHalf = field.width === 'half';
    const requiredMark = field.required ? ' *' : '';

    let fieldContent: any;

    if (field.type === 'signature') {
      fieldContent = {
        stack: [
          { text: field.label + requiredMark, style: 'fieldLabel' },
          {
            table: {
              widths: ['*'],
              body: [
                [
                  {
                    text: 'Signature',
                    alignment: 'center',
                    color: '#9ca3af',
                    margin: [0, 25, 0, 25],
                  },
                ],
              ],
            },
            layout: {
              hLineWidth: () => 1,
              vLineWidth: () => 1,
              hLineColor: () => '#d1d5db',
              vLineColor: () => '#d1d5db',
              hLineStyle: () => ({ dash: { length: 4, space: 2 } }),
              vLineStyle: () => ({ dash: { length: 4, space: 2 } }),
            },
          },
        ],
        margin: [0, 0, 0, 10],
      };
    } else if (field.type === 'checkbox') {
      fieldContent = {
        columns: [
          {
            width: 14,
            stack: [
              {
                canvas: [
                  {
                    type: 'rect',
                    x: 0,
                    y: 2,
                    w: 12,
                    h: 12,
                    lineWidth: 1,
                    lineColor: '#6b7280',
                  },
                ],
              },
            ],
          },
          {
            text: field.label + requiredMark,
            style: 'checkboxLabel',
            margin: [4, 0, 0, 0],
          },
        ],
        margin: [0, 0, 0, 10],
      };
    } else if (field.type === 'textarea') {
      fieldContent = {
        stack: [
          { text: field.label + requiredMark, style: 'fieldLabel' },
          {
            table: {
              widths: ['*'],
              body: [[{ text: '', margin: [0, 40, 0, 0] }]],
            },
            layout: 'lightHorizontalLines',
          },
        ],
        margin: [0, 0, 0, 10],
      };
    } else if (field.type === 'select' && field.options) {
      fieldContent = {
        stack: [
          { text: field.label + requiredMark, style: 'fieldLabel' },
          {
            text: `Options: ${field.options.join(' | ')}`,
            style: 'selectOptions',
          },
          {
            table: {
              widths: ['*'],
              body: [[{ text: '', margin: [0, 8, 0, 0] }]],
            },
            layout: 'lightHorizontalLines',
          },
        ],
        margin: [0, 0, 0, 10],
      };
    } else if (field.type === 'photo') {
      fieldContent = {
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
            layout: {
              hLineWidth: () => 1,
              vLineWidth: () => 1,
              hLineColor: () => '#d1d5db',
              vLineColor: () => '#d1d5db',
              hLineStyle: () => ({ dash: { length: 4, space: 2 } }),
              vLineStyle: () => ({ dash: { length: 4, space: 2 } }),
            },
          },
        ],
        margin: [0, 0, 0, 10],
      };
    } else {
      // text, date, time fields
      const placeholder = field.type === 'date' ? 'DD / MM / YYYY' : field.type === 'time' ? 'HH : MM' : '';
      fieldContent = {
        stack: [
          { text: field.label + requiredMark, style: 'fieldLabel' },
          {
            table: {
              widths: ['*'],
              body: [
                [
                  {
                    text: placeholder,
                    color: '#9ca3af',
                    margin: [0, 6, 0, 6],
                  },
                ],
              ],
            },
            layout: 'lightHorizontalLines',
          },
        ],
        margin: [0, 0, 0, 10],
      };
    }

    if (isHalf) {
      currentRow.push(fieldContent);
      if (currentRow.length === 2 || index === fields.length - 1) {
        content.push({
          columns: currentRow.map((col) => ({ ...col, width: '48%' })),
          columnGap: 15,
        });
        currentRow = [];
      }
    } else {
      if (currentRow.length > 0) {
        content.push({
          columns: currentRow.map((col) => ({ ...col, width: '48%' })),
          columnGap: 15,
        });
        currentRow = [];
      }
      content.push(fieldContent);
    }
  });

  // Handle any remaining half-width fields
  if (currentRow.length > 0) {
    content.push({
      columns: currentRow.map((col) => ({ ...col, width: '48%' })),
      columnGap: 15,
    });
  }

  return content;
}

export async function generateFormPdf(
  form: FormTemplate,
  fields: FormField[],
  branding: OrganizationBranding
): Promise<void> {
  const primaryColor = hexToRgb(branding.primaryColor);
  const today = new Date().toLocaleDateString('en-ZA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const styles: any = {
    header: {
      fontSize: 22,
      bold: true,
      color: primaryColor,
      margin: [0, 0, 0, 5],
    },
    subheader: {
      fontSize: 11,
      color: '#6b7280',
      margin: [0, 0, 0, 5],
    },
    category: {
      fontSize: 10,
      bold: true,
      color: '#ffffff',
    },
    fieldLabel: {
      fontSize: 10,
      bold: true,
      color: '#374151',
      margin: [0, 0, 0, 4],
    },
    checkboxLabel: {
      fontSize: 10,
      color: '#374151',
    },
    selectOptions: {
      fontSize: 8,
      color: '#9ca3af',
      italics: true,
      margin: [0, 0, 0, 4],
    },
    orgName: {
      fontSize: 12,
      bold: true,
      color: primaryColor,
    },
    footer: {
      fontSize: 8,
      color: '#9ca3af',
    },
  };

  // Build header content
  const headerContent: any[] = [];

  // Organization info in header
  headerContent.push({
    columns: [
      {
        width: '*',
        stack: [
          { text: branding.name, style: 'orgName' },
          ...(branding.address ? [{ text: branding.address, fontSize: 8, color: '#6b7280' }] : []),
          ...(branding.phone || branding.email
            ? [
                {
                  text: [branding.phone, branding.email].filter(Boolean).join(' | '),
                  fontSize: 8,
                  color: '#6b7280',
                },
              ]
            : []),
        ],
      },
      {
        width: 'auto',
        text: today,
        fontSize: 9,
        color: '#6b7280',
        alignment: 'right',
      },
    ],
    margin: [0, 0, 0, 15],
  });

  // Colored line
  headerContent.push(createColoredLine(primaryColor));

  // Form title and description
  headerContent.push({
    text: form.name,
    style: 'header',
    alignment: 'center',
  });

  headerContent.push({
    text: form.description,
    style: 'subheader',
    alignment: 'center',
  });

  // Category badge
  headerContent.push({
    table: {
      body: [
        [
          {
            text: form.category,
            style: 'category',
            fillColor: primaryColor,
            margin: [8, 4, 8, 4],
          },
        ],
      ],
    },
    layout: 'noBorders',
    alignment: 'center',
    margin: [0, 10, 0, 20],
  });

  // Separator line
  headerContent.push({
    canvas: [
      {
        type: 'line',
        x1: 0,
        y1: 0,
        x2: 515,
        y2: 0,
        lineWidth: 0.5,
        lineColor: '#e5e7eb',
      },
    ],
    margin: [0, 0, 0, 20],
  });

  // Generate field content
  const fieldContent = generateFieldContent(fields, primaryColor);

  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 60],
    content: [...headerContent, ...fieldContent],
    styles,
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          text: `${branding.name} - ${form.name}`,
          style: 'footer',
          margin: [40, 20, 0, 0],
        },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          style: 'footer',
          alignment: 'right',
          margin: [0, 20, 40, 0],
        },
      ],
    }),
    defaultStyle: {
      font: 'Roboto',
    },
  };

  // Generate and download
  pdfMake.createPdf(docDefinition).download(`${form.name.replace(/\s+/g, '_')}.pdf`);
}

// Generate filled form PDF with data
export async function generateFilledFormPdf(
  form: FormTemplate,
  fields: FormField[],
  formData: Record<string, any>,
  branding: OrganizationBranding,
  submittedBy: string,
  submittedAt: Date
): Promise<void> {
  const primaryColor = hexToRgb(branding.primaryColor);
  const submissionDate = submittedAt.toLocaleDateString('en-ZA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const styles: any = {
    header: {
      fontSize: 22,
      bold: true,
      color: primaryColor,
      margin: [0, 0, 0, 5],
    },
    subheader: {
      fontSize: 11,
      color: '#6b7280',
      margin: [0, 0, 0, 5],
    },
    category: {
      fontSize: 10,
      bold: true,
      color: '#ffffff',
    },
    fieldLabel: {
      fontSize: 9,
      bold: true,
      color: '#6b7280',
      margin: [0, 0, 0, 2],
    },
    fieldValue: {
      fontSize: 11,
      color: '#111827',
    },
    orgName: {
      fontSize: 12,
      bold: true,
      color: primaryColor,
    },
    footer: {
      fontSize: 8,
      color: '#9ca3af',
    },
    submissionInfo: {
      fontSize: 9,
      color: '#6b7280',
      italics: true,
    },
  };

  // Build content
  const content: any[] = [];

  // Organization header
  content.push({
    columns: [
      {
        width: '*',
        stack: [
          { text: branding.name, style: 'orgName' },
          ...(branding.address ? [{ text: branding.address, fontSize: 8, color: '#6b7280' }] : []),
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
  });

  content.push(createColoredLine(primaryColor));

  // Form title
  content.push({
    text: form.name,
    style: 'header',
    alignment: 'center',
  });

  content.push({
    text: `Submitted by: ${submittedBy}`,
    style: 'submissionInfo',
    alignment: 'center',
    margin: [0, 5, 0, 20],
  });

  // Separator
  content.push({
    canvas: [
      {
        type: 'line',
        x1: 0,
        y1: 0,
        x2: 515,
        y2: 0,
        lineWidth: 0.5,
        lineColor: '#e5e7eb',
      },
    ],
    margin: [0, 0, 0, 20],
  });

  // Form data in a clean table format
  const tableBody: any[][] = [];

  fields.forEach((field) => {
    const value = formData[field.label];
    let displayValue = '';

    if (field.type === 'checkbox') {
      displayValue = value ? '✓ Yes' : '✗ No';
    } else if (field.type === 'signature') {
      displayValue = value ? '✓ Digitally Signed' : 'Not signed';
    } else if (field.type === 'photo') {
      const photoUrls = Array.isArray(value) ? value : [];
      displayValue = photoUrls.length > 0 
        ? `${photoUrls.length} photo(s) attached` 
        : 'No photos attached';
    } else {
      displayValue = value?.toString() || '-';
    }

    tableBody.push([
      { text: field.label, style: 'fieldLabel', border: [false, false, false, true] },
      { text: displayValue, style: 'fieldValue', border: [false, false, false, true] },
    ]);
  });

  content.push({
    table: {
      widths: ['35%', '*'],
      body: tableBody,
    },
    layout: {
      hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
      vLineWidth: () => 0,
      hLineColor: () => '#e5e7eb',
      paddingTop: () => 8,
      paddingBottom: () => 8,
    },
  });

  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 60],
    content,
    styles,
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          text: `${branding.name} - ${form.name}`,
          style: 'footer',
          margin: [40, 20, 0, 0],
        },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          style: 'footer',
          alignment: 'right',
          margin: [0, 20, 40, 0],
        },
      ],
    }),
    defaultStyle: {
      font: 'Roboto',
    },
  };

  pdfMake.createPdf(docDefinition).download(`${form.name.replace(/\s+/g, '_')}_Submission.pdf`);
}

// ===== H&S Compliance Report =====

const CERT_STATUS_LABEL: Record<string, { text: string; color: string }> = {
  expired: { text: 'EXPIRED', color: '#dc2626' },
  expiring_soon: { text: 'Expiring soon', color: '#d97706' },
  current: { text: 'Current', color: '#16a34a' },
  no_expiry: { text: 'No expiry recorded', color: '#6b7280' },
};

function categoryLabel(cat: string): string {
  return categoryMeta(cat)?.label ?? (cat === 'uncategorised' ? 'Uncategorised' : cat);
}

export async function generateHsCompliancePdf(opts: {
  buildingName: string;
  rangeStart: string; // yyyy-MM-dd
  rangeEnd: string;
  tasks: HsTask[];
  documents: HsDocument[];
  photoDataUrls: Record<string, string[]>; // task id -> thumbnail dataURLs
  branding: OrganizationBranding;
}): Promise<void> {
  const { buildingName, rangeStart, rangeEnd, tasks, documents, photoDataUrls, branding } = opts;
  const primaryColor = hexToRgb(branding.primaryColor);
  const today = new Date();
  const data = assembleHsReportData(tasks, documents, today);

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
  content.push(createColoredLine(primaryColor));
  content.push({ text: formatBuildingName(buildingName), style: 'header', alignment: 'center', margin: [0, 0, 0, 20] });

  // 1. Summary by compliance category
  content.push({ text: '1. Compliance Summary', style: 'sectionTitle' });
  content.push({
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto', 'auto'],
      body: [
        ['Category', 'Completed', 'Outstanding', 'Overdue'].map((h) => ({ text: h, bold: true, fontSize: 9 })),
        ...data.summary.map((s) => [
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
    content.push({ text: 'No completed H&S checks in this period.', fontSize: 9, italics: true, color: '#6b7280', margin: [0, 5, 0, 20] });
  } else {
    const body: Content[][] = [
      ['Check', 'Category', 'Completed', 'By', 'Evidence'].map((h) => ({ text: h, bold: true, fontSize: 9 })),
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
          t.photo_urls?.length ? `${t.photo_urls.length} photo(s) on file${extraPhotos > 0 ? ` (${extraPhotos} not shown)` : ''}` : 'No photos',
          t.signature_confirmed ? ' · signed' : '',
        ].join(''),
        fontSize: 7, color: '#6b7280',
      });
      body.push([
        { stack: [{ text: t.task_name, fontSize: 9 }, ...(t.completion_notes ? [{ text: t.completion_notes, fontSize: 7, color: '#6b7280' }] : [])] },
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
          ['Check', 'Category', 'Due', 'Status'].map((h) => ({ text: h, bold: true, fontSize: 9 })),
          ...data.outstandingTasks.map((t) => [
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
          ['Document', 'Type', 'Authority', 'Expiry', 'Status'].map((h) => ({ text: h, bold: true, fontSize: 9 })),
          ...documents.map((d) => {
            const cs = certificateStatus(d, today);
            const label = CERT_STATUS_LABEL[cs.status];
            return [
              { text: d.name, fontSize: 9 },
              { text: d.document_type.replace(/_/g, ' '), fontSize: 8 },
              { text: d.issuing_authority ?? '-', fontSize: 8 },
              { text: d.expiry_date ?? '-', fontSize: 8 },
              { text: cs.daysRemaining !== null && cs.status !== 'expired' ? `${label.text} (${cs.daysRemaining}d)` : label.text, fontSize: 8, bold: cs.status === 'expired', color: label.color },
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
    fontSize: 7, color: '#9ca3af', margin: [0, 10, 0, 0],
  });

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 60],
    content,
    styles: {
      header: { fontSize: 20, bold: true, color: primaryColor },
      orgName: { fontSize: 12, bold: true, color: primaryColor },
      sectionTitle: { fontSize: 13, bold: true, color: '#111827', margin: [0, 10, 0, 4] },
      footer: { fontSize: 8, color: '#9ca3af' },
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `${branding.name} — H&S Compliance Report — ${formatBuildingName(buildingName)}`, style: 'footer', margin: [40, 20, 0, 0] },
        { text: `Page ${currentPage} of ${pageCount}`, style: 'footer', alignment: 'right', margin: [0, 20, 40, 0] },
      ],
    }),
    defaultStyle: { font: 'Roboto' },
  };

  pdfMake.createPdf(docDefinition).download(
    `HS_Compliance_${buildingName.replace(/\s+/g, '_')}_${rangeStart}_${rangeEnd}.pdf`
  );
}

export async function generatePortfolioSummaryPdf(opts: {
  rows: HsBuildingScore[];
  generatedAt: string; // yyyy-MM-dd
  branding: OrganizationBranding;
}): Promise<void> {
  const { rows, generatedAt, branding } = opts;
  const s = summarizePortfolio(rows);
  const statusLabel: Record<string, string> = { good: 'Good', warning: 'Watch', critical: 'Critical', none: 'No checks' };

  const headerRow: Content[] = ['Building', 'Done / Total', 'Score', 'Status', 'Cert'].map(
    (t) => ({ text: t, style: 'th' })
  );
  const dataRows: Content[][] = rows.map((r) => [
    { text: r.name },
    { text: `${r.completed} / ${r.total}` },
    { text: r.score === null ? 'N/A' : `${r.score}%` },
    { text: statusLabel[scoreBand(r.score)] },
    { text: r.hasExpiredCert ? 'EXPIRED' : 'OK' },
  ]);

  const docDefinition: TDocumentDefinitions = {
    pageMargins: [40, 50, 40, 40],
    content: [
      { text: branding.name, style: 'org' },
      { text: 'Portfolio Compliance Summary', style: 'title' },
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
    },
    defaultStyle: { font: 'Roboto', fontSize: 10 },
  };

  pdfMake.createPdf(docDefinition).download(`Portfolio_Compliance_${generatedAt}.pdf`);
}
