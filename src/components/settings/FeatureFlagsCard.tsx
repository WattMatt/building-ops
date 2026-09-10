/**
 * Settings → Operations: org-level feature flags (organizations.settings.features). Share links, report
 * schedules and tenant intake ship dark in R4b/R4c and stay off until an admin switches them on here.
 */
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useOrgSettings } from '@/hooks/useOrgSettings';
import { FEATURE_LABELS, FEATURE_NAMES, type FeatureName } from '@/lib/orgSettings';

export function FeatureFlagsCard({ canEdit }: { canEdit: boolean }) {
  const { settings, isLoading, isError, save, isSaving } = useOrgSettings();
  // Nothing to toggle until the real values are in: the defaults shown while loading or after a failed
  // load are not the org's, and saving them would silently overwrite whatever is stored.
  const locked = !canEdit || isLoading || isError;

  const toggle = async (name: FeatureName, on: boolean) => {
    try {
      await save({ ...settings, features: { ...settings.features, [name]: on } });
      toast.success(`${FEATURE_LABELS[name].label} ${on ? 'enabled' : 'disabled'}.`);
    } catch (e) {
      if (import.meta.env.DEV) console.error('Save feature flag failed:', e);
      toast.error('Could not save that setting.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Features</CardTitle>
        <CardDescription>Switch on the features this organization uses. Changes save immediately.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {FEATURE_NAMES.map((name) => (
          <div key={name} className="flex min-h-11 items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor={`feature-${name}`} className="font-medium">{FEATURE_LABELS[name].label}</Label>
              <p className="text-xs text-muted-foreground">{FEATURE_LABELS[name].description}</p>
            </div>
            <Switch id={`feature-${name}`} checked={settings.features[name]} disabled={locked || isSaving}
              onCheckedChange={(on) => void toggle(name, on)} aria-label={FEATURE_LABELS[name].label} />
          </div>
        ))}
        {isError && <p className="text-sm text-destructive">Settings could not be loaded</p>}
        <Hint>These features arrive in later releases; the switches are here now so they can be turned on the day they land.</Hint>
      </CardContent>
    </Card>
  );
}
