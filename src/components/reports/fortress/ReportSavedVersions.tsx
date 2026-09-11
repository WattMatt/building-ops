/**
 * The PDFs already issued for THIS report.
 *
 * Every export is kept as a versioned copy in the private generated-reports bucket, but
 * until now the only way to find one was the portfolio-wide Saved Reports card on the
 * Compliance Reports page — there was no route back from the report that produced it. So
 * re-sending last month's pack meant regenerating it, which quietly issues a new version.
 */
import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Loader2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { downloadBlob } from '@/lib/exportCsv';
import { listReportArtifactsForSource, createArtifactSignedUrl, type ReportArtifactRow } from '@/lib/reportArtifacts';

const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const fmtWhen = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

interface ReportSavedVersionsProps {
  reportId: string;
  /** Given only when share links are on and the viewer may share: adds a per-version Share button. */
  onShare?: (a: ReportArtifactRow) => void;
}

export function ReportSavedVersions({ reportId, onShare }: ReportSavedVersionsProps) {
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['report-artifacts', reportId],
    queryFn: async () => {
      const { data: rows, error } = await listReportArtifactsForSource(reportId);
      if (error) throw new Error(error);
      return rows;
    },
  });

  const download = useCallback(async (a: ReportArtifactRow) => {
    setBusy(a.id);
    try {
      const { url, error } = await createArtifactSignedUrl(a.file_path, { downloadAs: a.file_name });
      if (!url) {
        toast.error(`Could not prepare the download${error ? `: ${error}` : '.'}`);
        return;
      }
      // Fetch first so an expired or forbidden URL surfaces as an error rather than
      // navigating the user to an error page in a new tab.
      const res = await fetch(url);
      if (!res.ok) {
        toast.error(`Could not download this version (${res.status}).`);
        return;
      }
      // The shared helper, not a local copy: it defers the revoke, which the copy here did not —
      // a synchronous revoke can beat a browser that starts the download asynchronously.
      downloadBlob(await res.blob(), a.file_name);
    } catch (e) {
      if (import.meta.env.DEV) console.error('Artifact download failed:', e);
      toast.error('Could not download this version.');
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Issued PDFs</CardTitle>
        <CardDescription>
          Every export of this report is kept as a versioned copy. Re-download one instead of
          regenerating, which would issue a new version.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <div className="text-sm">
            <p className="text-destructive">Could not load issued PDFs.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>Try again</Button>
          </div>
        ) : !data?.length ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <FileText className="h-5 w-5 shrink-0" />
            <p>No PDF has been exported for this report yet. Use “Export PDF” above.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    v{a.version} · {fmtWhen(a.created_at)} · {fmtSize(a.size_bytes)}
                  </p>
                </div>
                {a.status === 'issued' && <Badge className="text-xs">Current</Badge>}
                {a.status === 'superseded' && (
                  <Badge variant="outline" className="text-xs">superseded</Badge>
                )}
                {/* Which PDF is safe to send a client: one exported before approval is not (E2). */}
                {a.report_status && a.report_status !== 'approved' && (
                  <Badge variant="outline" className="text-xs">exported while {a.report_status}</Badge>
                )}
                {onShare && (
                  <Button variant="outline" size="sm" className="min-h-11" onClick={() => onShare(a)}>
                    <Share2 className="mr-2 h-4 w-4" />
                    Share this version
                  </Button>
                )}
                <Button variant="outline" size="sm" disabled={busy === a.id} onClick={() => download(a)}>
                  {busy === a.id
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <Download className="mr-2 h-4 w-4" />}
                  Download
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
