/**
 * Settings → Operations: default SLA hours per issue priority (organizations.settings.sla_hours). The DB
 * trigger issues_sla_defaults reads these on insert; changing them here affects issues created afterwards.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOrgSettings } from '@/hooks/useOrgSettings';
import { SLA_HOURS_MAX, SLA_HOURS_MIN, SLA_PRIORITIES, type SlaHours, type SlaPriority } from '@/lib/orgSettings';
import { PRIORITY_LABELS } from '@/lib/constants';

type Draft = Record<SlaPriority, string>;
const toDraft = (h: SlaHours): Draft => ({ critical: String(h.critical), high: String(h.high), medium: String(h.medium), low: String(h.low) });

function parse(draft: Draft): SlaHours | null {
  const out = {} as SlaHours;
  for (const p of SLA_PRIORITIES) {
    const n = Number(draft[p]);
    if (!Number.isInteger(n) || n < SLA_HOURS_MIN || n > SLA_HOURS_MAX) return null;
    out[p] = n;
  }
  return out;
}

export function SlaSettingsCard({ canEdit }: { canEdit: boolean }) {
  const { settings, isLoading, save, isSaving } = useOrgSettings();
  const [draft, setDraft] = useState<Draft>(toDraft(settings.sla_hours));
  useEffect(() => { setDraft(toDraft(settings.sla_hours)); }, [settings.sla_hours]);
  const parsed = parse(draft);

  const onSave = async () => {
    if (!parsed) return;
    try {
      await save({ ...settings, sla_hours: parsed });
      toast.success('SLA hours saved. New issues use them from now on.');
    } catch (e) {
      if (import.meta.env.DEV) console.error('Save SLA hours failed:', e);
      toast.error('Could not save the SLA hours.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Issue SLA</CardTitle>
        <CardDescription>Hours to resolve an issue, by priority. The clock starts when the issue is reported.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {SLA_PRIORITIES.map((p) => (
            <div key={p} className="space-y-2">
              <Label htmlFor={`sla-${p}`}>{PRIORITY_LABELS[p]} (hours)</Label>
              <Input
                id={`sla-${p}`}
                type="number"
                inputMode="numeric"
                min={SLA_HOURS_MIN}
                max={SLA_HOURS_MAX}
                className="h-11"
                value={draft[p]}
                onChange={(e) => setDraft({ ...draft, [p]: e.target.value })}
                disabled={!canEdit || isLoading}
              />
            </div>
          ))}
        </div>
        {!parsed && (
          <p className="text-xs text-destructive">Every value must be a whole number of hours from {SLA_HOURS_MIN} to {SLA_HOURS_MAX}.</p>
        )}
        <Hint>
          Existing issues keep the target they were created with. A breached issue is flagged on its card and in the inbox of its
          assignee and every admin and manager, checked every 15 minutes.
        </Hint>
        {canEdit && (
          <Button className="min-h-11" onClick={onSave} disabled={!parsed || isSaving || isLoading}>
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
