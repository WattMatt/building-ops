import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { FormField } from './formFields';

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
