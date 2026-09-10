/**
 * Report-level hooks: list, single, create, and lifecycle transitions
 * (draft → submitted → reviewed → approved / rejected). Mirrors the
 * form_submissions review model. RLS enforces who may transition: the author can
 * submit their own draft; admin/manager perform review transitions.
 *
 * PPM (R3c): an ops report's `ppm_services` rows are SEEDED from the building's active plan
 * lines (`seedPpmFromPlan`) when the report is created and again on carry-forward — the
 * function is idempotent, so the second run only picks up lines the first did not. The
 * prior report's PPM rows are never cloned: a plan-backed row's grid is derived from
 * execution, and its overrides belong to the month they were written for.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fdb, type Report, type ReportType, type ReportStatus, type FTableName, type FUpdate } from '@/integrations/supabase/fortress-db';
import { useAuth } from '@/contexts/AuthContext';
import { notify } from '@/lib/notify';
import { describeSeed, seedPpmFromPlan } from '@/hooks/useReportPpm';

const REPORTS_KEY = ['fortress-reports'];

/** Report types that carry the PPM section (see REPORT_SECTIONS in lib/fortressReports.ts). */
const PPM_REPORT_TYPES: ReadonlySet<string> = new Set<ReportType>(['ops_monthly']);

/** Plain copy for a seed that failed after the report itself was saved. */
export const PPM_SEED_FAILED_MESSAGE =
  'The report was saved, but its PPM services could not be seeded from the building plan. Use "Sync with the PPM plan" on the PPM section.';

/**
 * Seed the report's PPM rows from the plan without failing the surrounding write: the
 * report row already exists, so a refused seed is reported and the user is pointed at the
 * section's sync button rather than left with a create that "failed" after it succeeded.
 * A plan line the seed had to skip (its name is taken by a row linked to another line) is
 * said out loud too — silently missing a service from a compliance grid is the worse outcome.
 */
async function seedPpmOrWarn(report: Pick<Report, 'id' | 'building_id' | 'report_type'>): Promise<number> {
  if (!PPM_REPORT_TYPES.has(report.report_type)) return 0;
  try {
    const result = await seedPpmFromPlan(report.id, report.building_id);
    if (result.skipped > 0) toast.warning(describeSeed(result));
    return result.added + result.linked;
  } catch (e) {
    if (import.meta.env.DEV) console.error('Seed PPM from plan failed:', e);
    toast.error(PPM_SEED_FAILED_MESSAGE);
    return 0;
  }
}

