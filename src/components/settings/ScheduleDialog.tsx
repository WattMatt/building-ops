/**
 * Create or edit one report schedule. Buildings are either "every building with this report type
 * enabled" (`building_ids` null — new buildings join automatically) or an explicit list. The preview
 * line is computed from the same `nextRunDates` the edge function uses, so what the admin reads here is
 * what the cron will do.
 */
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Hint } from '@/components/ui/hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RecipientsEditor } from '@/components/settings/RecipientsEditor';
import { useBuildings } from '@/hooks/useBuildings';
import { useOrgSettings } from '@/hooks/useOrgSettings';
import type { Recipient, ReportSchedule, ScheduleInput } from '@/hooks/useReportSchedules';
import { REPORT_TYPE_LABELS, type ReportType } from '@/integrations/supabase/fortress-db';
import { formatBuildingName } from '@/lib/buildingName';
import { todayInOperatingTz } from '@/lib/myWork';
import { describeSchedule, nextRunDates, periodLabel, shortDate } from '@/lib/reportSchedule';

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create. */
  schedule: ReportSchedule | null;
  onSubmit: (input: ScheduleInput) => Promise<void>;
}

/** `buildings.report_types` (R4a) is not yet in the generated types; the column default is the two monthly types. */
function reportTypesOf(b: unknown): string[] {
  const rt = (b as { report_types?: unknown }).report_types;
  return Array.isArray(rt) ? (rt as string[]) : ['ops_monthly', 'cm_monthly'];
}

const REPORT_TYPES = Object.keys(REPORT_TYPE_LABELS) as ReportType[];

/**
 * A centred 44 × 44 px pointer overlay on a control that is drawn smaller (the checkbox is 16 px).
 * It changes the hit area only — never the layout or the look.
 */
const TAP_TARGET =
  "relative after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']";

