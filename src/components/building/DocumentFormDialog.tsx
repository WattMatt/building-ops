import { useState, useEffect, useCallback, type DragEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UploadCloud, X, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { DOCUMENT_TYPES } from './documents/documentTypes';
import type { UnifiedDocument } from './documents/types';
import type { DocumentFormValues } from './documents/useBuildingDocuments';

export interface DocumentFormSubmit {
  values: DocumentFormValues;
  files: File[]; // add mode: 0..n; edit mode: 0..1
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: UnifiedDocument | null; // null = add mode
  editingMeta: DocumentFormValues | null; // prefill for edit (looked up by caller)
  submitting: boolean;
  onSubmit: (s: DocumentFormSubmit) => Promise<void>;
}

const ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png';

export default function DocumentFormDialog({
  open,
  onOpenChange,
  editing,
  editingMeta,
  submitting,
  onSubmit,
}: Props) {
  const isEdit = !!editing;
  const [name, setName] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [issuingAuthority, setIssuingAuthority] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editingMeta ? (editing?.name ?? '') : '');
    setDocumentType(editingMeta?.document_type ?? '');
    setReferenceNumber(editingMeta?.reference_number ?? '');
    setIssueDate(editingMeta?.issue_date ?? '');
    setExpiryDate(editingMeta?.expiry_date ?? '');
    setIssuingAuthority(editingMeta?.issuing_authority ?? '');
    setNotes(editingMeta?.notes ?? '');
    setFiles([]);
  }, [open, editing, editingMeta]);

  const addFiles = useCallback(
    (picked: FileList | null) => {
      if (!picked) return;
      const next = Array.from(picked);
      setFiles((prev) => (isEdit ? next.slice(0, 1) : [...prev, ...next]));
    },
    [isEdit],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !documentType) {
      toast.error('Name and document type are required');
      return;
    }
    const values: DocumentFormValues = {
      name: name.trim(),
      document_type: documentType,
      reference_number: referenceNumber.trim() || null,
      issue_date: issueDate || null,
      expiry_date: expiryDate || null,
      issuing_authority: issuingAuthority.trim() || null,
      notes: notes.trim() || null,
    };
    await onSubmit({ values, files });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit document' : 'Add documents'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update document information' : 'Add one or more documents to this building'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="doc-name">Document name *</Label>
              <Input
                id="doc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Fire certificate 2026"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-type">Document type *</Label>
              <Select value={documentType} onValueChange={setDocumentType}>
                <SelectTrigger id="doc-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ref">Reference number</Label>
              <Input id="ref" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="auth">Issuing authority</Label>
              <Input id="auth" value={issuingAuthority} onChange={(e) => setIssuingAuthority(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="issue">Issue date</Label>
              <Input id="issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expiry">Expiry date</Label>
              <Input id="expiry" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{isEdit ? 'Replace file' : 'Files'}</Label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`rounded-md border border-dashed p-4 text-center text-sm ${
                dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
              }`}
            >
              <UploadCloud className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground">Drag files here, or</p>
              <label className="text-primary underline cursor-pointer">
                browse
                <input
                  type="file"
                  className="hidden"
                  accept={ACCEPT}
                  multiple={!isEdit}
                  onChange={(e) => addFiles(e.target.files)}
                />
              </label>
              {isEdit && editing?.storedUrl && files.length === 0 && (
                <p className="text-xs text-muted-foreground mt-2">Current file kept unless you choose a new one.</p>
              )}
            </div>
            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate flex-1">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                      aria-label={`Remove ${f.name}`}
                    >
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : isEdit ? 'Update' : files.length > 1 ? `Add ${files.length} documents` : 'Add document'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
