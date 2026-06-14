import { describe, it, expect } from 'vitest';
import { buildReportDoc, type ReportData } from './fortressReportDoc';

// Walk a pdfmake doc-definition tree collecting every image data-URL and text string.
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
function collect(doc: any): { images: string[]; text: string } {
  const images: string[] = []; const texts: string[] = [];
  walk(doc.content, images, texts);
  return { images, text: texts.join(' | ') };
}

const PHOTO = 'data:image/jpeg;base64,AAAA';
const LOGO = 'data:image/png;base64,BBBB';

describe('buildReportDoc — annual_inspection', () => {
  const data: ReportData = {
    annualSections: [
      { title: 'Electrical', items: [
        { label: 'Stand-by generator', rating: 'critical', recommendation: 'Service unit', comment: 'noisy', capexEstimate: 1000, applicable: true, photos: [{ dataUrl: PHOTO, caption: 'gen 1' }] },
        { label: 'DB board', rating: 'good', applicable: true, photos: [] },
      ] },
      { title: 'Building Fabric', items: [
        { label: 'Roof sheeting', rating: 'fair', applicable: false, photos: [] },
      ] },
    ],
    annualFlagged: 1,
    annualCapexTotal: 1000,
    capex: [{ description: 'Roof replacement', estimate: 5000 }],
  };
  const doc = buildReportDoc(
    { title: 'Annual — Test', report_period: '2025-12-01', report_type: 'annual_inspection', managers: ['A', 'B'] },
    data,
    { color: '#123456', orgName: 'Acme', logoDataUrl: LOGO },
  );
  const { images, text } = collect(doc);

  it('embeds the inspection photo AND the org logo', () => {
    expect(images).toContain(PHOTO);
    expect(images).toContain(LOGO);
  });
  it('renders the Condition Inspection section with grouped titles + items', () => {
    expect(text).toContain('Condition Inspection');
    expect(text).toContain('Electrical');
    expect(text).toContain('Building Fabric');
    expect(text).toContain('Stand-by generator');
  });
  it('shows recommendation, photo caption, flagged count, and N/A items', () => {
    expect(text).toContain('Service unit');
    expect(text).toContain('gen 1');
    expect(text).toContain('1 flagged');
    expect(text).toContain('Roof sheeting — N/A'); // applicable:false collapses to one line
  });
  it('renders the Capex Register table', () => {
    expect(text).toContain('Capex Register');
    expect(text).toContain('Roof replacement');
  });
});

describe('buildReportDoc — ops_monthly + branding', () => {
  it('renders the building compliance % and compliance table', () => {
    const doc = buildReportDoc(
      { title: 'OPS', report_period: '2025-10-01', report_type: 'ops_monthly', managers: [] },
      { compliancePct: 100, compliance: [{ itemNo: '1', prompt: 'Fire equipment serviced', mark: 'X', comment: '' }],
        recoveries: [{ service: 'Water', ytdExpense: 100, ytdRecovery: 95, pctRecovery: '95%' }] },
      { color: '#123456', orgName: 'Acme' },
    );
    const { text } = collect(doc);
    expect(text).toContain('OHS Act Compliance');
    expect(text).toContain('Building Compliance: 100%');
    expect(text).toContain('Fire equipment serviced');
    expect(text).toContain('Expense Recoveries');
  });
  it('falls back to org name in the header when no logo', () => {
    const doc = buildReportDoc(
      { title: 'OPS', report_period: '2025-10-01', report_type: 'ops_monthly', managers: [] },
      { compliancePct: 80 },
      { color: '#123456', orgName: 'Acme Holdings' },
    );
    const { images, text } = collect(doc);
    expect(images).toHaveLength(0);
    expect(text).toContain('Acme Holdings');
  });
});
