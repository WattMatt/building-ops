/**
 * Branded PDF export for a Fortress report (browser entry). Fetches the report's
 * data, resolves + downscales photos to data URLs, builds the document via the pure
 * `buildReportDoc`, and downloads it. Themes with the org primary colour + logo.
 * Covers all three report types (ops_monthly, cm_monthly, annual_inspection); the
 * annual branch embeds the condition-inspection photos.
 */
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { fdb, type ReportType } from '@/integrations/supabase/fortress-db';
import { supabase } from '@/integrations/supabase/client';
import { resolveStorageUrl } from '@/integrations/supabase/storage';
import { bitmapFromBlob, fetchImageBlob } from '@/lib/imageFetch';
import { buildReportDoc, MARK, type ReportData, type EmbeddedPhoto, type AnnualItem } from '@/lib/fortressReportDoc';
import { ANNUAL_FIELD_SETS } from '@/lib/annualFieldSets';
import { doneMonthsFromGrid, fiscalWindow, gridHasData } from '@/lib/ppmGrid';
import { fetchMergedPpmGrids } from '@/lib/ppmGridFetch';
import { REPORT_SECTIONS, watermarkFor } from '@/lib/fortressReports';
import { fetchReportElectricalCompliance } from '@/integrations/supabase/insight-linker';
import { TREND_COLUMNS, fetchAll, snapshots } from '@/lib/snapshotClient';
import { monthEnd, monthShift, monthlyPoints } from '@/lib/trendSeries';
import { reportError } from '@/lib/analytics';

pdfMake.vfs = pdfFonts.vfs;

