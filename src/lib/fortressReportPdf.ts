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
import { resolveStorageUrl } from '@/integrations/supabase/storage';
import { buildReportDoc, MARK, type ReportData, type EmbeddedPhoto, type AnnualItem } from '@/lib/fortressReportDoc';
import { ANNUAL_FIELD_SETS } from '@/lib/annualFieldSets';
import { doneMonths, type PpmCell } from '@/lib/ppmStatus';
import { REPORT_SECTIONS } from '@/lib/fortressReports';
import { fetchReportElectricalCompliance } from '@/integrations/supabase/insight-linker';

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
}

const FLAGGED = new Set(['poor', 'critical']);
/** Cap embedded photos so the PDF stays a sane size (AbaQulusi annual = 121). */
export const MAX_EMBEDDED_PHOTOS = 120;
const PHOTO_MAX_DIM = 1100;
const PHOTO_QUALITY = 0.62;

type PhotoRef = { ref?: string; path: string; caption?: string };

/** Resolve a stored photo path to a downscaled JPEG data URL (browser only). */
async function embedPhoto(path: string): Promise<string | null> {
  try {
    const signed = await resolveStorageUrl('/object/tenant-documents/' + path);
    if (!signed) return null;
    const blob = await (await fetch(signed)).blob();
    return await downscaleToDataUrl(blob);
  } catch {
    return null;
  }
}

