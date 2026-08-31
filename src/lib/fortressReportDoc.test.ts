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
        { label: 'Stand-by generator', rating: 'critical', recommendation: 'Service unit', comment: 'noisy', capexEstimate: 1000, applicable: true,
          fields: [{ label: 'Size generator', value: '500kVA' }, { label: 'Make and model', value: 'Cummins X' }],
          photos: [{ dataUrl: PHOTO, caption: 'gen 1' }] },
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
  it('renders per-archetype detail fields under the item', () => {
    expect(text).toContain('Size generator: ');
    expect(text).toContain('500kVA');
    expect(text).toContain('Make and model: ');
    expect(text).toContain('Cummins X');
  });
  it('renders the Capex Register table', () => {
    expect(text).toContain('Capex Register');
    expect(text).toContain('Roof replacement');
  });
});

describe('buildReportDoc — title casing', () => {
  it('uppercases the whole composed report title in the PDF header', () => {
    const doc = buildReportDoc(
      { title: 'Monthly OPS — Broll Centre — May 2026', report_period: '2026-05-01', report_type: 'ops_monthly', managers: [] },
      { compliancePct: 100 },
      { color: '#123456', orgName: 'Acme' },
    );
    const { text } = collect(doc);
    expect(text).toContain('MONTHLY OPS — BROLL CENTRE — MAY 2026');
  });
});

