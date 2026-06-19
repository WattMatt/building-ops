import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { useBuildingInsightLinker } from '@/integrations/supabase/insight-linker';
import { Button } from '@/components/ui/button';
import { useBuildingDocuments, type DocumentFormValues } from './documents/useBuildingDocuments';
import { unifyDocuments } from './documents/unifyDocuments';
import {
  searchDocuments,
  applyFilters,
  groupDocuments,
  needAttentionCount,
  type DocFilters,
  type GroupBy,
} from './documents/filterDocuments';
import { resolveDocUrl } from './documents/resolveDocUrl';
import type { UnifiedDocument, BuildingDocumentRow } from './documents/types';
import DocumentsToolbar from './DocumentsToolbar';
import DocumentsTable from './DocumentsTable';
import DocumentPreviewModal from './DocumentPreviewModal';
import DocumentFormDialog, { type DocumentFormSubmit } from './DocumentFormDialog';

interface DocumentsTabProps {
  buildingId: string;
}

const METRIC = 'rounded-md bg-muted/50 px-4 py-3';

export default function DocumentsTab({ buildingId }: DocumentsTabProps) {
  const { isAdminOrManager, user } = useAuth();
  const { list, create, update, remove } = useBuildingDocuments(buildingId);
  const il = useBuildingInsightLinker(buildingId, true);

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<DocFilters>({ source: 'all', type: 'all', status: 'all', shop: 'all' });
  const [groupBy, setGroupBy] = useState<GroupBy>('section');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UnifiedDocument | null>(null);

  const managedRows = (list.data ?? []) as BuildingDocumentRow[];
  const all = useMemo(() => unifyDocuments(managedRows, il.data), [managedRows, il.data]);
  const visible = useMemo(() => applyFilters(searchDocuments(all, query), filters), [all, query, filters]);
  const sections = useMemo(() => groupDocuments(visible, groupBy), [visible, groupBy]);
  const flat = useMemo(
    () => sections.flatMap((s) => s.subgroups.flatMap((sg) => sg.docs)),
    [sections],
  );

  const metaFor = (doc: UnifiedDocument | null): DocumentFormValues | null => {
    if (!doc?.managedId) return null;
    const r = managedRows.find((x) => x.id === doc.managedId);
    if (!r) return null;
    return {
      name: r.name,
      document_type: r.document_type,
      reference_number: r.reference_number,
      issue_date: r.issue_date,
      expiry_date: r.expiry_date,
      issuing_authority: r.issuing_authority,
      notes: r.notes,
    };
  };

  const download = async (doc: UnifiedDocument) => {
    const url = await resolveDocUrl(doc);
    if (!url) {
      toast.error('Could not resolve this file');
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.download = doc.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const downloadSelected = async () => {
    const picked = flat.filter((d) => selected.has(d.key));
    for (const d of picked) {
      await download(d); // sequential, no zip
    }
  };

  const submitForm = async ({ values, files }: DocumentFormSubmit) => {
    try {
      if (editing?.managedId) {
        await update.mutateAsync({ id: editing.managedId, values, file: files[0] ?? null, userId: user?.id ?? null });
        toast.success('Document updated');
      } else {
        await create.mutateAsync({ values, files, userId: user?.id ?? null });
        toast.success(files.length > 1 ? `${files.length} documents added` : 'Document added');
      }
      setFormOpen(false);
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save document');
    }
  };

  const deleteOne = async (doc: UnifiedDocument) => {
    if (!doc.managedId || !confirm(`Delete ${doc.name}?`)) return;
    try {
      await remove.mutateAsync([doc.managedId]);
      toast.success('Document deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete');
    }
  };
  const deleteSelected = async () => {
    const ids = flat.filter((d) => selected.has(d.key) && d.managedId).map((d) => d.managedId!) as string[];
    if (ids.length === 0 || !confirm(`Delete ${ids.length} document(s)?`)) return;
    try {
      await remove.mutateAsync(ids);
      setSelected(new Set());
      toast.success(`${ids.length} deleted`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const toggleAll = (keys: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      keys.forEach((k) => (on ? n.add(k) : n.delete(k)));
      return n;
    });

  if (list.isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const managedCount = all.filter((d) => d.source === 'managed').length;
  const ilCount = all.length - managedCount;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={METRIC}>
          <div className="text-xs text-muted-foreground">All documents</div>
          <div className="text-2xl font-medium">{all.length}</div>
        </div>
        <div className={METRIC}>
          <div className="text-xs text-muted-foreground">Managed here</div>
          <div className="text-2xl font-medium">{managedCount}</div>
        </div>
        <div className={METRIC}>
          <div className="text-xs text-muted-foreground">Insight-linker</div>
          <div className="text-2xl font-medium">
            {ilCount}
            {il.isLoading ? '…' : ''}
          </div>
        </div>
        <div className={METRIC}>
          <div className="text-xs text-muted-foreground">Need attention</div>
          <div className="text-2xl font-medium text-destructive">{needAttentionCount(all)}</div>
        </div>
      </div>

      <DocumentsToolbar
        query={query}
        onQuery={setQuery}
        filters={filters}
        onFilters={setFilters}
        groupBy={groupBy}
        onGroupBy={setGroupBy}
        docs={all}
        canAdd={isAdminOrManager}
        onAdd={() => {
          setEditing(null);
          setFormOpen(true);
        }}
      />

      {isAdminOrManager && selected.size > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={downloadSelected}>
            Download selected
          </Button>
          <Button size="sm" variant="outline" className="text-destructive" onClick={deleteSelected}>
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <DocumentsTable
        sections={sections}
        flat={flat}
        canEdit={isAdminOrManager}
        selected={selected}
        onToggle={toggle}
        onToggleAll={toggleAll}
        onPreview={(doc) => setPreviewIndex(flat.findIndex((d) => d.key === doc.key))}
        onDownload={download}
        onEdit={(doc) => {
          setEditing(doc);
          setFormOpen(true);
        }}
        onDelete={deleteOne}
      />

      <DocumentPreviewModal docs={flat} index={previewIndex} onIndexChange={setPreviewIndex} />
      {isAdminOrManager && (
        <DocumentFormDialog
          open={formOpen}
          onOpenChange={(o) => {
            setFormOpen(o);
            if (!o) setEditing(null);
          }}
          editing={editing}
          editingMeta={metaFor(editing)}
          submitting={create.isPending || update.isPending}
          onSubmit={submitForm}
        />
      )}
    </div>
  );
}
