import { describe, it, expect } from 'vitest';
import type { Content, ContextPageSize, DynamicContent, TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  buildBlankFormDoc,
  buildFilledFormDoc,
  buildHsComplianceDoc,
  buildPortfolioSummaryDoc,
  safePrimaryColor,
  HS_EMPTY_COMPLETED_COPY,
  type OrganizationBranding,
} from './reportDocs';
import type { FormField } from './formFields';
import type { HsTask, HsDocument } from './hsComplianceReport';

// Walk a pdfmake doc-definition tree collecting every image data-URL and text
// string (same harness as fortressReportDoc.test.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
function walk(node: any, images: string[], texts: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) walk(n, images, texts); return; }
  if (typeof node !== 'object') return;
  if (typeof node.image === 'string') images.push(node.image);
  if (typeof node.text === 'string') texts.push(node.text);
  else if (Array.isArray(node.text)) for (const t of node.text) texts.push(typeof t === 'string' ? t : (t?.text ?? ''));
  if (node.columns) walk(node.columns, images, texts);
  if (node.stack) walk(node.stack, images, texts);
  if (node.content) walk(node.content, images, texts);
  if (node.table?.body) walk(node.table.body, images, texts);
}
function collect(root: unknown): { images: string[]; text: string } {
  const images: string[] = []; const texts: string[] = [];
  walk((root as { content?: unknown })?.content ?? root, images, texts);
  return { images, text: texts.join(' | ') };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const PAGE: ContextPageSize = { width: 595, height: 842, orientation: 'portrait' };

/** Assert the standard page furniture: header skips page 1, footer shows Page N of M. */
function expectStandardFurniture(doc: TDocumentDefinitions, orgName: string, titleFragment: string) {
  expect(typeof doc.header).toBe('function');
  expect(typeof doc.footer).toBe('function');
  const header = doc.header as DynamicContent;
  const footer = doc.footer as DynamicContent;

  // Page 1 has a cover-style inline header — the running header stays off it.
  expect(header(1, 3, PAGE)).toBeUndefined();
  const page2 = collect(header(2, 3, PAGE) as Content);
  expect(page2.text).toContain(orgName);
  expect(page2.text).toContain(titleFragment);

  const foot = collect(footer(2, 5, PAGE) as Content);
  expect(foot.text).toContain('Page 2 of 5');
}

const BRANDING: OrganizationBranding = { name: 'Acme Property Co', primaryColor: '#123456' };
const PHOTO = 'data:image/jpeg;base64,AAAA';

describe('safePrimaryColor', () => {
  it('keeps a valid 6-digit hex and falls back on garbage', () => {
    expect(safePrimaryColor('#123456')).toBe('#123456');
    expect(safePrimaryColor('123456')).toBe('123456');
    expect(safePrimaryColor('not-a-colour')).toBe('#2563eb');
    expect(safePrimaryColor('#12345')).toBe('#2563eb');
  });
});

describe('buildHsComplianceDoc', () => {
  const completedTask: HsTask = {
    id: 't1',
    task_name: 'Fire extinguisher check',
    category: 'fire_safety',
    status: 'completed',
    due_date: '2026-08-01',
    completed_at: '2026-08-01T10:00:00Z',
    completed_by_name: 'Thandi M',
    completion_notes: 'All units serviced',
    photo_urls: ['photos/a.jpg', 'photos/b.jpg'],
    signature_confirmed: true,
  };
  const outstandingTask: HsTask = {
    id: 't2',
    task_name: 'Emergency light test',
    category: 'electrical',
    status: 'pending',
    due_date: '2026-07-01',
    completed_at: null,
    completed_by_name: null,
    completion_notes: null,
    photo_urls: [],
    signature_confirmed: false,
  };
  const doc: HsDocument = {
    id: 'd1',
    name: 'Fire Certificate',
    document_type: 'fire_certificate',
    expiry_date: '2026-01-01',
    issuing_authority: 'City of JHB',
    reference_number: 'FC-1',
  };

  const built = buildHsComplianceDoc({
    buildingName: 'Broll Centre',
    rangeStart: '2026-05-01',
    rangeEnd: '2026-08-01',
    tasks: [completedTask, outstandingTask],
    documents: [doc],
    photoDataUrls: { t1: [PHOTO] },
    branding: BRANDING,
    now: new Date('2026-08-06T00:00:00Z'),
  });
  const { images, text } = collect(built);

  it('renders all four report sections in order', () => {
    expect(text).toContain('1. Compliance Summary');
    expect(text).toContain('2. Completed Checks (evidence)');
    expect(text).toContain('3. Outstanding & Overdue Items');
    expect(text).toContain('4. Statutory Certificate Register');
  });

  it('embeds the completed check photo evidence', () => {
    expect(images).toContain(PHOTO);
    expect(text).toContain('2 photo(s) on file (1 not shown)');
  });

  it('marks overdue items and expired certificates', () => {
    expect(text).toContain('OVERDUE');
    expect(text).toContain('EXPIRED');
  });

  it('applies branding: org name in cover header, primary colour in styles', () => {
    expect(text).toContain('Acme Property Co');
    expect(built.styles?.header?.color).toBe('#123456');
    expect(built.styles?.orgName?.color).toBe('#123456');
  });

  it('has the standard page furniture (running header off page 1, Page N of M footer)', () => {
    expectStandardFurniture(built, 'Acme Property Co', 'H&S Compliance Report');
  });

  it('shows the empty-state copy when no checks were completed', () => {
    const empty = buildHsComplianceDoc({
      buildingName: 'Broll Centre',
      rangeStart: '2026-05-01',
      rangeEnd: '2026-08-01',
      tasks: [outstandingTask],
      documents: [],
      photoDataUrls: {},
      branding: BRANDING,
      now: new Date('2026-08-06T00:00:00Z'),
    });
    const { text: emptyText } = collect(empty);
    expect(emptyText).toContain(HS_EMPTY_COMPLETED_COPY);
    expect(emptyText).toContain('No documents on file for this building.');
  });
});

describe('buildPortfolioSummaryDoc', () => {
  const built = buildPortfolioSummaryDoc({
    rows: [
      { building_id: 'b1', name: 'BROLL CENTRE', total: 10, completed: 9, score: 90, hasExpiredCert: false },
      { building_id: 'b2', name: 'YARONA MALL', total: 4, completed: 1, score: 25, hasExpiredCert: true },
    ],
    generatedAt: '2026-08-06',
    branding: BRANDING,
  });
  const { text } = collect(built);

  it('renders the title, summary line, and per-building rows', () => {
    expect(text).toContain('Portfolio Compliance Summary');
    expect(text).toContain('2 buildings');
    expect(text).toContain('BROLL CENTRE');
    expect(text).toContain('YARONA MALL');
    expect(text).toContain('EXPIRED');
  });

  it('uses the org primary colour for the table header style', () => {
    expect(built.styles?.th?.color).toBe('#123456');
  });

  it('has the standard page furniture', () => {
    expectStandardFurniture(built, 'Acme Property Co', 'Portfolio Compliance Summary');
  });
});

describe('buildBlankFormDoc', () => {
  const fields: FormField[] = [
    { label: 'Date', type: 'date', required: true, width: 'half' },
    { label: 'Time', type: 'time', width: 'half' },
    { label: 'Visitor Name', type: 'text', required: true },
    { label: 'Escorted', type: 'checkbox' },
    { label: 'Area', type: 'select', options: ['Roof', 'Basement'] },
    { label: 'Notes', type: 'textarea' },
    { label: 'Photos', type: 'photo', maxPhotos: 3 },
    { label: 'Signature', type: 'signature', required: true },
  ];
  const built = buildBlankFormDoc(
    { id: 'f1', name: 'Visitor Register', description: 'Daily visitor log', category: 'Security' },
    fields,
    BRANDING,
    new Date('2026-08-06T00:00:00Z'),
  );
  const { text } = collect(built);

  it('renders the form title, description, category badge, and org name', () => {
    expect(text).toContain('Visitor Register');
    expect(text).toContain('Daily visitor log');
    expect(text).toContain('Security');
    expect(text).toContain('Acme Property Co');
  });

  it('renders every field label, marking required ones', () => {
    expect(text).toContain('Date *');
    expect(text).toContain('Time');
    expect(text).toContain('Visitor Name *');
    expect(text).toContain('Escorted');
    expect(text).toContain('Options: Roof | Basement');
    expect(text).toContain('[Photo upload - max 3 images]');
    expect(text).toContain('Signature *');
  });

  it('has the standard page furniture', () => {
    expectStandardFurniture(built, 'Acme Property Co', 'Visitor Register');
  });
});

describe('buildFilledFormDoc', () => {
  const fields: FormField[] = [
    { label: 'Visitor Name', type: 'text' },
    { label: 'Escorted', type: 'checkbox' },
    { label: 'Photos', type: 'photo' },
    { label: 'Signature', type: 'signature' },
    { label: 'Comments', type: 'text' },
  ];
  const built = buildFilledFormDoc(
    { id: 'f1', name: 'Visitor Register', description: 'Daily visitor log', category: 'Security' },
    fields,
    { 'Visitor Name': 'Sipho D', Escorted: true, Photos: ['a.jpg', 'b.jpg'], Signature: 'sig', Comments: '' },
    BRANDING,
    'Thandi M',
    new Date('2026-08-06T10:30:00Z'),
  );
  const { text } = collect(built);

  it('renders submitted values with type-specific formatting', () => {
    expect(text).toContain('Sipho D');
    expect(text).toContain('✓ Yes');
    expect(text).toContain('2 photo(s) attached');
    expect(text).toContain('✓ Digitally Signed');
    expect(text).toContain('Comments | -'); // empty value renders as a dash
  });

  it('shows the submission banner and submitter', () => {
    expect(text).toContain('SUBMITTED FORM');
    expect(text).toContain('Submitted by: Thandi M');
  });

  it('has the standard page furniture with the submission title', () => {
    expectStandardFurniture(built, 'Acme Property Co', 'Visitor Register — Submission');
  });
});