export function useFortressReports(buildingId?: string) {
  return useQuery({
    queryKey: [...REPORTS_KEY, buildingId ?? 'all'],
    queryFn: async (): Promise<Report[]> => {
      let q = fdb.from('reports').select('*').order('report_period', { ascending: false });
      if (buildingId) q = q.eq('building_id', buildingId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useFortressReport(reportId: string | undefined) {
  return useQuery({
    queryKey: [...REPORTS_KEY, 'one', reportId],
    enabled: !!reportId,
    queryFn: async (): Promise<Report | null> => {
      const { data, error } = await fdb.from('reports').select('*').eq('id', reportId!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export interface CreateReportInput {
  buildingId: string;
  reportType: ReportType;
  /** YYYY-MM-DD first of month */
  reportPeriod: string;
  title: string;
  inspectionDate?: string | null;
}

export function useCreateReport() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateReportInput): Promise<Report> => {
      // org id + author name are denormalized on the report (RLS hides profiles).
      const { data: building } = await fdb
        .from('buildings')
        .select('organization_id')
        .eq('id', input.buildingId)
        .maybeSingle();

      let authorName: string | null = user?.email ?? null;
      if (user?.id) {
        const { data: profile } = await fdb
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .maybeSingle();
        authorName = (profile?.full_name as string | null) ?? authorName;
      }

      const { data, error } = await fdb
        .from('reports')
        .insert({
          id: crypto.randomUUID(),
          building_id: input.buildingId,
          organization_id: building?.organization_id ?? null,
          report_type: input.reportType,
          report_period: input.reportPeriod,
          inspection_date: input.inspectionDate ?? null,
          title: input.title,
          status: 'draft',
          author_id: user?.id ?? null,
          author_name: authorName,
        })
        .select('*')
        .single();
      if (error) throw error;
      await seedPpmOrWarn(data);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: REPORTS_KEY });
    },
    onError: (e: unknown) => {
      if (import.meta.env.DEV) console.error('Create report failed:', e);
      const msg = (e as { code?: string })?.code === '23505'
        ? 'A report of this type already exists for that building and month.'
        : 'Could not create the report. Please try again.';
      toast.error(msg);
    },
  });
}

/** Section tables cloned on carry-forward, with volatile columns blanked (operator
 *  re-enters fresh values). Scaffold columns (services, tenants, narratives, contacts)
 *  carry over. Heavy/seeded sections (tenant_compliance, inspections) regenerate.
 *  `ppm_services` is deliberately absent: PPM rows are re-seeded from the building plan
 *  (`seedPpmFromPlan`), not cloned, so the new report gets the plan as it stands today
 *  and none of last month's overrides. */
const CARRY_FORWARD: Record<ReportType, { table: FTableName; blank: string[] }[]> = {
  ops_monthly: [
    { table: 'report_narratives', blank: [] },
    { table: 'report_checklist_items', blank: ['value_text', 'value_date', 'response'] },
    { table: 'expense_recoveries', blank: ['ytd_expense', 'ytd_recovery', 'pct_recovery', 'budget_pct_recovery', 'records_uploaded', 'fault_found', 'comment'] },
    { table: 'utility_readings', blank: ['reading', 'pct_of_bulk', 'difference', 'comment'] },
    { table: 'utility_yields', blank: ['actual_yield', 'pct_achieved', 'comment'] },
    { table: 'masterfile_items', blank: ['on_file', 'comment'] },
  ],
  cm_monthly: [
    { table: 'report_narratives', blank: [] },
    { table: 'local_resources_contacts', blank: ['last_meeting_date'] },
    { table: 'building_turnover', blank: ['current_month_total', 'previous_year_month_total', 'annual_trading_density', 'spend_per_head', 'cm_comment'] },
    { table: 'tenant_turnover', blank: ['monthly_avg_turnover', 'annual_trading_density', 'coo_pct', 'annual_growth_pct', 'comment'] },
    { table: 'category_turnover', blank: ['monthly_turnover', 'trading_density', 'comment'] },
    { table: 'footfall_counts', blank: ['month_count', 'ytd_count', 'prev_ytd', 'variance_pct'] },
    { table: 'toilet_fund', blank: ['issued_bales', 'stock_on_hand_bales', 'actual_banked', 'variance', 'profit_per_roll'] },
    { table: 'security_incidents', blank: ['count', 'narrative'] },
  ],
  annual_inspection: [
    { table: 'capex_items', blank: ['status'] },
  ],
};

/** Clone the prior report's scaffold into a freshly-created report (smart-reset:
 *  keep structure, blank the volatile values) and set cloned_from_report_id. */
export function useCarryForwardReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ newReport, fromReportId }: { newReport: Report; fromReportId: string }): Promise<number> => {
      let cloned = 0;
      for (const { table, blank } of CARRY_FORWARD[newReport.report_type as ReportType] ?? []) {
        // `table` is a runtime union of section tables; the typed client cannot narrow it.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rows } = await (fdb.from(table) as any).select('*').eq('report_id', fromReportId);
        if (!rows?.length) continue;
        const mapped = (rows as Record<string, unknown>[]).map((r) => {
          const row: Record<string, unknown> = { ...r, id: crypto.randomUUID(), report_id: newReport.id };
          delete row.created_at; delete row.updated_at;
          if ('period' in row) row.period = newReport.report_period;
          for (const c of blank) row[c] = null;
          return row;
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (fdb.from(table) as any).insert(mapped);
        if (error) { if (import.meta.env.DEV) console.error(`carry-forward ${table}:`, error); }
        else cloned += mapped.length;
      }
      // PPM: seed from the plan (idempotent — creation usually did this already, so this
      // only adds lines the plan gained since, or seeds a report created another way).
      cloned += await seedPpmOrWarn(newReport);
      await fdb.from('reports').update({ cloned_from_report_id: fromReportId }).eq('id', newReport.id);
      return cloned;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: REPORTS_KEY });
      toast.success(`Carried forward ${n} row${n === 1 ? '' : 's'} from the previous report.`);
    },
    onError: (e: unknown) => {
      if (import.meta.env.DEV) console.error('Carry-forward failed:', e);
      toast.error('Could not carry forward the previous report.');
    },
  });
}

const FORWARD: Record<ReportStatus, ReportStatus | null> = {
  draft: 'submitted',
  submitted: 'reviewed',
  reviewed: 'approved',
  approved: null,
  rejected: 'submitted',
};

export function nextStatus(status: ReportStatus): ReportStatus | null {
  return FORWARD[status];
}

