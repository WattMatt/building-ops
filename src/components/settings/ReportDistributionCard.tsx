/**
 * Settings → Report distribution (R4b, spec §5.7). Lists the schedules, edits them, and drives the
 * `report-distribution` function for one schedule: "Preview run" is a dry run (nothing sent), "Send
 * now" is a real send behind a confirm — both show the per-building outcome.
 *
 * Access is gated ONCE, by the Settings page (`isAdminOrManager && report_schedules`), and the
 * schedules query carries its own `enabled` — the card used to re-test both and still ran the query
 * before returning null.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Switch } from '@/components/ui/switch';
import { useBuildingNames } from '@/hooks/useBuildingNames';
import { useReportSchedules, useScheduleDistributions, type LastResult, type ReportSchedule, type RunResponse } from '@/hooks/useReportSchedules';
import { REPORT_TYPE_LABELS, type ReportType } from '@/integrations/supabase/fortress-db';
import { todayInOperatingTz } from '@/lib/myWork';
import { countsLine, describeSchedule, lastRunLabel, nextRunDates, periodLabel, previousMonthStart, shortDate } from '@/lib/reportSchedule';
import { DistributionResults } from '@/components/settings/DistributionResults';
import { ScheduleDialog } from '@/components/settings/ScheduleDialog';

interface RunOutcome { title: string; dryRun: boolean; counts: Record<string, number>; rows: LastResult['buildings'] }

const PAUSED_HINT = 'This schedule is paused. Switch it on to send.';
/** A send with nobody to send to still mints a share link and records a failed row — so it is refused. */
const NO_RECIPIENTS_HINT = 'Add at least one recipient before sending.';
/**
 * A centred 44 × 44 px pointer overlay on a control that is drawn smaller (the switch is 24 px tall).
 * It changes the hit area only — never the layout or the look. `ScheduleDialog` does the same for its
 * checkboxes; the string is repeated rather than shared because these two files already import one way.
 */
const TAP_TARGET =
  "relative after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']";

function outcomeFrom(res: RunResponse, label: string, dryRun: boolean): RunOutcome {
  const s = res.schedules[0];
  const period = s?.period ? ` · ${periodLabel(s.period)}` : '';
  const counts = res.counts ?? {};
  // A real run that skipped every building must not be titled "Sent".
  const what = dryRun ? 'Preview' : (counts.sent ?? 0) > 0 ? 'Sent' : 'Nothing sent';
  return { title: `${what} · ${label}${period}`, dryRun, counts, rows: s?.buildings ?? [] };
}

