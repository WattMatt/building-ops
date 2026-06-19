import { Fragment, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FileText,
  MoreVertical,
  Eye,
  Download,
  Edit,
  Trash2,
  Lock,
  Pencil,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { DocSection } from './documents/filterDocuments';
import type { UnifiedDocument, StatusKind } from './documents/types';

const STATUS_VARIANT: Record<StatusKind, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  success: 'default',
  warning: 'outline',
  danger: 'destructive',
  neutral: 'secondary',
};

interface Props {
  sections: DocSection[];
  flat: UnifiedDocument[]; // visual order, for preview indexing
  narrowed: boolean; // a search query or filter is active → auto-expand so matches show
  canEdit: boolean;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleAll: (keys: string[], on: boolean) => void;
  onPreview: (doc: UnifiedDocument) => void;
  onDownload: (doc: UnifiedDocument) => void;
  onEdit: (doc: UnifiedDocument) => void;
  onDelete: (doc: UnifiedDocument) => void;
}

function sizeLabel(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DocumentsTable(p: Props) {
  // Sections default to COLLAPSED on load — track the ones the user has explicitly opened.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleSection = (label: string) =>
    setExpanded((e) => {
      const n = new Set(e);
      if (n.has(label)) n.delete(label);
      else n.add(label);
      return n;
    });
  // Open if the user opened it, or there's only one section, or a search/filter is active.
  const isOpen = (label: string) =>
    p.narrowed || p.sections.length === 1 || expanded.has(label);

  if (p.flat.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 border rounded-lg">
        <FileText className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="font-medium">No documents found</p>
        <p className="text-sm text-muted-foreground">Try adjusting your search or filters.</p>
      </div>
    );
  }

  const selectableKeys = p.flat.filter((d) => d.editable).map((d) => d.key);
  const allSelected = selectableKeys.length > 0 && selectableKeys.every((k) => p.selected.has(k));
  const cols = p.canEdit ? 6 : 5;

  const row = (doc: UnifiedDocument) => (
    <TableRow key={doc.key}>
      {p.canEdit && (
        <TableCell>
          {doc.editable && (
            <Checkbox
              checked={p.selected.has(doc.key)}
              onCheckedChange={() => p.onToggle(doc.key)}
              aria-label={`Select ${doc.name}`}
            />
          )}
        </TableCell>
      )}
      <TableCell>
        <button
          className="flex items-center gap-2 text-left hover:underline"
          onClick={() => p.onPreview(doc)}
        >
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium truncate max-w-[260px]">{doc.name}</span>
          {doc.sizeBytes ? (
            <span className="text-xs text-muted-foreground">{sizeLabel(doc.sizeBytes)}</span>
          ) : null}
        </button>
      </TableCell>
      <TableCell className="truncate max-w-[160px]">{doc.type}</TableCell>
      <TableCell>
        <Badge variant="secondary" className="gap-1">
          {doc.editable ? <Pencil className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          {doc.editable ? 'Managed' : 'Live'}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[doc.status.kind]}>{doc.status.label}</Badge>
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => p.onPreview(doc)}>
              <Eye className="h-4 w-4 mr-2" /> Preview
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => p.onDownload(doc)}>
              <Download className="h-4 w-4 mr-2" /> Download
            </DropdownMenuItem>
            {p.canEdit && doc.editable && (
              <>
                <DropdownMenuItem onClick={() => p.onEdit(doc)}>
                  <Edit className="h-4 w-4 mr-2" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => p.onDelete(doc)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            {p.canEdit && (
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(v) => p.onToggleAll(selectableKeys, !!v)}
                  aria-label="Select all editable"
                />
              </TableHead>
            )}
            <TableHead>Name</TableHead>
            <TableHead>Type / category</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[60px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {p.sections.map((section) => {
            const open = isOpen(section.label);
            return (
              <Fragment key={section.label}>
                <TableRow className="bg-muted/50 hover:bg-muted/60 cursor-pointer" onClick={() => toggleSection(section.label)}>
                  <TableCell colSpan={cols} className="py-2 text-xs font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {section.label}
                      <span className="text-muted-foreground font-normal">· {section.count}</span>
                    </span>
                  </TableCell>
                </TableRow>
                {open &&
                  section.subgroups.map((sg, i) => (
                    <Fragment key={sg.label ?? `__flat${i}`}>
                      {sg.label && (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={cols} className="py-1 pl-8 text-xs font-medium text-muted-foreground">
                            {sg.label}
                          </TableCell>
                        </TableRow>
                      )}
                      {sg.docs.map(row)}
                    </Fragment>
                  ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
