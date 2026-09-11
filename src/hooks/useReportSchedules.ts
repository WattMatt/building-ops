/**
 * Report distribution schedules (R4b, spec §5.7): who gets which report type, on which day of the
 * following month, with a reminder to the author beforehand. Admin/manager only — RLS makes a
 * non-privileged insert/update/delete a silent no-op (zero rows, no error), so every write selects
 * the row back and turns "nothing came back" into the permission message.
 *
 * `runNow` calls the `report-distribution` edge function for ONE schedule: a dry run (the default,
 * nothing is sent) or a real send for the given period (default: the previous month). The daily cron
 * uses the same function with a secret header; the client never sees that path.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { ReportType } from '@/integrations/supabase/fortress-db';
import type { TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

/** External: `email` (+ optional name). Colleague: `user_id` (+ display name) — the address is resolved server-side. */
export interface Recipient { email?: string; name?: string; user_id?: string }

export interface LastResult {
  ranAt: string;
  /** `failed` when the schedule itself threw before its buildings could be walked. */
  action: 'send' | 'remind' | 'failed';
  period: string;
  /** `recipients` is "1 of 2" (delivered of configured); rows written before R4b's review hold a number. */
  buildings: { buildingId: string; buildingName: string; reportId: string | null; status: string; recipients: string; error?: string }[];
}

export interface ReportSchedule {
  id: string;
  report_type: ReportType;
  /** null = every building whose `report_types` contains `report_type`. */
  building_ids: string[] | null;
  recipients: Recipient[];
  /** Day of the month AFTER the report period (1–28). */
  send_day: number;
  /** 0–27; 0 = no reminder. */
  remind_days_before: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_run_on: string | null;
  last_result: LastResult | null;
}

export interface ScheduleInput {
  report_type: ReportType;
  building_ids: string[] | null;
  recipients: Recipient[];
  send_day: number;
  remind_days_before: number;
  is_active: boolean;
}

export type DistributionStatus = 'sent' | 'skipped_no_artifact' | 'skipped_not_approved' | 'failed';

export interface Distribution {
  id: string;
  schedule_id: string;
  report_id: string | null;
  building_id: string | null;
  report_period: string;
  artifact_id: string | null;
  share_id: string | null;
  sent_to: (Recipient & { ok: boolean })[];
  sent_at: string;
  status: DistributionStatus;
  error: string | null;
}

export type RunResponse = {
  ok: true;
  dryRun: boolean;
  today: string;
  schedules: { scheduleId: string; action: string; period: string | null; buildings: LastResult['buildings'] }[];
  counts: Record<string, number>;
};

export interface RunNowInput { scheduleId: string; dryRun: boolean; period?: string }

export const SCHEDULE_PERMISSION_MESSAGE = 'Only admins and managers can change report schedules.';
/** Postgres 23514 here is `report_recipients_valid()` — the only CHECK a client can trip on this table. */
export const RECIPIENT_INVALID_MESSAGE = 'A recipient name is too long, or an address is invalid.';

export const SCHEDULES_KEY = ['report-schedules'] as const;
export const distributionsKey = (scheduleId: string | undefined) => ['report-distributions', scheduleId] as const;

/** The columns a client may write; everything else on the row belongs to the service role or the DB. */
const EDITABLE = ['report_type', 'building_ids', 'recipients', 'send_day', 'remind_days_before', 'is_active'] as const;

/** Same shape as `report_recipients_valid()` in the migration: no spaces, one `@`, a dot in the domain. */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function isEmail(s: string): boolean {
  return EMAIL_RE.test(s);
}

/**
 * The client-writable subset, shaped for the row. `recipients` is jsonb, and the generated column
 * type is `Json`, which a `Recipient[]` (an interface, so no implicit index signature) does not
 * structurally satisfy — the value written is identical either way.
 */
function pickEditable(patch: Partial<ScheduleInput>): TablesUpdate<'report_schedules'> {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in patch) out[k] = patch[k];
  return out as TablesUpdate<'report_schedules'>;
}

