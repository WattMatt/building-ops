/**
 * Share one issued PDF with someone who has no account (spec §5.8).
 *
 * A link points at ONE artifact, not at "the report": re-exporting later never changes what a
 * recipient already holds, and a version exported before approval carries its DRAFT watermark —
 * so the version being shared is named, and an unapproved one says so in plain copy (guardrail,
 * never through <Hint>). Links expire; a passcode is optional and is hashed server-side, which is
 * why that path goes through the report-share function instead of a direct insert.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Link2, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Hint } from '@/components/ui/hint';
import type { ReportArtifactRow } from '@/lib/reportArtifacts';
import {
  EXPIRY_OPTIONS,
  isActiveShare,
  passcodeProblem,
  shareUrl,
  useReportShares,
  type ExpiryDays,
  type ReportShareRow,
} from '@/lib/reportShares';

const fmtDate = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-ZA', { dateStyle: 'medium' });
};

const fmtWhen = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
};

const artifactLabel = (a: ReportArtifactRow) =>
  `v${a.version} · ${fmtDate(a.created_at)}${a.status === 'issued' ? ' · current' : ''}${
    a.report_status && a.report_status !== 'approved' ? ` · exported while ${a.report_status}` : ''
  }`;

export interface ShareReportDialogProps {
  reportId: string;
  artifacts: ReportArtifactRow[];
  /** Pre-select the version the user pressed "Share this version" on. */
  initialArtifactId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareReportDialog({ reportId, artifacts, initialArtifactId, open, onOpenChange }: ShareReportDialogProps) {
  const { shares, isLoading, create, revoke } = useReportShares(open ? reportId : undefined);
  const [artifactId, setArtifactId] = useState<string>('');
  const [days, setDays] = useState<ExpiryDays>(30);
  const [passcode, setPasscode] = useState('');
  const [created, setCreated] = useState<{ token: string; expiresAt: string; passcode: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  // The current list, readable from the reset effect without being one of its dependencies.
  const artifactsRef = useRef(artifacts);
  artifactsRef.current = artifacts;

  // Each open starts a fresh link: leaving the previous one on screen invites sending a stale URL.
  // Deliberately NOT keyed on `artifacts`: the array identity changes on every refetch, and re-running
  // this while the dialog is open would wipe the link just created and the passcode being typed.
  useEffect(() => {
    if (!open) return;
    const fallback = artifactsRef.current.find((a) => a.status === 'issued') ?? artifactsRef.current[0];
    setArtifactId(initialArtifactId ?? fallback?.id ?? '');
    setPasscode('');
    setCreated(null);
    setCopied(false);
    setConfirmRevoke(null);
  }, [open, initialArtifactId]);

  const selected = artifacts.find((a) => a.id === artifactId) ?? null;
  const problem = passcodeProblem(passcode);
  const active = useMemo(() => shares.filter((s) => isActiveShare(s)), [shares]);
  const inactiveCount = shares.length - active.length;

  const onCreate = () => {
    if (!artifactId || problem) return;
    create.mutate(
      { reportId, artifactId, expiresInDays: days, passcode: passcode || undefined },
      {
        onSuccess: (r) => {
          setCreated({ token: r.token, expiresAt: r.expiresAt, passcode: !!passcode });
          setCopied(false);
        },
        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Could not create the link.'),
      },
    );
  };

  const onCopy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(shareUrl(created.token));
      setCopied(true);
      toast.success('Link copied.');
    } catch {
      toast.error('Could not copy the link — select it and copy manually.');
    }
  };

  const onRevoke = (s: ReportShareRow) => {
    revoke.mutate(s.id, {
      onSuccess: () => {
        setConfirmRevoke(null);
        if (created?.token === s.token) setCreated(null);
        toast.success('Link revoked.');
      },
      onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Could not revoke the link.'),
    });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Share this report</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            A link opens one saved PDF of this report. It stops working when it expires, or when you revoke it.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4">
          {!artifacts.length ? (
            <p className="text-sm text-muted-foreground">
              This report has no saved PDF yet. Export one first — a link always serves an existing version.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="share-version">Version to share</Label>
                <Select value={artifactId} onValueChange={setArtifactId}>
                  <SelectTrigger id="share-version" aria-label="Version to share" className="min-h-11">
                    <SelectValue placeholder="Choose a version" />
                  </SelectTrigger>
                  <SelectContent>
                    {artifacts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{artifactLabel(a)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Guardrail, not coaching: the recipient sees the watermark, so the sender must too. */}
                {selected?.report_status && selected.report_status !== 'approved' && (
                  <p className="text-sm">This version carries a DRAFT watermark.</p>
                )}
              </div>

              <div className="space-y-1">
                <Label>Link expires after</Label>
                <RadioGroup
                  className="flex flex-wrap gap-4"
                  value={String(days)}
                  onValueChange={(v) => setDays(Number(v) as ExpiryDays)}
                >
                  {EXPIRY_OPTIONS.map((o) => (
                    <div key={o.value} className="flex min-h-11 items-center gap-2">
                      <RadioGroupItem id={`expiry-${o.value}`} value={String(o.value)} />
                      <Label htmlFor={`expiry-${o.value}`} className="font-normal">{o.label}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className="space-y-1">
                <Label htmlFor="share-passcode">Passcode (optional)</Label>
                <Input
                  id="share-passcode"
                  className="h-11"
                  type="text"
                  autoComplete="off"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="Leave empty for no passcode"
                />
                {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
              </div>

              {/* What the link actually grants is a guardrail: it must survive hints being switched off. */}
              <p className="text-sm">Anyone with this link can open the PDF. No sign-in is required.</p>
              <Hint>Add a passcode for external recipients.</Hint>

              <Button className="min-h-11 w-full" disabled={!artifactId || !!problem || create.isPending} onClick={onCreate}>
                {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                Create link
              </Button>

              {created && (
                <div className="space-y-2 rounded-md border p-3">
                  <p className="break-all text-sm font-medium" data-testid="share-link">{shareUrl(created.token)}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" className="min-h-11" onClick={() => void onCopy()}>
                      {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                      {copied ? 'Copied' : 'Copy link'}
                    </Button>
                    <span className="text-xs text-muted-foreground">Expires {fmtDate(created.expiresAt)}</span>
                    {created.passcode && (
                      <Badge variant="outline" className="text-xs">
                        <Lock className="mr-1 h-3 w-3" /> Passcode required
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">Active links</p>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !active.length ? (
              <p className="text-sm text-muted-foreground">No active links for this report.</p>
            ) : (
              <ul className="divide-y">
                {active.map((s) => {
                  const version = artifacts.find((a) => a.id === s.artifact_id)?.version;
                  const versionLabel = version ? `v${version}` : 'a removed version';
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          {version ? `v${version}` : 'Version removed'} · expires {fmtDate(s.expires_at)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Created {fmtDate(s.created_at)} · {s.view_count} view{s.view_count === 1 ? '' : 's'}
                          {s.last_viewed_at ? ` · last opened ${fmtWhen(s.last_viewed_at)}` : ''}
                        </p>
                      </div>
                      {/* `has_passcode` is a generated boolean granted at the column level: the list can
                          say THAT a link is locked without the hash ever leaving the server. */}
                      {s.has_passcode && (
                        <Badge variant="outline" className="text-xs">
                          <Lock className="mr-1 h-3 w-3" /> Passcode
                        </Badge>
                      )}
                      {/* Every row's buttons read the same to a screen reader unless the version is named,
                          and a two-step confirm that cannot be backed out of is a trap. */}
                      {confirmRevoke === s.id ? (
                        <div className="flex flex-wrap items-center gap-2" role="status">
                          {/* Honest about the tail: a signed storage URL already handed out lives its
                              own 60 seconds out (report-share SIGNED_URL_TTL) and revocation cannot recall it. */}
                          <span className="text-sm">Revoke this link? It stops working immediately for anyone who has not already opened it.</span>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="min-h-11"
                            disabled={revoke.isPending}
                            aria-label={`Confirm revoking the link for ${versionLabel}`}
                            onClick={() => onRevoke(s)}
                          >
                            Confirm revoke
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-11"
                            aria-label={`Keep the link for ${versionLabel}`}
                            onClick={() => setConfirmRevoke(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11"
                          aria-label={`Revoke link for ${versionLabel}`}
                          onClick={() => setConfirmRevoke(s.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {inactiveCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {inactiveCount} older link{inactiveCount === 1 ? ' is' : 's are'} expired or revoked.
              </p>
            )}
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
