/**
 * The Documents section of a contractor sheet: insurance, certifications, contracts and the
 * like, each with an optional expiry. The expiry chip is the point of the section — an
 * expired public-liability certificate is a reason not to send that company on site — so it
 * is plain copy that stays visible whatever the hints setting.
 */
import { useRef, useState, type FormEvent } from 'react';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { ExternalLink, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { Hint } from '@/components/ui/hint';
import { todayInOperatingTz } from '@/lib/myWork';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { csvInstant, csvText, type CsvColumn } from '@/lib/exportCsv';
import {
  openContractorDocument,
  useContractorDocuments,
  type ContractorDocument,
} from '@/hooks/useContractors';

export const DOCUMENT_TYPES = [
  'Insurance',
  'Certification',
  'Contract / SLA',
  'Tax clearance',
  'BEE certificate',
  'Company registration',
  'Other',
] as const;

/** Amber inside this window, red once past. */
export const EXPIRY_WARNING_DAYS = 30;

/** Module scope: nothing here closes over the component, so it must not be rebuilt per render. */
export const DOCUMENT_CSV_COLUMNS: CsvColumn<ContractorDocument>[] = [
  { key: 'document_name', header: 'Document' },
  { key: 'document_type', header: 'Type', format: csvText },
  { key: 'expiry_date', header: 'Expiry date', format: csvText },
  { key: 'is_verified', header: 'Verified', format: (v) => (v ? 'Yes' : 'No') },
  // An instant, so it goes through the shared formatter rather than shipping a raw ISO string.
  { key: 'uploaded_at', header: 'Uploaded at', format: csvInstant },
  { key: 'notes', header: 'Notes', format: csvText },
];

export type ExpiryStatus =
  | { kind: 'none' }
  | { kind: 'ok'; days: number }
  | { kind: 'expiring'; days: number }
  | { kind: 'expired'; days: number };

/** Pure: where an expiry date sits relative to `today` (both `YYYY-MM-DD`). */
export function expiryStatus(expiry: string | null | undefined, today: string): ExpiryStatus {
  if (!expiry) return { kind: 'none' };
  const days = differenceInCalendarDays(parseISO(expiry), parseISO(today));
  if (days < 0) return { kind: 'expired', days };
  if (days <= EXPIRY_WARNING_DAYS) return { kind: 'expiring', days };
  return { kind: 'ok', days };
}

export function expiryLabel(status: ExpiryStatus, expiry: string | null | undefined): string {
  switch (status.kind) {
    case 'none':
      return 'No expiry';
    case 'expired':
      return 'expired';
    case 'expiring':
      return status.days === 0 ? 'expires today' : `expires in ${status.days} day${status.days === 1 ? '' : 's'}`;
    case 'ok':
      return `Expires ${format(parseISO(expiry!), 'dd MMM yyyy')}`;
  }
}

export function ExpiryChip({ expiry, today = todayInOperatingTz() }: { expiry: string | null | undefined; today?: string }) {
  const status = expiryStatus(expiry, today);
  const label = expiryLabel(status, expiry);
  if (status.kind === 'expired') return <Badge variant="destructive">{label}</Badge>;
  if (status.kind === 'expiring') {
    return <Badge className="border-transparent bg-amber-500 text-white hover:bg-amber-500/90">{label}</Badge>;
  }
  return <span className="text-xs text-muted-foreground">{label}</span>;
}

interface ContractorDocumentsProps {
  contractorId: string;
  /** Writes are admin/manager only under RLS and the storage policy; hide the controls otherwise. */
  canEdit: boolean;
}

export function ContractorDocuments({ contractorId, canEdit }: ContractorDocumentsProps) {
  const { documents, isLoading, isError, upload, setVerified, remove } = useContractorDocuments(contractorId);
  const [pendingRemove, setPendingRemove] = useState<ContractorDocument | null>(null);
  const today = todayInOperatingTz();

  const handleRemove = async () => {
    if (!pendingRemove) return;
    try {
      await remove.mutateAsync(pendingRemove);
      toast.success('Document removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the document.');
    } finally {
      setPendingRemove(null);
    }
  };

  return (
    <section aria-labelledby="contractor-documents-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="contractor-documents-heading" className="text-sm font-semibold">Documents</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{documents.length}</span>
          <ExportCsvButton rows={documents} columns={DOCUMENT_CSV_COLUMNS} filename="contractor-documents" />
        </div>
      </div>
      <Hint>Upload insurance and certifications with their expiry dates. Anything due within {EXPIRY_WARNING_DAYS} days shows amber here; expired shows red.</Hint>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading documents…</div>
      ) : isError ? (
        <p className="text-sm text-destructive">Could not load documents.</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.document_name}</p>
                <p className="text-xs text-muted-foreground">
                  {doc.document_type}
                  {doc.notes ? ` · ${doc.notes}` : ''}
                </p>
              </div>
              <ExpiryChip expiry={doc.expiry_date} today={today} />
              <div className="flex items-center gap-1">
                <Label htmlFor={`verified-${doc.id}`} className="text-xs text-muted-foreground">Verified</Label>
                <Switch
                  id={`verified-${doc.id}`}
                  checked={!!doc.is_verified}
                  disabled={!canEdit || setVerified.isPending}
                  onCheckedChange={(v) =>
                    setVerified.mutateAsync({ id: doc.id, is_verified: v }).catch((err: unknown) => {
                      toast.error(err instanceof Error ? err.message : 'Could not update the document.');
                    })
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11"
                aria-label={`Open ${doc.document_name}`}
                disabled={!doc.file_url}
                onClick={() => { void openContractorDocument(doc.file_url); }}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 text-destructive"
                  aria-label={`Remove ${doc.document_name}`}
                  onClick={() => setPendingRemove(doc)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <UploadForm
          busy={upload.isPending}
          onUpload={async (file, meta) => {
            try {
              await upload.mutateAsync({ file, meta });
              toast.success('Document uploaded');
              return true;
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Upload failed.');
              return false;
            }
          }}
        />
      )}

      <AlertDialog open={!!pendingRemove} onOpenChange={(o) => { if (!o) setPendingRemove(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this document?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemove?.document_name} will be deleted from the register and from storage. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Keep it</AlertDialogCancel>
            <AlertDialogAction className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(e) => { e.preventDefault(); void handleRemove(); }}>
              {remove.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function UploadForm({
  busy,
  onUpload,
}: {
  busy: boolean;
  onUpload: (file: File, meta: { document_name: string; document_type: string; expiry_date: string | null; notes: string | null }) => Promise<boolean>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<string>(DOCUMENT_TYPES[0]);
  const [expiry, setExpiry] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setName('');
    setType(DOCUMENT_TYPES[0]);
    setExpiry('');
    setNotes('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) { setError('Choose a file to upload.'); return; }
    if (!name.trim()) { setError('Give the document a name.'); return; }
    setError(null);
    const ok = await onUpload(file, {
      document_name: name.trim(),
      document_type: type,
      expiry_date: expiry || null,
      notes: notes.trim() || null,
    });
    if (ok) reset();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border p-3" aria-label="Upload document" noValidate>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          id="contractor-doc-file"
          type="file"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f && !name) setName(f.name.replace(/\.[^.]+$/, ''));
          }}
        />
        <Button type="button" variant="outline" className="min-h-11" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload className="mr-2 h-4 w-4" />
          Choose file
        </Button>
        <span className="truncate text-sm text-muted-foreground">{file ? file.name : 'No file chosen'}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="contractor-doc-name">Document name</Label>
          <Input id="contractor-doc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="contractor-doc-type">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="contractor-doc-type" aria-label="Document type" className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOCUMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="contractor-doc-expiry">Expiry date</Label>
          <Input id="contractor-doc-expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="contractor-doc-notes">Notes</Label>
          <Input id="contractor-doc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="min-h-11" disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Upload
      </Button>
    </form>
  );
}
