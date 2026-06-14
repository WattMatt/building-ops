/**
 * Report-level hooks: list, single, create, and lifecycle transitions
 * (draft → submitted → reviewed → approved / rejected). Mirrors the
 * form_submissions review model. RLS enforces who may transition: the author can
 * submit their own draft; admin/manager perform review transitions.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fdb, type Report, type ReportType, type ReportStatus, type FTableName } from '@/integrations/supabase/fortress-db';
import { useAuth } from '@/contexts/AuthContext';

const REPORTS_KEY = ['fortress-reports'];

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
 *  carry over. Heavy/seeded sections (tenant_compliance, inspections) regenerate. */
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
        const { data: rows } = await (fdb.from(table) as any).select('*').eq('report_id', fromReportId);
        if (!rows?.length) continue;
        const mapped = (rows as Record<string, unknown>[]).map((r) => {
          const row: Record<string, unknown> = { ...r, id: crypto.randomUUID(), report_id: newReport.id };
          delete row.created_at; delete row.updated_at;
          if ('period' in row) row.period = newReport.report_period;
          for (const c of blank) row[c] = null;
          return row;
        });
        const { error } = await (fdb.from(table) as any).insert(mapped);
        if (error) { if (import.meta.env.DEV) console.error(`carry-forward ${table}:`, error); }
        else cloned += mapped.length;
      }
      await (fdb.from('reports') as any).update({ cloned_from_report_id: fromReportId }).eq('id', newReport.id);
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
