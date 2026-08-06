/**
 * Saved-reports browser (standard D6): lists persisted report artifacts
 * (version, date, size) with signed-URL Preview (iframe dialog) and Download.
 * Reads are RLS-scoped server-side; downloads go through fetch + status check
 * + empty-blob guard rather than a bare anchor (standard D4).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Eye, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  createArtifactSignedUrl,
  listReportArtifacts,
  REPORT_KIND_LABELS,
  type ReportArtifactKind,
  type ReportArtifactRow,
} from '@/lib/reportArtifacts';

function kindLabel(kind: string): string {
  return REPORT_KIND_LABELS[kind as ReportArtifactKind] ?? kind;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function SavedReportsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['report-artifacts'],
    queryFn: async () => {
      const { data: rows, error } = await listReportArtifacts();
      if (error) throw new Error(error);
      return rows;
    },
  });

  const [preview, setPreview] = useState<{ artifact: ReportArtifactRow; url: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handlePreview = async (artifact: ReportArtifactRow) => {
    setBusyId(artifact.id);
    try {
      const { url, error } = await createArtifactSignedUrl(artifact.file_path);
      if (!url) {
        toast.error(`Could not open the report preview${error ? `: ${error}` : '.'}`);
        return;
      }
      setPreview({ artifact, url });
    } finally {
      setBusyId(null);
    }
  };

  const handleDownload = async (artifact: ReportArtifactRow) => {
    setBusyId(artifact.id);
    try {
      const { url, error } = await createArtifactSignedUrl(artifact.file_path, { downloadAs: artifact.file_name });
      if (!url) {
        toast.error(`Could not prepare the download${error ? `: ${error}` : '.'}`);
        return;
      }
      const res = await fetch(url);
      if (!res.ok) {
        toast.error(`Download failed (HTTP ${res.status}).`);
        return;
      }
      const blob = await res.blob();
      if (blob.size === 0) {
        toast.error('Download failed: the stored file is empty.');
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = artifact.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (e) {
      if (import.meta.env.DEV) console.error('Artifact download failed:', e);
      toast.error('Download failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Saved Reports</CardTitle>
        <CardDescription>
          Every generated report is kept here as a versioned copy — preview or re-download without regenerating.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data || data.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No saved reports yet. Generated PDFs will appear here automatically.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Report</TableHead>
                <TableHead className="w-16 text-center">Version</TableHead>
                <TableHead className="w-40">Generated</TableHead>
                <TableHead className="w-20 text-right">Size</TableHead>
                <TableHead className="w-28 text-center">Status</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((artifact) => (
                <TableRow key={artifact.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{kindLabel(artifact.kind)}</p>
                        <p className="truncate text-xs text-muted-foreground">{artifact.file_name}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-center tabular-nums">v{artifact.version}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(artifact.created_at).toLocaleString('en-ZA', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {formatSize(artifact.size_bytes)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={artifact.status === 'issued' ? 'default' : 'outline'} className="capitalize">
                      {artifact.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === artifact.id}
                        onClick={() => handlePreview(artifact)}
                        aria-label={`Preview ${artifact.file_name}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === artifact.id}
                        onClick={() => handleDownload(artifact)}
                        aria-label={`Download ${artifact.file_name}`}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{preview ? kindLabel(preview.artifact.kind) : 'Report preview'}</DialogTitle>
            <DialogDescription>
              {preview ? `${preview.artifact.file_name} · v${preview.artifact.version}` : ''}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <iframe src={preview.url} title={preview.artifact.file_name} className="h-[70vh] w-full rounded-md border" />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
