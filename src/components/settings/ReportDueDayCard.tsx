/**
 * Settings → Operations: the day of the following month by which a monthly report must be approved.
 * Read by R4b's schedules and reminders; in R4a it only needs to be captured.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOrgSettings } from '@/hooks/useOrgSettings';

export function ReportDueDayCard({ canEdit }: { canEdit: boolean }) {
  const { settings, isLoading, isError, save, isSaving } = useOrgSettings();
  const [day, setDay] = useState(String(settings.report_due_day));
  useEffect(() => { setDay(String(settings.report_due_day)); }, [settings.report_due_day]);

  const n = Number(day);
  const valid = Number.isInteger(n) && n >= 1 && n <= 28;
  // Nothing to edit until the real value is in: the default shown while loading or after a failed load is
  // not the org's, and saving it would silently overwrite whatever is stored.
  const locked = !canEdit || isLoading || isError;

  const onSave = async () => {
    if (!valid) return;
    try {
      await save({ ...settings, report_due_day: n });
      toast.success('Report due day saved.');
    } catch (e) {
      if (import.meta.env.DEV) console.error('Save report due day failed:', e);
      toast.error('Could not save the report due day.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Report due day</CardTitle>
        <CardDescription>Monthly reports are due, approved, by this day of the following month.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs space-y-2">
          <Label htmlFor="report-due-day">Day of the following month (1–28)</Label>
          <Input id="report-due-day" type="number" inputMode="numeric" min={1} max={28} className="h-11" value={day}
            onChange={(e) => setDay(e.target.value)} disabled={locked} aria-invalid={!valid} />
          {!valid && <p className="text-xs text-destructive">Enter a whole number from 1 to 28.</p>}
        </div>
        {isError && <p className="text-sm text-destructive">Settings could not be loaded</p>}
        <Hint>September's OPS and CM reports are due by this day in October. Reminders (a later release) count back from it.</Hint>
        {canEdit && (
          <Button className="min-h-11" onClick={onSave} disabled={!valid || isSaving || locked}>{isSaving ? 'Saving…' : 'Save'}</Button>
        )}
      </CardContent>
    </Card>
  );
}
