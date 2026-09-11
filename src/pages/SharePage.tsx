/**
 * Public share page (spec §5.8): /share/:token. No session. Branding from the anon-readable
 * organization_branding view; report metadata from report-share GET; the PDF opens through a
 * 10-minute signed URL from report-share POST. The PDF itself carries DRAFT unless approved.
 *
 * The token is the credential, so nothing on this page may reveal more than the function already
 * returns: every refusal (unknown, revoked, expired, wrong passcode) comes back as the same 404 and
 * is worded the same way here.
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Lock, FileText } from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatPeriodLabel } from '@/lib/fortressReports';
import { headerTextColor } from '@/lib/headerTextColor';
import { REPORT_TYPE_LABELS, type ReportType } from '@/integrations/supabase/fortress-db';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/report-share`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface ShareMeta {
  building: string;
  title: string;
  type: ReportType;
  period: string;
  reportStatus: string;
  issuedAt: string;
  expiresAt: string;
  needsPasscode: boolean;
}

export async function fetchShareMeta(token: string): Promise<ShareMeta | null> {
  // A malformed token cannot exist, so it never leaves the browser.
  if (!TOKEN_RE.test(token)) return null;
  const res = await fetch(`${FN_URL}?t=${encodeURIComponent(token)}`, { headers: { apikey: ANON_KEY } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ShareMeta;
}

export type OpenResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'not_found' | 'locked' | 'error'; retryAfterSeconds?: number };

export async function openShare(token: string, passcode?: string): Promise<OpenResult> {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ t: token, passcode }),
  });
  if (res.status === 200) return { ok: true, url: ((await res.json()) as { url: string }).url };
  if (res.status === 429) {
    const body = (await res.json().catch(() => ({}))) as { retryAfterSeconds?: number };
    return { ok: false, reason: 'locked', retryAfterSeconds: body.retryAfterSeconds };
  }
  if (res.status === 404) return { ok: false, reason: 'not_found' };
  return { ok: false, reason: 'error' };
}

export default function SharePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [passcode, setPasscode] = useState('');
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // The same anon branding read the theme provider above this route already performs — going through
  // the shared hook rather than a second query keeps the public page to one request for it.
  const { organization } = useOrganization();
  const meta = useQuery({ queryKey: ['share-page', token], retry: false, queryFn: () => fetchShareMeta(token) });

  const open = async () => {
    setProblem(null);
    setOpening(true);
    // Open the tab synchronously (popup blockers), then point it at the signed URL. The new tab keeps
    // a live `window.opener` back to this page until it is nulled — the PDF viewer must not hold a
    // handle that can navigate this page or read its origin.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const r = await openShare(token, passcode || undefined);
      if (r.ok) {
        if (tab) tab.location.href = r.url;
        else window.location.assign(r.url);
        return;
      }
      tab?.close();
      setProblem(
        r.reason === 'locked'
          ? `Too many attempts. Try again in ${Math.ceil((r.retryAfterSeconds ?? 900) / 60)} minutes.`
          : r.reason === 'not_found'
            ? (meta.data?.needsPasscode
                ? 'That passcode is not right, or the link has expired.'
                : 'This link is no longer available.')
            : 'Could not open the report. Try again.',
      );
    } finally {
      setOpening(false);
    }
  };

  const color = organization?.primary_color && /^#[0-9a-f]{6}$/i.test(organization.primary_color)
    ? organization.primary_color
    : '#2563eb';
  const textColor = headerTextColor(color);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="px-4 py-4" style={{ background: color, color: textColor }}>
        <div className="mx-auto flex max-w-lg items-center gap-3">
          {organization?.logo_url ? <img src={organization.logo_url} alt="" className="h-8 w-auto rounded bg-white p-1" /> : null}
          <span className="text-base font-semibold">{organization?.name ?? 'Building Ops'}</span>
        </div>
      </header>
      <main className="mx-auto max-w-lg p-4">
        {meta.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : meta.isError ? (
          <p className="text-sm text-destructive">Could not load this link. Try again later.</p>
        ) : !meta.data ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              This link is not available. It may have expired or been revoked — ask the sender for a new one.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{meta.data.title?.toUpperCase()}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {REPORT_TYPE_LABELS[meta.data.type] ?? meta.data.type} · {meta.data.building} · {formatPeriodLabel(meta.data.period)}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant={meta.data.reportStatus === 'approved' ? 'default' : 'outline'} className="capitalize">
                  {meta.data.reportStatus}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Issued {new Date(meta.data.issuedAt).toLocaleDateString('en-ZA')} · Link expires{' '}
                  {new Date(meta.data.expiresAt).toLocaleDateString('en-ZA')}
                </span>
              </div>
              {meta.data.reportStatus !== 'approved' && (
                <p className="text-sm">This PDF was issued before approval and carries a DRAFT watermark.</p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {meta.data.needsPasscode && (
                <div className="space-y-1">
                  <Label htmlFor="passcode" className="flex items-center gap-1">
                    <Lock className="h-3 w-3" /> Passcode
                  </Label>
                  <Input
                    id="passcode"
                    type="password"
                    autoComplete="off"
                    inputMode="text"
                    className="h-11"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void open(); }}
                  />
                </div>
              )}
              {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
              <Button
                className="h-11 w-full"
                disabled={opening || (meta.data.needsPasscode && !passcode)}
                onClick={() => void open()}
              >
                {opening ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                Open PDF
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
