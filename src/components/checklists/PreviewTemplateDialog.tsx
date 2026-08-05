import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Camera, FileSignature, ListChecks, Eye } from 'lucide-react';

export interface PreviewTemplate {
  id: string;
  name: string;
  frequency: string;
  description?: string | null;
}

export interface PreviewItem {
  id: string;
  task_name: string;
  task_description: string | null;
  responsible_party: string | null;
  requires_photo: boolean;
  requires_signature: boolean;
  display_order: number;
}

export function TemplatePreviewBody({ items }: { template: PreviewTemplate; items: PreviewItem[] }) {
  const ordered = [...items].sort((a, b) => a.display_order - b.display_order);

  if (ordered.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <ListChecks className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>This checklist has no tasks yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {ordered.map((item, index) => (
        <div key={item.id} className="rounded-md border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{index + 1}. {item.task_name}</p>
              {item.task_description && (
                <p className="text-sm text-muted-foreground mt-1">{item.task_description}</p>
              )}
              {item.responsible_party && (
                <p className="text-xs text-muted-foreground mt-1">Responsible: {item.responsible_party}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              {item.requires_photo && (
                <Badge variant="secondary" className="gap-1"><Camera className="h-3 w-3" />Photo</Badge>
              )}
              {item.requires_signature && (
                <Badge variant="secondary" className="gap-1"><FileSignature className="h-3 w-3" />Signature</Badge>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PreviewTemplateDialog({
  template,
  items,
  open,
  onOpenChange,
}: {
  template: PreviewTemplate | null;
  items: PreviewItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Eye className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="truncate">{template.name}</DialogTitle>
              <p className="text-sm text-muted-foreground capitalize">{template.frequency} checklist · preview</p>
            </div>
          </div>
        </DialogHeader>
        <TemplatePreviewBody template={template} items={items} />
      </DialogContent>
    </Dialog>
  );
}