function parseDay(value: string, min: number, max: number): number | null {
  const n = Number(value);
  return value.trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export function ScheduleDialog({ open, onOpenChange, schedule, onSubmit }: ScheduleDialogProps) {
  const { settings } = useOrgSettings();
  const { buildings, loading: buildingsLoading } = useBuildings();

  const [reportType, setReportType] = useState<ReportType>('ops_monthly');
  const [allBuildings, setAllBuildings] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [sendDay, setSendDay] = useState('7');
  const [remindDays, setRemindDays] = useState('3');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReportType(schedule?.report_type ?? 'ops_monthly');
    setAllBuildings(schedule ? schedule.building_ids === null : true);
    setSelected(schedule?.building_ids ?? []);
    setSearch('');
    setRecipients(schedule?.recipients ?? []);
    setSendDay(String(schedule?.send_day ?? settings.report_due_day));
    setRemindDays(String(schedule?.remind_days_before ?? 3));
    setIsActive(schedule?.is_active ?? true);
  }, [open, schedule, settings.report_due_day]);

  const eligible = useMemo(() => buildings.filter((b) => reportTypesOf(b).includes(reportType)), [buildings, reportType]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? eligible.filter((b) => formatBuildingName(b.name).toLowerCase().includes(q)) : eligible;
  }, [eligible, search]);

  const sendDayN = parseDay(sendDay, 1, 28);
  const remindN = parseDay(remindDays, 0, 27);
  const buildingsOk = allBuildings || selected.length > 0;
  const valid = sendDayN !== null && remindN !== null && buildingsOk;

  const timing = sendDayN !== null && remindN !== null ? { send_day: sendDayN, remind_days_before: remindN } : null;
  const next = timing ? nextRunDates(todayInOperatingTz(), timing) : null;
  // The colleague picker needs a building: the first chosen one, or the first eligible one when the
  // schedule covers all (admins and managers are members everywhere, so any building lists them).
  const pickerBuildingId = (allBuildings ? eligible[0]?.id : selected[0] ?? eligible[0]?.id) ?? null;

  const toggleBuilding = (id: string, on: boolean) => {
    setSelected((prev) => (on ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)));
  };

  const submit = async () => {
    if (!valid || sendDayN === null || remindN === null) return;
    setSaving(true);
    try {
      await onSubmit({
        report_type: reportType,
        building_ids: allBuildings ? null : selected,
        recipients,
        send_day: sendDayN,
        remind_days_before: remindN,
        is_active: isActive,
      });
      toast.success(schedule ? 'Schedule saved.' : 'Schedule created.');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Could not save the schedule.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{schedule ? 'Edit schedule' : 'New schedule'}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Who receives this report type, and when.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="schedule-type">Report type</Label>
            <Select value={reportType} onValueChange={(v) => { setReportType(v as ReportType); setSelected([]); }}>
              <SelectTrigger id="schedule-type" className="h-11" aria-label="Report type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{REPORT_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="schedule-all-buildings">All buildings with this report type</Label>
              <Switch id="schedule-all-buildings" checked={allBuildings} onCheckedChange={setAllBuildings} />
            </div>
            {allBuildings ? (
              <p className="text-sm text-muted-foreground">
                {buildingsLoading ? 'Counting buildings…' : `${eligible.length} building${eligible.length === 1 ? '' : 's'} today; new ones join automatically.`}
              </p>
            ) : (
              <div className="space-y-2">
                <Input
                  aria-label="Search buildings"
                  placeholder="Search buildings"
                  className="h-11"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                  {buildingsLoading && <li className="text-sm text-muted-foreground">Loading buildings…</li>}
                  {!buildingsLoading && visible.length === 0 && (
                    <li className="text-sm text-muted-foreground">No buildings with this report type match.</li>
                  )}
                  {visible.map((b) => {
                    const id = `schedule-building-${b.id}`;
                    return (
                      <li key={b.id} className="flex min-h-11 items-center gap-3">
                        <Checkbox
                          id={id}
                          checked={selected.includes(b.id)}
                          onCheckedChange={(v) => toggleBuilding(b.id, v === true)}
                          className={TAP_TARGET}
                        />
                        <Label htmlFor={id} className="flex-1 cursor-pointer font-normal">{formatBuildingName(b.name)}</Label>
                      </li>
                    );
                  })}
                </ul>
                {!buildingsOk && <p className="text-xs text-destructive">Choose at least one building, or switch on all buildings.</p>}
                {selected.length > 0 && <p className="text-xs text-muted-foreground">{selected.length} selected</p>}
              </div>
            )}
          </div>

          <RecipientsEditor value={recipients} onChange={setRecipients} buildingId={pickerBuildingId} />
          {recipients.length === 0 && (
            <p className="text-xs text-muted-foreground">With no recipients the reminder still goes to the author, but nothing is emailed on the send day.</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="schedule-send-day">Send day (of the following month, 1–28)</Label>
              <Input
                id="schedule-send-day"
                type="number"
                inputMode="numeric"
                min={1}
                max={28}
                step={1}
                className="h-11"
                value={sendDay}
                onChange={(e) => setSendDay(e.target.value)}
                aria-invalid={sendDayN === null || undefined}
              />
              {sendDayN === null && <p className="text-xs text-destructive">Enter a whole number from 1 to 28.</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-remind-days">Reminder (days before, 0–27)</Label>
              <Input
                id="schedule-remind-days"
                type="number"
                inputMode="numeric"
                min={0}
                max={27}
                step={1}
                className="h-11"
                value={remindDays}
                onChange={(e) => setRemindDays(e.target.value)}
                aria-invalid={remindN === null || undefined}
              />
              {remindN === null && <p className="text-xs text-destructive">Enter a whole number from 0 to 27.</p>}
            </div>
          </div>

          {timing && next && (
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <p>{describeSchedule(timing)}</p>
              <p className="text-muted-foreground">
                {timing.remind_days_before > 0 && next.nextReminder >= todayInOperatingTz() ? `Next reminder ${shortDate(next.nextReminder)} · ` : ''}
                next send {shortDate(next.nextSend)} for {periodLabel(next.period)}
              </p>
            </div>
          )}

          <div className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor="schedule-active">Active</Label>
            <Switch id="schedule-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <Hint>
            The report for a month is sent on this day of the following month. Only approved reports with a final PDF go out; the rest
            are listed as skipped.
          </Hint>
        </div>

        <ResponsiveDialogFooter>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" className="min-h-11" onClick={submit} disabled={!valid || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {schedule ? 'Save' : 'Create schedule'}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