function HistoryDialog({ schedule, onClose }: { schedule: ReportSchedule; onClose: () => void }) {
  const { data, isLoading, isError } = useScheduleDistributions(schedule.id);
  const names = useBuildingNames();
  const byId = Object.fromEntries((names.data ?? []).map((b) => [b.id, b.name]));
  return (
    <ResponsiveDialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <ResponsiveDialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>History · {REPORT_TYPE_LABELS[schedule.report_type]}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>The last 100 sends recorded for this schedule.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground" role="status">Loading…</p>}
        {isError && <p className="text-sm text-destructive">History could not be loaded.</p>}
        {data && <DistributionResults rows={data} title="Sends" buildingNames={byId} recipientCount={schedule.recipients.length} />}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export function ReportDistributionCard() {
  const { schedules, isLoading, isError, create, update, remove, runNow, isRunning } = useReportSchedules();

  // undefined = closed; null = create; a schedule = edit.
  const [editing, setEditing] = useState<ReportSchedule | null | undefined>(undefined);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [sendTarget, setSendTarget] = useState<ReportSchedule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReportSchedule | null>(null);
  const [historyTarget, setHistoryTarget] = useState<ReportSchedule | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const today = todayInOperatingTz();
  const label = (s: ReportSchedule) => REPORT_TYPE_LABELS[s.report_type as ReportType] ?? s.report_type;

  const run = async (s: ReportSchedule, dryRun: boolean) => {
    setBusyId(s.id);
    try {
      const res = await runNow({ scheduleId: s.id, dryRun });
      setOutcome(outcomeFrom(res, label(s), dryRun));
      if (!dryRun) toast.success('Distribution run finished.');
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'The distribution run failed.');
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (s: ReportSchedule, on: boolean) => {
    try {
      await update(s.id, { is_active: on });
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Could not update the schedule.');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove(deleteTarget.id);
      toast.success('Schedule deleted.');
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Could not delete the schedule.');
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Report distribution</CardTitle>
          <CardDescription>Who receives each report type, on which day, with a reminder to the author beforehand.</CardDescription>
        </div>
        <Button className="min-h-11" onClick={() => setEditing(null)}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          New schedule
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground" role="status">Loading schedules…</p>}
        {isError && <p className="text-sm text-destructive">Schedules could not be loaded</p>}
        {!isLoading && !isError && schedules.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No schedules yet. Approved reports are only emailed through a schedule, and a new schedule starts paused until it has been
            previewed.
          </p>
        )}

        {schedules.length > 0 && (
          <ul className="divide-y rounded-md border">
            {schedules.map((s) => {
              const next = nextRunDates(today, s);
              const last = lastRunLabel(s);
              const busy = busyId === s.id;
              return (
                <li key={s.id} className="space-y-3 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">{label(s)}</p>
                      <p className="text-sm text-muted-foreground">
                        {s.building_ids === null ? 'All buildings' : `${s.building_ids.length} building${s.building_ids.length === 1 ? '' : 's'}`}
                        {' · '}
                        {s.recipients.length} recipient{s.recipients.length === 1 ? '' : 's'}
                      </p>
                      <p className="text-sm text-muted-foreground">{describeSchedule(s)}</p>
                      <p className="text-sm text-muted-foreground">
                        {s.is_active ? `Next send ${shortDate(next.nextSend)} for ${periodLabel(next.period)}` : 'Paused'}
                      </p>
                      {last && <Badge variant="outline" className="bg-muted text-muted-foreground">{last}</Badge>}
                    </div>
                    <div className="flex min-h-11 items-center gap-2">
                      <label htmlFor={`schedule-active-${s.id}`} className="text-sm">Active</label>
                      {/* The switch is 24 px tall; the ::after overlay makes the tap target 44 px without moving it. */}
                      <Switch
                        id={`schedule-active-${s.id}`}
                        checked={s.is_active}
                        onCheckedChange={(on) => void toggleActive(s, on)}
                        aria-label={`Active: ${label(s)}`}
                        className={TAP_TARGET}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="min-h-11" onClick={() => setEditing(s)}>Edit</Button>
                    {/* Preview stays available while paused ON PURPOSE: a new schedule is created paused,
                        and a dry run is how you check it before switching the cron loose. It writes
                        nothing and emails nobody. Only "Send now" is gated on active. */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      onClick={() => void run(s, true)}
                      disabled={isRunning}
                    >
                      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                      Preview run
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      onClick={() => setSendTarget(s)}
                      disabled={isRunning || !s.is_active || s.recipients.length === 0}
                      title={!s.is_active ? PAUSED_HINT : s.recipients.length === 0 ? NO_RECIPIENTS_HINT : undefined}
                    >
                      Send now
                    </Button>
                    <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setHistoryTarget(s)}>History</Button>
                    <Button variant="ghost" size="sm" className="min-h-11 text-destructive" onClick={() => setDeleteTarget(s)}>Delete</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <Hint>
          Preview run shows what today's send would do without emailing anyone. A reminder goes to the report's author and every admin
          and manager; the send emails each recipient an expiring link to the issued PDF.
        </Hint>
      </CardContent>

      {editing !== undefined && (
        <ScheduleDialog
          open
          onOpenChange={(o) => { if (!o) setEditing(undefined); }}
          schedule={editing}
          onSubmit={async (input) => {
            if (editing) await update(editing.id, input);
            else await create(input);
          }}
        />
      )}

      {outcome && (
        <ResponsiveDialog open onOpenChange={(o) => { if (!o) setOutcome(null); }}>
          <ResponsiveDialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{outcome.title}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>{countsLine(outcome.counts)}</ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            {outcome.dryRun && <p className="text-sm text-muted-foreground">Nothing was sent.</p>}
            <DistributionResults rows={outcome.rows} title="Buildings" />
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}

      {historyTarget && <HistoryDialog schedule={historyTarget} onClose={() => setHistoryTarget(null)} />}

      <AlertDialog open={sendTarget !== null} onOpenChange={(o) => { if (!o) setSendTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send now?</AlertDialogTitle>
            <AlertDialogDescription>
              {sendTarget && (sendTarget.recipients.length === 0 ? (
                NO_RECIPIENTS_HINT + ' A send with no recipients still mints a share link and records a failed send.'
              ) : (
                <>
                  This emails the share links for {periodLabel(previousMonthStart(today))} to {sendTarget.recipients.length} recipient
                  {sendTarget.recipients.length === 1 ? '' : 's'} now. Reports already sent by this schedule are not re-sent.
                </>
              ))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            {/* The confirm is guarded too, not just the button that opens it: a send with nobody to send
                to mints a share link and records a failed row for nothing. */}
            <AlertDialogAction
              className="min-h-11"
              disabled={(sendTarget?.recipients.length ?? 0) === 0}
              onClick={() => {
                const s = sendTarget;
                setSendTarget(null);
                if (s && s.recipients.length > 0) void run(s, false);
              }}
            >
              Send now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && `${label(deleteTarget)} will no longer be distributed or reminded. Its history stays until the schedule is gone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => void confirmDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