describe('buildReportDoc — page furniture (standard C2)', () => {
  const doc = buildReportDoc(
    { title: 'Monthly OPS — Broll Centre — May 2026', report_period: '2026-05-01', report_type: 'ops_monthly', managers: [] },
    { compliancePct: 90 },
    { color: '#123456', orgName: 'Acme' },
  );

  it('keeps the running header off page 1 (cover-style band already there)', () => {
    const header = doc.header as (cur: number) => unknown;
    expect(typeof header).toBe('function');
    expect(header(1)).toBeUndefined();
  });

  it('repeats org name + uppercased report title on pages 2+', () => {
    const header = doc.header as (cur: number) => unknown;
    const { text } = collect({ content: header(2) });
    expect(text).toContain('Acme');
    expect(text).toContain('MONTHLY OPS — BROLL CENTRE — MAY 2026');
  });

  it('keeps the page-number footer', () => {
    const footer = doc.footer as (cur: number, total: number) => unknown;
    const { text } = collect({ content: footer(3, 7) });
    expect(text).toContain('3 / 7');
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

/*
 * Export completeness (added when the export was rebuilt).
 *
 * Each of these corresponds to a way the export was previously wrong: CM reports exported
 * as a bare cover page, OPS reports claimed a 0% compliance score nobody had measured, and
 * a report missing eleven sections looked identical to a complete one.
 */
const OPTS = { color: '#0b5f5e', orgName: 'Building Ops' };
const opsDoc = (data: ReportData) =>
  buildReportDoc({ title: 'X — Operations', report_period: '2026-06-01', report_type: 'ops_monthly', managers: [] }, data, OPTS);
const cmDoc = (data: ReportData) =>
  buildReportDoc({ title: 'X — CM', report_period: '2026-06-01', report_type: 'cm_monthly', managers: [] }, data, OPTS);

/** Every string anywhere in the definition, including cells `collect` does not descend into. */
function allText(doc: unknown): string {
  const out: string[] = [];
  const visit = (n: unknown): void => {
    if (n == null) return;
    if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (typeof n === 'object') Object.values(n as Record<string, unknown>).forEach(visit);
  };
  visit(doc);
  return out.join('\n');
}

describe('buildReportDoc — export completeness', () => {
  it('does not claim a compliance score when the OHS section was never completed', () => {
    const t = allText(opsDoc({ compliancePct: null, compliance: [] }));
    expect(t).not.toContain('Building Compliance');
  });

  it('exports utilities, masterfile and the inspection checklist', () => {
    const t = allText(opsDoc({
      utilities: [{ utility: 'water', meter: 'Bulk Check', reading: 1166, unit: 'KL', category: 'bulk', pctOfBulk: null, comment: null }],
      masterfile: [{ document: 'Zoning certificate', onFile: 'yes', comment: null }],
      checklist: [{ section: 'Building Inspection', items: [{ item: 'STRUCTURE / Basement', response: 'yes', value: null, comment: null }] }],
    }));
    expect(t).toContain('Utilities');
    expect(t).toContain('Bulk Check');
    expect(t).toContain('Masterfile');
    expect(t).toContain('Zoning certificate');
    expect(t).toContain('STRUCTURE / Basement');
  });

  it('counts documents on file in the masterfile note', () => {
    const t = allText(opsDoc({
      masterfile: [
        { document: 'A', onFile: 'yes', comment: null },
        { document: 'B', onFile: 'no', comment: null },
        { document: 'C', onFile: 'unassessed', comment: null },
      ],
    }));
    expect(t).toContain('1 of 3 documents on file.');
  });

  it('says the PPM status is unrecorded rather than printing an empty schedule', () => {
    const t = allText(opsDoc({
      ppm: [{ service: 'Aircon minor', frequency: 'Monthly', servicedMonths: [] }],
      ppmStatusNote: 'Service status is recorded in the source workbook as a cell colour with no legend.',
    }));
    expect(t).toContain('Aircon minor');
    expect(t).toContain('no legend');
    expect(t).toContain('not recorded');
  });

  it('exports every captured CM tenant column, grouped so each table fits the page', () => {
    const t = allText(cmDoc({
      tenantCompliance: [{
        shop: '2', tenant: 'ACKERMANS', gla: 704,
        occupancyCert: '2023/74', cocNumber: 'M0247625', cocDate: '2023-09-27', leaseClause: '7.7',
        hvacResponsibility: 'LL', hvacRecords: 'yes', hvacHandover: '12/2024',
        generatorResponsibility: 'll', generatorRecords: 'yes',
        sprinklerDedicated: 'yes', sprinklerWeekly: 'yes', sprinklerAnnual: 'na', sprinkler3yr: 'no',
        smokeExtractionDedicated: 'yes', smokeExtractionService: 'yes',
        smokeDetectionDedicated: 'yes', smokeDetectionService: 'na', handheldFire: 'yes',
        ohsRisks: 'Y', evacPlan: 'na', foodExtraction: 'yes',
        greaseTrap: 'yes', fireBlanket: 'no', gasCoc: 'na', flammableLiquid: 'yes',
      }],
      shopSpec: [{
        shop: '2', tenant: 'ACKERMANS', phase: '3 - Three phase', actualAmps: '160A', leaseAmps: '160A',
        generator: 'yes', hvac: 'DP', hvacBtu: '4x 7500', hvacGas: 'R410A',
        lighting: 'L-LED', shopfront: 'DD- Double door', rollerShutter: 'G',
      }],
    }));
    // the four compliance groups and the two shop-spec groups all render
    expect(t).toContain('Tenant OHS & Housekeeping');
    expect(t).toContain('Certificates and occupancy.');
    expect(t).toContain('HVAC and generators.');
    expect(t).toContain('Fire equipment.');
    expect(t).toContain('OHS act risks and food tenants.');
    expect(t).toContain('Shop Specification');
    // values from every group, i.e. nothing is dropped on the way to the page
    expect(t).toContain('M0247625');      // certificates
    expect(t).toContain('12/2024');       // hvac handover
    expect(t).toContain('4x 7500');       // hvac btu — was dropped entirely
    expect(t).toContain('DD- Double door'); // shopfront — was dropped entirely
    expect(t).toContain('7.7');           // lease clause — was dropped entirely
  });

  it('keeps every table inside the printable width', () => {
    const doc: any = cmDoc({
      tenantCompliance: [{
        shop: '1', tenant: 'B', gla: 1, occupancyCert: 'a', cocNumber: 'b', cocDate: 'c', leaseClause: 'd',
        hvacResponsibility: 'e', hvacRecords: 'f', hvacHandover: 'g', generatorResponsibility: 'h',
        generatorRecords: 'i', sprinklerDedicated: 'j', sprinklerWeekly: 'k', sprinklerAnnual: 'l',
        sprinkler3yr: 'm', smokeExtractionDedicated: 'n', smokeExtractionService: 'o',
        smokeDetectionDedicated: 'p', smokeDetectionService: 'q', handheldFire: 'r', ohsRisks: 's',
        evacPlan: 't', foodExtraction: 'u', greaseTrap: 'v', fireBlanket: 'w', gasCoc: 'x', flammableLiquid: 'y',
      }],
      shopSpec: [{ shop: '1', tenant: 'B', phase: 'a', actualAmps: 'b', leaseAmps: 'c', generator: 'd',
        hvac: 'e', hvacBtu: 'f', hvacGas: 'g', lighting: 'h', shopfront: 'i', rollerShutter: 'j' }],
    });
    // pdfmake draws overflow off the paper rather than wrapping, so fixed widths plus
    // gutters must fit the 515pt text block. This is the guard the review found missing.
    const over: string[] = [];
    const visit = (n: any): void => {
      if (n == null) return;
      if (Array.isArray(n)) { n.forEach(visit); return; }
      if (typeof n !== 'object') return;
      if (n.table?.widths) {
        const fixed = n.table.widths.reduce((a: number, w: any) => a + (typeof w === 'number' ? w : 0), 0);
        if (fixed + n.table.widths.length * 4 > 515) over.push(`${n.table.widths.length} cols / ${fixed}pt`);
      }
      Object.values(n).forEach(visit);
    };
    visit(doc.content);
    expect(over).toEqual([]);
  });

  it('names the sections that carry nothing, and omits the block when none do', () => {
    expect(allText(cmDoc({ emptySections: ['Building Turnover', 'Leasing'] }))).toContain('Not captured this period');
    expect(allText(cmDoc({ emptySections: ['Building Turnover', 'Leasing'] }))).toContain('Leasing');
    expect(allText(cmDoc({ emptySections: [] }))).not.toContain('Not captured this period');
  });
});

/*
 * The Page 2 / Page 3 blocks.
 *
 * These were ingested from the June drop and then had no route into the PDF: a CM report
 * printed its tenant tables and silently omitted head counts, leasing, trading hours,
 * arrears and utilities. Each assertion below corresponds to one such omission.
 */
describe('buildReportDoc — CM Page 2 / Page 3 sections', () => {
  const full = cmDoc({
    footfall: [{ entrance: 'BUS RANK', month: '73,832', ytd: '143,870', prevYtd: '141,550', variance: '2%' }],
    toiletFund: [{ label: 'Issued (bales)', value: '122' }],
    vacancies: [{ shop: 'Shop 12', area: '250', budgetRelet: '95', grossMandate: '110', comment: 'agent mandated' }],
    waitlist: [{ tradingAs: 'Sportscene', contact: '082', category: 'Fashion', size: '300m²', comment: '' }],
    movements: [{ tradingAs: 'KFC', type: 'new', vacateDate: '2025-09-22', prelim: '', takeOn: '', firstTrade: '2025-11-01', comment: '' }],
    tradingBreaches: [{ tenant: 'Bargain Books', date: '2026-06-04', time: '17:30', letterTo: 'Head office', comment: 'closed early' }],
    arrears: [{ tradingAs: 'Nizams', deposit: '361,088.52', balance: '100,000.00', contact: '083' }],
    loadshedding: [{ day: '2026-06-22', week: '4', stage: 'Power failure', hours: '4', litres: '470', dieselDate: '2026-06-22' }],
    interruptions: [{ date: '2026-06-20', type: 'Power failure', start: '23:00', end: '02:30', hours: '3.5', ref: 'No Ref.', comment: 'main supply' }],
    incidentsTotal: 33,
    incidentsByMonth: [{ month: '2025-07', count: 33 }],
    incidentsByType: [{ type: 'Public indecency', count: 14 }],
  });
  const t = allText(full);

  it('prints head counts and the toilet fund', () => {
    expect(t).toContain('Head Counts');
    expect(t).toContain('BUS RANK');
    expect(t).toContain('Toilet Fund');
    expect(t).toContain('Issued (bales)');
  });

  it('prints all three leasing blocks under one heading', () => {
    expect(t).toContain('Leasing');
    expect(t).toContain('Shop 12');        // vacancies
    expect(t).toContain('Sportscene');     // waiting list
    expect(t).toContain('KFC');            // movements
  });

  it('prints trading-hour breaches and arrears', () => {
    expect(t).toContain('Tenant Trading Hours');
    expect(t).toContain('Bargain Books');
    expect(t).toContain('Arrears');
    expect(t).toContain('Nizams');
  });

  it('prints loadshedding and municipal interruptions', () => {
    expect(t).toContain('Utility Management');
    expect(t).toContain('Power failure');
    expect(t).toContain('No Ref.');
  });

  it('breaks the incident matrix down by month and by type, not just a total', () => {
    expect(t).toContain('Total incidents: 33');
    expect(t).toContain('2025-07');
    expect(t).toContain('Public indecency');
  });

  it('omits every block that carries no rows, rather than printing empty tables', () => {
    const bare = allText(cmDoc({ turnover: [] }));
    for (const heading of ['Head Counts', 'Toilet Fund', 'Tenant Trading Hours', 'Arrears', 'Utility Management'])
      expect(bare).not.toContain(heading);
  });

  it('keeps every new table inside the 515pt text block', () => {
    const over: string[] = [];
    const visit = (n: any): void => {
      if (n == null) return;
      if (Array.isArray(n)) { n.forEach(visit); return; }
      if (typeof n !== 'object') return;
      if (n.table?.widths) {
        const fixed = n.table.widths.reduce((a: number, w: any) => a + (typeof w === 'number' ? w : 0), 0);
        if (fixed + n.table.widths.length * 4 > 515) over.push(`${n.table.widths.length} cols / ${fixed}pt`);
      }
      Object.values(n).forEach(visit);
    };
    visit(full.content);
    expect(over).toEqual([]);
  });
});

/*
 * Electrical compliance: the four states insight-linker can be in.
 *
 * Previously the PDF rendered a table only when rows existed, and coerced every null to
 * ''. So "not linked", "linked but the site has no shops", and "the live read failed"
 * were one indistinguishable silence, and a table whose CoC columns were entirely blank
 * (781 of 1,265 shops portfolio-wide) printed as though it were complete data.
 */
describe('buildReportDoc — electrical compliance states', () => {
  const annual = (data: ReportData) =>
    buildReportDoc({ title: 'X', report_period: '2026-06-01', report_type: 'annual_inspection', managers: [] }, data, OPTS);

  it('says the building is not linked, rather than printing nothing', () => {
    const t = allText(annual({ electricalLinked: false }));
    expect(t).toContain('Electrical Compliance');
    expect(t).toContain('not linked to an insight-linker site');
  });

  it('distinguishes "linked but no shops recorded" from "not linked"', () => {
    const t = allText(annual({ electricalLinked: true, electricalCompliance: [] }));
    expect(t).toContain('no shops are recorded');
    expect(t).not.toContain('not linked to an insight-linker site');
  });

  it('reports a failed live read as a failure, never as absent data', () => {
    const t = allText(annual({ electricalError: 'statement timeout' }));
    expect(t).toContain('could not be read');
    expect(t).toContain('statement timeout');
    expect(t).not.toContain('no shops are recorded');
  });

  it('renders an em-dash for every missing CoC field instead of a blank cell', () => {
    const t = allText(annual({
      electricalLinked: true,
      electricalCompliance: [{
        shop_number: 'S1', tenant_name: 'Acme',
        coc_number: null, coc_type: null, coc_status: null,
        coc_issue_date: null, coc_expiry_date: null,
        certificate_url: '', certificate_name: '',
      }],
    }));
    expect(t).toContain('Acme');
    expect(t).toContain('—');
  });

  it('still prints real values when they are present', () => {
    const t = allText(annual({
      electricalLinked: true,
      electricalCompliance: [{
        shop_number: 'S1', tenant_name: 'Acme',
        coc_number: 'COC-99', coc_type: 'Electrical', coc_status: 'Pass',
        coc_issue_date: '2026-01-15', coc_expiry_date: null,
        certificate_url: 'https://example.test/c.pdf', certificate_name: 'c.pdf',
      }],
    }));
    expect(t).toContain('COC-99');
    expect(t).toContain('Pass');
    expect(t).toContain('2026-01-15');
  });
});