async function downscaleToDataUrl(blob: Blob): Promise<string> {
  try {
    const bmp = await createImageBitmap(blob);
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
  } catch {
    return blobToDataUrl(blob);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function generateReportPdf(reportId: string, branding: ReportBranding): Promise<GeneratedFortressPdf> {
  const color = /^#([a-f\d]{6})$/i.test(branding.primaryColor) ? branding.primaryColor : '#2563eb';
  const report = (await fdb.from('reports').select('*').eq('id', reportId).maybeSingle()).data;
  if (!report) throw new Error('report not found');
  const managers = [report.asset_manager, report.ops_manager, report.centre_manager].filter(Boolean) as string[];

  let logoDataUrl: string | null = null;
  if (branding.logoUrl) {
    try {
      const signed = await resolveStorageUrl(branding.logoUrl);
      if (signed) logoDataUrl = await blobToDataUrl(await (await fetch(signed)).blob());
    } catch { /* logo optional */ }
  }

  const data: ReportData = {};

  if (report.report_type === ('ops_monthly' as ReportType)) {
    data.compliancePct = (await fdb.from('compliance_scores').select('compliance_pct').eq('report_id', reportId).maybeSingle()).data?.compliance_pct ?? null;
    const asmt = (await fdb.from('compliance_assessments').select('id').eq('report_id', reportId).maybeSingle()).data;
    if (asmt) {
      const resp = (await fdb.from('compliance_responses')
        .select('response,comment,compliance_template_items(item_no,prompt)')
        .eq('assessment_id', asmt.id)).data as any[] ?? [];
      data.compliance = resp.map((r) => ({
        itemNo: r.compliance_template_items?.item_no ?? '',
        prompt: r.compliance_template_items?.prompt ?? '',
        mark: MARK[r.response] ?? '',
        comment: r.comment ?? '',
      }));
    }
    const rec = (await fdb.from('expense_recoveries').select('service,ytd_expense,ytd_recovery,pct_recovery').eq('report_id', reportId)).data ?? [];
    data.recoveries = rec.map((r) => ({ service: r.service ?? '', ytdExpense: r.ytd_expense, ytdRecovery: r.ytd_recovery, pctRecovery: r.pct_recovery == null ? '—' : `${Math.round(Number(r.pct_recovery) * 10) / 10}%` }));

    const ppm = (await fdb.from('ppm_services').select('service_name,frequency,months,sort_order')
      .eq('report_id', reportId).order('sort_order', { ascending: true, nullsFirst: false })).data ?? [];
    data.ppm = ppm.map((p) => ({
      service: p.service_name ?? '',
      frequency: p.frequency ?? null,
      servicedMonths: doneMonths({ months: p.months as Record<string, PpmCell> }).map(ppmMonthLabel),
    }));
    // doneMonths() counts only status === 'done'. A schedule whose month cells carry no
    // status at all (the source records it as a fill colour, which has no agreed meaning
    // yet) would otherwise print a full table of "—" and read as "nothing was serviced".
    const anyStatus = ppm.some((p) => {
      const m = (p.months ?? {}) as Record<string, PpmCell>;
      return Object.values(m).some((c) => c && c.status != null);
    });
    if (ppm.length && !anyStatus) {
      data.ppmStatusNote =
        'Service status is recorded in the source workbook as a cell colour with no legend, so no month can be reported as serviced or missed. The schedule itself is shown below.';
    }

    const util = (await fdb.from('utility_readings')
      .select('utility,meter_name,reading,unit,category,pct_of_bulk,comment')
      .eq('report_id', reportId)).data ?? [];
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

    const mf = (await fdb.from('masterfile_items')
      .select('document_label,on_file,comment').eq('report_id', reportId)).data ?? [];
    data.masterfile = mf.map((m) => ({
      document: m.document_label ?? '',
      onFile: m.on_file ?? 'unassessed',
      comment: m.comment ?? null,
    }));

  }

  if (report.report_type === ('cm_monthly' as ReportType)) {
    const turn = (await fdb.from('tenant_turnover').select('tenant_name,annual_trading_density,annual_growth_pct,rank_band').eq('report_id', reportId)).data ?? [];
    data.turnover = turn.map((t) => ({
      tenant: t.tenant_name ?? '',
      density: String(t.annual_trading_density ?? '—'),
      growth: t.annual_growth_pct != null ? `${Math.round(Number(t.annual_growth_pct) * 1000) / 10}%` : '—',
      band: t.rank_band ?? '',
    }));
    const inc = (await fdb.from('security_incidents').select('count').eq('report_id', reportId)).data ?? [];
    data.incidentsTotal = inc.length ? inc.reduce((a, i) => a + (i.count ?? 0), 0) : null;

    // Tenant compliance and shop spec are the substance of a CM report and were never
    // exported — a CM PDF was a cover page. Tenants are resolved with a second query
    // rather than an embedded select so this does not depend on FK relationship naming.
    const tenants = (await fdb.from('building_tenants')
      .select('id,shop_number,name,area').eq('building_id', report.building_id)).data ?? [];
    const tenantById = new Map(tenants.map((t) => [t.id, t]));
    const sortByShop = <T extends { shop: string }>(rows: T[]) =>
      rows.sort((a, b) => a.shop.localeCompare(b.shop, undefined, { numeric: true }));

    const tc = (await fdb.from('tenant_compliance')
      .select('tenant_id,occupancy_cert_no,electrical_coc_cert_no,electrical_coc_date,hvac_records_current,fire_sprinkler_annual,smoke_detection_annual_service,evac_plan_displayed')
      .eq('report_id', reportId)).data ?? [];
    if (tc.length) {
      type TcRow = {
        tenant_id: string; occupancy_cert_no: string | null; electrical_coc_cert_no: string | null;
        electrical_coc_date: string | null; hvac_records_current: string | null;
        fire_sprinkler_annual: string | null; smoke_detection_annual_service: string | null;
        evac_plan_displayed: string | null;
      };
      data.tenantCompliance = sortByShop((tc as TcRow[]).map((r) => {
        const t = tenantById.get(r.tenant_id);
        return {
          shop: t?.shop_number ?? '',
          tenant: t?.name ?? '',
          gla: t?.area == null ? null : Number(t.area),
          occupancyCert: r.occupancy_cert_no ?? null,
          cocNumber: r.electrical_coc_cert_no ?? null,
          cocDate: r.electrical_coc_date ?? null,
          hvacRecords: r.hvac_records_current ?? null,
          sprinkler: r.fire_sprinkler_annual ?? null,
          smokeDetection: r.smoke_detection_annual_service ?? null,
          evacPlan: r.evac_plan_displayed ?? null,
        };
      }));
    }

    const ss = (await fdb.from('tenant_shop_spec')
      .select('tenant_id,db_phase,actual_amps,generator_connection,hvac_units,lighting_type')
      .eq('building_id', report.building_id).eq('is_current', true)).data ?? [];
    if (ss.length) {
      type SsRow = {
        tenant_id: string; db_phase: string | null; actual_amps: string | null;
        generator_connection: string | null; hvac_units: string | null; lighting_type: string | null;
      };
      data.shopSpec = sortByShop((ss as SsRow[]).map((r) => {
        const t = tenantById.get(r.tenant_id);
        return {
          shop: t?.shop_number ?? '',
          tenant: t?.name ?? '',
          phase: r.db_phase ?? null,
          actualAmps: r.actual_amps ?? null,
          generator: r.generator_connection ?? null,
          hvac: r.hvac_units ?? null,
          lighting: r.lighting_type ?? null,
        };
      }));
    }
  }

  if (report.report_type === ('annual_inspection' as ReportType)) {
    const insp = (await fdb.from('building_inspections').select('id,template_id').eq('report_id', reportId).maybeSingle()).data;
    if (insp?.template_id) {
      const items = (await fdb.from('inspection_template_items')
        .select('id,section_no,section_title,item_label,sort_order,field_set')
        .eq('template_id', insp.template_id).order('sort_order')).data ?? [];
      const resps = (await fdb.from('inspection_responses')
        .select('template_item_id,condition_rating,recommendation,comment,capex_estimate,applicable,photo_urls,detail')
        .eq('inspection_id', insp.id)).data ?? [];
      const byItem = new Map(resps.map((r) => [r.template_item_id, r]));

      let embedded = 0;
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
          if (embedded >= MAX_EMBEDDED_PHOTOS) break;
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
    }
    const capex = (await fdb.from('capex_items').select('description,estimate').eq('report_id', reportId)).data ?? [];
    data.capex = capex.map((c: any) => ({ description: c.description ?? '', estimate: c.estimate ?? null }));

    try {
      const elec = await fetchReportElectricalCompliance(report.building_id);
      if (elec.linked && elec.rows.length) {
        data.electricalCompliance = elec.rows.map((r) => ({
          shop_number: r.shop_number ?? '', tenant_name: r.tenant_name ?? '',
          coc_number: r.coc_number ?? '', coc_type: r.coc_type ?? '', coc_status: r.coc_status ?? '',
          coc_issue_date: r.coc_issue_date ?? '', coc_expiry_date: r.coc_expiry_date ?? '', certificate_url: r.certificate_url ?? '', certificate_name: r.certificate_name ?? '',
        }));
      }
    } catch { /* electrical compliance is best-effort; never block the PDF */ }
  }

  // Building-inspection and OHS-act answers, grouped by the sheet section they came from.
  const chk = (await fdb.from('report_checklist_items')
    .select('section_key,item_key,response,value_text,value_date,comment,sort_order')
    .eq('report_id', reportId)
    .order('section_key', { ascending: true })
    .order('sort_order', { ascending: true, nullsFirst: false })).data ?? [];
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
    arr.push({
      item: resolveItem(c.item_key ?? ''),
      response: c.response ?? null,
      value: c.value_text ?? null,
      comment: c.comment ?? null,
    });
    grouped.set(label, arr);
  }
  data.checklist = [...grouped.entries()].map(([sectionName, items]) => ({ section: sectionName, items }));

  // Section narratives (all report types) — fetched generically so any section_key
  // renders (building_overview, loadshedding, maintenance_project, security_incidents, …).
  const narr = (await fdb.from('report_narratives')
    .select('section_key,heading,body,status_flag,sort_order')
    .eq('report_id', reportId)
    .order('sort_order', { ascending: true, nullsFirst: false })).data ?? [];
  const narrKeys = new Set(narr.filter((n) => (n.body ?? '').trim() !== '').map((n) => n.section_key));
  data.narratives = narr
    .filter((n) => (n.body ?? '').trim() !== '')
    .map((n) => ({ heading: n.heading ?? '', body: n.body ?? '', statusFlag: n.status_flag ?? null }));

  // Name the sections this report type expects but which carry nothing, so a short PDF is
  // legibly incomplete instead of looking like the whole report.
  {
    const hasInspection = !!data.checklist?.some((g) => g.section === 'Building Inspection');
    const hasOhsAnswers = !!data.checklist?.some((g) => g.section === 'OHS Act Report');
    let hazardCount = 0;
    try {
      const asm = (await fdb.from('compliance_assessments').select('id').eq('report_id', reportId)).data ?? [];
      if (asm.length) {
        const hazard = fdb as unknown as {
          from(t: 'hazard_log'): {
            select(c: 'id', o: { count: 'exact'; head: true }): {
              in(col: string, vals: string[]): PromiseLike<{ count: number | null }>;
            };
          };
        };
        const { count } = await hazard.from('hazard_log')
          .select('id', { count: 'exact', head: true })
          .in('assessment_id', asm.map((a) => a.id));
        hazardCount = count ?? 0;
      }
    } catch { /* a missing hazard table must not block the export */ }

    // Sections with no in-memory data are COUNTED rather than assumed empty: hardcoding
    // them false makes the "not captured" list state things that were never checked.
    // null = could not be determined. Returning 0 on error would print
    // "carries no entries for this period" for a section we simply failed to read.
    const countRows = async (tbl: string): Promise<number | null> => {
      try {
        const c = fdb as unknown as {
          from(t: string): { select(c: 'id', o: { count: 'exact'; head: true }): {
            eq(col: string, v: string): PromiseLike<{ count: number | null }> } };
        };
        const { count } = await c.from(tbl).select('id', { count: 'exact', head: true }).eq('report_id', reportId);
        return count ?? 0;
      } catch { return null; }
    };
    const [nCatTurn, nFootfall, nVacancies, nArrears, nLoadshed, nChecklistRows, nBuildingTurn] = await Promise.all([
      countRows('category_turnover'), countRows('footfall_counts'), countRows('vacancies'),
      countRows('tenant_arrears'), countRows('loadshedding_log'), countRows('report_checklist_items'),
      countRows('building_turnover'),
    ]);

    const filled: Record<string, boolean> = {
      operational_overview: !!data.narratives?.length,
      report_checklist: nChecklistRows !== 0,
      ohs_compliance: !!(data.compliance?.length || data.compliancePct != null || hasOhsAnswers),
      hazard_log: hazardCount > 0,
      building_inspection: hasInspection,
      expense_recoveries: !!data.recoveries?.length,
      utilities: !!data.utilities?.length,
      ppm: !!data.ppm?.length,
      masterfile: !!data.masterfile?.length,
      building_overview: narrKeys.has('building_overview'),
      local_resources: narrKeys.has('local_resources'),
      building_turnover: nBuildingTurn !== 0,
      turnover: !!data.turnover?.length,
      category_turnover: nCatTurn !== 0,
      footfall_toilet: nFootfall !== 0,
      leasing: nVacancies !== 0,
      trading_arrears: nArrears !== 0,
      utility_management: nLoadshed !== 0,
      tenant_compliance: !!data.tenantCompliance?.length,
      shop_spec: !!data.shopSpec?.length,
      security_incidents: data.incidentsTotal != null,
      building_profile: narrKeys.has('building_profile'),
      condition_inspection: !!data.annualSections?.length,
      capex: !!data.capex?.length,
      electrical_compliance: !!data.electricalCompliance?.length,
    };
    const expected = REPORT_SECTIONS[report.report_type as ReportType] ?? [];
    data.emptySections = expected.filter((s) => !filled[s.key]).map((s) => s.label);
  }

  const doc = buildReportDoc(
    { title: report.title, report_period: report.report_period, report_type: report.report_type as ReportType, managers },
    data,
    { color, orgName: branding.name, logoDataUrl },
  );
  const fileName = `${(report.title ?? 'report').replace(/[^\w]+/g, '_')}.pdf`;
  const pdf = pdfMake.createPdf(doc);
  const blob = await pdf.getBlob();
  await pdf.download(fileName); // re-uses the buffered render; keeps current UX
  return { blob, fileName, buildingId: report.building_id, reportType: report.report_type as ReportType };
}
