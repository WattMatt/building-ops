import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Lock, Pencil } from 'lucide-react';
import { resolveDocUrl } from './documents/resolveDocUrl';
import type { UnifiedDocument } from './documents/types';

function kind(name: string): 'pdf' | 'image' | 'other' {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  return 'other';
}

interface Props {
  docs: UnifiedDocument[]; // the filtered+sorted list to navigate
  index: number | null; // which doc is open; null = closed
  onIndexChange: (i: number | null) => void;
}

export default function DocumentPreviewModal({ docs, index, onIndexChange }: Props) {
  const open = index !== null;
  const doc = open ? docs[index] : null;
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!doc) {
      setUrl(null);
      return;
    }
    setLoading(true);
    resolveDocUrl(doc).then((u) => {
      if (!cancelled) {
        setUrl(u);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && index! > 0) onIndexChange(index! - 1);
      if (e.key === 'ArrowRight' && index! < docs.length - 1) onIndexChange(index! + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, docs.length, onIndexChange]);

  if (!doc) return null;
  const k = kind(doc.name);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onIndexChange(null)}>
      <DialogContent className="max-w-4xl w-[90vw] h-[85vh] flex flex-col p-0 gap-0">
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium truncate">{doc.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {doc.scope === 'shop'
                ? `Shop ${doc.shopNumber ?? '—'}${doc.tenantName ? ` · ${doc.tenantName}` : ''}`
                : doc.scope === 'site'
                  ? 'Site-level'
                  : 'Building'}
              {doc.sizeBytes ? ` · ${(doc.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ''}
            </p>
          </div>
          <Badge variant="secondary" className="gap-1 shrink-0">
            {doc.editable ? <Pencil className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            {doc.editable ? 'Managed' : 'Live'}
          </Badge>
          {url && (
            <Button variant="outline" size="sm" asChild>
              <a href={url} download target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4 mr-1" /> Download
              </a>
            </Button>
          )}
        </div>

        <div className="flex-1 min-h-0 bg-muted/40 flex items-center justify-center overflow-auto">
          {loading ? (
            <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          ) : !url ? (
            <p className="text-sm text-muted-foreground">Could not load this file.</p>
          ) : k === 'pdf' ? (
            <iframe title={doc.name} src={url} className="w-full h-full" />
          ) : k === 'image' ? (
            <img src={url} alt={doc.name} className="max-w-full max-h-full object-contain" />
          ) : (
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">Preview isn’t available for this file type.</p>
              <Button asChild>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1" /> Open file
                </a>
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t text-sm">
          <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => onIndexChange(index! - 1)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Previous
          </Button>
          <span className="text-muted-foreground">
            {index! + 1} of {docs.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={index === docs.length - 1}
            onClick={() => onIndexChange(index! + 1)}
          >
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
