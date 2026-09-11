/**
 * Building → Tenants: the tenant intake link (spec §5.10). Hidden until the org's tenant_intake
 * feature flag is on and only for admin/manager. Shows the live link with its QR code, prints
 * the A5 sheet, and rotates/disables the token. The card body is a separate component so the
 * flag/role gate can return early without breaking the rules of hooks.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toDataURL } from 'qrcode';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Copy, Printer, QrCode, RefreshCw, Ban, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useFeature } from '@/hooks/useOrgSettings';
import { useOrganization } from '@/hooks/useOrganization';
import { useIntakeTokens } from '@/hooks/useIntakeTokens';
import { intakeSheetHtml, openPrintWindow } from '@/lib/intakeSheet';
import { formatBuildingName } from '@/lib/buildingName';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Hint } from '@/components/ui/hint';

interface Props { buildingId: string }

export function TenantIntakeCard({ buildingId }: Props) {
  const enabled = useFeature('tenant_intake');
  const { isAdminOrManager } = useAuth();
  if (!enabled || !isAdminOrManager) return null;
  return <IntakeCardBody buildingId={buildingId} />;
}

function IntakeCardBody({ buildingId }: Props) {
  const { token, url, isLoading, isError, isMutating, create, rotate, disable } = useIntakeTokens(buildingId);
  const { organization } = useOrganization();
  const { data: buildingName } = useQuery({
    queryKey: ['building-name', buildingId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('buildings').select('name').eq('id', buildingId).maybeSingle();
      if (error) throw error;
      return formatBuildingName(data?.name ?? null) || 'this building';
    },
  });
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!url) { setQr(null); return; }
    toDataURL(url, { width: 256, margin: 1, errorCorrectionLevel: 'M' })
      .then((d) => { if (!cancelled) setQr(d); })
      .catch(() => { if (!cancelled) setQr(null); });
    return () => { cancelled = true; };
  }, [url]);

  const run = async (fn: () => Promise<void>, done: string) => {
    try { await fn(); toast.success(done); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong'); }
  };
  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); toast.success('Link copied'); }
    catch { toast.error('Could not copy — select the link and copy it by hand'); }
  };
  const print = () => {
    if (!url || !qr) return;
    const html = intakeSheetHtml({
      buildingName: buildingName ?? 'this building',
      orgName: organization?.name ?? 'Building Ops',
      url,
      qrDataUrl: qr,
    });
    if (!openPrintWindow(html)) toast.error('Your browser blocked the print window. Allow pop-ups for this site and try again.');
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><QrCode className="h-4 w-4" />Tenant intake</CardTitle>
        <CardDescription>A QR code tenants scan to report a problem in {buildingName ?? 'this building'} — no login needed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : isError ? (
          <p className="text-sm text-destructive">Could not load the intake link.</p>
        ) : !token ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No intake link yet.</p>
            <Button className="h-11" onClick={() => void run(create, 'Intake link created')} disabled={isMutating}>Create link</Button>
            <Hint>Create the link, print the sheet, and put it where tenants will see it — the centre entrance, the loading bay, the notice board</Hint>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="shrink-0 self-center sm:self-start">
              {qr
                ? <img src={qr} alt="QR code for the tenant report form" className="h-40 w-40 rounded-md border bg-white" />
                : <div className="h-40 w-40 rounded-md border bg-muted" />}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{token.submissions_count} report{token.submissions_count === 1 ? '' : 's'}</Badge>
                <span className="text-muted-foreground">
                  {token.last_used_at ? `Last used ${format(new Date(token.last_used_at), 'd MMM yyyy')}` : 'Not used yet'}
                </span>
              </div>
              <code className="block break-all rounded bg-muted px-2 py-1.5 text-xs" aria-label="Intake link">{url}</code>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="h-11" onClick={() => void copy()}><Copy className="mr-2 h-4 w-4" />Copy link</Button>
                <Button variant="outline" className="h-11" onClick={print} disabled={!qr}><Printer className="mr-2 h-4 w-4" />Print QR sheet</Button>
                <Button
                  variant="outline"
                  className="h-11"
                  disabled={isMutating}
                  onClick={() => {
                    if (window.confirm('Rotate the link? The printed QR codes stop working and you will need to print new ones.')) {
                      void run(rotate, 'Intake link rotated — print the new sheet');
                    }
                  }}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />Rotate
                </Button>
                <Button
                  variant="ghost"
                  className="h-11 text-destructive"
                  disabled={isMutating}
                  onClick={() => {
                    if (window.confirm('Disable tenant intake for this building? Scanning the QR code will show "link not active".')) {
                      void run(disable, 'Intake link disabled');
                    }
                  }}
                >
                  <Ban className="mr-2 h-4 w-4" />Disable
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Anyone with this link can report a problem in this building. Rotate it if it leaks.</p>
              <Hint>Reports arrive on the Issues page with a Tenant chip and go to the building's assignee; each tenant gets a reference number to quote</Hint>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