/** "Aug 2025" from a "YYYY-MM" PPM month key. */
function ppmMonthLabel(monthKey: string): string {
  const d = new Date(`${monthKey}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return monthKey;
  return d.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' });
}

export interface ReportBranding { name: string; primaryColor: string; logoUrl?: string | null }

/** Rendered export handed back so the caller can persist it as an artifact. */
export interface GeneratedFortressPdf {
  blob: Blob;
  fileName: string;
  buildingId: string;
  reportType: ReportType;
  /** Lifecycle status of the report at the moment this PDF was rendered (E2). */
  reportStatus: string;
}

const FLAGGED = new Set(['poor', 'critical']);
/** Cap embedded photos so the PDF stays a sane size (AbaQulusi annual = 121). */
export const MAX_EMBEDDED_PHOTOS = 120;
const PHOTO_MAX_DIM = 1100;
const PHOTO_QUALITY = 0.62;

type PhotoRef = { ref?: string; path: string; caption?: string };

/**
 * Resolve a stored photo path to a downscaled JPEG data URL (browser only). Null on ANY failure —
 * a bad photo is skipped and counted under "not embedded" (annualPhotosOmitted), never allowed to
 * fail the export, and never handed to pdfmake as a base64'd error body. There is deliberately no
 * FileReader fallback here: if the browser cannot decode it, pdfmake cannot either.
 */
async function embedPhoto(path: string): Promise<string | null> {
  try {
    const signed = await resolveStorageUrl('/object/tenant-documents/' + path);
    if (!signed) return null;
    const blob = await fetchImageBlob(signed);
    return await downscaleToDataUrl(blob);
  } catch (e) {
    if (import.meta.env.DEV) console.warn('report photo skipped:', path, (e as Error)?.message ?? String(e));
    return null;
  }
}

/**
 * Display name for the inspector. `profiles` is readable only by the person themselves and by
 * admins/managers (p_select), so a field user exporting a colleague's inspection would read
 * nothing from the table; the `building_members` RPC (security definer, scoped by
 * can_access_building) is the path the evidence pack already uses for names. Non-fatal — the
 * name is provenance, not the inspection itself: on any failure, or an inspector no longer a
 * member of the building, fall back to the denormalised report author name when the ids match,
 * else null (the doc then prints the date alone).
 */
async function inspectorName(buildingId: string, userId: string, fallback: string | null): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('building_members', { b: buildingId });
    if (error) throw error;
    const row = ((data ?? []) as { id: string; full_name: string | null }[]).find((m) => m.id === userId);
    const name = row?.full_name?.trim();
    if (name) return name;
  } catch (e) {
    if (import.meta.env.DEV) console.warn('Inspector name lookup failed:', e);
  }
  return fallback?.trim() || null;
}

async function downscaleToDataUrl(blob: Blob): Promise<string> {
  const bmp = await bitmapFromBlob(blob);
  const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d ctx');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
}

/**
 * LOGO ONLY. The logo is embedded as-is (pdfmake fits it to 130×40; no canvas pass, so a PNG keeps
 * its transparency). It is safe only because fetchImageBlob has already refused a non-2xx, a
 * non-image and an SVG before this reads the body. Photos never come through here.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}


/**
 * Unwrap a PostgREST result, failing loudly.
 *
 * Every read here used to be `(await …).data ?? []`, which turns a permissions change, a
 * renamed column or a transient 5xx into an empty section. The PDF is then DOWNLOADED and
 * SAVED as a versioned artifact that silently lacks that section — indistinguishable from
 * a report the centre genuinely left blank. Better to fail the export and say why.
 */
function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T | null {
  if (res.error) throw new Error(`Could not load ${what} for this report: ${res.error.message}`);
  return res.data;
}

/**
 * The PPM table for the ops PDF, from the MERGED grid (override > derived execution >
 * legacy `months`) over the report's fiscal window — a plan-backed row whose `months` is
 * empty still prints the months its completed occurrences fell in. Exported for the test.
 */
export async function fetchPpmForPdf(
  reportId: string,
  reportPeriod: string | null,
): Promise<{ ppm: NonNullable<ReportData['ppm']>; ppmStatusNote: string | null }> {
  const rows = unwrap(await supabase.from('ppm_services').select('id, building_id, service_name, frequency, plan_service_id, overrides, months')
    .eq('report_id', reportId).order('sort_order', { ascending: true, nullsFirst: false }), 'the PPM schedule') ?? [];
  const grids = await fetchMergedPpmGrids(rows, fiscalWindow(reportPeriod));
  const ppm = rows.map((p) => ({
    service: p.service_name ?? '',
    frequency: p.frequency ?? null,
    servicedMonths: doneMonthsFromGrid(grids.get(p.id) ?? {}).map(ppmMonthLabel),
  }));
  // Only status === 'done' counts as serviced. A schedule whose cells carry no status in any
  // layer (the source workbook records it as a fill colour, which has no agreed meaning yet)
  // would otherwise print a full table of "—" and read as "nothing was serviced".
  const anyStatus = rows.some((p) => gridHasData(grids.get(p.id) ?? {}));
  const ppmStatusNote = rows.length && !anyStatus
    ? 'Service status is recorded in the source workbook as a cell colour with no legend, so no month can be reported as serviced or missed. The schedule itself is shown below.'
    : null;
  return { ppm, ppmStatusNote };
}

/**
 * Render the report. `opts.download` defaults to true (the user pressed Export PDF); approval's
 * auto-export passes `download: false`, because nobody asked for a file — the blob is saved as
 * the report's artifact instead.
 */
export async function generateReportPdf(
  reportId: string,
  branding: ReportBranding,
  opts: { download?: boolean } = {},
): Promise<GeneratedFortressPdf> {
  const color = /^#([a-f\d]{6})$/i.test(branding.primaryColor) ? branding.primaryColor : '#2563eb';
  // maybeSingle() responses go through a variable before unwrap(): passing the awaited
  // expression inline makes TypeScript infer the row type as `never`.
  const reportRes = await fdb.from('reports').select('*').eq('id', reportId).maybeSingle();
  const report = unwrap(reportRes, 'the report');
  if (!report) throw new Error('Report not found, or you do not have access to it.');
  const managers = [report.asset_manager, report.ops_manager, report.centre_manager].filter(Boolean) as string[];

  let logoDataUrl: string | null = null;
  if (branding.logoUrl) {
    try {
      const signed = await resolveStorageUrl(branding.logoUrl);
      // pdfmake embeds PNG and JPEG only: an SVG logo (accepted by Settings before S2) is skipped
      // and the org name prints in its place, exactly as when no logo is set.
      if (signed) logoDataUrl = await blobToDataUrl(await fetchImageBlob(signed, { rejectSvg: true }));
    } catch (e) {
      if (import.meta.env.DEV) console.warn('report logo skipped:', (e as Error)?.message ?? String(e));
    }
  }

  const data: ReportData = {};

  if (report.report_type === ('ops_monthly' as ReportType)) {
    const scoreRes = await fdb.from('compliance_scores').select('compliance_pct')
      .eq('report_id', reportId).maybeSingle();
    data.compliancePct = unwrap(scoreRes, 'the compliance score')?.compliance_pct ?? null;
    const asmtRes = await fdb.from('compliance_assessments').select('id')
      .eq('report_id', reportId).maybeSingle();
    const asmt = unwrap(asmtRes, 'the OHS assessment');
    if (asmt) {
      const resp = unwrap(await fdb.from('compliance_responses')
        .select('response,comment,compliance_template_items(item_no,prompt)')
        .eq('assessment_id', asmt.id), 'the OHS responses') ?? [];
      data.compliance = resp.map((r) => ({
        itemNo: r.compliance_template_items?.item_no ?? '',
        prompt: r.compliance_template_items?.prompt ?? '',
        mark: MARK[r.response ?? ''] ?? '',
        comment: r.comment ?? '',
      }));
      // Hazard log rows hang off the assessment, not the report.
      const haz = unwrap(await fdb.from('hazard_log')
        .select('hazard,corrective_action,status,sort_order')
        .eq('assessment_id', asmt.id)
        .order('sort_order', { ascending: true, nullsFirst: false }), 'the hazard log') ?? [];
      data.hazards = haz.map((h) => ({
        hazard: h.hazard ?? '',
        correctiveAction: h.corrective_action ?? '',
        status: (h.status ?? '').replace(/_/g, ' '),
      }));
    }

    // Trend: the last twelve month-end snapshot rows for this building (R4a). Unlike every other section
    // this read is NOT fatal: the section is derived from a table that may not exist yet (the migration
    // is staged before prod) and is a nicety, not report content — failing every OPS export over it would
    // block the reports the trend is drawn from. On error the section is omitted and the failure is
    // reported (Sentry + dev console) so it does not pass for "no snapshots yet", which merely yields
    // blank months.
    try {
      const endPeriod = report.report_period.slice(0, 10);
      const snapRes = await fetchAll(() => snapshots(TREND_COLUMNS).eq('building_id', report.building_id)
        .gte('day', `${monthShift(endPeriod, 11)}-01`).lte('day', monthEnd(endPeriod))
        .order('day', { ascending: true }));
      if (snapRes.error) throw new Error(`Could not read the trend snapshots: ${snapRes.error.message}`);
      data.trend = monthlyPoints(snapRes.data, endPeriod, 12);
    } catch (err) {
      reportError(err, { where: 'generateReportPdf.trend', reportId });
      if (import.meta.env.DEV) console.warn('[generateReportPdf] trend snapshots unavailable; the Trend section is omitted:', err);
    }

    // Monthly building inspection (template walk-through). Same honesty rule as the
    // annual branch: an inspection row exists the moment the tab is opened, so only
    // responses prove anything was actually inspected.
    //
    // Fetched as a LIST, never maybeSingle(): report_id is NOT unique on
    // building_inspections — the section hook keeps one row per (report, template
    // version), so re-versioning the monthly template mid-period leaves two rows for
    // one report, and maybeSingle() then errors, failing the whole export. The newest
    // row that actually holds responses wins.
    const opsInspRows = unwrap(await fdb.from('building_inspections').select('id,template_id')
      .eq('report_id', reportId).order('created_at', { ascending: false }), 'the building inspection') ?? [];
    for (const opsInsp of opsInspRows) {
      if (!opsInsp.template_id) continue;
      const resps = unwrap(await fdb.from('inspection_responses')
        .select('template_item_id,acceptable,action_required,comment')
        .eq('inspection_id', opsInsp.id), 'the inspection responses') ?? [];
      if (!resps.length) continue;
      const items = unwrap(await fdb.from('inspection_template_items')
        .select('id,section_title,item_label,sort_order')
        .eq('template_id', opsInsp.template_id).order('sort_order'), 'the inspection template') ?? [];
      const byItem = new Map(resps.map((r) => [r.template_item_id, r]));
      const ACCEPTABLE: Record<string, string> = { yes: 'Yes', no: 'No', na: 'N/A' };
      const ACTION: Record<string, string> = { none: 'None', within_3_months: 'Within 3 months', immediate: 'Immediate' };
      const secMap = new Map<string, { label: string; acceptable: string | null; action: string | null; comment: string | null }[]>();
      for (const it of items) {
        const r = byItem.get(it.id);
        const title = it.section_title ?? 'Other';
        const arr = secMap.get(title) ?? [];
        arr.push({
          label: it.item_label ?? '',
          acceptable: r?.acceptable ? (ACCEPTABLE[r.acceptable] ?? r.acceptable) : null,
          action: r?.action_required ? (ACTION[r.action_required] ?? r.action_required) : null,
          comment: r?.comment ?? null,
        });
        secMap.set(title, arr);
      }
      data.buildingInspection = [...secMap.entries()].map(([title, its]) => ({ section: title, items: its }));
      break;
    }
    const rec = unwrap(await fdb.from('expense_recoveries').select('service,ytd_expense,ytd_recovery,pct_recovery').eq('report_id', reportId), 'expense recoveries') ?? [];
    data.recoveries = rec.map((r) => ({ service: r.service ?? '', ytdExpense: r.ytd_expense, ytdRecovery: r.ytd_recovery, pctRecovery: r.pct_recovery == null ? '—' : `${Math.round(Number(r.pct_recovery) * 10) / 10}%` }));

    const { ppm, ppmStatusNote } = await fetchPpmForPdf(reportId, report.report_period);
    data.ppm = ppm;
    if (ppmStatusNote) data.ppmStatusNote = ppmStatusNote;

    const util = unwrap(await fdb.from('utility_readings')
      .select('utility,meter_name,reading,unit,category,pct_of_bulk,comment')
      .eq('report_id', reportId), 'utility readings') ?? [];
    data.utilities = util.map((u) => ({
      utility: u.utility ?? null,
      meter: u.meter_name ?? '',
      reading: u.reading == null ? null : Number(u.reading),
      unit: u.unit ?? null,
      category: u.category ?? null,
      // numeric comes back as a string from PostgREST; round so a repeating decimal
      // does not print as "0.8638239339752407%".
      pctOfBulk: u.pct_of_bulk == null ? null : Math.round(Number(u.pct_of_bulk) * 10) / 10,
      comment: u.comment ?? null,
    }));

    // Borehole/solar yields — the second grid of the Utilities section. % achieved is
    // recomputed from the raw yields (same rule as the in-app grid), never read stored.
    const uy = unwrap(await fdb.from('utility_yields')
      .select('source,predicted_yield,actual_yield,unit,comment')
      .eq('report_id', reportId), 'the borehole/solar yields') ?? [];
    const SOURCE_LABEL: Record<string, string> = { borehole: 'Borehole', solar: 'Solar' };
    data.utilityYields = uy.map((y) => {
      const pred = y.predicted_yield == null ? null : Number(y.predicted_yield);
      const act = y.actual_yield == null ? null : Number(y.actual_yield);
      const pct = pred && act != null ? Math.round((act / pred) * 1000) / 10 : null;
      const unit = y.unit ? ` ${y.unit}` : '';
      return {
        source: SOURCE_LABEL[y.source ?? ''] ?? (y.source ?? ''),
        predicted: pred == null ? '—' : `${pred}${unit}`,
        actual: act == null ? '—' : `${act}${unit}`,
        pctAchieved: pct == null ? '—' : `${pct}%`,
        comment: y.comment ?? '',
      };
    });

    const mf = unwrap(await fdb.from('masterfile_items')
      .select('document_label,on_file,comment').eq('report_id', reportId), 'the masterfile register') ?? [];
    data.masterfile = mf.map((m) => ({
      document: m.document_label ?? '',
      onFile: m.on_file ?? 'unassessed',
      comment: m.comment ?? null,
    }));

  }

  if (report.report_type === ('cm_monthly' as ReportType)) {
    const turn = unwrap(await fdb.from('tenant_turnover').select('tenant_name,annual_trading_density,annual_growth_pct,rank_band').eq('report_id', reportId), 'tenant turnover') ?? [];
    data.turnover = turn.map((t) => ({
      tenant: t.tenant_name ?? '',
      density: String(t.annual_trading_density ?? '—'),
      growth: t.annual_growth_pct != null ? `${Math.round(Number(t.annual_growth_pct) * 1000) / 10}%` : '—',
      band: t.rank_band ?? '',
    }));
    const inc = unwrap(await fdb.from('security_incidents').select('count,period,incident_type,narrative').eq('report_id', reportId), 'security incidents') ?? [];
    data.incidentsTotal = inc.length ? inc.reduce((a, i) => a + (i.count ?? 0), 0) : null;
    if (inc.length) {
      // The matrix spans the whole financial year, so it is summarised along each axis
      // rather than printed as a 12 x 28 grid that cannot fit the page.
      const prettyType = (t: string) => t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
      const byMonth = new Map<string, number>();
      const byType = new Map<string, number>();
      for (const i of inc) {
        const n = Number(i.count ?? 0);
        const p = String(i.period ?? '').slice(0, 7);
        if (p) byMonth.set(p, (byMonth.get(p) ?? 0) + n);
        const t = String(i.incident_type ?? '');
        if (t) byType.set(t, (byType.get(t) ?? 0) + n);
      }
      data.incidentsByMonth = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, count]) => ({ month, count }));
      data.incidentsByType = [...byType.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type: prettyType(type), count }));
      // Free-text narratives captured against individual incident rows — the axis
      // summaries above lose them, so they are exported alongside.
      data.incidentNarratives = inc
        .filter((i) => (i.narrative ?? '').trim() !== '')
        .sort((a, b) => String(a.period ?? '').localeCompare(String(b.period ?? '')))
        .map((i) => ({
          period: String(i.period ?? '').slice(0, 7),
          type: prettyType(String(i.incident_type ?? '')),
          narrative: String(i.narrative).trim(),
        }));
    }

    // Page 2 / Page 3 blocks. These were ingested but had no route into the PDF, so a CM
    // report printed its tenant tables and silently omitted head counts, leasing, trading
    // hours, arrears and utilities entirely.
    const numf = (v: unknown, dp = 0) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-ZA', { minimumFractionDigits: dp, maximumFractionDigits: dp }));

    // Building turnover — one record per report. Growth % is recomputed from the raw
    // totals, the same rule as the in-app section.
    const bt = unwrap(await fdb.from('building_turnover')
      .select('current_month_total,previous_year_month_total,annual_trading_density,spend_per_head,cm_comment')
      .eq('report_id', reportId), 'building turnover') ?? [];
    if (bt.length) {
      const b = bt[0];
      const cur = b.current_month_total == null ? null : Number(b.current_month_total);
      const prev = b.previous_year_month_total == null ? null : Number(b.previous_year_month_total);
      const growth = cur != null && prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
      data.buildingTurnover = ([
        ['Current month total', numf(b.current_month_total, 2)],
        ['Prev-year month total', numf(b.previous_year_month_total, 2)],
        ['Growth % (computed)', growth == null ? '' : `${growth}%`],
        ['Annual trading density', numf(b.annual_trading_density, 2)],
        ['Spend per head', numf(b.spend_per_head, 2)],
        ['CM comment', b.cm_comment ?? ''],
      ] as [string, string][]).filter(([, v]) => v !== '').map(([label, value]) => ({ label, value }));
    }

    const cat = unwrap(await fdb.from('category_turnover')
      .select('category,monthly_turnover,trading_density,rank,comment')
      .eq('report_id', reportId).order('rank', { ascending: true, nullsFirst: false }), 'category turnover') ?? [];
    data.categoryTurnover = cat.map((c) => ({
      category: c.category ?? '', monthly: numf(c.monthly_turnover, 2), density: numf(c.trading_density, 2),
      rank: c.rank == null ? '' : String(c.rank), comment: c.comment ?? '',
    }));

    const RESOURCE_LABEL: Record<string, string> = { cpf: 'CPF', police: 'Police', authority: 'Authority' };
    const lr = unwrap(await fdb.from('local_resources_contacts')
      .select('resource_type,name,last_meeting_date,frequency,contact_person,contact_number,sort_order')
      .eq('report_id', reportId).order('sort_order', { ascending: true, nullsFirst: false }), 'local resources') ?? [];
    data.localResources = lr.map((r) => ({
      type: RESOURCE_LABEL[r.resource_type ?? ''] ?? (r.resource_type ?? ''),
      name: r.name ?? '', lastMeeting: r.last_meeting_date ?? '', frequency: r.frequency ?? '',
      contact: r.contact_person ?? '', number: r.contact_number ?? '',
    }));

    const ff = unwrap(await fdb.from('footfall_counts')
      .select('entrance,month_count,ytd_count,prev_ytd,variance_pct').eq('report_id', reportId), 'head counts') ?? [];
    data.footfall = ff.map((f2) => ({
      entrance: f2.entrance ?? '', month: numf(f2.month_count), ytd: numf(f2.ytd_count),
      prevYtd: numf(f2.prev_ytd), variance: f2.variance_pct == null ? '' : `${Math.round(Number(f2.variance_pct) * 100) / 100}%`,
    }));

    const tf = unwrap(await fdb.from('toilet_fund')
      .select('issued_bales,stock_on_hand_bales,actual_banked,budget,variance,profit_per_roll')
      .eq('report_id', reportId), 'the toilet fund') ?? [];
    if (tf.length) {
      const t = tf[0];
      data.toiletFund = ([
        ['Issued (bales)', numf(t.issued_bales)], ['Stock on hand (bales)', numf(t.stock_on_hand_bales)],
        ['Actual banked', numf(t.actual_banked, 2)], ['Budget', numf(t.budget, 2)],
        ['Variance', numf(t.variance, 2)], ['Profit per roll', numf(t.profit_per_roll, 2)],
      ] as [string, string][]).filter(([, v]) => v !== '').map(([label, value]) => ({ label, value }));
    }

    const vac = unwrap(await fdb.from('vacancies')
      .select('shop_no,area,budget_relet_rpm,gross_mandate_rpm,comment').eq('report_id', reportId), 'vacancies') ?? [];
    data.vacancies = vac.map((v) => ({
      shop: v.shop_no ?? '', area: numf(v.area, 2), budgetRelet: numf(v.budget_relet_rpm, 2),
      grossMandate: numf(v.gross_mandate_rpm, 2), comment: v.comment ?? '',
    }));

    const wl = unwrap(await fdb.from('leasing_waitlist')
      .select('trading_as,contact,category,optimal_size,comment').eq('report_id', reportId), 'the waiting list') ?? [];
    data.waitlist = wl.map((w) => ({
      tradingAs: w.trading_as ?? '', contact: w.contact ?? '', category: w.category ?? '',
      size: w.optimal_size ?? '', comment: w.comment ?? '',
    }));

    const mv = unwrap(await fdb.from('tenant_movements')
      .select('trading_as,movement_type,vacate_or_bo_date,prelim_inspection_date,take_on_back_date,first_trade_date,comment')
      .eq('report_id', reportId), 'tenant movements') ?? [];
    data.movements = mv.map((m) => ({
      tradingAs: m.trading_as ?? '', type: (m.movement_type ?? '').replace(/_/g, ' '),
      vacateDate: m.vacate_or_bo_date ?? '', prelim: m.prelim_inspection_date ?? '',
      takeOn: m.take_on_back_date ?? '', firstTrade: m.first_trade_date ?? '', comment: m.comment ?? '',
    }));

    const th = unwrap(await fdb.from('trading_hour_breaches')
      .select('tenant_name,date,time,letter_sent_to,comment').eq('report_id', reportId), 'trading-hour breaches') ?? [];
    data.tradingBreaches = th.map((t) => ({
      tenant: t.tenant_name ?? '', date: t.date ?? '', time: (t.time ?? '').slice(0, 5),
      letterTo: t.letter_sent_to ?? '', comment: t.comment ?? '',
    }));

    const ar = unwrap(await fdb.from('tenant_arrears')
      .select('trading_as,deposit_held,closing_balance,contact').eq('report_id', reportId), 'arrears') ?? [];
    data.arrears = ar.map((a) => ({
      tradingAs: a.trading_as ?? '', deposit: numf(a.deposit_held, 2),
      balance: numf(a.closing_balance, 2), contact: a.contact ?? '',
    }));

    const ls = unwrap(await fdb.from('loadshedding_log')
      .select('day,week_no,stage,hours,diesel_litres,diesel_date').eq('report_id', reportId), 'the loadshedding log') ?? [];
    data.loadshedding = ls.map((l) => ({
      day: l.day ?? '', week: l.week_no == null ? '' : String(l.week_no), stage: l.stage ?? '',
      hours: l.hours == null ? '' : String(Math.round(Number(l.hours) * 100) / 100),
      litres: numf(l.diesel_litres), dieselDate: l.diesel_date ?? '',
    }));

    const si = unwrap(await fdb.from('service_interruptions')
      .select('date,interruption_type,start_time,end_time,total_hours,council_ref,comment')
      .eq('report_id', reportId), 'service interruptions') ?? [];
    data.interruptions = si.map((i) => ({
      date: i.date ?? '', type: i.interruption_type ?? '', start: (i.start_time ?? '').slice(0, 5),
      end: (i.end_time ?? '').slice(0, 5),
      hours: i.total_hours == null ? '' : String(Math.round(Number(i.total_hours) * 100) / 100),
      ref: i.council_ref ?? '', comment: i.comment ?? '',
    }));

    // Tenant compliance and shop spec are the substance of a CM report and were never
    // exported — a CM PDF was a cover page. Tenants are resolved with a second query
    // rather than an embedded select so this does not depend on FK relationship naming.
    // The most consequential read in the CM branch: a failure here silently blanks the
    // shop number and tenant name on EVERY row of all six tenant tables.
    const tenants = unwrap(await fdb.from('building_tenants')
      .select('id,shop_number,name,area').eq('building_id', report.building_id), 'the tenant register') ?? [];
    const tenantById = new Map(tenants.map((t) => [t.id, t]));
    const sortByShop = <T extends { shop: string }>(rows: T[]) =>
      rows.sort((a, b) => a.shop.localeCompare(b.shop, undefined, { numeric: true }));

    const TC_COLS = [
      'tenant_id', 'occupancy_cert_no', 'electrical_coc_cert_no', 'electrical_coc_date', 'lease_clause_no',
      'hvac_responsibility', 'hvac_records_current', 'hvac_handover_month',
      'generator_responsibility', 'generator_records_current',
      'sprinkler_dedicated', 'fire_sprinkler_weekly', 'fire_sprinkler_annual', 'fire_sprinkler_3yr',
      'smoke_extraction_dedicated', 'smoke_extraction_annual_service',
      'smoke_detection_dedicated', 'smoke_detection_annual_service', 'handheld_fire_current',
      'ohs_risks', 'evac_plan_displayed', 'food_extraction_cert', 'grease_trap_clean',
      'fire_blanket', 'gas_coc', 'flammable_liquid_cert',
    ] as const;
    // NOTE: the unwrap() wrapper here is load-bearing. A previous edit dropped it and
    // left `(await …, 'tenant compliance')` — a comma expression that evaluates to the
    // LABEL STRING, which then crashed every CM export at `.map`.
    const tc = unwrap(await fdb.from('tenant_compliance')
      .select(TC_COLS.join(','))
      .eq('report_id', reportId), 'tenant compliance') ?? [];
    if (tc.length) {
      type TcRow = Record<(typeof TC_COLS)[number], string | null>;
      data.tenantCompliance = sortByShop((tc as unknown as TcRow[]).map((r) => {
        const t = tenantById.get(r.tenant_id as string);
        return {
          shop: t?.shop_number ?? '',
          tenant: t?.name ?? '',
          gla: t?.area == null ? null : Number(t.area),
          occupancyCert: r.occupancy_cert_no,
          cocNumber: r.electrical_coc_cert_no,
          cocDate: r.electrical_coc_date,
          leaseClause: r.lease_clause_no,
          hvacResponsibility: r.hvac_responsibility,
          hvacRecords: r.hvac_records_current,
          hvacHandover: r.hvac_handover_month,
          generatorResponsibility: r.generator_responsibility,
          generatorRecords: r.generator_records_current,
          sprinklerDedicated: r.sprinkler_dedicated,
          sprinklerWeekly: r.fire_sprinkler_weekly,
          sprinklerAnnual: r.fire_sprinkler_annual,
          sprinkler3yr: r.fire_sprinkler_3yr,
          smokeExtractionDedicated: r.smoke_extraction_dedicated,
          smokeExtractionService: r.smoke_extraction_annual_service,
          smokeDetectionDedicated: r.smoke_detection_dedicated,
          smokeDetectionService: r.smoke_detection_annual_service,
          handheldFire: r.handheld_fire_current,
          ohsRisks: r.ohs_risks,
          evacPlan: r.evac_plan_displayed,
          foodExtraction: r.food_extraction_cert,
          greaseTrap: r.grease_trap_clean,
          fireBlanket: r.fire_blanket,
          gasCoc: r.gas_coc,
          flammableLiquid: r.flammable_liquid_cert,
        };
      }));
    }

    const SS_COLS = [
      'tenant_id', 'db_phase', 'actual_amps', 'lease_amps', 'generator_connection',
      'hvac_units', 'hvac_btu', 'hvac_gas', 'lighting_type', 'shopfront_type', 'roller_shutter_type',
    ] as const;
    const ss = unwrap(await fdb.from('tenant_shop_spec')
      .select(SS_COLS.join(','))
      .eq('building_id', report.building_id).eq('is_current', true), 'shop specifications') ?? [];
    if (ss.length) {
      type SsRow = Record<(typeof SS_COLS)[number], string | null>;
      data.shopSpec = sortByShop((ss as unknown as SsRow[]).map((r) => {
        const t = tenantById.get(r.tenant_id as string);
        return {
          shop: t?.shop_number ?? '',
          tenant: t?.name ?? '',
          phase: r.db_phase,
          actualAmps: r.actual_amps,
          leaseAmps: r.lease_amps,
          generator: r.generator_connection,
          hvac: r.hvac_units,
          hvacBtu: r.hvac_btu,
          hvacGas: r.hvac_gas,
          lighting: r.lighting_type,
          shopfront: r.shopfront_type,
          rollerShutter: r.roller_shutter_type,
        };
      }));
    }
  }

  if (report.report_type === ('annual_inspection' as ReportType)) {
    // Same non-unique report_id caveat as the OPS branch: building_inspections can hold
    // one row per template version for a single report, so fetch a list and use the
    // newest row that actually holds responses. The old maybeSingle() here returned
    // null on duplicates, which silently blanked the whole condition inspection.
    const inspRows = unwrap(await fdb.from('building_inspections').select('id,template_id,inspected_by,inspection_date')
      .eq('report_id', reportId).order('created_at', { ascending: false }), 'the building inspection') ?? [];
    for (const insp of inspRows) {
      if (!insp.template_id) continue;
      const resps = unwrap(await fdb.from('inspection_responses')
        .select('template_item_id,condition_rating,recommendation,comment,capex_estimate,applicable,photo_urls,detail')
        .eq('inspection_id', insp.id), 'inspection responses') ?? [];
      // An inspection row can exist with no responses at all (the row is created the
      // moment someone opens the tab). Rendering the template anyway prints every item
      // as a blank line, which reads as "inspected, all fine" rather than "not
      // inspected" — skip to the next candidate row, or leave the section unset so it
      // is named under "Not captured this period" instead.
      if (!resps.length) continue;
      const items = unwrap(await fdb.from('inspection_template_items')
        .select('id,section_no,section_title,item_label,sort_order,field_set')
        .eq('template_id', insp.template_id).order('sort_order'), 'the inspection template') ?? [];
      const byItem = new Map(resps.map((r) => [r.template_item_id, r]));

      let embedded = 0;
      let totalPhotoRefs = 0;
      let flagged = 0;
      let capexTotal = 0;
      const sectionMap = new Map<string, AnnualItem[]>();
      for (const it of items) {
        const r = byItem.get(it.id);
        const rating = (r?.condition_rating as string | null) ?? null;
        if (rating && FLAGGED.has(rating)) flagged += 1;
        if (r?.capex_estimate) capexTotal += Number(r.capex_estimate);
        const refs = (Array.isArray(r?.photo_urls) ? r?.photo_urls : []) as unknown as PhotoRef[];
        const photos: EmbeddedPhoto[] = [];
        for (const ref of refs) {
          // Count every photo on file, even past the cap, so the PDF can say how many
          // it does NOT show instead of truncating silently.
          totalPhotoRefs += 1;
          if (embedded >= MAX_EMBEDDED_PHOTOS) continue;
          const dataUrl = await embedPhoto(ref.path);
          if (dataUrl) { photos.push({ dataUrl, caption: ref.caption ?? ref.ref ?? null }); embedded += 1; }
        }
        // Per-archetype detail fields in catalogue order, then any extra keys.
        const detail = (r?.detail && typeof r.detail === 'object' && !Array.isArray(r.detail))
          ? (r.detail as Record<string, unknown>)
          : null;
        const fields: { label: string; value: string }[] = [];
        if (detail) {
          const catalogue = ANNUAL_FIELD_SETS[it.field_set] ?? [];
          const seen = new Set<string>();
          for (const f of catalogue) {
            const v = detail[f.key];
            if (v != null && String(v).trim() !== '') { fields.push({ label: f.label, value: String(v) }); seen.add(f.key); }
          }
          for (const [k, v] of Object.entries(detail)) {
            if (seen.has(k) || v == null || String(v).trim() === '') continue;
            fields.push({ label: k.replace(/\s*[:?]\s*$/, '').trim(), value: String(v) });
          }
        }
        const title = it.section_title ?? 'Other';
        const arr = sectionMap.get(title) ?? [];
        arr.push({
          label: it.item_label ?? '',
          rating,
          recommendation: r?.recommendation ?? null,
          comment: r?.comment ?? null,
          capexEstimate: r?.capex_estimate ?? null,
          applicable: r?.applicable ?? true,
          fields,
          photos,
        });
        sectionMap.set(title, arr);
      }
      data.annualSections = [...sectionMap.entries()].map(([title, its]) => ({ title, items: its }));
      data.annualFlagged = flagged;
      data.annualCapexTotal = capexTotal || null;
      data.annualPhotosTotal = totalPhotoRefs;
      if (totalPhotoRefs > embedded) data.annualPhotosOmitted = totalPhotoRefs - embedded;
      // Provenance off the winning row (S3): defaults stamp both columns at insert; the backfill
      // attributed older rows to the report author, so author_name is the right fallback when the ids match.
      data.annualInspectionDate = insp.inspection_date ?? null;
      data.annualInspectedBy = insp.inspected_by
        ? await inspectorName(report.building_id, insp.inspected_by, insp.inspected_by === report.author_id ? report.author_name : null)
        : null;
      break;
    }
    // The column is `item`, not `description` - selecting a column that does not exist
    // makes PostgREST reject the whole request, so the Capex Register would have failed
    // for any report that actually had capex rows. It reads empty today only because the
    // table is empty. `motivation` is the item's justification and prints beside it.
    const capex = unwrap(await fdb.from('capex_items')
      .select('item,motivation,estimate,year,priority,status').eq('report_id', reportId), 'the capex register') ?? [];
    data.capex = capex.map((c) => ({
      description: [c.item, c.motivation].filter(Boolean).join(' — ') || '',
      estimate: c.estimate ?? null,
      year: c.year == null ? '' : String(c.year),
      priority: c.priority ?? '',
      status: c.status ?? '',
    }));

  }

  // ---- Electrical compliance (live, insight-linker) --------------------------------
  // Runs for EVERY report type. It used to sit inside the annual_inspection branch, so
  // 69 of 72 reports in production could never show it — and annual is the type almost
  // never produced. insight-linker is the system of record for CoC.
  //
  // Nulls are preserved rather than coerced to '': the renderer distinguishes "no
  // certificate on file" from "" and prints an em-dash, and `filled` below needs to see
  // that a table of rows carries no actual CoC data.
  try {
    const elec = await fetchReportElectricalCompliance(report.building_id);
    data.electricalLinked = elec.linked;
    if (elec.linked) {
      data.electricalCompliance = elec.rows.map((r) => ({
        shop_number: r.shop_number ?? '', tenant_name: r.tenant_name ?? '',
        coc_number: r.coc_number, coc_type: r.coc_type, coc_status: r.coc_status,
        coc_issue_date: r.coc_issue_date, coc_expiry_date: r.coc_expiry_date,
        certificate_url: r.certificate_url ?? '', certificate_name: r.certificate_name ?? '',
      }));
    }
  } catch (e) {
    // A read failure must not print as "carries no entries for this period" in a
    // downloaded, versioned artifact — that is the same lie `unwrap` exists to prevent.
    data.electricalError = (e as Error)?.message ?? 'Electrical compliance could not be read.';
  }

  // Building-inspection and OHS-act answers, grouped by the sheet section they came from.
  const chk = unwrap(await fdb.from('report_checklist_items')
    .select('section_key,item_key,response,value_text,value_date,comment,sort_order')
    .eq('report_id', reportId)
    .order('section_key', { ascending: true })
    .order('sort_order', { ascending: true, nullsFirst: false }), 'the checklist') ?? [];
  const CHECKLIST_LABEL: Record<string, string> = {
    building_inspection: 'Building Inspection',
    ohs: 'OHS Act Report',
    general: 'General',
  };
  // OHS answers are keyed by clause number. The source sheet writes them with commas
  // ("2,6,2") while the OHS template numbers them with dots ("2.6.2"), so without this
  // normalisation the section prints ~57 rows of bare codes and no question text —
  // unreadable, and indistinguishable from a fault. 55 of 60 numeric codes resolve.
  const promptByNo = new Map<string, string>();
  try {
    const tplItems = (await fdb.from('compliance_template_items').select('item_no,prompt')).data ?? [];
    for (const t of tplItems) if (t.item_no) promptByNo.set(String(t.item_no), t.prompt ?? '');
  } catch { /* prompts are an enrichment; the codes still print without them */ }
  const resolveItem = (key: string): string => {
    const prompt = promptByNo.get(key.replace(/,/g, '.'));
    return prompt ? `${key.replace(/,/g, '.')} — ${prompt}` : key;
  };

  const grouped = new Map<string, { item: string; response: string | null; value: string | null; comment: string | null }[]>();
  for (const c of chk) {
    const label = CHECKLIST_LABEL[c.section_key ?? ''] ?? (c.section_key ?? 'Other');
    const arr = grouped.get(label) ?? [];
    // An answer can be text, a date, or both (separate columns in the grid). Selecting
    // value_date and then dropping it printed every date answer as blank.
    const value = [c.value_text, c.value_date]
      .filter((v): v is string => v != null && String(v).trim() !== '')
      .join(' · ');
    arr.push({
      item: resolveItem(c.item_key ?? ''),
      response: c.response ?? null,
      value: value || null,
      comment: c.comment ?? null,
    });
    grouped.set(label, arr);
  }
  data.checklist = [...grouped.entries()].map(([sectionName, items]) => ({ section: sectionName, items }));

  // Section narratives (all report types) — fetched generically so any section_key
  // renders (building_overview, loadshedding, maintenance_project, security_incidents, …).
  const narr = unwrap(await fdb.from('report_narratives')
    .select('section_key,heading,body,status_flag,sort_order')
    .eq('report_id', reportId)
    .order('sort_order', { ascending: true, nullsFirst: false }), 'the narratives') ?? [];
  const narrKeys = new Set(narr.filter((n) => (n.body ?? '').trim() !== '').map((n) => n.section_key));
  data.narratives = narr
    .filter((n) => (n.body ?? '').trim() !== '')
    .map((n) => ({ heading: n.heading ?? '', body: n.body ?? '', statusFlag: n.status_flag ?? null }));

  // Name the sections this report type expects but which carry nothing, so a short PDF is
  // legibly incomplete instead of looking like the whole report. Every expected section is
  // now genuinely fetched above (through unwrap, which fails the export loudly on a read
  // error), so this consults the in-memory data — a section can no longer be listed as
  // "not captured" while its table prints, or print nothing while counted as filled.
  {
    const hasInspection = !!data.checklist?.some((g) => g.section === 'Building Inspection');
    const hasOhsAnswers = !!data.checklist?.some((g) => g.section === 'OHS Act Report');
    const filled: Record<string, boolean> = {
      operational_overview: !!data.narratives?.length,
      report_checklist: !!data.checklist?.length,
      ohs_compliance: !!(data.compliance?.length || data.compliancePct != null || hasOhsAnswers),
      hazard_log: !!data.hazards?.length,
      building_inspection: hasInspection || !!data.buildingInspection?.length,
      expense_recoveries: !!data.recoveries?.length,
      utilities: !!(data.utilities?.length || data.utilityYields?.length),
      ppm: !!data.ppm?.length,
      masterfile: !!data.masterfile?.length,
      building_overview: narrKeys.has('building_overview'),
      local_resources: narrKeys.has('local_resources') || !!data.localResources?.length,
      building_turnover: !!data.buildingTurnover?.length,
      turnover: !!data.turnover?.length,
      category_turnover: !!data.categoryTurnover?.length,
      footfall_toilet: !!(data.footfall?.length || data.toiletFund?.length),
      leasing: !!(data.vacancies?.length || data.waitlist?.length || data.movements?.length),
      trading_arrears: !!(data.tradingBreaches?.length || data.arrears?.length),
      utility_management: !!(data.loadshedding?.length || data.interruptions?.length),
      tenant_compliance: !!data.tenantCompliance?.length,
      shop_spec: !!data.shopSpec?.length,
      security_incidents: data.incidentsTotal != null,
      building_profile: narrKeys.has('building_profile'),
      condition_inspection: !!data.annualSections?.length,
      capex: !!data.capex?.length,
      // Rows exist but every CoC field is null on 781 of 1265 shops portfolio-wide. A
      // table of blank cells is absence, not content — counting it as filled excluded it
      // from "Not captured this period" and told the reader everything was fine.
      electrical_compliance: !!data.electricalCompliance?.some(
        (r) => r.coc_number || r.coc_status || r.coc_type || r.coc_issue_date,
      ),
    };
    const expected = REPORT_SECTIONS[report.report_type as ReportType] ?? [];
    data.emptySections = expected.filter((s) => !filled[s.key]).map((s) => s.label);
  }

  const doc = buildReportDoc(
    { title: report.title, report_period: report.report_period, report_type: report.report_type as ReportType, managers, prepared_for: report.prepared_for ?? null },
    data,
    {
      color, orgName: branding.name, logoDataUrl,
      watermark: watermarkFor(report.status),
    },
  );
  const fileName = `${(report.title ?? 'report').replace(/[^\w]+/g, '_')}.pdf`;
  const pdf = pdfMake.createPdf(doc);
  const blob = await pdf.getBlob();
  if (opts.download !== false) await pdf.download(fileName); // re-uses the buffered render; keeps current UX
  return { blob, fileName, buildingId: report.building_id, reportType: report.report_type as ReportType, reportStatus: report.status };
}
