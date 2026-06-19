import { Fragment } from 'react';
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
import { FileText, MoreVertical, Eye, Download, Edit, Trash2, Lock, Pencil } from 'lucide-react';
import type { DocGroup } from './documents/filterDocuments';
import type { UnifiedDocument, StatusKind } from './documents/types';

const STATUS_VARIANT: Record<StatusKind, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  success: 'default',
  warning: 'outline',
  danger: 'destructive',
  neutral: 'secondary',
};

interface Props {
  groups: DocGroup[];
  flat: UnifiedDocument[]; // visual order, for preview indexing
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
            <TableHead>Linked to</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[60px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {p.groups.map((group) => (
            <Fragment key={group.label}>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={p.canEdit ? 7 : 6} className="py-1.5 text-xs font-medium">
                  {group.label} · {group.docs.length}
                </TableCell>
              </TableRow>
              {group.docs.map((doc) => (
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
                      <span className="font-medium truncate max-w-[220px]">{doc.name}</span>
                      {doc.sizeBytes ? (
                        <span className="text-xs text-muted-foreground">{sizeLabel(doc.sizeBytes)}</span>
                      ) : null}
                    </button>
                  </TableCell>
                  <TableCell className="truncate max-w-[140px]">{doc.type}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="gap-1">
                      {doc.editable ? <Pencil className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                      {doc.editable ? 'Managed' : 'Live'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {doc.scope === 'shop'
                      ? `Shop ${doc.shopNumber ?? '—'}${doc.tenantName ? ` · ${doc.tenantName}` : ''}`
                      : doc.scope === 'site'
                        ? 'Site-level'
                        : 'Building'}
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
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