export function useReportLifecycle(reportId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: { status: ReportStatus; reviewNotes?: string }): Promise<Report> => {
      const patch: Record<string, unknown> = { status: params.status };
      if (params.status === 'reviewed' || params.status === 'approved' || params.status === 'rejected') {
        patch.reviewed_by = user?.id ?? null;
        if (params.reviewNotes !== undefined) patch.review_notes = params.reviewNotes;
      }
      const { data, error } = await fdb
        .from('reports')
        .update(patch)
        .eq('id', reportId)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: REPORTS_KEY });
      const label = r.title ?? 'Building report';
      const url = `/reports/fortress/${r.id}`;
      if (r.status === 'submitted') {
        void notify({ kind: 'report_submitted', entityType: 'report', entityId: r.id, buildingId: r.building_id, recipients: [], title: `Report submitted for review: ${label}`, url });
      } else if ((r.status === 'rejected' || r.status === 'approved') && r.author_id && r.author_id !== user?.id) {
        void notify({
          kind: r.status === 'rejected' ? 'report_returned' : 'report_approved', entityType: 'report', entityId: r.id, buildingId: r.building_id,
          recipients: [r.author_id], title: r.status === 'rejected' ? `Report returned: ${label}` : `Report approved: ${label}`,
          body: r.status === 'rejected' ? (r.review_notes ?? undefined) : undefined, url,
        });
      }
      const verb: Record<string, string> = {
        submitted: 'submitted for review',
        reviewed: 'marked reviewed',
        approved: 'approved',
        rejected: 'returned to author',
        draft: 'reopened',
      };
      toast.success(`Report ${verb[r.status] ?? 'updated'}.`);
    },
    onError: (e: unknown) => {
      if (import.meta.env.DEV) console.error('Lifecycle transition failed:', e);
      toast.error('You do not have permission to change this report, or the change failed.');
    },
  });
}

/**
 * Why delete_empty_report refused, by SQLSTATE (2026-09-14_01): the code is the contract, the message is
 * prose for the log. Older builds of the function raise everything as 42501 with a distinguishing message,
 * so the substring match stays as a fallback.
 */
export const DISCARD_ERROR_CODES: Record<string, string> = {
  '42501': 'Only an admin can discard a draft.',
  P0002: 'That report no longer exists.',
  PR001: 'Only a draft can be discarded.',
  PR002: 'This draft has saved PDF versions and cannot be discarded.',
  PR003: 'This draft has saved content. Clear its sections before discarding it.',
};

export function discardErrorMessage(e: unknown): string {
  const { code, message } = (e as { code?: string; message?: string } | null) ?? {};
  if (code && DISCARD_ERROR_CODES[code]) return DISCARD_ERROR_CODES[code];
  const msg = message ?? '';
  return msg.includes('saved row') ? DISCARD_ERROR_CODES.PR003
    : msg.includes('PDF versions') ? DISCARD_ERROR_CODES.PR002
    : msg.includes('only a draft') ? DISCARD_ERROR_CODES.PR001
    : msg.includes('not found') ? DISCARD_ERROR_CODES.P0002
    : msg.includes('admin only') ? DISCARD_ERROR_CODES['42501']
    : 'Could not discard the draft.';
}

/** Admin only: deletes a draft that holds no content (delete_empty_report, 2026-09-14_01). */
export function useDiscardDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reportId: string): Promise<string> => {
      // delete_empty_report is not yet in the generated types; regenerate after the migration ships.
      const { error } = await (fdb as unknown as {
        rpc(fn: string, args: Record<string, string>): Promise<{ error: { message: string; code?: string } | null }>;
      }).rpc('delete_empty_report', { p_report: reportId });
      if (error) throw error;
      return reportId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: REPORTS_KEY });
      toast.success('Draft discarded.');
    },
    onError: (e: unknown) => {
      if (import.meta.env.DEV) console.error('Discard draft failed:', e);
      // Gone already: the list is stale, so refresh it along with the message.
      if ((e as { code?: string } | null)?.code === 'P0002') qc.invalidateQueries({ queryKey: REPORTS_KEY });
      toast.error(discardErrorMessage(e));
    },
  });
}

/** Which report types a building owes (buildings.report_types); drives "missing" on the coverage grid. */
export function useSetBuildingReportTypes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ buildingId, reportTypes }: { buildingId: string; reportTypes: ReportType[] }): Promise<void> => {
      // buildings.report_types is not yet in the generated types; regenerate after the migration ships.
      const { error } = await fdb.from('buildings').update({ report_types: reportTypes } as unknown as FUpdate<'buildings'>).eq('id', buildingId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['buildings-for-reports'] }); },
    onError: (e: unknown) => {
      if (import.meta.env.DEV) console.error('Set report types failed:', e);
      toast.error('Could not update the report types for that building.');
    },
  });
}
