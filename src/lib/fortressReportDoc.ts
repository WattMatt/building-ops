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
  /** Set when PPM months carry no recorded status, so the export says so rather than printing "—". */
  ppmStatusNote?: string | null;
  /** Meter readings. Percentages are recomputed upstream, never read from the sheet. */
  utilities?: {
    utility: string | null; meter: string; reading: number | null; unit: string | null;
    category: string | null; pctOfBulk: number | null; comment: string | null;
  }[];
  /** Document completeness register. */
  masterfile?: { document: string; onFile: string; comment: string | null }[];
  /** Building-inspection and OHS-act answers, grouped by their sheet section. */
  checklist?: { section: string; items: { item: string; response: string | null; value: string | null; comment: string | null }[] }[];
  // cm
  turnover?: { tenant: string; density: string; growth: string; band: string }[];
  incidentsTotal?: number | null;
  /** Page 2 / Page 3 blocks. Ingested since the June drop; previously absent from the PDF. */
  footfall?: { entrance: string; month: string; ytd: string; prevYtd: string; variance: string }[];
  toiletFund?: { label: string; value: string }[];
  vacancies?: { shop: string; area: string; budgetRelet: string; grossMandate: string; comment: string }[];
  waitlist?: { tradingAs: string; contact: string; category: string; size: string; comment: string }[];
  movements?: { tradingAs: string; type: string; vacateDate: string; prelim: string; takeOn: string; firstTrade: string; comment: string }[];
  tradingBreaches?: { tenant: string; date: string; time: string; letterTo: string; comment: string }[];
  arrears?: { tradingAs: string; deposit: string; balance: string; contact: string }[];
  loadshedding?: { day: string; week: string; stage: string; hours: string; litres: string; dieselDate: string }[];
  interruptions?: { date: string; type: string; start: string; end: string; hours: string; ref: string; comment: string }[];
  incidentsByMonth?: { month: string; count: number }[];
  incidentsByType?: { type: string; count: number }[];
  /**
   * Per-tenant OHS & housekeeping compliance — the substance of a CM report.
   *
   * All 29 captured columns, because exporting a subset silently discards the client's
   * answers: the seven-column version shipped 26% of what the app captures. They are
   * rendered as four narrow tables mirroring the source sheet's own groups, since 29
   * columns cannot fit A4 in one table.
   */
  tenantCompliance?: {
    shop: string; tenant: string; gla: number | null;
    // certificates
    occupancyCert: string | null; cocNumber: string | null; cocDate: string | null; leaseClause: string | null;
    // hvac + generators
    hvacResponsibility: string | null; hvacRecords: string | null; hvacHandover: string | null;
    generatorResponsibility: string | null; generatorRecords: string | null;
    // fire equipment
    sprinklerDedicated: string | null; sprinklerWeekly: string | null; sprinklerAnnual: string | null; sprinkler3yr: string | null;
    smokeExtractionDedicated: string | null; smokeExtractionService: string | null;
    smokeDetectionDedicated: string | null; smokeDetectionService: string | null;
    handheldFire: string | null;
    // ohs risks + food tenants
    ohsRisks: string | null; evacPlan: string | null; foodExtraction: string | null;
    greaseTrap: string | null; fireBlanket: string | null; gasCoc: string | null; flammableLiquid: string | null;
  }[];
  /** Per-tenant shop specification — all captured columns, in two narrow tables. */
  shopSpec?: {
    shop: string; tenant: string; phase: string | null; actualAmps: string | null; leaseAmps: string | null;
    generator: string | null; hvac: string | null; hvacBtu: string | null; hvacGas: string | null;
    lighting: string | null; shopfront: string | null; rollerShutter: string | null;
  }[];
  /**
   * Sections this report type is expected to carry that hold no rows. Printed as an
   * explicit list so a short report is legibly incomplete rather than silently truncated —
   * a reader must never have to guess whether a section was omitted or simply empty.
   */
  emptySections?: string[];
  // annual
  annualSections?: AnnualSection[];
  annualFlagged?: number;
  annualCapexTotal?: number | null;
  capex?: { description: string; estimate: number | null }[];
  electricalCompliance?: {
    shop_number: string; tenant_name: string;
    // Nullable on purpose: null means "no certificate recorded", which must render as an
    // em-dash and must NOT count as content. Coercing to '' erased that distinction.
    coc_number: string | null; coc_type: string | null; coc_status: string | null;
    coc_issue_date: string | null; coc_expiry_date: string | null;
    certificate_url: string; certificate_name: string;
  }[];
  /** Whether the building is linked to an insight-linker site at all. */
  electricalLinked?: boolean;
  /** Set when the live read FAILED — distinct from "linked but nothing recorded". */
  electricalError?: string | null;
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

  const note = (t: string) =>
    content.push({ text: t, fontSize: 9, italics: true, color: '#6b7280', margin: [0, 0, 0, 6] });

  if (report.report_type === ('ops_monthly' as ReportType)) {
    // The compliance percentage is only meaningful once the OHS section has been answered.
    // Printing "Building Compliance: 0%" for a report whose OHS section was never completed
    // states a failing score that nobody measured.
    if (data.compliancePct != null || (data.compliance && data.compliance.length)) {
      section('OHS Act Compliance');
      if (data.compliancePct != null) {
        content.push({ text: `Building Compliance: ${data.compliancePct}%`, fontSize: 16, bold: true, color, margin: [0, 0, 0, 6] });
      }
      if (data.compliance && data.compliance.length) {
        content.push(table(['Item', 'Prompt', 'Y/N/A', 'Comment'],
          data.compliance.map((r) => [r.itemNo, r.prompt, r.mark, r.comment]),
          ['auto', '*', 'auto', 'auto']));
      }
    }

    if (data.checklist && data.checklist.length) {
      section('Building Inspection & OHS Act');
      for (const grp of data.checklist) {
        content.push({ text: grp.section, fontSize: 11, bold: true, color, margin: [0, 8, 0, 4] });
        content.push(table(['Item', 'Response', 'Detail', 'Comment'],
          grp.items.map((i) => [i.item, i.response ?? '—', i.value ?? '', i.comment ?? '']),
          ['*', 'auto', 'auto', '*']));
      }
    }

    if (data.utilities && data.utilities.length) {
      section('Utilities');
      note('Readings are as recorded on the meter. Percentages are recomputed from the raw readings.');
      content.push(compactTable(['Meter', 'Utility', 'Reading', 'Unit', 'Category', '% of bulk', 'Comment'],
        data.utilities.map((u) => [
          u.meter,
          u.utility ?? '—',
          u.reading == null ? '—' : String(u.reading),
          u.unit ?? '',
          u.category ?? '—',
          u.pctOfBulk == null ? '' : `${u.pctOfBulk}%`,
          u.comment ?? '',
        ]),
        ['*', 42, 44, 26, 54, 38, '*'],
        ['l', 'l', 'r', 'l', 'l', 'r', 'l']));
    }

    if (data.recoveries && data.recoveries.length) {
      section('Expense Recoveries');
      content.push(table(['Service', 'YTD Expense', 'YTD Recovery', '% Rec'],
        data.recoveries.map((r) => [r.service, formatZAR(r.ytdExpense), formatZAR(r.ytdRecovery), r.pctRecovery]),
        ['*', 'auto', 'auto', 'auto'],
        ['l', 'r', 'r', 'r']));
    }

    if (data.ppm && data.ppm.length) {
      section('PPM Schedule');
      if (data.ppmStatusNote) note(data.ppmStatusNote);
      content.push(table(['Service', 'Frequency', 'Months serviced'],
        data.ppm.map((p) => [
          p.service,
          p.frequency ?? '—',
          p.servicedMonths.length ? p.servicedMonths.join(', ') : (data.ppmStatusNote ? 'not recorded' : '—'),
        ]),
        ['*', 'auto', '*']));
    }

    if (data.masterfile && data.masterfile.length) {
      section('Masterfile');
      const onFile = data.masterfile.filter((m) => m.onFile === 'yes').length;
      note(`${onFile} of ${data.masterfile.length} documents on file.`);
      content.push(table(['Document', 'On file', 'Comment'],
        data.masterfile.map((m) => [m.document, m.onFile, m.comment ?? '']),
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
    if (data.footfall && data.footfall.length) {
      section('Head Counts');
      content.push(compactTable(
        ['Entrance', 'Month count', 'YTD count', 'Previous YTD', 'Variance'],
        data.footfall.map((f2) => [f2.entrance, f2.month, f2.ytd, f2.prevYtd, f2.variance]),
        ['*', 78, 78, 82, 60], ['l', 'r', 'r', 'r', 'r']));
    }
    if (data.toiletFund && data.toiletFund.length) {
      section('Toilet Fund');
      content.push(compactTable(['Item', 'Value'],
        data.toiletFund.map((t) => [t.label, t.value]), ['*', 120], ['l', 'r']));
    }
    if ((data.vacancies?.length || data.waitlist?.length || data.movements?.length)) {
      section('Leasing');
      if (data.vacancies?.length) {
        note('Vacancies.');
        content.push(compactTable(['Shop', 'Area (m²)', 'Budget relet R/m²', 'Gross mandate R/m²', 'Comment'],
          data.vacancies.map((v) => [v.shop, v.area, v.budgetRelet, v.grossMandate, v.comment]),
          [60, 56, 96, 104, '*'], ['l', 'r', 'r', 'r', 'l']));
      }
      if (data.waitlist?.length) {
        note('Waiting list.');
        content.push(compactTable(['Trading as', 'Contact', 'Category', 'Optimal size', 'Comment'],
          data.waitlist.map((w) => [w.tradingAs, w.contact, w.category, w.size, w.comment]),
          ['*', 92, 82, 66, '*']));
      }
      if (data.movements?.length) {
        note('Tenant movements.');
        content.push(compactTable(['Tenant', 'Type', 'Vacate / B-O', 'Prelim insp.', 'Take on / back', '1st trade', 'Comment'],
          data.movements.map((m) => [m.tradingAs, m.type, m.vacateDate, m.prelim, m.takeOn, m.firstTrade, m.comment]),
          ['*', 50, 60, 58, 66, 54, '*']));
      }
    }
    if (data.tradingBreaches && data.tradingBreaches.length) {
      section('Tenant Trading Hours');
      note('Tenants not adhering to centre trading hours.');
      content.push(compactTable(['Tenant', 'Date', 'Time', 'Letter sent to', 'Comment'],
        data.tradingBreaches.map((t) => [t.tenant, t.date, t.time, t.letterTo, t.comment]),
        ['*', 58, 46, 96, '*']));
    }
    if (data.arrears && data.arrears.length) {
      section('Arrears');
      content.push(compactTable(['Tenant', 'Deposit held', 'Closing balance', 'Contact'],
        data.arrears.map((a) => [a.tradingAs, a.deposit, a.balance, a.contact]),
        ['*', 78, 88, 110], ['l', 'r', 'r', 'l']));
    }
    if ((data.loadshedding?.length || data.interruptions?.length)) {
      section('Utility Management');
      if (data.loadshedding?.length) {
        note('Loadshedding and diesel.');
        content.push(compactTable(['Date', 'Week', 'Stage', 'Hours', 'Litres', 'Diesel purchased'],
          data.loadshedding.map((l) => [l.day, l.week, l.stage, l.hours, l.litres, l.dieselDate]),
          [66, 34, '*', 44, 46, 88], ['l', 'r', 'l', 'r', 'r', 'l']));
      }
      if (data.interruptions?.length) {
        note('Municipal service interruptions.');
        content.push(compactTable(['Date', 'Type', 'Start', 'End', 'Hours', 'Council ref', 'Comment'],
          data.interruptions.map((i) => [i.date, i.type, i.start, i.end, i.hours, i.ref, i.comment]),
          [62, 82, 42, 42, 38, 62, '*']));
      }
    }
    if (data.tenantCompliance && data.tenantCompliance.length) {
      // 29 captured columns cannot fit one A4 table, so they are split along the source
      // sheet's own groups. Splitting beats dropping: the previous single table carried
      // seven columns and silently discarded three quarters of the client's answers.
      const tc = data.tenantCompliance;
      section('Tenant OHS & Housekeeping');
      note('Certificates and occupancy.');
      content.push(compactTable(
        ['Shop', 'Tenant', 'GLA', 'Occupancy cert', 'Electrical COC no.', 'COC date', 'Lease clause'],
        tc.map((t) => [t.shop, t.tenant, t.gla == null ? '' : String(t.gla),
          t.occupancyCert ?? '', t.cocNumber ?? '', t.cocDate ?? '', t.leaseClause ?? '']),
        [34, '*', 28, 70, 76, 48, 60],
        ['l', 'l', 'r', 'l', 'l', 'l', 'l']));

      note('HVAC and generators.');
      content.push(compactTable(
        ['Shop', 'Tenant', 'HVAC resp.', 'HVAC records', 'HVAC handover', 'Gen. resp.', 'Gen. records'],
        tc.map((t) => [t.shop, t.tenant, t.hvacResponsibility ?? '', t.hvacRecords ?? '',
          t.hvacHandover ?? '', t.generatorResponsibility ?? '', t.generatorRecords ?? '']),
        [34, '*', 52, 54, 60, 48, 52]));

      note('Fire equipment. Sprinkler and smoke systems: D = dedicated, then service records.');
      content.push(compactTable(
        ['Shop', 'Tenant', 'Sprnk D', 'Weekly', 'Annual', '3-yr', 'Ext. D', 'Ext. svc', 'Det. D', 'Det. svc', 'Handheld'],
        tc.map((t) => [t.shop, t.tenant, t.sprinklerDedicated ?? '', t.sprinklerWeekly ?? '',
          t.sprinklerAnnual ?? '', t.sprinkler3yr ?? '', t.smokeExtractionDedicated ?? '',
          t.smokeExtractionService ?? '', t.smokeDetectionDedicated ?? '', t.smokeDetectionService ?? '',
          t.handheldFire ?? '']),
        [30, '*', 30, 30, 30, 24, 28, 30, 28, 30, 34]));

      note('OHS act risks and food tenants.');
      content.push(compactTable(
        ['Shop', 'Tenant', 'OHS risks', 'Evac plan', 'Food extr.', 'Grease trap', 'Fire blanket', 'Gas COC', 'Flammable'],
        tc.map((t) => [t.shop, t.tenant, t.ohsRisks ?? '', t.evacPlan ?? '', t.foodExtraction ?? '',
          t.greaseTrap ?? '', t.fireBlanket ?? '', t.gasCoc ?? '', t.flammableLiquid ?? '']),
        [30, '*', 46, 40, 40, 42, 44, 34, 40]));
    }
    if (data.shopSpec && data.shopSpec.length) {
      const ss = data.shopSpec;
      section('Shop Specification');
      note('Electrical.');
      content.push(compactTable(
        ['Shop', 'Tenant', 'Phase', 'Actual amps', 'Lease amps', 'Generator'],
        ss.map((s2) => [s2.shop, s2.tenant, s2.phase ?? '', s2.actualAmps ?? '', s2.leaseAmps ?? '', s2.generator ?? '']),
        [34, '*', 70, 54, 54, 44]));

      note('HVAC, lighting and shopfront.');
      content.push(compactTable(
        ['Shop', 'Tenant', 'HVAC units', 'BTU', 'Gas', 'Lighting', 'Shopfront', 'Shutters'],
        ss.map((s2) => [s2.shop, s2.tenant, s2.hvac ?? '', s2.hvacBtu ?? '', s2.hvacGas ?? '',
          s2.lighting ?? '', s2.shopfront ?? '', s2.rollerShutter ?? '']),
        [30, 64, '*', 60, 40, '*', 56, 46]));
    }
    if (data.incidentsTotal != null) {
      section('Security Incidents');
      content.push({ text: `Total incidents: ${data.incidentsTotal}`, fontSize: 10, margin: [0, 0, 0, 4] });
      // The matrix is 12 months x up to 28 types - far too wide for A4 - so it is shown
      // along each axis instead. A bare total told the reader nothing actionable.
      if (data.incidentsByMonth?.length) {
        note('By month.');
        content.push(compactTable(['Month', 'Incidents'],
          data.incidentsByMonth.map((m) => [m.month, String(m.count)]), [120, 70], ['l', 'r']));
      }
      if (data.incidentsByType?.length) {
        note('By type (categories with at least one incident).');
        content.push(compactTable(['Incident type', 'Count'],
          data.incidentsByType.map((t) => [t.type, String(t.count)]), ['*', 70], ['l', 'r']));
      }
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
        ['*', 'auto'],
        ['l', 'r']));
    }

    if (data.electricalError) {
      // A failed read is not "no data". Say so, in the artifact.
      section('Electrical Compliance');
      content.push({ text: `Live insight-linker data could not be read at generation time: ${data.electricalError}`, fontSize: 8, italics: true, color: '#b91c1c', margin: [0, 0, 0, 4] });
    } else if (data.electricalLinked === false) {
      section('Electrical Compliance');
      content.push({ text: 'This building is not linked to an insight-linker site, so no live certificate data is available.', fontSize: 8, italics: true, color: '#6b7280', margin: [0, 0, 0, 4] });
    } else if (data.electricalLinked && !data.electricalCompliance?.length) {
      // Linked, but the source site records no shops — a different fact from "not linked".
      section('Electrical Compliance');
      content.push({ text: 'Linked to insight-linker, but no shops are recorded against this site.', fontSize: 8, italics: true, color: '#6b7280', margin: [0, 0, 0, 4] });
    }
    if (data.electricalCompliance && data.electricalCompliance.length) {
      section('Electrical Compliance');
      content.push({ text: 'Live snapshot from insight-linker at generation time.', fontSize: 8, italics: true, color: '#6b7280', margin: [0, 0, 0, 4] });
      content.push({
        table: {
          headerRows: 1,
          // Explicit widths + the compact layout: with pdfmake's default 8pt-a-side
          // gutters, eight columns spend 128pt on padding alone and the last column is
          // pushed off the paper. 30+92+52+34+38+40+40+60 = 386, +32pt gutters = 418.
          widths: [30, 92, 52, 34, 38, 40, 40, 60],
          body: [
            ['Shop', 'Tenant', 'COC #', 'Type', 'Status', 'Issued', 'Expires', 'Certificate'].map((h) => ({ text: h, bold: true, fontSize: 6.5, fillColor: '#f3f4f6' })),
            ...data.electricalCompliance.map((r) => [
              { text: r.shop_number || '', fontSize: 6.5 },
              { text: r.tenant_name || '', fontSize: 6.5 },
              // Em-dash, matching ElectricalComplianceSection's own convention: a blank
              // cell reads as "not yet filled in", an em-dash as "nothing on record".
              { text: r.coc_number ?? '—', fontSize: 6.5 },
              { text: r.coc_type ?? '—', fontSize: 6.5 },
              { text: r.coc_status ?? '—', fontSize: 6.5 },
              { text: r.coc_issue_date ?? '—', fontSize: 6.5 },
              { text: r.coc_expiry_date ?? '—', fontSize: 6.5 },
              r.certificate_url
                ? { text: r.certificate_name || 'View', link: r.certificate_url, fontSize: 8, color: '#2563eb', decoration: 'underline' }
                : { text: '—', fontSize: 8 },
            ]),
          ],
        },
        layout: {
          paddingLeft: () => 2, paddingRight: () => 2,
          paddingTop: () => 2, paddingBottom: () => 2,
          hLineWidth: (r: number) => (r === 1 ? 1 : 0.5),
          vLineWidth: () => 0,
          hLineColor: () => '#e5e7eb',
        },
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

  // Name the sections this report type expects but which hold nothing. Without this a
  // report that is 2 sections long looks the same as one that is complete, and the reader
  // has no way to tell an omission from an empty section.
  if (data.emptySections && data.emptySections.length) {
    section('Not captured this period');
    content.push({
      text: 'These sections of the report carry no entries for this period:',
      fontSize: 9, color: '#6b7280', margin: [0, 0, 0, 4],
    });
    content.push({
      ul: data.emptySections.map((s) => ({ text: s, fontSize: 9, color: '#374151' })),
      margin: [0, 0, 0, 6],
    });
  }

  const headerTitle = (report.title ?? 'Report').toUpperCase();
  return {
    pageMargins: [40, 40, 40, 50],
    content,
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    // Repeating page header (standard C2): org name + report title on every
    // page except page 1, which carries the cover-style logo/title band.
    header: (cur: number) =>
      cur === 1
        ? undefined
        : {
            columns: [
              { text: opts.orgName, fontSize: 8, color: '#9ca3af', margin: [40, 14, 0, 0] },
              { text: headerTitle, fontSize: 8, color: '#9ca3af', alignment: 'right', margin: [0, 14, 40, 0] },
            ],
          },
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

/** 'r' right-aligns that column — use it for money, areas, readings and percentages. */
type Align = ('l' | 'r')[];
const alignOf = (a: Align | undefined, i: number) => (a?.[i] === 'r' ? 'right' as const : undefined);

function table(headers: string[], rows: string[][], widths: (string | number)[], align?: Align): Content {
  return {
    table: {
      headerRows: 1,
      // Never split a row across a page break: a wrapped comment cell otherwise leaves its
      // label stranded at the foot of one page and its value at the head of the next.
      dontBreakRows: true,
      widths,
      body: [
        headers.map((h, i) => ({ text: h, bold: true, fontSize: 8, fillColor: '#f3f4f6', alignment: alignOf(align, i) })),
        ...rows.map((r) => r.map((c, i) => ({ text: String(c ?? ''), fontSize: 8, alignment: alignOf(align, i) }))),
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 4, 0, 12],
  };
}

/**
 * A table for many narrow columns.
 *
 * pdfmake will not shrink an `auto` column below its natural width: once the columns plus
 * their gutters exceed the 515pt text block, it draws the overflow off the right edge of
 * the paper rather than wrapping. The ten-column tenant matrix did exactly that. So wide
 * tables get EXPLICIT widths that are known to sum inside the block, a smaller font, and
 * tighter horizontal padding (pdfmake's default is 4pt each side — 80pt of pure gutter
 * across ten columns).
 */
const USABLE_WIDTH = 515;
function compactTable(headers: string[], rows: string[][], widths: (string | number)[], align?: Align): Content {
  const fixed = widths.reduce<number>((a, w) => a + (typeof w === 'number' ? w : 0), 0);
  const gutters = widths.length * 4; // 2pt each side, per the layout below
  if (fixed + gutters > USABLE_WIDTH && import.meta.env?.DEV) {
    // Loud in dev rather than silently clipped in a client's PDF.
    console.warn(`compactTable: fixed widths ${fixed}pt + ${gutters}pt gutters exceed ${USABLE_WIDTH}pt`);
  }
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths,
      body: [
        headers.map((h, i) => ({ text: h, bold: true, fontSize: 6.5, fillColor: '#f3f4f6', alignment: alignOf(align, i) })),
        ...rows.map((r) => r.map((c, i) => ({ text: String(c ?? ''), fontSize: 6.5, alignment: alignOf(align, i) }))),
      ],
    },
    layout: {
      ...({} as object),
      paddingLeft: () => 2,
      paddingRight: () => 2,
      paddingTop: () => 2,
      paddingBottom: () => 2,
      hLineWidth: (i: number) => (i === 1 ? 1 : 0.5),
      vLineWidth: () => 0,
      hLineColor: () => '#e5e7eb',
    },
    margin: [0, 4, 0, 12],
  };
}