/** Zero rows back with no error is RLS saying no; a CHECK violation is the recipient list. */
function guardRows(rows: unknown, error: { message: string; code?: string } | null): void {
  if (error) throw new Error(error.code === '23514' ? RECIPIENT_INVALID_MESSAGE : error.message);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(SCHEDULE_PERMISSION_MESSAGE);
}

/** The function's JSON `{error}` when it sent one; supabase-js's generic message otherwise. */
async function functionErrorMessage(error: { message: string; context?: { json?: () => Promise<unknown> } }): Promise<string> {
  try {
    const body = (await error.context?.json?.()) as { error?: unknown } | undefined;
    if (body && typeof body.error === 'string' && body.error) return body.error;
  } catch {
    /* not JSON — fall through to the generic message */
  }
  return error.message || 'The distribution run failed.';
}

export function useReportSchedules() {
  const qc = useQueryClient();
  const { user, isAdminOrManager } = useAuth();

  // `rs_select` is admin/manager-only, so for anyone else the read can only come back empty: the hook
  // owns that gate rather than every caller re-deciding whether it is safe to mount.
  const query = useQuery({
    queryKey: SCHEDULES_KEY,
    enabled: isAdminOrManager,
    queryFn: async (): Promise<ReportSchedule[]> => {
      const { data, error } = await supabase.from('report_schedules').select('*').order('created_at');
      if (error) throw new Error(error.message);
      return (data ?? []) as ReportSchedule[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: SCHEDULES_KEY });

  const createMutation = useMutation({
    mutationFn: async (input: ScheduleInput): Promise<string> => {
      const row = { ...pickEditable(input), created_by: user?.id ?? null } as TablesInsert<'report_schedules'>;
      const { data, error } = await supabase.from('report_schedules').insert(row).select('id');
      guardRows(data, error);
      return (data as { id: string }[])[0].id;
    },
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<ScheduleInput> }): Promise<void> => {
      const { data, error } = await supabase.from('report_schedules').update(pickEditable(patch)).eq('id', id).select('id');
      guardRows(data, error);
    },
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { data, error } = await supabase.from('report_schedules').delete().eq('id', id).select('id');
      guardRows(data, error);
    },
    onSuccess: invalidate,
  });

  const runMutation = useMutation({
    mutationFn: async (input: RunNowInput): Promise<RunResponse> => {
      const body: RunNowInput = { scheduleId: input.scheduleId, dryRun: input.dryRun };
      if (input.period) body.period = input.period;
      const { data, error } = await supabase.functions.invoke('report-distribution', { body });
      if (error) throw new Error(await functionErrorMessage(error));
      return data as RunResponse;
    },
    onSuccess: (_res, input) => {
      if (input.dryRun) return;
      void qc.invalidateQueries({ queryKey: SCHEDULES_KEY });
      void qc.invalidateQueries({ queryKey: distributionsKey(input.scheduleId) });
    },
  });

  return {
    schedules: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    create: createMutation.mutateAsync,
    update: (id: string, patch: Partial<ScheduleInput>) => updateMutation.mutateAsync({ id, patch }),
    remove: removeMutation.mutateAsync,
    runNow: runMutation.mutateAsync,
    isSaving: createMutation.isPending || updateMutation.isPending || removeMutation.isPending,
    isRunning: runMutation.isPending,
  };
}

/** The last 100 sends recorded for one schedule, newest first. */
export function useScheduleDistributions(scheduleId: string | undefined) {
  return useQuery({
    queryKey: distributionsKey(scheduleId),
    enabled: !!scheduleId,
    queryFn: async (): Promise<Distribution[]> => {
      if (!scheduleId) return [];
      const { data, error } = await supabase
        .from('report_distributions')
        .select('*')
        .eq('schedule_id', scheduleId)
        .order('sent_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      // `sent_to` is jsonb (generated as `Json`) and `status` plain text; the service role writes
      // both, and the CHECK on `status` makes the narrowing safe.
      return (data ?? []) as unknown as Distribution[];
    },
  });
}
