import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { COMPLIANCE_CATEGORIES } from '@/lib/compliance';

type TaskFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';

interface TemplateItem {
  id: string;
  task_name: string;
  task_description: string | null;
  responsible_party: string | null;
  requires_photo: boolean;
  requires_signature: boolean;
  display_order: number;
  template_id: string;
  category: string | null;
  template?: {
    id: string;
    name: string;
    frequency: TaskFrequency;
  };
}

interface Template {
  id: string;
  name: string;
  frequency: TaskFrequency;
}

interface TemplateItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: TemplateItem | null;
  templates: Template[];
  defaultTemplateId?: string;
  onSuccess: () => void;
}

const responsibleParties = [
  'Cleaning Staff',
  'Maintenance',
  'Security',
  'Operations',
  'Security/Operations',
  'Security/Maintenance',
  'HVAC Contractor',
  'Electrical Contractor',
  'Fire Safety Contractor',
  'Structural Contractor',
  'Roofing Contractor',
  'Pest Control Contractor',
  'Contractors',
  'Facilities/Accessibility Consultant',
  'Legal/Operations',
  'Security/IT',
];

export default function TemplateItemDialog({
  open,
  onOpenChange,
  item,
  templates,
  defaultTemplateId,
  onSuccess,
}: TemplateItemDialogProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    task_name: '',
    task_description: '',
    responsible_party: 'Operations',
    requires_photo: false,
    requires_signature: true,
    template_id: defaultTemplateId || '',
    category: '',
  });

  useEffect(() => {
    if (item) {
      setFormData({
        task_name: item.task_name,
        task_description: item.task_description || '',
        responsible_party: item.responsible_party || 'Operations',
        requires_photo: item.requires_photo || false,
        requires_signature: item.requires_signature ?? true,
        template_id: item.template_id,
        category: item.category || '',
      });
    } else {
      setFormData({
        task_name: '',
        task_description: '',
        responsible_party: 'Operations',
        requires_photo: false,
        requires_signature: true,
        template_id: defaultTemplateId || templates[0]?.id || '',
        category: '',
      });
    }
  }, [item, defaultTemplateId, templates, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.task_name.trim() || !formData.template_id) {
      toast.error('Task name and template are required');
      return;
    }

    setLoading(true);
    try {
      if (item) {
        // Update existing item
        const { error } = await supabase
          .from('template_items')
          .update({
            task_name: formData.task_name.trim(),
            task_description: formData.task_description.trim() || null,
            responsible_party: formData.responsible_party,
            requires_photo: formData.requires_photo,
            requires_signature: formData.requires_signature,
            template_id: formData.template_id,
            category: formData.category || null,
          })
          .eq('id', item.id);

        if (error) throw error;
        toast.success('Task updated successfully');
      } else {
        // Get max display order for this template
        const { data: existingItems } = await supabase
          .from('template_items')
          .select('display_order')
          .eq('template_id', formData.template_id)
          .order('display_order', { ascending: false })
          .limit(1);

        const nextOrder = existingItems && existingItems.length > 0 
          ? existingItems[0].display_order + 1 
          : 0;

        // Create new item
        const { error } = await supabase.from('template_items').insert({
          task_name: formData.task_name.trim(),
          task_description: formData.task_description.trim() || null,
          responsible_party: formData.responsible_party,
          requires_photo: formData.requires_photo,
          requires_signature: formData.requires_signature,
          template_id: formData.template_id,
          display_order: nextOrder,
          category: formData.category || null,
        });

        if (error) throw error;
        toast.success('Task created successfully');
      }

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving template item:', error);
      toast.error('Failed to save task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit Task' : 'Add New Task'}</DialogTitle>
          <DialogDescription>
            {item ? 'Update the checklist task details' : 'Add a new task to the checklist template'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template">Checklist Template *</Label>
            <Select
              value={formData.template_id}
              onValueChange={(v) => setFormData({ ...formData, template_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({t.frequency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="task_name">Task Name *</Label>
            <Input
              id="task_name"
              value={formData.task_name}
              onChange={(e) => setFormData({ ...formData, task_name: e.target.value })}
              placeholder="e.g., Restroom Consumables Restock"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task_description">Description</Label>
            <Textarea
              id="task_description"
              value={formData.task_description}
              onChange={(e) => setFormData({ ...formData, task_description: e.target.value })}
              placeholder="Detailed instructions for this task..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="responsible_party">Responsible Party</Label>
            <Select
              value={formData.responsible_party}
              onValueChange={(v) => setFormData({ ...formData, responsible_party: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select responsible party" />
              </SelectTrigger>
              <SelectContent>
                {responsibleParties.map((party) => (
                  <SelectItem key={party} value={party}>
                    {party}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Compliance Category</Label>
            <Select
              value={formData.category || 'none'}
              onValueChange={(v) => setFormData({ ...formData, category: v === 'none' ? '' : v })}
            >
              <SelectTrigger id="category">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {COMPLIANCE_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between py-2">
            <div className="space-y-0.5">
              <Label>Requires Photo</Label>
              <p className="text-xs text-muted-foreground">User must attach a photo when completing</p>
            </div>
            <Switch
              checked={formData.requires_photo}
              onCheckedChange={(v) => setFormData({ ...formData, requires_photo: v })}
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <div className="space-y-0.5">
              <Label>Requires Signature</Label>
              <p className="text-xs text-muted-foreground">User must confirm with digital signature</p>
            </div>
            <Switch
              checked={formData.requires_signature}
              onCheckedChange={(v) => setFormData({ ...formData, requires_signature: v })}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {item ? 'Update Task' : 'Add Task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
