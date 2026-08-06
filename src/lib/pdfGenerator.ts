/**
 * Browser entry for the legacy report family (blank form, filled form, H&S
 * compliance, portfolio summary). Owns the pdfmake runtime (fonts/vfs) and the
 * download trigger; the document definitions come from the pure builders in
 * `reportDocs.ts` (unit-tested, DOM-free — same split as fortressReportDoc.ts
 * / fortressReportPdf.ts).
 *
 * The H&S and portfolio generators return the rendered blob alongside the
 * download so callers can persist it as a report artifact (standard D1/D2);
 * the download itself never depends on persistence succeeding (D4 ladder).
 */
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import type { FormField } from './formFields';
import type { HsTask, HsDocument } from './hsComplianceReport';
import type { HsBuildingScore } from './hsScore';
import {
  buildBlankFormDoc,
  buildFilledFormDoc,
  buildHsComplianceDoc,
  buildPortfolioSummaryDoc,
  type FormTemplateMeta,
  type OrganizationBranding,
} from './reportDocs';

// Initialize pdfMake with fonts
pdfMake.vfs = pdfFonts.vfs;

export type { OrganizationBranding } from './reportDocs';

/** A rendered PDF handed back to the caller for persistence. */
export interface GeneratedPdf {
  blob: Blob;
  fileName: string;
}

/** Render a doc definition once, download it, and hand the blob back. */
async function renderAndDownload(doc: Parameters<typeof pdfMake.createPdf>[0], fileName: string): Promise<GeneratedPdf> {
  const pdf = pdfMake.createPdf(doc);
  const blob = await pdf.getBlob();
  await pdf.download(fileName); // re-uses the buffered render; keeps current UX
  return { blob, fileName };
}

export async function generateFormPdf(
  form: FormTemplateMeta,
  fields: FormField[],
  branding: OrganizationBranding
): Promise<void> {
  const doc = buildBlankFormDoc(form, fields, branding);
  await renderAndDownload(doc, `${form.name.replace(/\s+/g, '_')}.pdf`);
}

// Generate filled form PDF with data
export async function generateFilledFormPdf(
  form: FormTemplateMeta,
  fields: FormField[],
  formData: Record<string, unknown>,
  branding: OrganizationBranding,
  submittedBy: string,
  submittedAt: Date
): Promise<void> {
  const doc = buildFilledFormDoc(form, fields, formData, branding, submittedBy, submittedAt);
  await renderAndDownload(doc, `${form.name.replace(/\s+/g, '_')}_Submission.pdf`);
}

export async function generateHsCompliancePdf(opts: {
  buildingName: string;
  rangeStart: string; // yyyy-MM-dd
  rangeEnd: string;
  tasks: HsTask[];
  documents: HsDocument[];
  photoDataUrls: Record<string, string[]>; // task id -> thumbnail dataURLs
  branding: OrganizationBranding;
}): Promise<GeneratedPdf> {
  const doc = buildHsComplianceDoc(opts);
  return renderAndDownload(
    doc,
    `HS_Compliance_${opts.buildingName.replace(/\s+/g, '_')}_${opts.rangeStart}_${opts.rangeEnd}.pdf`
  );
}

export async function generatePortfolioSummaryPdf(opts: {
  rows: HsBuildingScore[];
  generatedAt: string; // yyyy-MM-dd
  branding: OrganizationBranding;
}): Promise<GeneratedPdf> {
  const doc = buildPortfolioSummaryDoc(opts);
  return renderAndDownload(doc, `Portfolio_Compliance_${opts.generatedAt}.pdf`);
}
